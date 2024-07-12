# This file used to implement (partially) old plans for granular ACLs.
# It now retains only the minimum needed to keep new documents openable by old code,
# and to produce the ActionBundles expected by other code.

import json
import logging

import action_obj
import predicate_formula
from predicate_formula import NamedEntity, parse_predicate_formula_json, TreeConverter

log = logging.getLogger(__name__)


class Permissions(object):
  # Permission types and their combination are represented as bits of a single integer.
  VIEW          = 0x1
  UPDATE        = 0x2
  ADD           = 0x4
  REMOVE        = 0x8
  SCHEMA_EDIT   = 0x10
  ACL_EDIT      = 0x20
  EDITOR        = VIEW | UPDATE | ADD | REMOVE
  ADMIN         = EDITOR | SCHEMA_EDIT
  OWNER         = ADMIN | ACL_EDIT


# Special recipients, or instanceIds. ALL is the special recipient for schema actions that
# should be shared with all collaborators of the document.
ALL = '#ALL'
ALL_SET = frozenset([ALL])


def parse_acl_formulas(col_values):
  """
  Populates `aclFormulaParsed` by parsing `aclFormula` for all `col_values`.
  """
  if 'aclFormula' not in col_values:
    return

  col_values['aclFormulaParsed'] = [parse_predicate_formula_json(v)
                                    for v
                                    in col_values['aclFormula']]


class _ACLEntityCollector(TreeConverter):
  def __init__(self):
    self.entities = []    # NamedEntity list

  def visit_Attribute(self, node):
    parent = self.visit(node.value)

    # We recognize a couple of specific patterns for entities that may be affected by renames.
    if parent == ['Name', 'rec'] or parent == ['Name', 'newRec']:
      # rec.COL refers to the column from the table that the rule is on.
      self.entities.append(NamedEntity('recCol', node.last_token.startpos, node.attr, None))
    elif parent == ['Name', 'user']:
      # user.ATTR is a user attribute.
      self.entities.append(NamedEntity('userAttr', node.last_token.startpos, node.attr, None))
    elif parent[0] == 'Attr' and parent[1] == ['Name', 'user']:
      # user.ATTR.COL is a column from the lookup table of the UserAttribute ATTR.
      self.entities.append(
          NamedEntity('userAttrCol', node.last_token.startpos, node.attr, parent[2]))

    return ["Attr", parent, node.attr]


def acl_read_split(action_group):
  """
  Returns an ActionBundle containing actions from the given action_group, all in one envelope.
  With the deprecation of old-style ACL rules, envelopes are not used at all, and only kept to
  avoid triggering unrelated code changes.
  """
  bundle = action_obj.ActionBundle()
  bundle.envelopes.append(action_obj.Envelope(ALL_SET))
  bundle.stored.extend((0, da) for da in action_group.stored)
  bundle.direct.extend((0, flag) for flag in action_group.direct)
  bundle.calc.extend((0, da) for da in action_group.calc)
  bundle.undo.extend((0, da) for da in action_group.undo)
  bundle.retValues = action_group.retValues
  return bundle


def prepare_acl_table_renames(useractions, table_renames_dict):
  """
  Given a dict of table renames of the form {table_id: new_table_id}, returns a callback
  that will apply updates to the affected ACL rules and resources.
  """
  # If there are ACLResources that refer to the renamed table, prepare updates for those.
  resource_updates = []
  for resource_rec in useractions.get_docmodel().aclResources.all:
    if resource_rec.tableId in table_renames_dict:
      resource_updates.append((resource_rec, {'tableId': table_renames_dict[resource_rec.tableId]}))

  # Collect updates for any ACLRules with UserAttributes that refer to the renamed table.
  rule_updates = []
  for rule_rec in useractions.get_docmodel().aclRules.all:
    if rule_rec.userAttributes:
      try:
        rule_info = json.loads(rule_rec.userAttributes)
        if rule_info.get("tableId") in table_renames_dict:
          rule_info["tableId"] = table_renames_dict[rule_info.get("tableId")]
          rule_updates.append((rule_rec, {'userAttributes': json.dumps(rule_info)}))
      except Exception as e:
        log.warning("Error examining aclRule: %s", e)

  def do_renames():
    useractions.doBulkUpdateFromPairs('_grist_ACLResources', resource_updates)
    useractions.doBulkUpdateFromPairs('_grist_ACLRules', rule_updates)
  return do_renames


def perform_acl_rule_renames(useractions, col_renames_dict):
  """
  Given a dict of column renames of the form {(table_id, col_id): new_col_id}, returns a callback
  that will apply updates to the affected ACL rules and resources.
  """
  # Collect updates for ACLResources that refer to the renamed columns.
  resource_updates = []
  for resource_rec in useractions.get_docmodel().aclResources.all:
    t = resource_rec.tableId
    if resource_rec.colIds and resource_rec.colIds != '*':
      new_col_ids = ','.join((col_renames_dict.get((t, c)) or c)
                             for c in resource_rec.colIds.split(','))
      if new_col_ids != resource_rec.colIds:
        resource_updates.append((resource_rec, {'colIds': new_col_ids}))

  # Collect updates for any ACLRules with UserAttributes that refer to the renamed column.
  rule_updates = []
  user_attr_tables = {}   # Maps name of user attribute to its lookup table
  for rule_rec in useractions.get_docmodel().aclRules.all:
    if rule_rec.userAttributes:
      try:
        rule_info = json.loads(rule_rec.userAttributes)
        user_attr_tables[rule_info.get('name')] = rule_info.get('tableId')
        new_col_id = col_renames_dict.get((rule_info.get("tableId"), rule_info.get("lookupColId")))
        if new_col_id:
          rule_info["lookupColId"] = new_col_id
          rule_updates.append((rule_rec, {'userAttributes': json.dumps(rule_info)}))
      except Exception as e:
        log.warning("Error examining aclRule: %s", e)

  acl_resources_table = useractions.get_docmodel().aclResources.table
  # Go through again checking if anything in ACL formulas is affected by the rename.
  for rule_rec in useractions.get_docmodel().aclRules.all:

    if not rule_rec.aclFormula:
      continue
    acl_formula = rule_rec.aclFormula

    def renamer(subject):
      if subject.type == 'recCol':
        table_id = acl_resources_table.get_record(int(rule_rec.resource)).tableId
      elif subject.type == 'userAttrCol':
        table_id = user_attr_tables.get(subject.extra)
      else:
        return None
      col_id = subject.name
      return col_renames_dict.get((table_id, col_id))

    new_acl_formula = predicate_formula.process_renames(acl_formula, _ACLEntityCollector(), renamer)
    # No need to check for syntax errors, but this "if" statement must be present.
    # See perform_dropdown_condition_renames for more info.
    if new_acl_formula != acl_formula:
      new_rule_record = {
        "aclFormula": new_acl_formula,
        "aclFormulaParsed": parse_predicate_formula_json(new_acl_formula)
      }
      rule_updates.append((rule_rec, new_rule_record))

  useractions.doBulkUpdateFromPairs('_grist_ACLResources', resource_updates)
  useractions.doBulkUpdateFromPairs('_grist_ACLRules', rule_updates)
