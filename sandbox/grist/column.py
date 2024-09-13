import json
import logging
import types
from collections import namedtuple
from numbers import Number

import six

import actions
import depend
import objtypes
import usertypes
import relabeling
import relation
import reverse_references
import moment
from sortedcontainers import SortedListWithKey

log = logging.getLogger(__name__)

MANUAL_SORT = 'manualSort'
MANUAL_SORT_COL_INFO = {
  'id': MANUAL_SORT,
  'type': 'ManualSortPos',
  'formula': '',
  'isFormula': False
}
MANUAL_SORT_DEFAULT = 2147483647.0

SPECIAL_COL_IDS = {'id', MANUAL_SORT}


def is_visible_column(col_id):
  """
  Returns whether this is an id of a column that's intended to be shown to the user.
  """
  return col_id not in SPECIAL_COL_IDS and not col_id.startswith(('#', 'gristHelper_'))

def is_virtual_column(col_id):
  """
  Returns whether col_id is of a special column that does not get communicated outside of the
  sandbox. Lookup maps are an example.
  """
  return col_id.startswith('#')

def is_validation_column_name(name):
  return name.startswith("validation___")

ColInfo = namedtuple('ColInfo', ('type_obj', 'is_formula', 'method'))

def get_col_info(col_model, default_func=None):
  if isinstance(col_model, types.FunctionType):
    type_obj = getattr(col_model, 'grist_type', usertypes.Any())
    return ColInfo(type_obj, is_formula=True, method=col_model)
  else:
    return ColInfo(col_model, is_formula=False, method=col_model.default_func or default_func)


