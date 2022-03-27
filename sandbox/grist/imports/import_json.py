"""
The import_json module converts json file into a list of grist tables.

It supports data being structured as a list of record, turning each
object into a row and each object's key into a column. For
example:
```
[{'a': 1, 'b': 'tree'}, {'a': 4, 'b': 'flowers'}, ... ]
```
is turned into a table with two columns 'a' of type 'Numeric' and 'b' of
type 'Text'.

Nested object are stored as references to a distinct table where the
nested object is stored. For example:
```
[{'a': {'b': 4}}, ...]
```
is turned into a column 'a' of type 'Ref:my_import_name.a', and into
another table 'my_import_name.a' with a column 'b' of type
'Numeric'. (Nested-nested objects are supported as well and the module
assumes no limit to the number of level of nesting you can do.)

Each value which is not an object will be stored into a column with id
'' (empty string). For example:
```
['apple', 'peach', ... ]
```
is turned into a table with an un-named column that stores the values.

Arrays are stored as a list of references to a table where the content
of the array is stored. For example:
```
[{'items': [{'a':'apple'}, {'a':'peach'}]}, {'items': [{'a':'cucumber'}, {'a':'carots'}, ...]}, ...]
```
is turned into a column named 'items' of type
'RefList:my_import_name.items' which points to another table named
'my_import_name.items' which has a column 'a' of type Text.

Data could be structured with an object at the root as well in which
case, the object is considered to represent a single row, and gets
turned into a table with one row.

A column's type is defined by the type of its first value that is not
None (ie: if another value with different type is stored in the same
column, the column's type remains unchanged), 'Text' otherwise.

Usage:
import import_json
# if you have a file to parse
import_json.parse_file(file_path)

# if data is already encoded with python's standard containers (dict and list)
import_json.dumps(data, import_name)


TODO:
  - references should map to appropriate column type ie: `Ref:{$colname}` and
    `RefList:{$colname}` (which depends on T413).
  - Allows user to set the uniqueValues options per table.
  - User should be able to choose some objects to be imported as
    indexes: for instance:
```
{
  'pink lady': {'type': 'apple', 'taste': 'juicy'},
  'gala':      {'type': 'apple', 'taste': 'tart'},
  'comice':    {'type': 'pear', 'taste': 'lemon'},
   ...
}
```
   could be mapped to columns 'type', 'taste' and a 3rd that holds the
   property 'name'.

"""
import os
import json
from collections import OrderedDict, namedtuple
from itertools import count, chain

import six

from imports import import_utils

Ref = namedtuple('Ref', ['table_name', 'rowid'])
Row = namedtuple('Row', ['values', 'parent', 'ref'])
Col = namedtuple('Col', ['type', 'values'])

GRIST_TYPES={
  float: "Numeric",
  bool: "Bool",
}

for typ in six.integer_types:
  GRIST_TYPES[typ] = "Numeric"

for typ in six.string_types:
  GRIST_TYPES[typ] = "Text"

SCHEMA = [{
  'name': 'includes',
  'label': 'Includes (list of tables separated by semicolon)',
  'type': 'string',
  'visible': True
}, {
  'name': 'excludes',
  'label': 'Excludes (list of tables separated by semicolon)',
  'type': 'string',
  'visible': True
}]

DEFAULT_PARSE_OPTIONS = {
  'includes': '',
  'excludes': '',
  'SCHEMA': SCHEMA
}

def parse_file(file_source, parse_options):
  "Deserialize `file_source` into a python object and dumps it into jgrist form"
  path = import_utils.get_path(file_source['path'])
  name, ext = os.path.splitext(file_source['origName'])
  if 'SCHEMA' not in parse_options:
    parse_options.update(DEFAULT_PARSE_OPTIONS)
  with open(path, 'r') as json_file:
    data = json.loads(json_file.read())

    return dumps(data, name, parse_options)

