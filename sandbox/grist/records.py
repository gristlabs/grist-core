"""
Implements the base classes for Record and RecordSet objects used to represent records in Grist
tables. Individual tables use derived versions of these, which add per-column properties.
"""

from bisect import bisect_left, bisect_right
import functools
import sys

import six

@functools.total_ordering
class Record(object):
  """
  Name: Record, rec

  A Record represents a record of data. It is the primary means of accessing values in formulas. A
  Record for a particular table has a property for each data and formula column in the table.

  In a formula, `$field` is translated to `rec.field`, where `rec` is the Record for which the
  formula is being evaluated.

  For example:
  ```
  def Full_Name(rec, table):
    return rec.First_Name + ' ' + rec.LastName

  def Name_Length(rec, table):
    return len(rec.Full_Name)
  ```
  """

  # Some documentation for method-like parts of Record, which aren't actually methods.
  _DOC_EXTRA = (
    """
    Name: $Field, rec.Field
    Usage: __$__*Field* or __rec__*.Field*

    Access the field named "Field" of the current record. E.g. `$First_Name` or `rec.First_Name`.
    """,
    """
    Name: $group, rec.group
    Usage: __$group__

    In a [summary table](summary-tables.md), `$group` is a special field
    containing the list of Records that are summarized by the current summary line.  E.g. the
    formula `len($group)` counts the number of those records being summarized in each row.

    See [RecordSet](#recordset) for useful properties offered by the returned object.

    Examples:
    ```
    sum($group.Amount)                        # Sum of the Amount field in the matching records
    sum(r.Amount for r in $group)             # Same as sum($group.Amount)
    sum(r.Amount for r in $group if r > 0)    # Sum of only the positive amounts
    sum(r.Shares * r.Price for r in $group)   # Sum of shares * price products
    ```
    """
  )

  # Slots are an optimization to avoid the need for a per-object __dict__.
  __slots__ = ('_row_id', '_source_relation')

  # Per-table derived classes override this and set it to the appropriate Table object.
  _table = None

  # Record is always a thin class, containing essentially a reference to a row in the table. The
  # properties to access individual fields of a row are provided in per-table derived classes.
  def __init__(self, row_id, relation=None):
    """
    Creates a Record object.
      table - Table object, in which this record lives.
      row_id - The ID of the record within table.
      relation - Relation object for how this record was obtained; used in dependency tracking.

    In general you shouldn't call this constructor directly, but rather:

        table.Record(row_id, relation)

    which provides the table argument automatically.
    """
    self._row_id = row_id
    self._source_relation = relation or self._table._identity_relation

  # Existing fields are added as @property methods in table.py. When no field is found, raise a
  # more informative AttributeError.
  def __getattr__(self, name):
    return self._table._attribute_error(name, self._source_relation)

  def __hash__(self):
    return hash((self._table, self._row_id))

  def __eq__(self, other):
    return (isinstance(other, Record) and
            (self._table, self._row_id) == (other._table, other._row_id))

  def __ne__(self, other):
    return not self.__eq__(other)

  def __lt__(self, other):
    return (self._table.table_id, self._row_id) < (other._table.table_id, other._row_id)

  def __int__(self):
    return self._row_id

  def __nonzero__(self):
    return bool(self._row_id)

  __bool__ = __nonzero__

  def __repr__(self):
    return "%s[%s]" % (self._table.table_id, self._row_id)

  def _exists(self):
    # Whether the record exists: helpful for the rare cases when examining a record with a
    # non-zero rowId which has just been deleted.
    return self._row_id in self._table.row_ids

  def _clone_with_relation(self, src_relation):
    return self._table.Record(self._row_id,
                              relation=src_relation.compose(self._source_relation))