class BaseColumn(object):
  """
  BaseColumn holds a column of data, whether raw or computed.
  """
  def __init__(self, table, col_id, col_info):
    self.type_obj = col_info.type_obj
    self._is_right_type = self.type_obj.is_right_type
    self._data = []
    self.col_id = col_id
    self.table_id = table.table_id
    self.node = depend.Node(self.table_id, col_id)
    self._is_formula = col_info.is_formula
    self._is_private = bool(col_info.method) and getattr(col_info.method, 'is_private', False)
    self.update_method(col_info.method)

    # Always initialize to include the special empty record at index 0.
    self.growto(1)

  def update_method(self, method):
    """
    After rebuilding user code, we reuse existing column objects, but need to replace their
    'method' function. The method may refer to variables in the generated "usercode" module, and
    it's important that all such references are to the rebuilt "usercode" module.
    """
    self.method = method

  def is_formula(self):
    """
    Whether this is a formula column. Note that a non-formula column may have an associated
    method, which is used to fill in defaults when a record is added.
    """
    return self._is_formula

  def is_private(self):
    """
    Returns whether this method is private to the sandbox. If so, changes to this column do not
    get communicated to outside the sandbox via actions.
    """
    return self._is_private

  def has_formula(self):
    """
    has_formula is true if formula is set, whether or not this is a formula column.
    """
    return self.method is not None

  def clear(self):
    self._data = []
    self.growto(1)    # Always include the special empty record at index 0.

  def destroy(self):
    """
    Called when the column is deleted.
    """
    del self._data[:]

  def growto(self, size):
    if len(self._data) < size:
      self._data.extend([self.getdefault()] * (size - len(self._data)))

  def size(self):
    return len(self._data)

  def set(self, row_id, value):
    """
    Sets the value of this column for the given row_id. Value should be as returned by convert(),
    i.e. of the right type, or alttext, or error (but should NOT be random wrong types).
    """
    try:
      self._data[row_id] = value
    except IndexError:
      self.growto(row_id + 1)
      self._data[row_id] = value

  def unset(self, row_id):
    """
    Sets the value for the given row_id to the default value.
    """
    self.set(row_id, self.getdefault())

  def get_cell_value(self, row_id, restore=False):
    """
    Returns the "rich" value for the given row_id, i.e. the value that would be seen by formulas.
    E.g. for ReferenceColumns it'll be the referred-to Record object. For cells containing
    alttext, this will be an AltText object. For RaisedException objects that represent a thrown
    error, this will re-raise that error.
    """
    raw = self.raw_get(row_id)

    if isinstance(raw, objtypes.RaisedException):
      # For trigger formulas, we want to restore the previous value to recalculate
      # the cell one more time.
      if restore and raw.has_user_input():
        raw = raw.user_input
      elif isinstance(raw.error, depend.CircularRefError):
        # Wrapping a CircularRefError in a CellError is often redundant, but
        # TODO a CellError is still useful if the calling cell is not involved in the cycle
        raise raw.error
      else:
        raise objtypes.CellError(self.table_id, self.col_id, row_id, raw.error)

    # Inline _convert_raw_value here because this is particularly hot code, called on every access
    # of any data field in a formula.
    if self._is_right_type(raw):
      return self._make_rich_value(raw)
    return self._alt_text(raw)

  def _convert_raw_value(self, raw):
    if self._is_right_type(raw):
      return self._make_rich_value(raw)
    return self._alt_text(raw)

  def _alt_text(self, raw):
    return usertypes.AltText(str(raw), self.type_obj.typename())

  def _make_rich_value(self, typed_value):
    """
    Called by get_cell_value() with a value of the right type for this column. Should be
    implemented by derived classes to produce a "rich" version of the value.
    """
    # pylint: disable=no-self-use
    return typed_value

  def raw_get(self, row_id):
    """
    Returns the value stored for the given row_id. This may be an error or alttext, and it does
    not convert to a richer object.
    """
    try:
      return self._data[row_id]
    except IndexError:
      return self.getdefault()

  def safe_get(self, row_id):
    """
    Returns a value of the right type, or the default value if the stored value had a wrong type.
    """
    raw = self.raw_get(row_id)
    return raw if self.type_obj.is_right_type(raw) else self.getdefault()

  def getdefault(self):
    """
    Returns the default value for this column. This is a static default; the implementation of
    "default formula" logic is separate.
    """
    return self.type_obj.default

  def sample_value(self):
    """
    Returns a sample value for this column, used for auto-completions. E.g. for a date, this
    returns an actual datetime object rather than None (only its attributes should matter).
    """
    return self.type_obj.default

  def copy_from_column(self, other_column):
    """
    Replace this column's data entirely with data from another column of the same exact type.
    """
    self._data[:] = other_column._data

  def convert(self, value_to_convert):
    """
    Converts a value of any type to this column's type, returning either the converted value (for
    which is_right_type is true), or an alttext string, or an error object.
    """
    return self.type_obj.convert(value_to_convert)

  def prepare_new_values(self, row_ids, values, ignore_data=False, action_summary=None):
    """
    This allows us to modify values and also produce adjustments to existing records.

    Returns the pair (new_values, adjustments), where new_values is a list to replace `values`
    (one for each row_id), and adjustments is a list of additional docactions to apply, e.g. to
    adjust other rows.

    If ignore_data is True, makes adjustments without regard to the existing data; this is used
    for processing ReplaceTableData actions.
    """
    # pylint: disable=no-self-use, unused-argument
    return values, []

  def recalc_from_reverse_values(self):
    pass    # Only two-way references implement this


class DataColumn(BaseColumn):
  """
  DataColumn describes a column of raw data, and holds it.
  """
  pass


class ChoiceColumn(DataColumn):
  def rename_choices(self, renames):
    row_ids = []
    values = []
    for row_id, value in enumerate(self._data):
      if value is not None and self.type_obj.is_right_type(value):
        value = self._rename_cell_choice(renames, value)
        if value is not None:
          row_ids.append(row_id)
          values.append(value)
    return row_ids, values

  def _rename_cell_choice(self, renames, value):
    # pylint: disable=no-self-use
    return renames.get(value)


