# Access Control Lists.
#
# This modules is used by engine.py to split actions according to recipient, as well as to
# validate whether an action received from a peer is allowed by the rules.

# Where are ACLs applied?
# -----------------------
# Read ACLs (which control who can see data) are implemented by "acl_read_split" operation, which
# takes an action group and returns an action bundle, which is a list of ActionEnvelopes, each
# containing a smaller action group associated with a set of recipients who should get it. Note
# that the order of ActionEnvelopes matters, and actions should be applied in that order.
#
# In principle, this operation can be done either in the Python data engine or in Node. We do it
# in Python. The clearest reason is the need to apply ACL formulas. Not that it's impossible to do
# on the Node side, but currently formula values are only maintained on the Python side.

# UserActions and ACLs
# --------------------
# Each actions starts with a UserAction, which is turned by the data engine into a number of
# DocActions. We then split DocActions by recipient according to ACL rules. But should recipients
# receive UserActions too?
#
# If UserAction is shared, we need to split it similarly to docactions, because it will often
# contain data that some recipients should not see (e.g. a BulkUpdateRecord user-action generated
# by a copy-paste). An additional difficulty is that splitting by recipient may sometimes require
# creating multiple actions. Further, trimmed UserActions aren't enough for purposes (2) or (3).
#
# Our solution will be not to send around UserActions at all, since DocActions are sufficient to
# update a document. But UserActions are needed for some things:
#   (1) Present a meaningful description to users for the action log. This should be possible, and
#       may in fact be better, to do from docactions only.
#   (2) Redo actions. We currently use UserActions for this, but we can treat this as "undo of the
#       undo", relying on docactions, which is in fact more general. Any difficulties with that
#       are the same as for Undo, and are not specific to Redo anyway.
#   (3) Rebase pending actions after getting peers' actions from the hub. This only needs to be
#       done by the authoring instance, which will keep its original UserAction. We don't need to
#       share the UserAction for this purpose.

# Initial state
# -------------
# With sharing enabled, the ACL rules have particular defaults (in particular, with the current
# user included in the Owners group, and that group having full access in the default rule).
# Before sharing is enabled, this cannot be completely set up, because the current user is
# unknown, nor are the user's instances, and the initial instance may not even have an instanceId.
#
# Our approach is that default rules and groups are created immediately, before sharing is
# enabled. The Owners group stays empty, and action bundles end up destined for an empty list of
# recipients. Node handles empty list of recipients as its own instanceId when sharing is off.
#
# When sharing is enabled, actions are sent to add a user with the user's instances, including the
# current instance's real instanceId, to the Owners group, and Node stops handling empty list of
# recipients as special, relying on the presence of the actual instanceId instead.

# Identifying tables and columns
# ------------------------------
# If we use tableId and colId in rules, then rules need to be adjusted when tables or columns are
# renamed or removed. If we use tableRef and colRef, then such rules cannot apply to metadata
# tables (which don't have refs at all).
#
# Additionally, a benefit of using tableId and colId is that this is how actions identify tables
# and columns, so rules can be applied to actions without additional lookups.
#
# For these reasons, we use tableId and colId, rather than refs (row-ids).

# Summary tables
# --------------
# It's not sufficient to identify summary tables by their actual tableId or by tableRef, since
# both may change when summaries are removed and recreated. They should instead be identified
# by a value similar to tableTitle() in DocModel.js, specifically by the combination of source
# tableId and colIds of all group-by columns.

# Actions on Permission Changes
# -----------------------------
# When VIEW principals are added or removed for a table/column, or a VIEW ACLFormula adds or
# removes principals for a row, those principals need to receive AddRecord or RemoveRecord
# doc-actions (or equivalent). TODO: This needs to be handled.

from collections import OrderedDict
import action_obj
import logger
log = logger.Logger(__name__, logger.INFO)

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

  @classmethod
  def includes(cls, superset, subset):
    return (superset & subset) == subset

  @classmethod
  def includes_view(cls, permissions):
    return cls.includes(permissions, cls.VIEW)


# Sentinel object to represent "all rows", for internal use in this file.
_ALL_ROWS = "ALL_ROWS"


