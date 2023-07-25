import itertools
import logging
from abc import abstractmethod

import six

import column
import depend
import records
import relation
import twowaymap
import usertypes
from functions.lookup import _Contains

log = logging.getLogger(__name__)


def _extract(cell_value):
  """
  When cell_value is a Record, returns its rowId. Otherwise returns the value unchanged.
  This is to allow lookups to work with reference columns.
  """
  if isinstance(cell_value, records.Record):
    return cell_value._row_id
  return cell_value


class BaseLookupMapColumn(column.BaseColumn):
  """
  Conceptually a LookupMapColumn is associated with a table ("target table") and maintains for
  each row a key (which is a tuple of values from the named columns), which is fast to look up.
  The lookup is generally performed in a formula in a different table ("referring table").

  LookupMapColumn is similar to a FormulaColumn in that it needs to do some computation whenever
  one of its dependencies changes: namely, it needs to update the index.

  Although it acts as a column, a LookupMapColumn isn't included among its table's columns, and
  doesn't have a column id.

  Compared to relational database, LookupMapColumn is analogous to a database index.
  """

  def __init__(self, table, col_id, col_ids_tuple):
    # Note that self._recalc_rec_method is passed in as the formula's "method".
    col_info = column.ColInfo(usertypes.Any(), is_formula=True, method=self._recalc_rec_method)
    super(BaseLookupMapColumn, self).__init__(table, col_id, col_info)

    self._col_ids_tuple = col_ids_tuple
    self._engine = table._engine

    # Two-way map between rowIds of the target table (on the left) and key tuples (on the right).
    # Multiple rows can naturally map to the same key.
    # Multiple keys can map to the same row if CONTAINS() is used
    # The map is populated by engine's _recompute when this
    # node is brought up-to-date.
    self._row_key_map = self._make_row_key_map()
    self._engine.invalidate_column(self)

    # Map of referring Node to _LookupRelation. Different tables may do lookups using this
    # LookupMapColumn, and that creates a dependency from other Nodes to us, with a relation
    # between referring rows and the lookup keys. This map stores these relations.
    self._lookup_relations = {}

  @abstractmethod
  def _make_row_key_map(self):
    raise NotImplementedError

  @abstractmethod
  def _recalc_rec_method(self, rec, table):
    """
    LookupMapColumn acts as a formula column, and this method is the "formula" called whenever
    a dependency changes. If LookupMapColumn indexes columns (A,B), then a change to A or B would
    cause the LookupMapColumn to be invalidated for the corresponding rows, and brought up to date
    during formula recomputation by calling this method. It shold take O(1) time per affected row.
    """
    raise NotImplementedError

  @abstractmethod
  def _get_keys(self, target_row_id):
    """
    Get the keys associated with the given target row id.
    """
    raise NotImplementedError

  def unset(self, row_id):
    # This is called on record removal, and is necessary to deal with removed records.
    old_keys = self._get_keys(row_id)
    for old_key in old_keys:
      self._row_key_map.remove(row_id, old_key)
    self._invalidate_affected(old_keys)

  def _invalidate_affected(self, affected_keys):
    # For each known relation, figure out which referring rows are affected, and invalidate them.
    # The engine will notice that there have been more invalidations, and recompute things again.
    for node, rel in six.iteritems(self._lookup_relations):
      affected_rows = rel.get_affected_rows_by_keys(affected_keys)
      self._engine.invalidate_records(node.table_id, affected_rows, col_ids=(node.col_id,))

  def _get_relation(self, referring_node):
    """
    Helper which returns an existing or new _LookupRelation object for the given referring Node.
    """
    rel = self._lookup_relations.get(referring_node)
    if not rel:
      rel = _LookupRelation(self, referring_node)
      self._lookup_relations[referring_node] = rel
    return rel

  def _delete_relation(self, referring_node):
    self._lookup_relations.pop(referring_node, None)
    if not self._lookup_relations:
      self._engine.mark_lookupmap_for_cleanup(self)

  def _do_fast_empty_lookup(self):
    """
    Simplified version of do_lookup for a lookup column with no key columns
    to make Table._num_rows as fast as possible.
    """
    return self._row_key_map.lookup_right((), default=())

  def do_lookup(self, key):
    """
    Looks up key in the lookup map and returns a tuple with two elements: the set of matching
    records (as a set object, not ordered), and the Relation object for those records, relating
    the current frame to the returned records. Returns an empty set if no records match.
    """
    key = tuple(_extract(val) for val in key)
    engine = self._engine
    if engine._is_current_node_formula:
      rel = self._get_relation(engine._current_node)
      rel._add_lookup(engine._current_row_id, key)
    else:
      rel = None

    # The _use_node call both brings LookupMapColumn up-to-date, and creates a dependency on it.
    # Relation of None isn't valid, but it happens to be unused when there is no current_frame.
    engine._use_node(self.node, rel)

    row_ids = self._row_key_map.lookup_right(key, set())
    return row_ids, rel

  # Override various column methods, since LookupMapColumn doesn't care to store any values. To
  # outside code, it looks like a column of None's.
  def raw_get(self, value):
    return None
  def convert(self, value):
    return None
  def get_cell_value(self, row_id):
    return None
  def set(self, row_id, value):
    pass

# For performance, prefer SimpleLookupMapColumn when no CONTAINS is used
# in lookups, although the two implementations should be equivalent
# See also table._add_update_summary_col