class BoolColumn(BaseColumn):
  def set(self, row_id, value):
    # When 1 or 1.0 is loaded, we should see it as True, and similarly 0 as False. This is similar
    # to how, after loading a number into a DateColumn, we should see a date, except we adjust
    # booleans at set() time.
    bool_value = True if value == 1 else (False if value == 0 else value)
    super(BoolColumn, self).set(row_id, bool_value)

class NumericColumn(BaseColumn):
  def set(self, row_id, value):
    # Make sure any integers are treated as floats to avoid truncation.
    # Uses `type(value) == int` rather than `isintance(value, int)` to specifically target
    # ints and not bools (which are singleton instances the class int in python).  But
    # perhaps something should be done about bools also?
    # pylint: disable=unidiomatic-typecheck
    super(NumericColumn, self).set(row_id, float(value) if type(value) == int else value)

_sample_date = moment.ts_to_date(0)
_sample_datetime = moment.ts_to_dt(0, None, moment.TZ_UTC)

class DateColumn(NumericColumn):
  """
  DateColumn contains numerical timestamps represented as seconds since epoch, in type float,
  to midnight of specific UTC dates. Accessing them yields date objects.
  """
  def _make_rich_value(self, typed_value):
    return typed_value and moment.ts_to_date(typed_value)

  def sample_value(self):
    return _sample_date

class DateTimeColumn(NumericColumn):
  """
  DateTimeColumn contains numerical timestamps represented as seconds since epoch, in type float,
  and a timestamp associated with the column. Accessing them yields datetime objects.
  """
  def __init__(self, table, col_id, col_info):
    super(DateTimeColumn, self).__init__(table, col_id, col_info)
    self._timezone = col_info.type_obj.timezone

  def _make_rich_value(self, typed_value):
    return typed_value and moment.ts_to_dt(typed_value, self._timezone)

  def sample_value(self):
    return _sample_datetime


class SafeSortKey(object):
  """
  Sort key that deals with errors raised by normal comparison,
  in particular for values of different types or values that can't
  be compared at all (e.g. None).
  This somewhat mimics the way that Python 2 compares values.
  This is only needed in Python 3.
  """

  __slots__ = ("value",)

  def __init__(self, value):
    self.value = value

  def __repr__(self):
    return "MixedTypesKey({self.value!r})".format(self=self)

  def __eq__(self, other):
    return self.value == other.value

  def __lt__(self, other):
    try:
      return self.value < other.value
    except TypeError:
      if type(self.value) is type(other.value):
        return id(self.value) < id(other.value)
      else:
        return self.type_position() < other.type_position()

  def type_position(self):
    # Fallback order similar to Python 2:
    # - None is less than everything else
    # - Numbers are less than other types
    # - Other types are ordered by type name
    # The first two elements use the fact that False < True (because 0 < 1)
    return (
      self.value is not None,
      not isinstance(self.value, Number),
      type(self.value).__name__,
    )


if six.PY2:
  _doc = SafeSortKey.__doc__
  def SafeSortKey(x):
    return x
  SafeSortKey.__doc__ =_doc


class PositionColumn(NumericColumn):
  def __init__(self, table, col_id, col_info):
    super(PositionColumn, self).__init__(table, col_id, col_info)
    # This is a list of row_ids, ordered by the position.
    self._sorted_rows = SortedListWithKey(key=lambda x: SafeSortKey(self.raw_get(x)))

  def clear(self):
    super(PositionColumn, self).clear()
    self._sorted_rows.clear()

  def set(self, row_id, value):
    self._sorted_rows.discard(row_id)
    super(PositionColumn, self).set(row_id, value)
    if value != self.getdefault():
      self._sorted_rows.add(row_id)

  def copy_from_column(self, other_column):
    super(PositionColumn, self).copy_from_column(other_column)
    self._sorted_rows = SortedListWithKey(other_column._sorted_rows[:],
                                          key=lambda x: SafeSortKey(self.raw_get(x)))

  def prepare_new_values(self, row_ids, values, ignore_data=False, action_summary=None):
    # This does the work of adjusting positions and relabeling existing rows with new position
    # (without changing sort order) to make space for the new positions. Note that this is also
    # used for updating a position for an existing row: we'll find a new value for it; later when
    # this value is set, the old position will be removed and the new one added.
    if ignore_data:
      rows = []
    else:
      rows = self._sorted_rows
    # prepare_inserts expects floats as keys, not MixedTypesKeys
    rows = SortedListWithKey(rows, key=self.raw_get)
    adjustments, new_values = relabeling.prepare_inserts(rows, values)
    adj_action = _adjustments_to_action(self.node,
        [(self._sorted_rows[i], pos) for (i, pos) in adjustments])
    return new_values, ([adj_action] if adj_action else [])


