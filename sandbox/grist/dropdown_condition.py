import json
import logging

from predicate_formula import parse_predicate_formula_json

log = logging.getLogger(__name__)

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
