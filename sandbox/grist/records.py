"""
Implements the base classes for Record and RecordSet objects used to represent records in Grist
tables. Individual tables use derived versions of these, which add per-column properties.
"""

import functools

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
  __slots__ = ('_row_ids', '_source_relation', '_group_by', '_sort_by')

  # Per-table derived classes override this and set it to the appropriate Table object.
  _table = None

  # Methods should be named with a leading underscore to avoid interfering with access to
  # user-defined fields.
  def __init__(self, row_ids, relation=None, group_by=None, sort_by=None):
    """
    group_by may be a dictionary mapping column names to values that are all the same for the given
    RecordSet. sort_by may be the column name used for sorting this record set. Both are set by
    lookupRecords, and used when using RecordSet to insert new records.
    """
    self._row_ids = row_ids
    self._source_relation = relation or self._table._identity_relation
    # If row_ids is itself a RecordList, default to its _group_by and _sort_by properties.
    self._group_by = group_by or getattr(row_ids, '_group_by', None)
    self._sort_by = sort_by or getattr(row_ids, '_sort_by', None)

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
    if not self._row_ids:
      # Default to the empty/sample record
      row_id = 0
    elif self._sort_by:
      # Pick the first record in the sorted order
      row_id = self._row_ids[0]
    else:
      # Pick the first record in the order of the underlying table, for backwards compatibility.
      row_id = min(self._row_ids)
    return self._table.Record(row_id, self._source_relation)

  def __getattr__(self, name):
    return self._table._attribute_error(name, self._source_relation)

  def __repr__(self):
    return "%s[%s]" % (self._table.table_id, self._row_ids)

  def _clone_with_relation(self, src_relation):
    return self._table.RecordSet(self._row_ids,
                                 relation=src_relation.compose(self._source_relation),
                                 group_by=self._group_by,
                                 sort_by=self._sort_by)

  def _get_encodable_row_ids(self):
    """
    Returns stored rowIds as a simple list or tuple type, even if actually stored as RecordList.
    """
    # pylint: disable=unidiomatic-typecheck
    if type(self._row_ids) in (list, tuple):
      return self._row_ids
    else:
      return list(self._row_ids)



def adjust_record(relation, value):
  """
  Helper to adjust a Record's source relation to be the composition with the given relation. This
  is used to wrap values like `foo.bar`: if `bar` is a Record, then its source relation should be
  the composition of the source relation of `foo` and the relation associated with `bar`.
  """
  if isinstance(value, (Record, RecordSet)):
    return value._clone_with_relation(relation)
  return value