class ChoiceListColumn(ChoiceColumn):
  """
  ChoiceListColumn's default value is None, but is presented to formulas as the empty list.
  """
  def set(self, row_id, value):
    # When a JSON string is loaded, set it to a tuple parsed from it. When a list is loaded,
    # convert to a tuple to keep values immutable.
    if isinstance(value, six.string_types) and value.startswith(u'['):
      try:
        value = tuple(json.loads(value))
      except Exception:
        pass
    elif isinstance(value, list):
      value = tuple(value)
    super(ChoiceListColumn, self).set(row_id, value)

  def _make_rich_value(self, typed_value):
    return () if typed_value is None else typed_value

  def _rename_cell_choice(self, renames, value):
    if any((v in renames) for v in value):
      return tuple(renames.get(choice, choice) for choice in value)
    return None


class BaseReferenceColumn(BaseColumn):
  """
  Base class for ReferenceColumn and ReferenceListColumn.
  """
  def __init__(self, table, col_id, col_info):
    super(BaseReferenceColumn, self).__init__(table, col_id, col_info)
    # We can assume that all tables have been instantiated, but not all initialized.
    target_table_id = self.type_obj.table_id
    self._table = table
    self._target_table = table._engine.tables.get(target_table_id, None)
    self._relation = relation.ReferenceRelation(table.table_id, target_table_id, col_id)
    # Note that we need to remove these back-references when the column is removed.
    if self._target_table:
      self._target_table._back_references.add(self)

    self._reverse_source_node = self.type_obj.reverse_source_node()
    if self._reverse_source_node:
      _multimap_add(self._table._reverse_cols_by_source_node, self._reverse_source_node, self)


  def destroy(self):
    # Destroy the column and remove the back-reference we created in the constructor.
    super(BaseReferenceColumn, self).destroy()
    if self._reverse_source_node:
      _multimap_remove(self._table._reverse_cols_by_source_node, self._reverse_source_node, self)

    if self._target_table:
      self._target_table._back_references.remove(self)

  def _update_references(self, row_id, old_value, new_value):
    for r in self._value_iterable(old_value):
      self._relation.remove_reference(row_id, r)
    for r in self._value_iterable(new_value):
      self._relation.add_reference(row_id, r)

  def _clean_up_value(self, value):
    raise NotImplementedError()

  def _value_iterable(self, value):
    raise NotImplementedError()

  def _list_to_value(self, value_as_list):
    raise NotImplementedError()

  def set(self, row_id, value):
    old = self.safe_get(row_id)
    super(BaseReferenceColumn, self).set(row_id, self._clean_up_value(value))
    new = self.safe_get(row_id)
    self._update_references(row_id, old, new)

  def copy_from_column(self, other_column):
    super(BaseReferenceColumn, self).copy_from_column(other_column)
    self._relation.clear()
    # This is hacky: we should have an interface to iterate through values of a column. (As it is,
    # self._data may include values for non-existent rows; it works here because those values are
    # falsy, which makes them ignored by self._update_references).
    for row_id, value in enumerate(self._data):
      if self.type_obj.is_right_type(value):
        self._update_references(row_id, None, value)

  def sample_value(self):
    return self._target_table.sample_record

  def get_updates_for_removed_target_rows(self, target_row_ids):
    """
    Returns a list of pairs of (row_id, new_value) for values in this column that need to be
    updated when target_row_ids are removed from the referenced table.
    """
    affected_rows = sorted(self._relation.get_affected_rows(target_row_ids))
    return [(row_id, self._raw_get_without(row_id, target_row_ids)) for row_id in affected_rows]

  def prepare_new_values(self, row_ids, values, ignore_data=False, action_summary=None):
    values = [self._clean_up_value(v) for v in values]
    reverse_cols = self._target_table._reverse_cols_by_source_node.get(self.node, [])
    adjustments = []
    if reverse_cols:
      old_values = [self.raw_get(r) for r in row_ids]
      reverse_adjustments = reverse_references.get_reverse_adjustments(
          row_ids, old_values, values, self._value_iterable, self._relation)

      if reverse_adjustments:
        for reverse_col in reverse_cols:
          adjustments.append(_adjustments_to_action(
            reverse_col.node,
            [(row_id, reverse_col._list_to_value(value)) for (row_id, value) in reverse_adjustments]
          ))

    return values, adjustments

  def recalc_from_reverse_values(self):
    """
    Generates actions to update reverse column based on this column.
    """
    if not self._reverse_source_node:
      return None
    rev_table_id, rev_col_id = self._reverse_source_node
    reverse_col = self._target_table.get_column(rev_col_id)
    reverse_adjustments = []
    for target_row_id in self._target_table.row_ids:
      reverse_value = self._relation.get_affected_rows((target_row_id,))
      reverse_adjustments.append((target_row_id, sorted(reverse_value)))
    return _adjustments_to_action(reverse_col.node,
        [(row_id, reverse_col._list_to_value(value)) for (row_id, value) in reverse_adjustments])

  def _raw_get_without(self, _row_id, _target_row_ids):
    """
    Returns a Ref or RefList cell value with the specified target_row_ids removed, assuming one of
    them is actually present in the value. For References, it just leaves the default value.
    """
    return self.getdefault()

  def _lookup(self, reference_lookup, value):
    col_id = (
        reference_lookup.options.get("column")
        or self._target_table._engine.docmodel
            .get_column_rec(self.table_id, self.col_id).visibleCol.colId
        or "id"
    )
    value = objtypes.decode_object(value)
    return self._target_table.lookup_one_record(**{col_id: value})

