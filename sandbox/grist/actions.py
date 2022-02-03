"""
actions.py defines the action objects used in the Python code, and functions to convert between
them and the serializable docActions objects used to communicate with the outside.

When communicating with Node, docActions are represented as arrays [actionName, arguments...].
"""

from collections import namedtuple
import inspect

import six

import objtypes

def _eq_with_type(self, other):
  # pylint: disable=unidiomatic-typecheck
  return tuple(self) == tuple(other) and type(self) == type(other)

def _ne_with_type(self, other):
  return not _eq_with_type(self, other)

def namedtuple_eq(typename, field_names):
  """
  Just like namedtuple, but these objects are only considered equal to other objects of the same
  type (not just to any tuple with the same values).
  """
  n = namedtuple(typename, field_names)
  n.__eq__ = _eq_with_type
  n.__ne__ = _ne_with_type
  return n

# For Record actions, the parameters are as follows:
#     table_id: string name of the table.
#     row_id:   numeric row identifier
#     row_ids:  list of row identifiers
#     columns:  dictionary mapping col_id (string name of column) to the value for the given
#               row_id, or an array of values parallel to the array of row_ids.
AddRecord = namedtuple_eq('AddRecord', ('table_id', 'row_id', 'columns'))
BulkAddRecord = namedtuple_eq('BulkAddRecord', ('table_id', 'row_ids', 'columns'))
RemoveRecord = namedtuple_eq('RemoveRecord', ('table_id', 'row_id'))
BulkRemoveRecord = namedtuple_eq('BulkRemoveRecord', ('table_id', 'row_ids'))
UpdateRecord = namedtuple_eq('UpdateRecord', ('table_id', 'row_id', 'columns'))
BulkUpdateRecord = namedtuple_eq('BulkUpdateRecord', ('table_id', 'row_ids', 'columns'))

# Identical to BulkAddRecord, but implies emptying out the table first.
ReplaceTableData = namedtuple_eq('ReplaceTableData', BulkAddRecord._fields)

# For Column actions, the parameters are:
#     table_id: string name of the table.
#     col_id:   string name of column
#     col_info: dictionary with particular keys
#         type :      string type of the column
#         isFormula:  bool, whether it is a formula column
#         formula:    string text of the formula, or empty string
#     Other keys may be set in col_info (e.g. widgetOptions, label) but are not currently used in
#     the schema (only such values from the metadata tables is used).
AddColumn = namedtuple_eq('AddColumn', ('table_id', 'col_id', 'col_info'))
RemoveColumn = namedtuple_eq('RemoveColumn', ('table_id', 'col_id'))
RenameColumn = namedtuple_eq('RenameColumn', ('table_id', 'old_col_id', 'new_col_id'))
ModifyColumn = namedtuple_eq('ModifyColumn', ('table_id', 'col_id', 'col_info'))

# For Table actions, the parameters are:
#     table_id: string name of the table.
#     columns:  array of col_info objects, as described for Column actions above, containing also:
#         id:         string name of the column (aka col_id in Column actions)
AddTable = namedtuple_eq('AddTable', ('table_id', 'columns'))
RemoveTable = namedtuple_eq('RemoveTable', ('table_id',))
RenameTable = namedtuple_eq('RenameTable', ('old_table_id', 'new_table_id'))

# Identical to BulkAddRecord, just a clearer type name for loading or fetching data.
TableData = namedtuple_eq('TableData', BulkAddRecord._fields)

action_types = dict((key, val) for (key, val) in globals().items()
                    if inspect.isclass(val) and issubclass(val, tuple))

# This is the set of names of all the actions that affect the schema.
schema_actions = {name for name in action_types
                  if name.endswith("Column") or name.endswith("Table")}

def _add_simplify(SingleActionType, BulkActionType):
  """
  Add .simplify method to "Bulk" actions, which returns None for no rows, non-Bulk version for a
  single row, and the original action otherwise.
  """
  if len(SingleActionType._fields) < 3:
    def get_first(self):
      return SingleActionType(self.table_id, self.row_ids[0])
  else:
    def get_first(self):
      return SingleActionType(self.table_id, self.row_ids[0],
                              { key: col[0] for key, col in six.iteritems(self.columns)})
  def simplify(self):
    return None if not self.row_ids else (get_first(self) if len(self.row_ids) == 1 else self)

  BulkActionType.simplify = simplify