# Representation of ACL resources that's used by the ACL class. An instance of this class becomes
# the value of DocInfo.acl_resources formula.
# Note that the default ruleset (for tableId None, colId None) must exist.
# TODO: ensure that the default ruleset is created, and cannot be deleted.
class ResourceMap(object):
  def __init__(self, resource_records):
    self._col_resources = {}      # Maps table_id to [(resource, col_id_set), ...]
    self._default_resources = {}  # Maps table_id (or None for global default) to resource record.
    for resource in resource_records:
      # Note that resource.tableId is the empty string ('') for the default table (represented as
      # None in self._default_resources), and resource.colIds is '' for the table's default rule.
      table_id = resource.tableId or None
      if not resource.colIds:
        self._default_resources[table_id] = resource
      else:
        col_id_set = set(resource.colIds.split(','))
        self._col_resources.setdefault(table_id, []).append((resource, col_id_set))

  def get_col_resources(self, table_id):
    """
    Returns a list of (resource, col_id_set) pairs, where resource is a record in ACLResources.
    """
    return self._col_resources.get(table_id, [])

  def get_default_resource(self, table_id):
    """
    Returns the "default" resource record for the given table.
    """
    return self._default_resources.get(table_id) or self._default_resources.get(None)

# Used by docmodel.py for DocInfo.acl_resources formula.
def build_resources(resource_records):
  return ResourceMap(resource_records)


