def PREVIOUS(rec, *, group_by=(), order_by):
  """
  Finds the previous record in the table according to the order specified by `order_by`, and
  grouping specified by `group_by`. Each of these arguments may be a column ID or a tuple of
  column IDs, and `order_by` allows column IDs to be prefixed with "-" to reverse sort order.

  For example,
  ```python
  PREVIOUS(rec, order_by="Date")    # The previous record when sorted by increasing Date.
  PREVIOUS(rec, order_by="-Date")   # The previous record when sorted by decreasing Date.
  ```

  You may use `group_by` to search for the previous record within a filtered group. For example,
  this finds the previous record with the same Account as `rec`, when records are filtered by the
  Account of `rec` and sorted by increasing Date:
  ```python
  PREVIOUS(rec, group_by="Account", order_by="Date")
  ```

  When multiple records have the same `order_by` values (e.g. the same Date in the examples above),
  the order is determined by the relative position of rows in views. This is done internally by
  falling back to the special column `manualSort` and the row ID column `id`.

  Use `order_by=None` to find the previous record in an unsorted table (when rows may be
  rearranged by dragging them manually). For example:
  ```python
  PREVIOUS(rec, order_by=None)      # The previous record in the unsorted list of records.
  ```

  You may specify multiple column IDs as a tuple, for both `group_by` and `order_by`. This can be
  used to match views sorted by multiple columns. For example:
  ```python
  PREVIOUS(rec, group_by=("Account", "Year"), order_by=("Date", "-Amount"))
  ```
  """
  return _sorted_lookup(rec, group_by=group_by, order_by=order_by)._find.previous(rec)

def NEXT(rec, *, group_by=(), order_by):
  """
  Finds the next record in the table according to the order specified by `order_by`, and
  grouping specified by `group_by`. See [`PREVIOUS`](#previous) for details.
  """
  return _sorted_lookup(rec, group_by=group_by, order_by=order_by)._find.next(rec)

def RANK(rec, *, group_by=(), order_by, order="asc"):
  """
  Returns the rank (or position) of this record in the table according to the order specified by
  `order_by`, and grouping specified by `group_by`. See [`PREVIOUS`](#previous) for details of
  these parameters.

  The `order` parameter may be `"asc"` (which is the default) or `"desc"`.

  When `order` is `"asc"` or omitted, the first record in the group in the sorted order would have
  the rank of 1. When `order` is `"desc"`, the last record in the sorted order would have the rank
  of 1.

  If there are multiple groups, there will be multiple records with the same rank. In particular,
  each group will have a record with rank 1.

  For example, `RANK(rec, group_by="Year", order_by="Score", order="desc")` will return the rank of
  the current record (`rec`) among all the records in its table for the same year, ordered by
  decreasing score.
  """
  return _sorted_lookup(rec, group_by=group_by, order_by=order_by)._find.rank(rec, order=order)


def _sorted_lookup(rec, *, group_by, order_by):
  if isinstance(group_by, str):
    group_by = (group_by,)
  return rec._table.lookup_records(**{c: getattr(rec, c) for c in group_by}, order_by=order_by)