_add_simplify(AddRecord, BulkAddRecord)
_add_simplify(RemoveRecord, BulkRemoveRecord)
_add_simplify(UpdateRecord, BulkUpdateRecord)


def get_action_repr(action_obj):
  """
  Converts an action object, such as UpdateRecord into a docAction array.
  """
  return [action_obj.__class__.__name__] + list(encode_objects(action_obj))

def action_from_repr(doc_action):
  """
  Converts a docAction array into an object such as UpdateRecord.
  """
  action_type = action_types.get(doc_action[0])
  if not action_type:
    raise ValueError('Unknown action %s' % (doc_action[0],))

  try:
    return decode_objects(action_type(*doc_action[1:]))
  except TypeError as e:
    raise TypeError("%s: %s" % (doc_action[0], str(e)))


def convert_recursive_helper(converter, data):
  """
  Given JSON-like data (a nested collection of lists or arrays), which may include Action tuples,
  replaces all primitive values with converter(value). It should be used as follows:

      def my_convert(data):
        if data needs conversion:
          return converted_value
        return convert_recursive_helper(my_convert, data)
  """
  if isinstance(data, dict):
    return {converter(k): converter(v) for k, v in six.iteritems(data)}
  elif isinstance(data, list):
    return [converter(el) for el in data]
  elif isinstance(data, tuple):
    return type(data)(*[converter(el) for el in data])
  else:
    return data

def convert_action_values(converter, action):
  """
  Replaces all data values in an action that includes actual data with converter(value).
  """
  if isinstance(action, (AddRecord, UpdateRecord)):
    return type(action)(action.table_id, action.row_id,
                        {k: converter(v) for k, v in six.iteritems(action.columns)})
  if isinstance(action, (BulkAddRecord, BulkUpdateRecord, ReplaceTableData, TableData)):
    return type(action)(
      action.table_id, action.row_ids,
      {k: [converter(value) for value in values] for k, values in six.iteritems(action.columns)}
    )
  return action

def convert_recursive_in_action(converter, data):
  """
  Like convert_recursive_helper, but only values of Grist cells (i.e. individual values in data
  columns) get passed through converter.
  """
  def inner(data):
    if isinstance(data, tuple):
      return convert_action_values(converter, data)
    return convert_recursive_helper(inner, data)
  return inner(data)

def encode_objects(data):
  return convert_recursive_in_action(objtypes.encode_object, data)

def decode_objects(data, decoder=objtypes.decode_object):
  """
  Decode objects in values of a DocAction or a data structure containing DocActions.
  """
  return convert_recursive_in_action(decoder, data)

def decode_bulk_values(bulk_values, decoder=objtypes.decode_object):
  """
  Decode objects in values of the form {col_id: array_of_values}, as present in bulk DocActions
  and UserActions.
  """
  return {
    k: [decoder(value) for value in values]
    for k, values in six.iteritems(bulk_values)
  }

def transpose_bulk_action(bulk_action):
  """
  Generates namedtuples for records in a bulk action such as BulkAddRecord. Such actions store
  values by columns, so in effect this transposes them, yielding them by rows.
  """
  items = sorted(bulk_action.columns.items())
  RecordType = namedtuple('Record', ['id'] + [col_id for (col_id, values) in items])
  for row in zip(bulk_action.row_ids, *[values for (col_id, values) in items]):
    yield RecordType(*row)


def prune_actions(action_list, table_id, col_id):
  """
  Modifies action_list in-place, removing any mention of (table_id, col_id). Both must be given
  and not None in this implementation.
  """
  keep = []
  for a in action_list:
    if getattr(a, 'table_id', None) == table_id:
      if hasattr(a, 'columns'):
        a.columns.pop(col_id, None)
        if not a.columns:
          continue
      if getattr(a, 'col_id', None) == col_id:
        continue
    keep.append(a)
  action_list[:] = keep
