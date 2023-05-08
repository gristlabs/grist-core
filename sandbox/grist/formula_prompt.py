import json
import textwrap

import six

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

    result += "     def __len__(self):\n"
    result += "        return len(%s.lookupRecords())\n" % table_id
    result += "    @staticmethod\n"
    result += "    def lookupRecords(%s) -> List[%s]:\n" % (lookupOne_args_line, table_id)
    result += "       # ...\n"
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


def get_formula_prompt(engine, table_id, col_id, description,
                       include_all_tables=True,
                       lookups=True):
  result = ""
  other_tables = (all_other_tables(engine, table_id)
    if include_all_tables else referenced_tables(engine, table_id))
  for other_table_id in sorted(other_tables):
    result += class_schema(engine, other_table_id, lookups)

  result += class_schema(engine, table_id, col_id, lookups)

  return_type = column_type(engine, table_id, col_id)
  result += "    @property\n"
  result += "    # rec is alias for self\n"
  result += "    def {}(rec) -> {}:\n".format(col_id, return_type)
  result += '        """\n'
  result += '{}\n'.format(indent(description, "        "))
  result += '        """\n'
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
  result = textwrap.dedent(completion)
  return result
