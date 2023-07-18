import json
import math
import os
import re

import six

import actions

def table_data_from_rows(table_id, col_names, rows):
  """
  Returns a TableData object built from a table_id, a list of column names, and corresponding
  row-oriented data.
  """
  column_values = {}
  for i, col in enumerate(col_names):
    # Strip leading @ from column headers
    column_values[col.lstrip('@')] = [row[i] for row in rows]
  return actions.TableData(table_id, column_values.pop('id'), column_values)



def parse_testscript(script_path=None):
  """
  Parses JSON spec for test cases, and returns a tuple of (samples, test_cases). Lines starting
  with '//' are comments and are skipped.

  Samples are objects with keys "SCHEMA" and "DATA", each a dictionary mapping table name to
  actions.TableData object. "SCHEMA" contains "_grist_Tables" and "_grist_Tables_column" tables.

  Test cases are a list of objects with "TEST_CASE" and "BODY", and the body is a list of steps of
  the form [line_number, step_name, data], with line_number being an addition by this parser (or
  None if not available).
  """
  if not script_path:
    script_path = os.path.join(os.path.dirname(__file__), "testscript.json")

  comment_re = re.compile(r'^\s*//')
  add_line_no_re = re.compile(r'"(APPLY|CHECK_OUTPUT|LOAD_SAMPLE)"\s*,')
  all_lines = []
  with open(script_path, "r") as testfile:
    for i, line in enumerate(testfile):
      if comment_re.match(line):
        all_lines.append("\n")
      else:
        line = add_line_no_re.sub(r'"\1@%s",' % (i + 1), line)
        all_lines.append(line)
  full_text = "".join(all_lines)

  script = json.loads(full_text)

  samples = {}
  test_cases = []
  for obj in script:
    if "TEST_CASE" in obj:
      body = []
      for step, data in obj["BODY"]:
        step_line = step.split('@', 1)
        step = step_line[0]
        line = step_line[1] if len(step_line) > 1 else None
        body.append([line, step, data])
      obj["BODY"] = body
      test_cases.append(obj)
    elif "SAMPLE_NAME" in obj:
      samples[obj["SAMPLE_NAME"]] = parse_test_sample(obj, samples=samples)
    else:
      raise ValueError("Unrecognized object in test script: %s" % obj)
  return (samples, test_cases)


def parse_test_sample(obj, samples={}):
  """
  Parses human-readable sample data (with "SCHEMA" or "SCHEMA_FROM", and "DATA" dictionaries; see
  testscript.json for an example) into a sample containing "SCHEMA" and "DATA" keys, each a
  dictionary mapping table name to TableData object.
  """
  if "SCHEMA_FROM" in obj:
    schema = samples[obj["SCHEMA_FROM"]]["SCHEMA"].copy()
  else:
    raw_schema = obj["SCHEMA"]
    # Convert the meta tables to appropriate table representations for loading.
    schema = {
      '_grist_Tables': table_data_from_rows(
        '_grist_Tables',
        ("id", "tableId"),
        [(table_row_id, table_id) for (table_row_id, table_id, _) in raw_schema]),
      '_grist_Tables_column': table_data_from_rows(
        '_grist_Tables_column',
        ("parentId", "parentPos", "id", "colId", "type", "isFormula",
         "formula", "label", "widgetOptions", "recalcWhen", "recalcDeps"),
        [[table_row_id, i+1] + col_schema_row(*e) for (table_row_id, _, entries) in raw_schema
         for (i, e) in enumerate(entries)])
    }

  data = {t: table_data_from_rows(t, data[0], data[1:])
          for t, data in six.iteritems(obj["DATA"])}
  return {"SCHEMA": schema, "DATA": data}


def col_schema_row(id_, colId, type_, isFormula, formula="",
                   label="", widgetOptions="", recalcWhen=0, recalcDeps=None):
  """
  Helper to specify columns in test SCHEMA descriptions, to allow omitting some column properties.
  """
  return [id_, colId, type_, isFormula, formula, label, widgetOptions, recalcWhen, recalcDeps]


def replace_nans(data):
  """
  Convert all NaNs and Infinities in the data to descriptive strings, since they cannot be
  serialized to JS-compliant JSON. (But we can serialize them using marshalling, so this
  workaround is just for the testscript-based tests.)
  """
  if isinstance(data, float) and (math.isnan(data) or math.isinf(data)):
    return "@+Infinity" if data > 0 else "@-Infinity" if data < 0 else "@NaN"
  return actions.convert_recursive_in_action(replace_nans, data)


def repeat_until_passes(count):
  """
  Use as a decorator on test cases to repeat a failing test case up to count times, until it
  passes. The resulting test cases will fail only if every repetition failed. This is suitable for
  flaky timing test when unexpected load spikes could cause spurious failures.
  """
  def decorator(f):
    def wrapped(*args):
      for i in range(0, count):
        try:
          f(*args)
          return
        except AssertionError as e:
          pass
      # Raises the last caught exception, even outside try/except (see
      # https://stackoverflow.com/questions/25632147/raise-at-the-end-of-a-python-function-outside-try-or-except-block)
      raise   # pylint: disable=misplaced-bare-raise
    return wrapped
  return decorator