class UniqueReferenceError(ValueError):
  pass

class ReferenceColumn(BaseReferenceColumn):
  """
  ReferenceColumn contains IDs of rows in another table. Accessing them yields the records in the
  other table.
  """
  def _make_rich_value(self, typed_value):
    # If we refer to an invalid table, return integers rather than fail completely.
    if not self._target_table:
      return typed_value
    # For a Reference, values must either refer to an existing record, or be 0. In all tables,
    # the 0 index will contain the all-defaults record.
    return self._target_table.Record(typed_value, self._relation)

  def _value_iterable(self, value):
    return (value,) if value and self.type_obj.is_right_type(value) else ()

  def _list_to_value(self, value_as_list):
    if len(value_as_list) > 1:
      raise UniqueReferenceError("UNIQUE reference constraint violated")
    return value_as_list[0] if value_as_list else 0

  def _clean_up_value(self, value):
    # Allow float values that are small integers. In practice, this only turns out to be relevant
    # in rare cases (such as undo of Ref->Numeric conversion).
    if type(value) == float and value.is_integer():   # pylint:disable=unidiomatic-typecheck
      if value > 0 and objtypes.is_int_short(int(value)):
        return int(value)
    return value

  def prepare_new_values(self, row_ids, values, ignore_data=False, action_summary=None):
    if action_summary and values:
      values = action_summary.translate_new_row_ids(self._target_table.table_id, values)
    return super(ReferenceColumn, self).prepare_new_values(row_ids, values,
        ignore_data=ignore_data, action_summary=action_summary)

  def convert(self, val):
    if isinstance(val, objtypes.ReferenceLookup):
      val = self._lookup(val, val.value) or self._alt_text(val.alt_text)
    elif isinstance(val, list):
      val = val[0] if val else 0
    return super(ReferenceColumn, self).convert(val)


