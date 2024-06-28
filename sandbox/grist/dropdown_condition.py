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
  Given a dict of column renames of the form {(table_id, col_id): new_col_id}, applies updates
  to the affected dropdown condition formulas.
  """
  updates = []

  for col in useractions._docmodel.columns.all:

    patches = []

    # Find all columns in the document that have dropdown conditions.
    try:
      widget_options = json.loads(col.widgetOptions)
      dc_formula = widget_options["dropdownCondition"]["text"]
    except (json.JSONDecodeError, KeyError):
      continue

    # Find out what table this column refers to and belongs to.
    ref_table_id = col.type.lstrip("Ref:")
    self_table_id = col.parentId.tableId

    def renamer(subject):
      table_id = ref_table_id if subject.type == "choiceAttr" else self_table_id
      return renames.get((table_id, subject.name))
      
    new_dc_formula = predicate_formula.process_renames(dc_formula, _DCEntityCollector(), renamer)

    widget_options["dropdownCondition"] = {"text": new_dc_formula}
    try:
      # Parse the new dropdown condition formula if it is syntactically correct.
      widget_options["dropdownCondition"]["parsed"] = parse_predicate_formula_json(new_dc_formula)
    except SyntaxError:
      pass
    except ValueError as e:
      if not str(e).startswith("Unsupported syntax"):
        raise e
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
