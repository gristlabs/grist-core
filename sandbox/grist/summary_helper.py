import itertools

import column
import depend
import relation
import usertypes
from usertypes import extract_value

# Summary tables rely on two special columns:
#
# - In the *source* table:
#   a summary helper column, with ID "#summary#<SummaryTableId>". Changes to the table trigger a
#   recalc, and a call to its _recalc_rec_method, which updates the mappings. Its type is Reference
#   or ReferenceList. It is neither visible nor stored.
#
# - In the *summary* table:
#   "group": a visible column available to the user. Its type is ReferenceList. It is a formula
#   column, with formula table.getSummarySourceGroup(rec). It depends on the summary helper column
#   and is invalidated by changes to it.
#
# They also rely on the new DB-like trigger functionality, so far only available internally, as
# table._hooks_* members.

class SummaryHelperMixin():
  def __init__(self, table, col_id, summary_table, groupby_cols):
    type_obj = self.usertype_cls(summary_table.table_id)
    col_info = column.ColInfo(type_obj, is_formula=True, method=self._recalc_rec_method)
    super().__init__(table, col_id, col_info)
    self._engine = table._engine
    self._is_private = True
    self.initialize(summary_table, groupby_cols)

  def initialize(self, summary_table, groupby_cols):
    self._summary_key_map = None  # To be initialized lazily, see _get_summary_key_map.
                                  # It maps each summary row's key tuple to its row_id.
    self._summary_table = summary_table
    self._summary_table_id = summary_table.table_id
    self._groupby_cols = groupby_cols
    self._group_relation = _SummaryGroupRelation(self)
    self._engine.invalidate_records(self._summary_table_id, depend.ALL_ROWS, col_ids=('group',))

  def get_source_group(self, row_id):
    # Here, row_id is in the _summary_ table; the return value is a list of _source_ table rows.
    #
    # Called by the summary table's "group" column, as table.getSummarySourceGroup(rec). The
    # source rows of a summary group are exactly the rows referring to it -- i.e. the reverse of
    # this reference column -- which the relation already maintains in its inverse_map.

    # The _use_node call records the "group" column's dependency on this helper column, and,
    # importantly, ensures that the helper column is brought up to date first.
    self._engine._use_node(self.node, self._group_relation)

    # We sort a transient list rather than caching via LookupSet.get_sorted_version(): the sorted
    # result is already stored on the "group" column, so a per-group sorted cache would only add
    # memory (measured ~+9% on a many-summaries doc) to save a re-sort that happens just once per
    # change anyway.
    return sorted(self._relation.inverse_map.get(row_id, ()))

  def reset_mapping(self):
    # Reset the key map to be rebuilt on next use.
    self._summary_key_map = None

  def _group_key(self, rec):
    # The group-by tuple for a record. The group-by columns exist on both the source table (whose
    # records drive _recalc_rec_method) and the summary table (whose records drive the hooks).
    return tuple(extract_value(getattr(rec, c)) for c in self._groupby_cols)

  def _get_summary_key_map(self):
    if self._summary_key_map is None:
      groupby_col_objs = [self._summary_table.get_column(col_id) for col_id in self._groupby_cols]

      def make_key(row_id):
        return tuple(extract_value(c.get_cell_value(row_id)) for c in groupby_col_objs)

      self._summary_key_map = {make_key(row_id): row_id for row_id in self._summary_table.row_ids}
    return self._summary_key_map

  def _update_references(self, row_id, old_value, new_value, index_new=True):
    # This is called for row_id in the _source_ table (the one containing this helper column),
    # while old_value and new_value contain row_ids in the summary table.
    super()._update_references(row_id, old_value, new_value, index_new)

    # After updating references (called on .set() and .unset(), in particular), invalidate the
    # summary table's "group" column. It relies on these references without lookup machinery.
    affected_rows = set(self._value_iterable(old_value)) | set(self._value_iterable(new_value))
    self._engine.invalidate_records(self._summary_table_id, affected_rows, col_ids=('group',))

  # The two hooks below keep _summary_key_map current as summary rows come and go (fired by the
  # summary table's _hooks_after_add / _hooks_after_load / _hooks_before_remove). In both,
  # row_id refers to rows in the summary table (rather than the source table).
  def _on_summary_after_add(self, row_id):
    if self._summary_key_map is not None:
      key = self._group_key(self._summary_table.get_record(row_id))
      self._summary_key_map[key] = row_id

  def _on_summary_before_remove(self, row_id):
    # Pop the key only if it maps to this row. Group-by values are written only by the summary
    # machinery, but rows sharing a key can still appear, e.g. via an undo of a summary-row
    # removal, after an equivalent group was auto-created.
    if self._summary_key_map is not None:
      key = self._group_key(self._summary_table.get_record(row_id))
      if self._summary_key_map.get(key) == row_id:
        del self._summary_key_map[key]


