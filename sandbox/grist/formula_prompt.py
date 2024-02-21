import ast
import json
import re
import textwrap

import asttokens
import asttokens.util
import six

import attribute_recorder
import objtypes
from codebuilder import make_formula_body
from column import is_visible_column, BaseReferenceColumn
from objtypes import RaisedException
import records


def column_type(engine, table_id, col_id):
  col_rec = engine.docmodel.get_column_rec(table_id, col_id)
  typ = col_rec.type
  parts = typ.split(":")
  if parts[0] == "Ref":
    return parts[1]
  elif parts[0] == "RefList":
    return "list[{}]".format(parts[1])
  elif typ == "Choice":
    return choices(col_rec)
  elif typ == "ChoiceList":
    return "tuple[{}, ...]".format(choices(col_rec))
  elif typ == "Any":
    table = engine.tables[table_id]
    col = table.get_column(col_id)
    values = [col.raw_get(row_id) for row_id in table.row_ids]
    return values_type(values)
  else:
    return dict(
      Text="str",
      Numeric="float",
      Int="int",
      Bool="bool",
      Date="datetime.date",
      DateTime="datetime.datetime",
      Any="Any",
      Attachments="Any",
    )[parts[0]]

def choices(col_rec):
  try:
    widget_options = json.loads(col_rec.widgetOptions)
    return "Literal{}".format(widget_options["choices"])
  except (ValueError, KeyError):
    return 'str'


def values_type(values):
  types = set(type(v) for v in values) - {RaisedException}
  optional = type(None) in types # pylint: disable=unidiomatic-typecheck
  types.discard(type(None))

  if types == {int, float}:
    types = {float}

  if len(types) != 1:
    return "Any"

  [typ] = types
  val = next(v for v in values if isinstance(v, typ))

  if isinstance(val, records.Record):
    type_name = val._table.table_id
  elif isinstance(val, records.RecordSet):
    type_name = "list[{}]".format(val._table.table_id)
  elif isinstance(val, list):
    type_name = "list[{}]".format(values_type(val))
  elif isinstance(val, set):
    type_name = "set[{}]".format(values_type(val))
  elif isinstance(val, tuple):
    type_name = "tuple[{}, ...]".format(values_type(val))
  elif isinstance(val, dict):
    type_name = "dict[{}, {}]".format(values_type(val.keys()), values_type(val.values()))
  else:
    type_name = typ.__name__

  if optional:
    type_name = "Optional[{}]".format(type_name)

  return type_name


def referenced_tables(engine, table_id):
  result = set()
  queue = [table_id]
  while queue:
    cur_table_id = queue.pop()
    if cur_table_id in result:
      continue
    result.add(cur_table_id)
    for col_id, col in visible_columns(engine, cur_table_id):
      if isinstance(col, BaseReferenceColumn):
        target_table_id = col._target_table.table_id
        if not target_table_id.startswith("_"):
          queue.append(target_table_id)
  return result - {table_id}

def all_other_tables(engine, table_id):
  result = set(t for t in engine.tables.keys() if not t.startswith('_grist'))
  return result - {table_id} - {'GristDocTour'}

def visible_columns(engine, table_id):
  return [
    (col_id, col)
    for col_id, col in engine.tables[table_id].all_columns.items()
    if is_visible_column(col_id)
  ]


def class_schema(engine, table_id, exclude_col_id=None, lookups=False):
  result = "class {}:\n".format(table_id)

  if lookups:

    # Build a lookupRecords and lookupOne method for each table, providing some arguments hints
    # for the columns that are visible.
    lookupRecords_args = []
    lookupOne_args = []
    for col_id, col in visible_columns(engine, table_id):
      if col_id != exclude_col_id:
        lookupOne_args.append(col_id + '=None')
        lookupRecords_args.append('%s=%s' % (col_id, col_id))
    lookupOne_args.append('sort_by=None')
    lookupRecords_args.append('sort_by=sort_by')
    lookupOne_args_line = ', '.join(lookupOne_args)
    lookupRecords_args_line = ', '.join(lookupRecords_args)

    result += "    def __len__(self):\n"
    result += "        return len(%s.lookupRecords())\n" % table_id
    result += "    @staticmethod\n"
    result += "    def lookupRecords(%s) -> list[%s]:\n" % (lookupOne_args_line, table_id)
    result += "       ...\n"
    result += "    @staticmethod\n"
    result += "    def lookupOne(%s) -> %s:\n" % (lookupOne_args_line, table_id)
    result += "       '''\n"
    result += "       Filter for one result matching the keys provided.\n"
    result += "       To control order, use e.g. `sort_by='Key' or `sort_by='-Key'`.\n"
    result += "       '''\n"
    result += "       return %s.lookupRecords(%s)[0]\n" % (table_id, lookupRecords_args_line)
    result += "\n"

  for col_id, col in visible_columns(engine, table_id):
    if col_id != exclude_col_id:
      result += "    {}: {}\n".format(col_id, column_type(engine, table_id, col_id))
  result += "\n"
  return result


