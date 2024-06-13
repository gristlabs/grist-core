import ast
import asttokens
import json
import logging
import textbuilder

from predicate_formula import NamedEntity, parse_predicate_formula_json, TreeConverter
import predicate_formula

log = logging.getLogger(__name__)

class _DCEntityCollector(TreeConverter):
  def __init__(self):
    self.entities = []

  def visit_Attribute(self, node):
    parent = self.visit(node.value)

    if parent == ["Name", "choice"]:
      self.entities.append(NamedEntity("choiceAttr", node.last_token.startpos, node.attr, None))
    elif parent == ["Name", "rec"]:
      self.entities.append(NamedEntity("recCol", node.last_token.startpos, node.attr, None))

    return ["Attr", parent, node.attr]


def perform_dropdown_condition_renames(useractions, renames):
  """
  Given a dict of column renames of the form {(table_id, col_id): new_col_id}, applys updates
  to the affected dropdown condition formulas.
  """
  updates = []

  for col in useractions._engine.docmodel.columns.all:

    patches = []

    # Find all columns in the document that has dropdown conditions.
    try:
      widget_options = json.loads(col.widgetOptions)
      dc_formula = widget_options["dropdownCondition"]["text"]
    except:
      continue

    # Find out what table this column refers to and belongs to.
    ref_table_id = col.type.lstrip("Ref:")
    self_table_id = col.parentId.tableId

    def renamer(subject):
      table_id = ref_table_id if subject.type == "choiceAttr" else self_table_id
      if (table_id, subject.name) in renames:
        return renames[(table_id, subject.name)]
      else:
        return None
      
    new_dc_formula = predicate_formula.process_renames(dc_formula, _DCEntityCollector(), renamer)

    # Parse the new dropdown condition formula.
    widget_options["dropdownCondition"] = {"text": new_dc_formula,
                                           "parsed": parse_predicate_formula_json(new_dc_formula)}
    updates.append((col, {"widgetOptions": json.dumps(widget_options)}))

  # Update the dropdown condition in the database.
  useractions.doBulkUpdateFromPairs('_grist_Tables_column', updates)


def parse_dropdown_conditions(col_values):
  """
  Parses any unparsed dropdown conditions in `col_values`.
  """
  if 'widgetOptions' not in col_values:
    return

  col_values['widgetOptions'] = [parse_dropdown_condition(widget_options_json)
                                 for widget_options_json
                                 in col_values['widgetOptions']]

def parse_dropdown_condition(widget_options_json):
  """
  Parses `dropdownCondition.text` in `widget_options_json` and stores the parsed
  representation in `dropdownCondition.parsed`.

  If `dropdownCondition.parsed` is already set, parsing is skipped (as an optimization).
  Clients are responsible for including just `dropdownCondition.text` when creating new
  (or updating existing) dropdown conditions.

  Returns an updated copy of `widget_options_json` or the original widget_options_json
  if parsing was skipped.
  """
  try:
    widget_options = json.loads(widget_options_json)
    if 'dropdownCondition' not in widget_options:
      return widget_options_json

    dropdown_condition = widget_options['dropdownCondition']
    if 'parsed' in dropdown_condition:
      return widget_options_json

    dropdown_condition['parsed'] = parse_predicate_formula_json(dropdown_condition['text'])
    return json.dumps(widget_options)
  except (TypeError, ValueError):
    return widget_options_json


def parse_dropdown_condition_grist_entities(dc_formula):
  """
  Parse the dropdown condition formula collecting any entities that may be subject to renaming.
  Returns a NamedEntity list.
  See also: parse_acl_grist_entities
  """
  try:
    atok = asttokens.ASTTokens(dc_formula, tree=ast.parse(dc_formula, mode='eval'))
    converter = _EntityCollector()
    converter.visit(atok.tree)
    return converter.entities
  except SyntaxError as err:
    return []

class _EntityCollector(TreeConverter):
  def __init__(self):
    self.entities = []

  def visit_Attribute(self, node):
    parent = self.visit(node.value)

    if parent == ["Name", "choice"]:
      self.entities.append(NamedEntity("choiceAttr", node.last_token.startpos, node.attr, None))
    elif parent == ["Name", "rec"]:
      self.entities.append(NamedEntity("recCol", node.last_token.startpos, node.attr, None))

    return ["Attr", parent, node.attr]