class ReferenceListColumn(BaseReferenceColumn):
  """
  ReferenceListColumn maintains for each row a list of references (row IDs) into another table.
  Accessing them yields RecordSets.
  """
  def _clean_up_value(self, value):
    if isinstance(value, six.string_types):
      # This is second part of a "hack" we have to do when we rename tables. During
      # the rename, we briefly change all Ref columns to Int columns (to lose the table
      # part), and then back to Ref columns. The values during this change are stored
      # as serialized strings, which we expect to understand when the column is back to
      # being a Ref column. We can either end up with a list of ints, or a RecordList
      # serialized as a string.
      # TODO: explain why we need to do this and why we have chosen the Int column
      try:
        # If it's a string that looks like JSON, try to parse it as such.
        if value.startswith('['):
          parsed = json.loads(value)

          # It must be list of integers.
          if not isinstance(parsed, list):
            return value

          # All of them must be positive integers
          if all(isinstance(v, int) and v > 0 for v in parsed):
            return parsed
        else:
          # Else try to parse it as a RecordList
          return objtypes.RecordList.from_repr(value)
      except Exception:
        pass
    return value

  def _value_iterable(self, value):
    return value if value and self.type_obj.is_right_type(value) else ()

  def _list_to_value(self, value_as_list):
    return value_as_list or None

  def _make_rich_value(self, typed_value):
    if typed_value is None:
      typed_value = []
    # If we refer to an invalid table, return integers rather than fail completely.
    if not self._target_table:
      return typed_value
    return self._target_table.RecordSet(typed_value, self._relation)

  def _raw_get_without(self, row_id, target_row_ids):
    """
    Returns the RefList cell value at row_id with the specified target_row_ids removed.
    """
    raw = self.raw_get(row_id)
    if self.type_obj.is_right_type(raw):
      raw = [r for r in raw if r not in target_row_ids] or None
    return raw

  def convert(self, val):
    if isinstance(val, objtypes.ReferenceLookup):
      result = []
      values = val.value
      if not isinstance(values, list):
        values = [values]
      for value in values:
        lookup_value = self._lookup(val, value)
        if not lookup_value:
          return self._alt_text(val.alt_text)
        result.append(lookup_value)
      val = result

    if isinstance(val, int) and val:
      val = [val]

    return super(ReferenceListColumn, self).convert(val)

def _multimap_add(mapping, key, value):
  mapping.setdefault(key, []).append(value)

def _multimap_remove(mapping, key, value):
  if key in mapping and value in mapping[key]:
    mapping[key].remove(value)
    if not mapping[key]:
      del mapping[key]

def _adjustments_to_action(node, row_value_pairs):
  # Takes a depend.Node and a list of (row_id, value) pairs, and returns a BulkUpdateRecord action.
  if not row_value_pairs:
    return None
  row_ids, values = zip(*row_value_pairs)
  return actions.BulkUpdateRecord(node.table_id, row_ids, {node.col_id: values})

# Set up the relationship between usertypes objects and column objects.
usertypes.BaseColumnType.ColType = DataColumn
usertypes.Reference.ColType = ReferenceColumn
usertypes.ReferenceList.ColType = ReferenceListColumn
usertypes.Choice.ColType = ChoiceColumn
usertypes.ChoiceList.ColType = ChoiceListColumn
usertypes.DateTime.ColType = DateTimeColumn
usertypes.Date.ColType = DateColumn
usertypes.PositionNumber.ColType = PositionColumn
usertypes.Bool.ColType = BoolColumn
usertypes.Numeric.ColType = NumericColumn

def create_column(table, col_id, col_info):
  return col_info.type_obj.ColType(table, col_id, col_info)