class RecordSet(object):
  """
  A RecordSet represents a collection of records, as returned by `Table.lookupRecords()` or
  `$group` property in summary views.

  A RecordSet allows iterating through the records:
  ```
  sum(r.Amount for r in Students.lookupRecords(First_Name="John", Last_Name="Doe"))
  min(r.DueDate for r in Tasks.lookupRecords(Owner="Bob"))
  ```

  RecordSets also provide a convenient way to access the list of values for a particular field for
  all the records, as `record_set.Field`. For example, the examples above are equivalent to:
  ```
  sum(Students.lookupRecords(First_Name="John", Last_Name="Doe").Amount)
  min(Tasks.lookupRecords(Owner="Bob").DueDate)
  ```

  You can get the number of records in a RecordSet using `len`, e.g. `len($group)`.
  """

  # Slots are an optimization to avoid the need for a per-object __dict__.
  __slots__ = ('_row_ids', '_source_relation', '_group_by', '_sort_by', '_sort_key')

  # Per-table derived classes override this and set it to the appropriate Table object.
  _table = None

  # Methods should be named with a leading underscore to avoid interfering with access to
  # user-defined fields.
  def __init__(self, row_ids, relation=None, group_by=None, sort_by=None, sort_key=None):
    """
    group_by may be a dictionary mapping column names to values that are all the same for the given
    RecordSet. sort_by may be the column name used for sorting this record set. Both are set by
    lookupRecords, and used when using RecordSet to insert new records.
    """
    self._row_ids = row_ids
    self._source_relation = relation or self._table._identity_relation
    # If row_ids is itself a RecordList, default to its _group_by, _sort_by, _sort_key properties.
    self._group_by = group_by or getattr(row_ids, '_group_by', None)
    self._sort_by = sort_by or getattr(row_ids, '_sort_by', None)
    self._sort_key = sort_key or getattr(row_ids, '_sort_key', None)

  def __len__(self):
    return len(self._row_ids)

  def __nonzero__(self):
    return bool(self._row_ids)

  __bool__ = __nonzero__

  def __eq__(self, other):
    return (isinstance(other, RecordSet) and
        (self._table, self._row_ids) == (other._table, other._row_ids))

  def __ne__(self, other):
    return not self.__eq__(other)

  def __iter__(self):
    for row_id in self._row_ids:
      yield self._table.Record(row_id, self._source_relation)

  def __contains__(self, item):
    """item may be a Record or its row_id."""
    if isinstance(item, int):
      return item in self._row_ids
    if isinstance(item, Record) and item._table == self._table:
      return int(item) in self._row_ids
    return False

  def get_one(self):
    # Pick the first record in the sorted order, or empty/sample record for empty RecordSet
    row_id = self._row_ids[0] if self._row_ids else 0
    return self._table.Record(row_id, self._source_relation)

  def __getitem__(self, index):
    # Allows subscripting a RecordSet as r[0] or r[-1].
    row_id = self._row_ids[index]
    return self._table.Record(row_id, self._source_relation)

  def __getattr__(self, name):
    return self._table._attribute_error(name, self._source_relation)

  def __repr__(self):
    return "%s[%s]" % (self._table.table_id, self._row_ids)

  def _at(self, index):
    """
    Returns element of RecordSet at the given index when the index is valid and non-negative.
    Otherwise returns the empty/sample record.
    """
    row_id = self._row_ids[index] if (0 <= index < len(self._row_ids)) else 0
    return self._table.Record(row_id, self._source_relation)

  def _clone_with_relation(self, src_relation):
    return self._table.RecordSet(self._row_ids,
                                 relation=src_relation.compose(self._source_relation),
                                 group_by=self._group_by,
                                 sort_by=self._sort_by,
                                 sort_key=self._sort_key)

  def _get_encodable_row_ids(self):
    """
    Returns stored rowIds as a simple list or tuple type, even if actually stored as RecordList.
    """
    # pylint: disable=unidiomatic-typecheck
    if type(self._row_ids) in (list, tuple):
      return self._row_ids
    else:
      return list(self._row_ids)

  def _get_sort_key(self):
    if not self._sort_key:
      if self._sort_by:
        raise ValueError("Sorted by %s but no sort_key" % (self._sort_by,))
      raise ValueError("Can only use 'find' methods in a sorted reference list")
    return self._sort_key

  def _to_local_row_id(self, item):
    if isinstance(item, int):
      return item
    if isinstance(item, Record) and item._table == self._table:
      return int(item)
    raise ValueError("unexpected search item")    # Need better error

  @property
  def find(self):
    # pylint: disable=line-too-long
    """
    Name: find.*
    Usage: RecordSet.**find.\\***(value)

    A set of methods for finding values in sorted sets of records, as returned by
    [`lookupRecords`](#lookuprecords). For example:
    ```
    Transactions.lookupRecords(..., order_by="Date").find.lt($Date)
    Table.lookupRecords(..., order_by=("Foo", "Bar")).find.le(foo, bar)
    ```

    If the `find` attribute is shadowed by a same-named user column, you may use `_find` instead.

    In the following methods, "less" is best understood as "before"
    and "greater" is best understood as "after".
    For example, if you use a negative `order_by` on a simple integer column,
    then the meaning of "less than" and "greater than" will be flipped.

    The methods available are:

    - __`lt`__: ("less than") Finds the nearest (last) record where the sort values are **before** the
      given values.
    - __`le`__: ("less than or equal to") Finds the last record where the sort values are **equal to
      or before** the given values.
    - __`gt`__: ("greater than") Finds the nearest (first) record where the sort values are **after**
      the given values.
    - __`ge`__: ("greater than or equal to") Finds the first record where the sort values are **equal
      to or after** the given values.
    - __`eq`__: ("equal to") Finds the first record where the sort values are **equal to** the given
      values.


    Example from [our Payroll template](https://templates.getgrist.com/5pHLanQNThxk/Payroll).
    Each person has a history of pay rates, in the Rates table. To find a rate applicable on a
    certain date, here is how you can do it old-style:
    ```python
    # Get all the rates for the Person and Role in this row.
    rates = Rates.lookupRecords(Person=$Person, Role=$Role)

    # Pick out only those rates whose Rate_Start is on or before this row's Date.
    past_rates = [r for r in rates if r.Rate_Start <= $Date]

    # Select the latest of past_rates, i.e. maximum by Rate_Start.
    rate = max(past_rates, key=lambda r: r.Rate_Start)

    # Return the Hourly_Rate from the relevant Rates record.
    return rate.Hourly_Rate
    ```

    With the new methods, it is much simpler:
    ```python
    rates = Rates.lookupRecords(Person=$Person, Role=$Role, order_by="Rate_Start")
    rate = rates.find.le($Date)
    return rate.Hourly_Rate
    ```

    Note that this is also much faster when there are many rates for the same Person and Role.
    """
    return FindOps(self)

  @property
  def _find(self):
    return FindOps(self)

  def _find_eq(self, *values):
    found = self._bisect_find(bisect_left, 0, _min_row_id, values)
    if found:
      # 'found' means that we found a row that's greater-than-or-equal-to the values we are
      # looking for. To check if the row is actually "equal", it remains to check if it is stictly
      # greater than the passed-in values.
      key = self._get_sort_key()
      if key(found._row_id, values) < key(found._row_id):
        return self._table.Record(0, self._source_relation)
    return found

  def _bisect_index(self, bisect_func, search_row_id, search_values=None):
    key = self._get_sort_key()
    # Note that 'key' argument is only available from Python 3.10.
    return bisect_func(self._row_ids, key(search_row_id, search_values), key=key)

  def _bisect_find(self, bisect_func, shift, search_row_id, search_values=None):
    i = self._bisect_index(bisect_func, search_row_id, search_values=search_values)
    return self._at(i + shift)