class ACL(object):
  # Special recipients, or instanceIds. ALL is the special recipient for schema actions that
  # should be shared with all collaborators of the document.
  ALL = '#ALL'
  ALL_SET = frozenset([ALL])
  EMPTY_SET = frozenset([])

  def __init__(self, docmodel):
    self._docmodel = docmodel

  def get_acl_resources(self):
    try:
      return self._docmodel.doc_info.table.get_record(1).acl_resources
    except KeyError:
      return None

  def _find_resources(self, table_id, col_ids):
    """
    Yields tuples (resource, col_id_set) where each col_id_set represents the intersection of the
    resouces's columns with col_ids. These intersections may be empty.

    If col_ids is None, then it's treated as "all columns", and each col_id_set represents all of
    the resource's columns. For the default resource then, it yields (resource, None)
    """
    resource_map = self.get_acl_resources()

    if col_ids is None:
      for resource, col_id_set in resource_map.get_col_resources(table_id):
        yield resource, col_id_set
      resource = resource_map.get_default_resource(table_id)
      yield resource, None

    else:
      seen = set()
      for resource, col_id_set in resource_map.get_col_resources(table_id):
        seen.update(col_id_set)
        yield resource, col_id_set.intersection(col_ids)

      resource = resource_map.get_default_resource(table_id)
      yield resource, set(c for c in col_ids if c not in seen)

  @classmethod
  def _acl_read_split_rows(cls, resource, row_ids):
    """
    Scans through ACL rules for the resouce, yielding tuples of the form (rule, row_id,
    instances), to say which rowId should be sent to each set of instances according to the rule.
    """
    for rule in resource.ruleset:
      if not Permissions.includes_view(rule.permissions):
        continue
      common_instances = _get_instances(rule.principalsList)
      if rule.aclColumn and row_ids is not None:
        for (row_id, principals) in get_row_principals(rule.aclColumn, row_ids):
          yield (rule, row_id, common_instances | _get_instances(principals))
      else:
        yield (rule, _ALL_ROWS, common_instances)

  @classmethod
  def _acl_read_split_instance_sets(cls, resource, row_ids):
    """
    Yields tuples of the form (instances, rowset, rules) for different sets of instances, to say
    which rowIds for the given resource should be sent to each set of instances, and which rules
    enabled that. When a set of instances should get all rows, rowset is None.
    """
    for instances, group in _group((instances, (rule, row_id)) for (rule, row_id, instances)
                                   in cls._acl_read_split_rows(resource, row_ids)):
      rules = set(item[0] for item in group)
      rowset = frozenset(item[1] for item in group)
      yield (instances, _ALL_ROWS if _ALL_ROWS in rowset else rowset, rules)

  @classmethod
  def _acl_read_split_resource(cls, resource, row_ids, docaction, output):
    """
    Given an ACLResource record and optionally row_ids (which may be None), appends to output
    tuples of the form `(instances, rules, action)`, where `action` is docaction itself or a part
    of it that should be sent to the corresponding set of instances.
    """
    if docaction is None:
      return

    # Different rules may produce different recipients for the same set of rows. We group outputs
    # by sets of rows (which determine a subaction), and take a union of all the recipients.
    for rowset, group in _group((rowset, (instances, rules)) for (instances, rowset, rules)
                                in cls._acl_read_split_instance_sets(resource, row_ids)):
      da = docaction if rowset is _ALL_ROWS else _subaction(docaction, row_ids=rowset)
      if da is not None:
        all_instances = frozenset(i for item in group for i in item[0])
        all_rules = set(r for item in group for r in item[1])
        output.append((all_instances, all_rules, da))

  def _acl_read_split_docaction(self, docaction, output):
    """
    Given just a docaction, appends to output tuples of the form `(instances, rules, action)`,
    where `action` is docaction itself or a part of it that should be sent to `instances`, and
    `rules` is the set of ACLRules that allowed that (empty set for schema actions).
    """
    parts = _get_docaction_parts(docaction)
    if parts is None:   # This is a schema action, to send to everyone.
      # We want to send schema actions to everyone on the document, represented by None.
      output.append((ACL.ALL_SET, set(), docaction))
      return

    table_id, row_ids, col_ids = parts
    for resource, col_id_set in self._find_resources(table_id, col_ids):
      da = _subaction(docaction, col_ids=col_id_set)
      if da is not None:
        self._acl_read_split_resource(resource, row_ids, da, output)

  def _acl_read_split_docactions(self, docactions):
    """
    Returns a list of tuples `(instances, rules, action)`. See _acl_read_split_docaction.
    """
    if not self.get_acl_resources():
      return [(ACL.EMPTY_SET, None, da) for da in docactions]

    output = []
    for da in docactions:
      self._acl_read_split_docaction(da, output)
    return output

  def acl_read_split(self, action_group):
    """
    Returns an ActionBundle, containing actions from the given action_group, split by the sets of
    instances to which actions should be sent.
    """
    bundle = action_obj.ActionBundle()
    envelopeIndices = {}    # Maps instance-sets to envelope indices.

    def getEnvIndex(instances):
      envIndex = envelopeIndices.setdefault(instances, len(bundle.envelopes))
      if envIndex == len(bundle.envelopes):
        bundle.envelopes.append(action_obj.Envelope(instances))
      return envIndex

    def split_into_envelopes(docactions, out_rules, output):
      for (instances, rules, action) in self._acl_read_split_docactions(docactions):
        output.append((getEnvIndex(instances), action))
        if rules:
          out_rules.update(r.id for r in rules)

    split_into_envelopes(action_group.stored, bundle.rules, bundle.stored)
    split_into_envelopes(action_group.calc, bundle.rules, bundle.calc)
    split_into_envelopes(action_group.undo, bundle.rules, bundle.undo)
    bundle.retValues = action_group.retValues
    return bundle


class OrderedDefaultListDict(OrderedDict):
  def __missing__(self, key):
    self[key] = value = []
    return value

def _group(iterable_of_pairs):
  """
  Group iterable of pairs (a, b), returning pairs (a, [list of b]). The order of the groups, and
  of items within a group, is according to the first seen.
  """
  groups = OrderedDefaultListDict()
  for key, value in iterable_of_pairs:
    groups[key].append(value)
  return groups.iteritems()


def _get_instances(principals):
  """
  Returns a frozenset of all instances for all passed-in principals.
  """
  instances = set()
  for p in principals:
    instances.update(i.instanceId for i in p.allInstances)
  return frozenset(instances)


def get_row_principals(_acl_column, _rows):
  # TODO TBD. Need to implement this (with tests) for acl-formulas for row-level access control.
  return []


#----------------------------------------------------------------------

def _get_docaction_parts(docaction):
  """
  Returns a tuple of (table_id, row_ids, col_ids), any of whose members may be None, or None if
  this action should not get split.
  """
  return _docaction_part_helpers[docaction.__class__.__name__](docaction)

