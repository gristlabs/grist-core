# Lookups are hard.
#
# Example to explain the relationship of various lookup helpers.
# Let's say we have this formula (notation [People.Rate] means a column "Rate" in table "People").
#     [People.Rate] = Rates.lookupRecords(Email=$Email, sort_by="Date")
#
# Conceptually, a good representation is to think of a helper table "UniqueRateEmails", which
# contains a list of unique Email values in the table Rates. These are all the values that
# lookupRecords() can find.
#
# So conceptually, it helps to imagine a table with the following columns:
#     [UniqueRateEmails.Email] = each Email in Rates
#     [UniqueRateEmails.lookedUpRates] = {r.id for r in Rates if r.Email == $Email}
#       -- this is the set of row_ids of all Rates with the email of this UniqueRateEmails row.
#     [UniqueRateEmails.lookedUpRatesSorted] = sorted($lookedUpRates)  # sorted by Date.
#
# We don't _actually_ create a helper table. (That would be a lot over overhead from all the extra
# tracking for recalculations.)
#
# We have two helper columns in the Rates table (the one in which we are looking up):
#     [Rate.#lookup#Email] (LookupMapColumn)
#       This is responsible to know which Rate rows correspond to which Emails (using a
#       SimpleLookupMapping helper). For any email, it can produce the set of row_ids of Rate
#       records.
#
#       - It depends on [Rate.Email], so that changes to Email cause a recalculation.
#       - When it gets recalculated, it
#         - updates internal maps.
#         - invalidates affected callers.
#
#     [Rate.#lookup#Email#Date] (SortedLookupMapColumn)
#       For each set of Rate results, this maintains a list of Rate row_ids sorted by Date.
#
#       - It depends on [Rate.Date] so that changes to Date cause a recalculation.
#       - When its do_lookup() is called, it creates
#         - a dependency between the caller [People.Rate] and itself [Rate.#lookup#Email#Date]
#           using a special _LookupRelation (which it keeps track of).
#         - a dependency between the caller [People.Rate] and unsorted lookup [Rate.#lookup#Email]
#           using another _LookupRelation (which [Rate.#lookup#Email] keeps track of).
#       - When it gets recalculated, which means that order of the lookup result has changed:
#         - it clears the cached sorted version of the lookup result
#         - uses its _LookupRelations to invalidate affected callers.

import itertools
import logging
from abc import abstractmethod

import six

import column
import depend
import records
import relation
from sort_key import make_sort_key
import twowaymap
from twowaymap import LookupSet
import usertypes
from functions.lookup import _Contains

log = logging.getLogger(__name__)


class NoValueColumn(column.BaseColumn):
  # Override various column methods, since (Sorted)LookupMapColumn doesn't care to store any
  # values. To outside code, it looks like a column of None's.
  def raw_get(self, row_id):
    return None
  def convert(self, value_to_convert):
    return None
  def get_cell_value(self, row_id, restore=False):
    return None
  def set(self, row_id, value):
    pass


