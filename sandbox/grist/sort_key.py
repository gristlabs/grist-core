from numbers import Number

def make_sort_key(table, sort_spec):
  """
  table: Table object from table.py
  sort_spec: tuple of column IDs, optionally prefixed by '-' to invert the sort order.

  Returns a key class for comparing row_ids, i.e. with the returned SortKey, the expression
  SortKey(r1) < SortKey(r2) is true iff r1 comes before r2 according to sort_spec.

  The returned SortKey also allows comparing values that aren't in the table:
  SortKey(row_id, (v1, v2, ...)) will act as if the values of the columns mentioned in
  sort_spec are v1, v2, etc.
  """
  col_sort_spec = []
  for col_spec in sort_spec:
    col_id, sign = (col_spec[1:], -1) if col_spec.startswith('-') else (col_spec, 1)
    col_obj = table.get_column(col_id)
    col_sort_spec.append((col_obj, sign))

  class SortKey(object):
    __slots__ = ("row_id", "values")

    def __init__(self, row_id, values=None):
      # When values are provided, row_id is not used for access but is used for comparison, so
      # must still be comparable to any valid row_id (e.g. must not be None). We use
      # +-sys.float_info.max in records.py for this.
      self.row_id = row_id
      self.values = values or tuple(c.get_cell_value(row_id) for (c, _) in col_sort_spec)

    def __lt__(self, other):
      for (a, b, (col_obj, sign)) in zip(self.values, other.values, col_sort_spec):
        try:
          if a < b:
            return sign == 1
          if b < a:
            return sign == -1
        except TypeError:
          # Use fallback values to maintain order similar to Python2 (this matches the fallback
          # logic in SafeSortKey in column.py).
          # - None is less than everything else
          # - Numbers are less than other types
          # - Other types are ordered by type name
          af = ( (0 if a is None else 1), (0 if isinstance(a, Number) else 1), type(a).__name__ )
          bf = ( (0 if b is None else 1), (0 if isinstance(b, Number) else 1), type(b).__name__ )
          if af < bf:
            return sign == 1
          if bf < af:
            return sign == -1

      # Fallback order is by ascending row_id.
      return self.row_id < other.row_id

  return SortKey