def get_formula_prompt(engine, table_id, col_id, _description,
                       include_all_tables=True,
                       lookups=True):
  result = ""
  other_tables = (all_other_tables(engine, table_id)
    if include_all_tables else referenced_tables(engine, table_id))
  for other_table_id in sorted(other_tables):
    result += class_schema(engine, other_table_id, None, lookups)

  result += class_schema(engine, table_id, col_id, lookups)

  return_type = column_type(engine, table_id, col_id)
  result += "def {}(rec: {}) -> {}:\n".format(col_id, table_id, return_type)
  return result

def indent(text, prefix, predicate=None):
  """
  Copied from https://github.com/python/cpython/blob/main/Lib/textwrap.py for python2 compatibility.
  """
  if six.PY3:
    return textwrap.indent(text, prefix, predicate) # pylint: disable = no-member
  if predicate is None:
    def predicate(line):
      return line.strip()
  def prefixed_lines():
    for line in text.splitlines(True):
      yield (prefix + line if predicate(line) else line)
  return ''.join(prefixed_lines())


def convert_completion(completion):
  # Extract code from a markdown code block if needed.
  match = re.search(r"```\w*\n(.*)```", completion, re.DOTALL)
  if match:
    completion = match.group(1)

  result = textwrap.dedent(completion)
  atok = asttokens.ASTText(result)

  try:
    # Constructing ASTText doesn't parse the code, but the .tree property does.
    stmts = atok.tree.body
  except SyntaxError:
    # If we don't have valid Python code, don't suggest a formula at all
    return ""

  # If the code starts with imports, save them for later.
  # In particular, the model may return something like:
  #  from datetime import date
  #  def my_column():
  #     ...
  # We want to return just the function body, but we need to keep the import,
  # i.e. move it 'inside the function'.
  imports = ""
  while stmts and isinstance(stmts[0], (ast.Import, ast.ImportFrom)):
    imports += atok.get_text(stmts.pop(0)) + "\n"

  # Sometimes the model repeats the provided classes, remove them.
  stmts = [stmt for stmt in stmts if not isinstance(stmt, ast.ClassDef)]

  # If the remaining code consists only of a function definition, extract the body.
  if len(stmts) == 1 and isinstance(stmts[0], ast.FunctionDef):
    func_body_stmts = stmts[0].body
    if (
      len(func_body_stmts) > 1 and
      isinstance(func_body_stmts[0], ast.Expr) and
      isinstance(func_body_stmts[0].value, ast.Str)
    ):
      # Skip the docstring.
      first_stmt = func_body_stmts[1]
    else:
      first_stmt = func_body_stmts[0]
    result_lines = result.splitlines()[first_stmt.lineno - 1:]
    result = "\n".join(result_lines)
    result = textwrap.dedent(result)

    if imports:
      result = imports + "\n" + result

  # Now convert `rec.` to `$` and remove redundant `return ` at the end.
  atok = asttokens.ASTText(result)
  try:
    # Constructing ASTText doesn't parse the code, but the .tree property does.
    tree = atok.tree
  except SyntaxError:
    # In case the above extraction somehow messed things up
    return ""

  replacements = []
  for node in ast.walk(tree):
    if isinstance(node, ast.Attribute):
      start, end = atok.get_text_range(node.value)
      end += 1
      if result[start:end] == "rec.":
        replacements.append((start, end, "$"))

  last_stmt = tree.body[-1]
  if isinstance(last_stmt, ast.Return):
    start, _ = atok.get_text_range(last_stmt)
    expected = "return "
    end = start + len(expected)
    if result[start:end] == expected:
      replacements.append((start, end, ""))

  result = asttokens.util.replace(result, replacements)

  return result.strip()


def evaluate_formula(engine, table_id, col_id, row_id):
  grist_formula = engine.docmodel.get_column_rec(table_id, col_id).formula
  assert grist_formula
  plain_formula = make_formula_body(grist_formula, default_value=None).get_text()

  attributes = {}
  result = engine.get_formula_value(table_id, col_id, row_id, record_attributes=attributes)
  if isinstance(result, objtypes.RaisedException):
    name, message = result.encode_args()[:2]
    result = "%s: %s" % (name, message)
    error = True
  else:
    result = attribute_recorder.safe_repr(result)
    error = False
  return dict(
    error=error,
    formula=plain_formula,
    result=result,
    attributes=attributes,
  )