class LookupMapColumn(NoValueColumn):
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
    super(LookupMapColumn, self).__init__(table, col_id, col_info)

    # For performance, prefer SimpleLookupMapping when no CONTAINS is used in lookups.
    if any(isinstance(col_id, _Contains) for col_id in col_ids_tuple):
      self._mapping = ContainsLookupMapping(col_ids_tuple)
    else:
      self._mapping = SimpleLookupMapping(col_ids_tuple)

    engine = table._engine
    engine.invalidate_column(self)
    self._relation_tracker = _RelationTracker(engine, self)

  def _recalc_rec_method(self, rec, _table):
    """
    LookupMapColumn acts as a formula column, and this method is the "formula" called whenever
    a dependency changes. If LookupMapColumn indexes columns (A,B), then a change to A or B would
    cause the LookupMapColumn to be invalidated for the corresponding rows, and brought up to date
    during formula recomputation by calling this method. It shold take O(1) time per affected row.
    """
    affected_keys = self._mapping.update_record(rec)
    self._relation_tracker.invalidate_affected_keys(affected_keys)

  def _do_fast_empty_lookup(self):
    """
    Simplified version of do_lookup for a lookup column with no key columns
    to make Table._num_rows as fast as possible.
    """
    return self._mapping.lookup_by_key((), default=())

  def _do_fast_lookup(self, key):
    key = tuple(_extract(val) for val in key)
    return self._mapping.lookup_by_key(key, default=LookupSet())

  @property
  def sort_key(self):
    return None

  def do_lookup(self, key):
    """
    Looks up key in the lookup map and returns a tuple with two elements: the list of matching
    records (sorted), and the Relation object for those records, relating
    the current frame to the returned records. Returns an empty set if no records match.
    """
    key = tuple(_extract(val) for val in key)
    row_ids, rel = self._do_lookup_with_sort(key, (), None)
    return row_ids, rel

  def _do_lookup_with_sort(self, key, sort_spec, sort_key):
    rel = self._relation_tracker.update_relation_from_current_node(key)
    row_id_set = self._do_fast_lookup(key)
    row_ids = row_id_set.sorted_versions.get(sort_spec)
    if row_ids is None:
      row_ids = sorted(row_id_set, key=sort_key)
      row_id_set.sorted_versions[sort_spec] = row_ids
    return row_ids, rel

  def _reset_sorted_versions(self, rec, sort_spec):
    # For the lookup keys in rec, find the associated LookupSets, and clear the cached
    # .sorted_versions entry for the given sort_spec. Used when only sort-by columns change.
    # Returns the set of affected keys.
    new_keys = set(self._mapping.get_new_keys_iter(rec))
    for key in new_keys:
      row_ids = self._mapping.lookup_by_key(key, default=LookupSet())
      row_ids.sorted_versions.pop(sort_spec, None)
    return new_keys

  def unset(self, row_id):
    # This is called on record removal, and is necessary to deal with removed records.
    affected_keys = self._mapping.remove_row_id(row_id)
    self._relation_tracker.invalidate_affected_keys(affected_keys)

  def _get_keys(self, row_id):
    # For _LookupRelation to know which keys are affected when the given looked-up row_id changes.
    return self._mapping.get_mapped_keys(row_id)

#----------------------------------------------------------------------

class SortedLookupMapColumn(NoValueColumn):
  """
  A SortedLookupMapColumn is associated with a LookupMapColumn and a set of columns used for
  sorting. It lives in the table containing the looked-up data. It is like a FormulaColumn in that
  it has a method triggered for a record whenever any of the sort columns change for that record.

  This method, in turn, invalidates lookups using the relations maintained by the LookupMapColumn.
  """
  def __init__(self, table, col_id, lookup_col, sort_spec):
    # Before creating the helper column, check that all dependencies are actually valid col_ids.
    sort_col_ids = [(c[1:] if c.startswith('-') else c) for c in sort_spec]

    for c in sort_col_ids:
      if not table.has_column(c):
        raise KeyError("Table %s has no column %s" % (table.table_id, c))

    # Note that different LookupSortHelperColumns may exist with the same sort_col_ids but
    # different sort_keys because they could differ in order of columns and ASC/DESC flags.
    col_info = column.ColInfo(usertypes.Any(), is_formula=True, method=self._recalc_rec_method)
    super(SortedLookupMapColumn, self).__init__(table, col_id, col_info)
    self._lookup_col = lookup_col

    self._sort_spec = sort_spec
    self._sort_col_ids = sort_col_ids
    self._sort_key = make_sort_key(table, sort_spec)

    self._engine = table._engine
    self._engine.invalidate_column(self)
    self._relation_tracker = _RelationTracker(self._engine, self)

  @property
  def sort_key(self):
    return self._sort_key

  def do_lookup(self, key):
    """
    Looks up key in the lookup map and returns a tuple with two elements: the list of matching
    records (sorted), and the Relation object for those records, relating
    the current frame to the returned records. Returns an empty set if no records match.
    """
    key = tuple(_extract(val) for val in key)
    self._relation_tracker.update_relation_from_current_node(key)
    row_ids, rel = self._lookup_col._do_lookup_with_sort(key, self._sort_spec, self._sort_key)
    return row_ids, rel

  def _recalc_rec_method(self, rec, _table):
    # Create dependencies on all the sort columns.
    for col_id in self._sort_col_ids:
      getattr(rec, col_id)

    affected_keys = self._lookup_col._reset_sorted_versions(rec, self._sort_spec)
    self._relation_tracker.invalidate_affected_keys(affected_keys)

  def _get_keys(self, row_id):
    # For _LookupRelation to know which keys are affected when the given looked-up row_id changes.
    return self._lookup_col._get_keys(row_id)

