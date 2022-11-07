import ast
import json
import textwrap

import asttokens.util
from asttokens import ASTText

import records
from column import is_visible_column, BaseReferenceColumn
from objtypes import RaisedException


def column_type(engine, table_id, col_id):
  col_rec = engine.docmodel.get_column_rec(table_id, col_id)
  typ = col_rec.type
  parts = typ.split(":")
  if parts[0] == "Ref":
    return parts[1]
  elif parts[0] == "RefList":
    return "List[{}]".format(parts[1])
  elif typ == "Choice":
    return choices(col_rec)
  elif typ == "ChoiceList":
    return "Tuple[{}, ...]".format(choices(col_rec))
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
  optional = type(None) in types
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
    type_name = "List[{}]".format(val._table.table_id)
  elif isinstance(val, list):
    type_name = "List[{}]".format(values_type(val))
  elif isinstance(val, set):
    type_name = "Set[{}]".format(values_type(val))
  elif isinstance(val, tuple):
    type_name = "Tuple[{}, ...]".format(values_type(val))
  elif isinstance(val, dict):
    type_name = "Dict[{}, {}]".format(values_type(val.keys()), values_type(val.values()))
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
  result = "@dataclass\nclass {}:\n".format(table_id)

  if lookups:
    tmp = []
    tmp2 = []
    for col_id, col in visible_columns(engine, table_id):
      if col_id != exclude_col_id:
        tmp.append(col_id + ' = None')
        tmp2.append(f'{col_id}={col_id}')
    tmp.append('sort_by = None')
    tmp2.append('sort_by=sort_by')
    args = ', '.join(tmp)
    args2 = ', '.join(tmp2)
    result += f"     def __len__(self):\n"
    result += f"        return len({table_id}.lookupRecords())\n"
    result += f"    @staticmethod\n"
    result += f"    def lookupRecords({args}) -> List[{table_id}]:\n"
    result += f"       # ...\n"
    result += f"    @staticmethod\n"
    result += f"    def lookupOne({args}) -> {table_id}:\n"
    result += f"       '''\n"
    result += f"       Filter for one result matching the keys provided.\n"
    result += f"       To control order, use e.g. `sort_by='Key' or `sort_by='-Key'`.\n"
    result += f"       '''\n"
    result += f"       return {table_id}.lookupRecords({args2})[0]\n"
    result += "\n"

  for col_id, col in visible_columns(engine, table_id):
    if col_id != exclude_col_id:
      result += "    {}: {}\n".format(col_id, column_type(engine, table_id, col_id))
  result += "\n"
  return result


def get_formula_prompt(engine, table_id, col_id, description,
                       include_all_tables=True,
                       lookups=True):
  result = ""
  other_tables = all_other_tables(engine, table_id) if include_all_tables else referenced_tables(engine, table_id)
  for other_table_id in sorted(other_tables):
    result += class_schema(engine, other_table_id, lookups)

  result += class_schema(engine, table_id, col_id, lookups)

  return_type = column_type(engine, table_id, col_id)
  result += "    @property\n"
  result += "    def {}(self) -> {}:\n".format(col_id, return_type)
  result += '        """\n'
  result += '{}\n'.format(textwrap.indent(description, "        "))
  result += '        """\n'
  return result


def convert_completion(completion):
  result = textwrap.dedent(completion)
  replacements = []
  atok = ASTText(result)
  for node in ast.walk(atok.tree):
    if isinstance(node, ast.Name) and node.id == "self":
      start, end = atok.get_text_range(node)
      # Avoid $ because of f-strings
      replacements.append((start, end, "rec"))
  result = asttokens.util.replace(result, replacements)
  return result