# Helpers for _get_docaction_parts to extract for each action type the table, rows, and columns
# that a docaction of that type affects. Note that we are only talking here about the data
# affected. Schema actions do not get trimmed, since we decided against having a separate
# (and confusing) "SCHEMA_VIEW" permission. All peers will know the schema.
_docaction_part_helpers = {
  'AddRecord'        : lambda a: (a.table_id, [a.row_id], a.columns.keys()),
  'BulkAddRecord'    : lambda a: (a.table_id, a.row_ids,  a.columns.keys()),
  'RemoveRecord'     : lambda a: (a.table_id, [a.row_id], None),
  'BulkRemoveRecord' : lambda a: (a.table_id, a.row_ids,  None),
  'UpdateRecord'     : lambda a: (a.table_id, [a.row_id], a.columns.keys()),
  'BulkUpdateRecord' : lambda a: (a.table_id, a.row_ids,  a.columns.keys()),
  'ReplaceTableData' : lambda a: (a.table_id, a.row_ids,  a.columns.keys()),
  'AddColumn'        : lambda a: None,
  'RemoveColumn'     : lambda a: None,
  'RenameColumn'     : lambda a: None,
  'ModifyColumn'     : lambda a: None,
  'AddTable'         : lambda a: None,
  'RemoveTable'      : lambda a: None,
  'RenameTable'      : lambda a: None,
}


#----------------------------------------------------------------------

def _subaction(docaction, row_ids=None, col_ids=None):
  """
  For data actions, extracts and returns a part of docaction that applies only to the given
  row_ids and/or col_ids, if given. If the part of the action is empty, returns None.
  """
  helper = _subaction_helpers[docaction.__class__.__name__]
  try:
    return docaction.__class__._make(helper(docaction, row_ids, col_ids))
  except _NoMatch:
    return None

# Helpers for _subaction(), one for each action type, which return the tuple of values for the
# trimmed action. From this tuple a new action is automatically created by _subaction. If any part
# of the action becomes empty, the helpers raise _NoMatch exception.
_subaction_helpers = {
  # pylint: disable=line-too-long
  'AddRecord'        : lambda a, r, c: (a.table_id, match(r, a.row_id),       match_keys_keep_empty(c, a.columns)),
  'BulkAddRecord'    : lambda a, r, c: (a.table_id, match_list(r, a.row_ids), match_keys_keep_empty(c, a.columns)),
  'RemoveRecord'     : lambda a, r, c: (a.table_id, match(r, a.row_id)),
  'BulkRemoveRecord' : lambda a, r, c: (a.table_id, match_list(r, a.row_ids)),
  'UpdateRecord'     : lambda a, r, c: (a.table_id, match(r, a.row_id),       match_keys_skip_empty(c, a.columns)),
  'BulkUpdateRecord' : lambda a, r, c: (a.table_id, match_list(r, a.row_ids), match_keys_skip_empty(c, a.columns)),
  'ReplaceTableData' : lambda a, r, c: (a.table_id, match_list(r, a.row_ids), match_keys_keep_empty(c, a.columns)),
  'AddColumn'        : lambda a, r, c: a,
  'RemoveColumn'     : lambda a, r, c: a,
  'RenameColumn'     : lambda a, r, c: a,
  'ModifyColumn'     : lambda a, r, c: a,
  'AddTable'         : lambda a, r, c: a,
  'RemoveTable'      : lambda a, r, c: a,
  'RenameTable'      : lambda a, r, c: a,
}

def match(subset, item):
  return item if (subset is None or item in subset) else no_match()

def match_list(subset, items):
  return items if subset is None else ([i for i in items if i in subset] or no_match())

def match_keys_keep_empty(subset, items):
  return items if subset is None else (
    {k: v for (k, v) in items.iteritems() if k in subset})

def match_keys_skip_empty(subset, items):
  return items if subset is None else (
    {k: v for (k, v) in items.iteritems() if k in subset} or no_match())

class _NoMatch(Exception):
  pass

def no_match():
  raise _NoMatch()
