import json
import logging

from predicate_formula import NamedEntity, parse_predicate_formula, TreeConverter
import predicate_formula

log = logging.getLogger(__name__)

class _TriggerEntityCollector(TreeConverter):
  """Collects entities (column references) in trigger condition formulas."""
  def __init__(self):
    self.entities = []

  def visit_Attribute(self, node):
    parent = self.visit(node.value)

    if parent in (["Name", "rec"], ["Name", "oldRec"]):
      self.entities.append(NamedEntity("recCol", node.last_token.startpos, node.attr, None))

    return ["Attr", parent, node.attr]


def perform_trigger_condition_renames(useractions, renames):
  """
  Given a dict of column renames of the form {(table_id, col_id): new_col_id}, applies updates
  to the affected trigger condition formulas.
  """
  updates = []

  for trigger in useractions.get_docmodel().triggers.all:
    if not trigger.condition:
      continue

    try:
      condition_data = json.loads(trigger.condition)
      if not isinstance(condition_data, dict):
        continue
    except (ValueError, KeyError, TypeError):
      continue

    table_id = trigger.tableRef.tableId
    changed = False

    def renamer(subject, _table_id=table_id):
      return renames.get((_table_id, subject.name))

    # Config mode: columnFilters use colRefs (stable across renames),
    # so only customExpression needs AST-based renaming.
    config = condition_data.get('config')
    if config and isinstance(config, dict):
      custom_expr = config.get('customExpression', '')
      if custom_expr:
        new_custom_expr = predicate_formula.process_renames(
          custom_expr, _TriggerEntityCollector(), renamer)
        if new_custom_expr != custom_expr:
          config['customExpression'] = new_custom_expr
          config['customExpressionParsed'] = parse_predicate_formula(new_custom_expr)
          changed = True

    # Text mode: rename in the text formula.
    if 'text' in condition_data:
      condition_formula = condition_data['text']
      new_condition_formula = predicate_formula.process_renames(
        condition_formula, _TriggerEntityCollector(), renamer)
      if new_condition_formula != condition_formula:
        condition_data['text'] = new_condition_formula
        condition_data['parsed'] = parse_predicate_formula(new_condition_formula)
        changed = True

    if changed:
      updates.append((trigger, {"condition": json.dumps(condition_data)}))

  # Update the trigger conditions in the database
  useractions.doBulkUpdateFromPairs('_grist_Triggers', updates)


def parse_conditions_in_triggers(col_values):
  """
  Parses any unparsed expressions in trigger `condition` column in `col_values`.
  """
  if 'condition' not in col_values:
    return

  col_values['condition'] = [parse_trigger_condition(condition)
                              for condition in col_values['condition']]


def parse_trigger_condition(condition_str):
  """
  Parses a trigger condition JSON or text if not already parsed. Returns the updated
  JSON string. If parsing fails or the input is not a valid JSON object, returns
  the original string.

  If `parsed` is already set, parsing is skipped (as an optimization). Clients are
  responsible for including just `text` when creating new (or updating
  existing) conditions.
  """

  # Quick exit for empty / null conditions
  if not condition_str:
    return None

  if not isinstance(condition_str, str):
    # If it's not a string, we don't know how to handle it, so we return it as is.
    return condition_str

  (is_json, condition_json) = safe_parse(condition_str)

  if is_json and not isinstance(condition_json, dict):
    # We have some json but it is not a dict (a json object), we don't know how
    # to handle it, so we return the original string.
    return condition_str
  elif not is_json:
    # We have a string, but it doesn't look like a json object, we assume that it is
    # a raw formula string, so we wrap it in the expected JSON format.
    condition_json = {'text': condition_str}

  assert condition_json

  # Config mode: structured condition evaluated directly by JS.
  # Only parse customExpression if present.
  config = condition_json.get('config')
  if config and isinstance(config, dict) and 'text' not in condition_json:
    custom_expr = config.get('customExpression', '')
    if custom_expr and 'customExpressionParsed' not in config:
      config['customExpressionParsed'] = parse_predicate_formula(custom_expr)
    # Config mode is valid even without customExpression (filters only).
    return json.dumps(condition_json)

  # Text mode.
  text = condition_json.get('text', '')

  if not text:
    # If text is explicitly cleared (e.g. by user action), we are removing the condition.
    return None

  # As in other cases (in dropdowns and acl), if parsed is set we skip
  # parsing, as an optimization.
  if 'parsed' in condition_json:
    return condition_str

  condition_json['parsed'] = parse_predicate_formula(text)

  return json.dumps(condition_json)


def safe_parse(json_str):
  """
  Safely parses a JSON string, returning a tuple (success, result). If parsing is
  successful, success is True and result is the parsed JSON.
  """
  try:
    return (True, json.loads(json_str))
  except (TypeError, ValueError):
    return (False, None)