class _SummaryGroupRelation(relation.Relation):
  """
  Relation for the summary table's "group" column's dependency on the source table's helper
  column. Row-level changes are invalidated precisely -- old and new memberships -- by the
  helper's set()/unset() (see SummaryHelperMixin._update_references), so this relation only
  passes through full-column invalidations; its main role is that the edge's _use_node call
  brings the helper up to date before "group" reads the inverse map.
  """
  def __init__(self, helper_col):
    super().__init__(helper_col._summary_table_id, helper_col.table_id)

  def __str__(self):
    return "_SummaryGroupRelation(%s)" % self.target_table

  def get_affected_rows(self, input_rows):
    return depend.ALL_ROWS if input_rows == depend.ALL_ROWS else set()


# When grouping doesn't involve any list columns (ChoiceList/ReferenceList), then each row of the
# source table maps to a single row of a summary table. This is the simpler and faster case.
class SummaryHelperSingleColumn(SummaryHelperMixin, column.ReferenceColumn):
  usertype_cls = usertypes.Reference

  def _recalc_rec_method(self, rec, table):     # pylint: disable=unused-argument
    values_tuple = self._group_key(rec)
    row_id = self._get_summary_key_map().get(values_tuple)
    if not row_id:
      col_values = dict(zip(self._groupby_cols, values_tuple))
      # Treat summary table output as we treat formula columns, for purposes of acl.
      with self._engine.user_actions.indirect_actions():
        row_id = self._engine.user_actions.AddRecord(self._summary_table_id, None, col_values)
    return row_id


# When grouping involves any list columns (ChoiceList/ReferenceList), then each row of the source
# table maps to possibly multiple rows of a summary table, so this helper is a ReferenceList.
class SummaryHelperListColumn(SummaryHelperMixin, column.ReferenceListColumn):
  usertype_cls = usertypes.ReferenceList

  def _get_lookup_tuples(self, rec, table):
    # Retrieves every combination of values that need to exist in the summary table.
    lookup_values = []
    for group_col in self._groupby_cols:
      lookup_value = getattr(rec, group_col)
      group_col_obj = table.table.all_columns[group_col]
      if isinstance(group_col_obj, (column.ChoiceListColumn, column.ReferenceListColumn)):
        # Check that ChoiceList/ReferenceList cells have appropriate types.
        # Don't iterate over characters of a string.
        if isinstance(lookup_value, (bytes, str)):
          return []
        try:
          # We only care about the unique choices
          lookup_value = set(lookup_value)
        except TypeError:
          return []

        if not lookup_value:
          if isinstance(group_col_obj, column.ChoiceListColumn):
            lookup_value = {""}
          else:
            lookup_value = {0}
      else:
        lookup_value = [lookup_value]
      lookup_values.append([extract_value(v) for v in lookup_value])
    return sorted(itertools.product(*lookup_values))

  def _recalc_rec_method(self, rec, table):  # pylint: disable=unused-argument
    # Returning [] removes this source row from every group: the ReferenceList set() updates the
    # reverse map and invalidates the affected summary "group" cells, which then drop this row.
    result = []
    values_to_add = {}
    count_new_keys = 0

    summary_key_map = self._get_summary_key_map()
    for values_tuple in self._get_lookup_tuples(rec, table):
      row_id = summary_key_map.get(values_tuple)
      if row_id:
        result.append(row_id)
      else:
        for col, value in zip(self._groupby_cols, values_tuple):
          values_to_add.setdefault(col, []).append(value)
        count_new_keys += 1

    if count_new_keys > 0:
      # summary table output should be treated as we treat formula columns, for acl purposes
      with self._engine.user_actions.indirect_actions():
        new_row_ids = self._engine.user_actions.BulkAddRecord(
          self._summary_table_id, [None] * count_new_keys, values_to_add
        )
        result += new_row_ids

    return result
