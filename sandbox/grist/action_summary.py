"""
Representation of changes due to some actions, similar to app/common/ActionSummary on node side.
It's used for collecting calculated values for formula columns.
"""
from collections import namedtuple

import six

import actions
from objtypes import equal_encoding

# Pairs of before/after names of tables and columns.  None represents non-existence for `before`,
# while "defunct_name" (i.e. `-{name}`) represents non-existence for `after`. This way,
# addition and removal of tables/columns can be represented.
#
# Note that changes are keyed using the last known name, or "defunct_name" for entities that have
# been removed.
LabelDelta = namedtuple('before', 'after')

class ActionSummary(object):
  # This is a class (similar to app/common/ActionSummary on node side) to summarize a list of
  # docactions to easily answer questions such as whether a column was added.
  def __init__(self):
    self._tables = {}         # maps tableId to TableDelta
    self._table_renames = LabelRenames()

  def add_changes(self, table_id, col_id, changes):
    """
    Record changes for the given table and column, in the form (row_id, before, after).
    """
    col_deltas = self._forTable(table_id).column_deltas.setdefault(col_id, {})
    for (row_id, before, after) in changes:
      # If a change was already recorded, update the 'after' value and keep the 'before' one.
      previous = col_deltas.get(row_id)
      col_deltas[row_id] = (previous[0] if previous else before, after)

  def convert_deltas_to_actions(self, out_stored, out_undo):
    """
    Go through all prepared deltas, construct DocActions for them, and add them to out_stored
    and out_undo lists.
    """
    for table_id in sorted(self._tables):
      table_delta = self._tables[table_id]
      for col_id in sorted(table_delta.column_deltas):
        column_delta = table_delta.column_deltas[col_id]
        self._changes_to_actions(table_id, col_id, column_delta, out_stored, out_undo)

  def pop_column_delta_as_actions(self, table_id, col_id, out_stored, out_undo):
    """
    Remove deltas for a particular column, and convert the removed deltas to DocActions. Add
    those to out_stored and out_undo lists.
    """
    table_delta = self._tables.get(table_id)
    col_delta = table_delta and table_delta.column_deltas.pop(col_id, None)
    return self._changes_to_actions(table_id, col_id, col_delta or {}, out_stored, out_undo)

  def update_new_rows_map(self, table_id, temp_row_ids, final_row_ids):
    """
    Add a mapping from temporary negative row_ids to the final ones, for rows added to the given
    table. The two lists must have the same length; only negative row_ids are remembered. If a
    negative row_id was already used, its mapping will be overridden.
    """
    t = self._forTable(table_id)
    t.temp_row_ids.update((a, b) for (a, b) in zip(temp_row_ids, final_row_ids) if a and a < 0)

  def translate_new_row_ids(self, table_id, row_ids):
    """
    Translate any temporary (negative) row_ids to their final values, using mappings created by
    update_new_rows_map().
    """
    t = self._forTable(table_id)
    return [t.temp_row_ids.get(r, r) for r in row_ids]

  def _changes_to_actions(self, table_id, col_id, column_delta, out_stored, out_undo):
    """
    Given a column and a dict of column_deltas for it, of the form {row_id: (before_value,
    after_value)}, creates DocActions and adds them to out_stored and out_undo lists.
    """
    if not column_delta:
      return
    full_row_ids = sorted(r for r, (before, after) in six.iteritems(column_delta)
                          if not equal_encoding(before, after))

    defunct = is_defunct(table_id) or is_defunct(col_id)
    table_id = root_name(table_id)
    col_id = root_name(col_id)

    def update_action(filtered_row_ids, delta_index):
      values = [column_delta[r][delta_index] for r in filtered_row_ids]
      return actions.BulkUpdateRecord(table_id, filtered_row_ids, {col_id: values}).simplify()

    if not defunct:
      row_ids_after = self.filter_out_gone_rows(table_id, full_row_ids)
      if row_ids_after:
        out_stored.append(update_action(row_ids_after, 1))

    if self.is_created(table_id, col_id) and not defunct:
      # A newly-created column, and not replacing a defunct one. Don't generate undo actions.
      return

    ## Maybe add one or two undo update actions for rows that existed before the change.
    row_ids_before = self.filter_out_new_rows(table_id, full_row_ids)

    if defunct:
      preserved_row_ids = []
    else:
      preserved_row_ids = self.filter_out_gone_rows(table_id, row_ids_before)

    preserved_row_ids_set = set(preserved_row_ids)
    defunct_row_ids = [r for r in row_ids_before if r not in preserved_row_ids_set]

    if preserved_row_ids:
      out_undo.append(update_action(preserved_row_ids, 0))

    if defunct_row_ids:
      # Updates for deleted rows/columns/tables should come after they're re-added.
      # So we need to insert the undos *before*.
      out_undo.insert(0, update_action(defunct_row_ids, 0))

  def _forTable(self, table_id):
    return self._tables.get(table_id) or self._tables.setdefault(table_id, TableDelta())

  def is_created(self, table_id, col_id):
    if self._table_renames.is_created(table_id):
      return True
    t = self._tables.get(table_id)
    return t and t.column_renames.is_created(col_id)

  def filter_out_new_rows(self, table_id, row_ids):
    t = self._tables.get(table_id)
    if not t:
      return row_ids
    return [r for r in row_ids if t._rows_present_before.get(r) != False]

  def filter_out_gone_rows(self, table_id, row_ids):
    t = self._tables.get(table_id)
    if not t:
      return row_ids
    return [r for r in row_ids if t._rows_present_after.get(r) != False]

  def add_records(self, table_id, row_ids):
    t = self._forTable(table_id)
    for r in row_ids:
      # An addition means the row was initially absent, unless we already processed its removal.
      t._rows_present_before.setdefault(r, False)
      t._rows_present_after[r] = True

  def remove_records(self, table_id, row_ids):
    t = self._forTable(table_id)
    for r in row_ids:
      # A removal means the row was initially present, unless it was already marked as new.
      t._rows_present_before.setdefault(r, True)
      t._rows_present_after[r] = False

  def add_column(self, table_id, col_id):
    return self.rename_column(table_id, None, col_id)

  def remove_column(self, table_id, col_id):
    return self.rename_column(table_id, col_id, defunct_name(col_id))

  def rename_column(self, table_id, old_col_id, new_col_id):
    t = self._forTable(table_id)
    t.column_renames.add_rename(old_col_id, new_col_id)
    if old_col_id in t.column_deltas:
      t.column_deltas[new_col_id] = t.column_deltas.pop(old_col_id)

  def add_table(self, table_id):
    self.rename_table(None, table_id)

  def remove_table(self, table_id):
    self.rename_table(table_id, defunct_name(table_id))

  def rename_table(self, old_table_id, new_table_id):
    self._table_renames.add_rename(old_table_id, new_table_id)
    if old_table_id in self._tables:
      self._tables[new_table_id] = self._tables.pop(old_table_id)

class TableDelta(object):
  def __init__(self):
    # Each map maps rowId to True or False. If a row was added and later removed, both will be
    # False. If removed, then added, both will be True. If neither, it will not be in the map.
    self._rows_present_before = {}
    self._rows_present_after = {}
    self.column_renames = LabelRenames()
    self.column_deltas = {}   # maps col_id to the dict {row_id: (before_value, after_value)}

    # Map of negative row_ids that may be used in [Bulk]AddRecord actions to the final row_ids for
    # those rows; to allow translating Reference values added in the same action bundle.
    self.temp_row_ids = {}


class LabelRenames(object):
  """
  Maintains a set of renames, for tables in a doc, or for columns in a table. For now, we only
  maintain the knowledge of the original name, since we only need to answer limited questions.
  """
  def __init__(self):
    self._new_to_old = {}

  def add_rename(self, before, after):
    original = self._new_to_old.pop(before, before)
    self._new_to_old[after] = original

  def is_created(self, latest_name):
    return self._new_to_old.get(latest_name, latest_name) is None


def defunct_name(name):
  return '-' + name

def is_defunct(name):
  return name.startswith('-')

def root_name(name):
  return name[1:] if name.startswith('-') else name