#----------------------------------------------------------------------

class BaseLookupMapping(object):
  def __init__(self, col_ids_tuple):
    self._col_ids_tuple = col_ids_tuple

    # Two-way map between rowIds of the target table (on the left) and key tuples (on the right).
    # Multiple rows can naturally map to the same key.
    # A single row can map to multiple keys when CONTAINS() is used.
    self._row_key_map = self._make_row_key_map()

  @abstractmethod
  def _make_row_key_map(self):
    raise NotImplementedError

  @abstractmethod
  def get_mapped_keys(self, row_id):
    """
    Get the set of keys associated with the given target row id, as stored in our mapping.
    """
    raise NotImplementedError

  @abstractmethod
  def get_new_keys_iter(self, rec):
    """
    Returns an iterator over the current value of all keys represented by the given record.
    Typically, it's just one key, but when list-type columns are involved, then could be several.
    """
    raise NotImplementedError

  @abstractmethod
  def update_record(self, rec):
    """
    Update the mapping to reflect the current value of all keys represented by the given record,
    and return all the affected keys, i.e. the set of all the keys that changed (old and new).
    """
    raise NotImplementedError

  def remove_row_id(self, row_id):
    old_keys = self.get_mapped_keys(row_id)
    for old_key in old_keys:
      self._row_key_map.remove(row_id, old_key)
    return old_keys

  def lookup_by_key(self, key, default=None):
    return self._row_key_map.lookup_right(key, default=default)


class SimpleLookupMapping(BaseLookupMapping):
  def _make_row_key_map(self):
    return twowaymap.TwoWayMap(left=LookupSet, right="single")

  def _get_mapped_key(self, row_id):
    return self._row_key_map.lookup_left(row_id)

  def get_mapped_keys(self, row_id):
    return {self._get_mapped_key(row_id)}

  def get_new_keys_iter(self, rec):
    # Note that getattr(rec, _col_id) is what creates the correct dependency, as well as ensures
    # that the columns used to index by are brought up-to-date (in case they are formula columns).
    return [tuple(_extract(getattr(rec, _col_id)) for _col_id in self._col_ids_tuple)]

  def update_record(self, rec):
    old_key = self._get_mapped_key(rec._row_id)
    new_key = self.get_new_keys_iter(rec)[0]
    if new_key == old_key:
      return set()
    try:
      self._row_key_map.insert(rec._row_id, new_key)
    except TypeError:
      # If key is not hashable, ignore it, just remove the old_key then.
      self._row_key_map.remove(rec._row_id, old_key)
      new_key = None

    # Both keys are affected when present.
    return {k for k in (old_key, new_key) if k is not None}


class ContainsLookupMapping(BaseLookupMapping):
  def _make_row_key_map(self):
    return twowaymap.TwoWayMap(left=LookupSet, right=set)

  def get_mapped_keys(self, row_id):
    # Need to copy the return value since it's the actual set
    # stored in the map and may be modified
    return set(self._row_key_map.lookup_left(row_id, ()))

  def get_new_keys_iter(self, rec):
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

    return itertools.product(*new_keys_groups)

  def update_record(self, rec):
    new_keys = set(self.get_new_keys_iter(rec))

    row_id = rec._row_id
    old_keys = self.get_mapped_keys(row_id)

    for old_key in old_keys - new_keys:
      self._row_key_map.remove(row_id, old_key)

    for new_key in new_keys - old_keys:
      self._row_key_map.insert(row_id, new_key)

    # Affected keys are those that were either newly inserted or newly removed.
    return new_keys ^ old_keys

#----------------------------------------------------------------------