_min_row_id = -sys.float_info.max
_max_row_id = sys.float_info.max

if six.PY3:
  class FindOps(object):
    def __init__(self, record_set):
      self._rset = record_set

    def previous(self, row):
      row_id = self._rset._to_local_row_id(row)
      return self._rset._bisect_find(bisect_left, -1, row_id)

    def next(self, row):
      row_id = self._rset._to_local_row_id(row)
      return self._rset._bisect_find(bisect_right, 0, row_id)

    def rank(self, row, order="asc"):
      row_id = self._rset._to_local_row_id(row)
      index = self._rset._bisect_index(bisect_left, row_id)
      if order == "asc":
        return index + 1
      elif order == "desc":
        return len(self._rset) - index
      else:
        raise ValueError("The 'order' parameter must be \"asc\" (default) or \"desc\"")

    def lt(self, *values):
      return self._rset._bisect_find(bisect_left, -1, _min_row_id, values)

    def le(self, *values):
      return self._rset._bisect_find(bisect_right, -1, _max_row_id, values)

    def gt(self, *values):
      return self._rset._bisect_find(bisect_right, 0, _max_row_id, values)

    def ge(self, *values):
      return self._rset._bisect_find(bisect_left, 0, _min_row_id, values)

    def eq(self, *values):
      return self._rset._find_eq(*values)
else:
  class FindOps(object):
    def __init__(self, record_set):
      raise NotImplementedError("Update engine to Python3 to use lookupRecords().find")


def adjust_record(relation, value):
  """
  Helper to adjust a Record's source relation to be the composition with the given relation. This
  is used to wrap values like `foo.bar`: if `bar` is a Record, then its source relation should be
  the composition of the source relation of `foo` and the relation associated with `bar`.
  """
  if isinstance(value, (Record, RecordSet)):
    return value._clone_with_relation(relation)
  return value