class SimpleLookupMapColumn(BaseLookupMapColumn):
  def _make_row_key_map(self):
    return twowaymap.TwoWayMap(left=set, right="single")

  def _recalc_rec_method(self, rec, table):
    old_key = self._row_key_map.lookup_left(rec._row_id)

    # Note that getattr(rec, _col_id) is what creates the correct dependency, as well as ensures
    # that the columns used to index by are brought up-to-date (in case they are formula columns).
    new_key = tuple(_extract(getattr(rec, _col_id)) for _col_id in self._col_ids_tuple)

    try:
      self._row_key_map.insert(rec._row_id, new_key)
    except TypeError:
      # If key is not hashable, ignore it, just remove the old_key then.
      self._row_key_map.remove(rec._row_id, old_key)
      new_key = None

    # It's OK if None is one of the values, since None will just never be found as a key.
    self._invalidate_affected({old_key, new_key})

  def _get_keys(self, target_row_id):
    return {self._row_key_map.lookup_left(target_row_id)}


class ContainsLookupMapColumn(BaseLookupMapColumn):
  def _make_row_key_map(self):
    return twowaymap.TwoWayMap(left=set, right=set)

  def _recalc_rec_method(self, rec, table):
    # Create a key in the index for every combination of values in columns
    # looked up with CONTAINS()
    new_keys_groups = []
    for col_id in self._col_ids_tuple:
      # Note that getattr() is what creates the correct dependency, as well as ensures
      # that the columns used to index by are brought up-to-date (in case they are formula columns).
      group = getattr(rec, extract_column_id(col_id))

      if isinstance(col_id, _Contains):
        # Check that the cell targeted by CONTAINS() has an appropriate type.
        # Don't iterate over characters of a string.
        # group = [] essentially means there are no new keys in this call
        if isinstance(group, (six.binary_type, six.text_type)):
          group = []
        elif not group and col_id.match_empty != _Contains.no_match_empty:
          group = [col_id.match_empty]
      else:
        group = [group]

      try:
        # We only care about the unique key values
        group = set(group)
      except TypeError:
        group = []

      new_keys_groups.append([_extract(v) for v in group])

    new_keys = set(itertools.product(*new_keys_groups))

    row_id = rec._row_id
    old_keys = self._get_keys(row_id)
    for old_key in old_keys - new_keys:
      self._row_key_map.remove(row_id, old_key)

    for new_key in new_keys - old_keys:
      self._row_key_map.insert(row_id, new_key)

    # Invalidate all keys which were either inserted or removed
    self._invalidate_affected(new_keys ^ old_keys)

  def _get_keys(self, target_row_id):
    # Need to copy the return value since it's the actual set
    # stored in the map and may be modified
    return set(self._row_key_map.lookup_left(target_row_id, ()))


#----------------------------------------------------------------------

class _LookupRelation(relation.Relation):
  """
  _LookupRelation maintains a mapping between rows of a table doing a lookup to the rows getting
  returned from the lookup. Lookups are implemented using a LookupMapColumn, and a _LookupRelation
  with in conjunction with its LookupMapColumn.

  _LookupRelation are created and owned by LookupMapColumn, and should not be created directly by
  other code.
  """

  def __init__(self, lookup_map, referring_node):
    super(_LookupRelation, self).__init__(referring_node.table_id, lookup_map.table_id)
    self._lookup_map = lookup_map
    self._referring_node = referring_node

    # Maps referring rows to keys, where multiple rows may map to the same key AND one row may
    # map to multiple keys (if a formula does multiple lookup calls).
    self._row_key_map = twowaymap.TwoWayMap(left=set, right=set)

  def __str__(self):
    return "_LookupRelation(%s->%s)" % (self._referring_node, self.target_table)

  def get_affected_rows(self, target_row_ids):
    if target_row_ids == depend.ALL_ROWS:
      return depend.ALL_ROWS
    # Each target row (result of a lookup by key)
    # is associated with a set of keys,and all rows that
    # looked up an affected key are affected by a change to any associated row. We remember which
    # rows looked up which key in self._row_key_map, so that when some target row changes to a new
    # key, we can know which referring rows need to be recomputed.
    return self.get_affected_rows_by_keys(
      set().union(*[self._lookup_map._get_keys(r) for r in target_row_ids])
    )

  def get_affected_rows_by_keys(self, keys):
    """
    This is used by LookupMapColumn to know which rows got affected when a target row changed to
    have a different key. Keys can be any iterable. A key of None is allowed and affects nothing.
    """
    affected_rows = set()
    for key in keys:
      if key is not None:
        affected_rows.update(self._row_key_map.lookup_right(key, default=()))
    return affected_rows

  def _add_lookup(self, referring_row_id, key):
    """
    Helper used by LookupMapColumn to store the fact that the given key was looked up in the
    process of computing the given referring_row_id.
    """
    self._row_key_map.insert(referring_row_id, key)

  def reset_rows(self, referring_rows):
    """
    Called when starting to compute a formula, so that mappings for the given referring_rows can
    be cleared as they are about to be rebuilt.
    """
    # Clear out references from referring_rows.
    if referring_rows == depend.ALL_ROWS:
      self._row_key_map.clear()
    else:
      for row_id in referring_rows:
        self._row_key_map.remove_left(row_id)

  def reset_all(self):
    """
    Called when the dependency using this relation is reset, and this relation is no longer used.
    """
    # In this case also, remove it from the LookupMapColumn. Once all relations are gone, the
    # lookup map can get cleaned up.
    self._row_key_map.clear()
    self._lookup_map._delete_relation(self._referring_node)


def extract_column_id(c):
  if isinstance(c, _Contains):
    return c.value
  else:
    return c