class _RelationTracker(object):
  """
  Helper used by (Sorted)LookupMapColumn to keep track of the _LookupRelations between referring
  nodes and that column.
  """
  def __init__(self, engine, lookup_map):
    self._engine = engine
    self._lookup_map = lookup_map

    # Map of referring Node to _LookupRelation. Different tables may do lookups using a
    # (Sorted)LookupMapColumn, and that creates a dependency from other Nodes to us, with a
    # relation between referring rows and the lookup keys. This map stores these relations.
    self._lookup_relations = {}

  def update_relation_from_current_node(self, key):
    """
    Looks up key in the lookup map and returns a tuple with two elements: the list of matching
    records (sorted), and the Relation object for those records, relating
    the current frame to the returned records. Returns an empty set if no records match.
    """
    engine = self._engine
    if engine._is_current_node_formula:
      rel = self._get_relation(engine._current_node)
      rel._add_lookup(engine._current_row_id, key)
    else:
      rel = None

    # The _use_node call brings the _lookup_map column up-to-date, and creates a dependency on it.
    # Relation of None isn't valid, but it happens to be unused when there is no current_frame.
    engine._use_node(self._lookup_map.node, rel)
    return rel

  def invalidate_affected_keys(self, affected_keys):
    # For each known relation, figure out which referring rows are affected, and invalidate them.
    # The engine will notice that there have been more invalidations, and recompute things again.
    for rel in six.itervalues(self._lookup_relations):
      rel.invalidate_affected_keys(affected_keys, self._engine)

  def _get_relation(self, referring_node):
    """
    Helper which returns an existing or new _LookupRelation object for the given referring Node.
    """
    rel = self._lookup_relations.get(referring_node)
    if not rel:
      rel = _LookupRelation(self._lookup_map, self, referring_node)
      self._lookup_relations[referring_node] = rel
    return rel

  def _delete_relation(self, referring_node):
    self._lookup_relations.pop(referring_node, None)
    if not self._lookup_relations:
      self._engine.mark_lookupmap_for_cleanup(self._lookup_map)


class _LookupRelation(relation.Relation):
  """
  _LookupRelation maintains a mapping between rows of a table doing a lookup to the rows getting
  returned from the lookup. Lookups are implemented using a LookupMapColumn, and a _LookupRelation
  with in conjunction with its LookupMapColumn.

  _LookupRelation are created and owned by LookupMapColumn, and should not be created directly by
  other code.
  """

  def __init__(self, lookup_map, relation_tracker, referring_node):
    super(_LookupRelation, self).__init__(referring_node.table_id, lookup_map.table_id)
    self._lookup_map = lookup_map
    self._relation_tracker = relation_tracker
    self._referring_node = referring_node

    # Maps referring rows to keys, where multiple rows may map to the same key AND one row may
    # map to multiple keys (if a formula does multiple lookup calls).
    self._row_key_map = twowaymap.TwoWayMap(left=set, right=set)

    # This is for an optimization. We may invalidate the same key many times (including O(N)
    # times), which will lead to invalidating the same O(N) records over and over, resulting in
    # O(N^2) work. By remembering the keys we invalidated, we can avoid that waste.
    self._invalidated_keys_cache = set()

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

  def invalidate_affected_keys(self, affected_keys, engine):
    affected_rows = self.get_affected_rows_by_keys(affected_keys - self._invalidated_keys_cache)
    if affected_rows:
      node = self._referring_node
      engine.invalidate_records(node.table_id, affected_rows, col_ids=(node.col_id,))
      self._invalidated_keys_cache.update(affected_keys)

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
    self._reset_invalidated_keys_cache()

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
    self._reset_invalidated_keys_cache()

  def reset_all(self):
    """
    Called when the dependency using this relation is reset, and this relation is no longer used.
    """
    # In this case also, remove it from the LookupMapColumn. Once all relations are gone, the
    # lookup map can get cleaned up.
    self._row_key_map.clear()
    self._relation_tracker._delete_relation(self._referring_node)
    self._reset_invalidated_keys_cache()

  def _reset_invalidated_keys_cache(self):
    # When the invalidations take effect (i.e. invalidated columns get recomputed), the engine
    # resets the relations for the affected rows. We use that, as well as any change to the
    # relation, as a signal to clear _invalidated_keys_cache. Its purpose is only to serve while
    # going down a helper (Sorted)LookupMapColumn.
    self._invalidated_keys_cache.clear()


def extract_column_id(c):
  if isinstance(c, _Contains):
    return c.value
  else:
    return c

def _extract(cell_value):
  """
  When cell_value is a Record, returns its rowId. Otherwise returns the value unchanged.
  This is to allow lookups to work with reference columns.
  """
  if isinstance(cell_value, records.Record):
    return cell_value._row_id
  return cell_value
