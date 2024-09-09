from collections import defaultdict
import six
from usertypes import get_referenced_table_id

class _RefUpdates(object):
  def __init__(self):
    self.removals = set()
    self.additions = set()

def get_reverse_adjustments(row_ids, old_values, new_values, value_iterator, relation):
  """
  Generates data for updating reverse columns, based on changes to this column
  """

  # Stores removals and addons for each target row
  affected_target_rows = defaultdict(_RefUpdates)

  # Iterate over changes to source column (my column)
  for (source_row_id, old_value, new_value) in zip(row_ids, old_values, new_values):
    if new_value != old_value:
      # Treat old_values as removals, and new_values as additions
      for target_row_id in value_iterator(old_value):
        affected_target_rows[target_row_id].removals.add(source_row_id)
      for target_row_id in value_iterator(new_value):
        affected_target_rows[target_row_id].additions.add(source_row_id)

  # Now in affected_target_rows, we have the changes (deltas), now we are going to convert them
  # to updates (full list of values) in target columns.

  adjustments = []

  # For each target row (that needs to be updated, and was change in our column)
  for target_row_id, updates in six.iteritems(affected_target_rows):
    # Get the value stored in that column by using our own relation object (which should store
    # correct values - the same that are stored in that reverse column). `reverse_value` is the
    # value in that reverse cell
    reverse_value = relation.get_affected_rows((target_row_id,))

    # Now make the adjustments using calculated deltas
    for source_row_id in updates.removals:
      reverse_value.discard(source_row_id)
    for source_row_id in updates.additions:
      reverse_value.add(source_row_id)
    adjustments.append((target_row_id, sorted(reverse_value)))

  return adjustments


def check_desired_reverse_col(col_type, desired_reverse_col):
  if not desired_reverse_col:
    raise ValueError("invalid column specified in reverseCol")
  if desired_reverse_col.reverseCol:
    raise ValueError("reverseCol specifies an existing two-way reference column")
  ref_table_id = get_referenced_table_id(col_type)
  if not ref_table_id:
    raise ValueError("reverseCol may only be set on a column with a reference type")
  if desired_reverse_col.tableId != ref_table_id:
    raise ValueError("reverseCol must be a column in the target table")


def pick_reverse_col_label(docmodel, col_rec):
  ref_table_id = get_referenced_table_id(col_rec.type)
  ref_table_rec = docmodel.get_table_rec(ref_table_id)

  # First try the source table title.
  source_table_rec = col_rec.parentId
  reverse_label = source_table_rec.rawViewSectionRef.title or source_table_rec.tableId

  # If that name already exists (as a label), add the source column's name as a suffix.
  avoid_set = set(c.label for c in ref_table_rec.columns)
  if reverse_label in avoid_set:
    return reverse_label + "-" + (col_rec.label or col_rec.colId)
  return reverse_label