def dumps(data, name = "", parse_options = DEFAULT_PARSE_OPTIONS):
  " Serializes `data` to a jgrist formatted object. "
  tables = Tables(parse_options)
  if not isinstance(data, list):
    # put simple record into a list
    data = [data]
  for val in data:
    tables.add_row(name, val)
  return {
    'tables': tables.dumps(),
    'parseOptions': parse_options
  }


class Tables(object):
  """
  Tables maintains the list of tables indexed by their name. Each table
  is a list of row. A row is a dictionary mapping columns id to a value.
  """

  def __init__(self, parse_options):
    self._tables = OrderedDict()
    self._includes_opt = list(filter(None, parse_options['includes'].split(';')))
    self._excludes_opt = list(filter(None, parse_options['excludes'].split(';')))


  def dumps(self):
    " Dumps tables in jgrist format "
    return [_dump_table(name, rows) for name, rows in six.iteritems(self._tables)]

  def add_row(self, table, value, parent = None):
    """
    Adds a row to `table` and fill it with the content of value, then
    returns a Ref object pointing to this row. Returns None if the row
    was excluded. Calls itself recursively to add nested object and
    lists.
    """
    row = None
    if self._is_included(table):
      rows = self._tables.setdefault(table, [])
      row = Row(OrderedDict(), parent, Ref(table, len(rows)+1))
      rows.append(row)

    # we need a dictionary to map values to the row's columns
    value = _dictify(value)
    for (k, val) in sorted(six.iteritems(value)):
      if isinstance(val, dict):
        val = self.add_row(table + '_' + k, val)
        if row and val:
          row.values[k] = val.ref
      elif isinstance(val, list):
        for list_val in val:
          self.add_row(table + '_' + k, list_val, row)
      else:
        if row and self._is_included(table + '_' + k):
          row.values[k] = val
    return row


  def _is_included(self, property_path):
    is_included = (any(property_path.startswith(inc) for inc in self._includes_opt)
                   if self._includes_opt else True)
    is_excluded = (any(property_path.startswith(exc) for exc in self._excludes_opt)
                   if self._excludes_opt else False)
    return is_included and not is_excluded


def first_available_key(dictionary, name):
  """
  Returns the first of (name, name2, name3 ...) that is not a key of
  dictionary.
  """
  names = chain([name], ("{}{}".format(name, i) for i in count(2)))
  return next(n for n in names if n not in dictionary)


def _dictify(value):
  """
  Converts non-dictionary value to a dictionary with a single
  empty-string key mapping to the given value. Or returns the value
  itself if it's already a dictionary. This is useful to map values to
  row's columns.
  """
  return value if isinstance(value, dict) else {'': value}


def _dump_table(name, rows):
  "Converts a list of rows into a jgrist table and set 'table_name' to name."
  columns = _transpose([r.values for r in rows])
  # find ref to first parent
  ref = next((r.parent.ref for r in rows if r.parent), None)
  if ref:
    # adds a column to store ref to parent
    col_id = first_available_key(columns, ref.table_name)
    columns[col_id] = Col(_grist_type(ref),
                          [row.parent.ref if row.parent else None for row in rows])
  return {
    'column_metadata': [{'id': key, 'type': col.type} for (key, col) in six.iteritems(columns)],
    'table_data': [[_dump_value(val) for val in col.values] for col in columns.values()],
    'table_name': name
  }

def _transpose(rows):
  """
  Transposes a collection of dictionary mapping key to values into a
  dictionary mapping key to values. Values are encoded into a tuple
  made of the grist_type of the first value that is not None and the
  collection of values.
  """
  transpose = OrderedDict()
  values = OrderedDict()
  for row in reversed(rows):
    values.update(row)
  for key, val in six.iteritems(values):
    transpose[key] = Col(_grist_type(val), [row.get(key, None) for row in rows])
  return transpose


def _dump_value(value):
  " Serialize a value."
  if isinstance(value, Ref):
    return value.rowid
  return value


def _grist_type(value):
  " Returns the grist type for value. "
  val_type = type(value)
  if val_type == Ref:
    return 'Ref:{}'.format(value.table_name)
  return GRIST_TYPES.get(val_type, 'Text')
