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
#
# Lookups whose key is a Reference or ReferenceList column take an optimized path. Such a column
# already maintains a reverse index (target row id -> set of referring rows) for invalidation
# (see ReferenceRelation), and that index is exactly the answer to lookupRecords(RefCol=$id) (or
# a CONTAINS() lookup on a RefList column). For these, LookupMapColumnForReferences serves
# results directly from the index (via ReferenceLookupMapping) and invalidates callers from the
# reference column's update hook, instead of maintaining a separate map of its own by
# recomputation.

import itertools
import logging
from abc import abstractmethod

import column
import depend
from lookupset import LookupSet
import relation
import twowaymap
import usertypes
from usertypes import extract_value as _extract
from functions.lookup import _Contains

log = logging.getLogger(__name__)


def make_lookup_map_column(table, col_id, col_ids_tuple):
  if is_reference_lookup(table, col_ids_tuple):
    return LookupMapColumnForReferences(table, col_id, col_ids_tuple)
  else:
    return LookupMapColumn(table, col_id, col_ids_tuple)


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
    if not col_ids_tuple:
      self._mapping = AllLookupMapping(col_ids_tuple)
    elif is_reference_lookup(table, col_ids_tuple):
      ref_col = table.get_column(extract_column_id(col_ids_tuple[0]))
      self._mapping = ReferenceLookupMapping(col_ids_tuple, ref_col)
    elif any(isinstance(col_id, _Contains) for col_id in col_ids_tuple):
      self._mapping = ContainsLookupMapping(col_ids_tuple)
    else:
      self._mapping = SimpleLookupMapping(col_ids_tuple)

    self._engine = table._engine
    self._engine.invalidate_column(self)
    self._relation_tracker = _RelationTracker(self._engine, self)
    self._invalidated_keys_cache = InvalidatedKeysCache()

  def _recalc_rec_method(self, rec, _table):
    """
    LookupMapColumn acts as a formula column, and this method is the "formula" called whenever
    a dependency changes. If LookupMapColumn indexes columns (A,B), then a change to A or B would
    cause the LookupMapColumn to be invalidated for the corresponding rows, and brought up to date
    during formula recomputation by calling this method. It shold take O(1) time per affected row.
    """
    affected_keys = self._mapping.update_record(rec)
    affected_keys = self._invalidated_keys_cache.add_keys(affected_keys)
    self._relation_tracker.invalidate_affected_keys(affected_keys)

  def _do_fast_empty_lookup(self):
    """
    Simplified version of do_lookup for a lookup column with no key columns
    to make Table._num_rows as fast as possible.
    """
    return self._mapping.lookup_by_key((), default=())

  def do_lookup(self, key):
    """
    Looks up key in the lookup map and returns a tuple with two elements: the list of matching
    records (sorted), and the Relation object for those records, relating
    the current frame to the returned records. Returns an empty set if no records match.
    """
    return self._do_lookup_with_sort(key, None)

  def _adjust_key(self, key):
    return tuple(_extract(val) for val in key)

  def _do_lookup_with_sort(self, key, sort_key):
    key = self._adjust_key(key)
    rel = self._relation_tracker.update_relation_from_current_node(key)
    # The _use_node call brings this LookupMapColumn up-to-date, and creates a dependency on it.
    self._engine._use_node(self.node, rel)
    # Bringing the column up-to-date consumes the keys accumulated in the dedup cache (which only
    # serves to skip redundant invalidations during a single recompute pass). Reset it now that
    # we're current, so that a later change to some key isn't mistaken for an already-handled
    # invalidation and dropped.
    self._invalidated_keys_cache.clear_keys()
    row_id_set = self._mapping.lookup_by_key(key, default=LookupSet())
    row_ids = row_id_set.get_sorted_version(sort_key)
    return row_ids, rel

  def _reset_sorted_versions(self, rec, sort_key):
    # For the lookup keys in rec, find the associated LookupSets, and clear the cached
    # ._sorted_versions entry for the given sort_spec. Used when only sort-by columns change.
    # Returns the set of affected keys.
    new_keys = set(self._mapping.get_new_keys_iter(rec))
    for key in new_keys:
      row_ids = self._mapping.lookup_by_key(key, default=LookupSet())
      row_ids.reset_sorted_version(sort_key)
    return new_keys

  def unset(self, row_id):
    # This is called on record removal, and is necessary to deal with removed records.
    affected_keys = self._mapping.remove_row_id(row_id)
    affected_keys = self._invalidated_keys_cache.add_keys(affected_keys)
    self._relation_tracker.invalidate_affected_keys(affected_keys)

  def _get_keys(self, row_id):
    # For _LookupRelation to know which keys are affected when the given looked-up row_id changes.
    return self._mapping.get_mapped_keys(row_id)

  def used_col_ids(self):
    return self._mapping.used_col_ids()

  def make_relation(self, relation_tracker, referring_node):
    if isinstance(self._mapping, AllLookupMapping):
      return _AllLookupRelation(self, relation_tracker, referring_node)
    else:
      return _LookupRelation(self, relation_tracker, referring_node)

#----------------------------------------------------------------------

class SortedLookupMapColumn(NoValueColumn):
  """
  A SortedLookupMapColumn is associated with a LookupMapColumn and a set of columns used for
  sorting. It lives in the table containing the looked-up data. It is like a FormulaColumn in that
  it has a method triggered for a record whenever any of the sort columns change for that record.

  This method, in turn, invalidates lookups using the relations maintained by the LookupMapColumn.
  """
  def __init__(self, table, col_id, lookup_col, sort_key):
    # Before creating the helper column, check that all dependencies are actually valid col_ids.
    sort_col_ids = [(c[1:] if c.startswith('-') else c) for c in sort_key.sort_spec]

    for c in sort_col_ids:
      if not table.has_column(c):
        raise KeyError("Table %s has no column %s" % (table.table_id, c))

    # Note that different LookupSortHelperColumns may exist with the same sort_col_ids but
    # different sort_keys because they could differ in order of columns and ASC/DESC flags.
    col_info = column.ColInfo(usertypes.Any(), is_formula=True, method=self._recalc_rec_method)
    super(SortedLookupMapColumn, self).__init__(table, col_id, col_info)
    self._lookup_col = lookup_col

    self._sort_col_ids = sort_col_ids
    self._sort_key = sort_key

    self._engine = table._engine
    self._engine.invalidate_column(self)
    self._lookup_col._relation_tracker.add_sorted_lookup_map(self)
    self._invalidated_keys_cache = InvalidatedKeysCache()

  @property
  def sort_key(self):
    return self._sort_key

  def do_lookup(self, key):
    """
    Looks up key in the lookup map and returns a tuple with two elements: the list of matching
    records (sorted), and the Relation object for those records, relating
    the current frame to the returned records. Returns an empty set if no records match.
    """
    key = self._lookup_col._adjust_key(key)
    rel = self._lookup_col._relation_tracker.update_relation_from_current_node(key)
    # The _use_node call brings this SortedLookupMapColumn up-to-date, and creates a dependency.
    self._engine._use_node(self.node, rel)
    # As in LookupMapColumn._do_lookup_with_sort, reset the dedup cache once we're up-to-date, so a
    # later change to the same sort key isn't dropped as an already-handled invalidation.
    self._invalidated_keys_cache.clear_keys()
    row_ids, _ = self._lookup_col._do_lookup_with_sort(key, self._sort_key)
    return row_ids, rel

  def _recalc_rec_method(self, rec, _table):
    # Create dependencies on all the sort columns.
    for col_id in self._sort_col_ids:
      try:
        getattr(rec, col_id)
      except Exception:
        # Ignore exceptions here, we don't want them to affect invalidations. Actual lookups will
        # lead to exceptions at a different point, when they try to do the actual sorting.
        pass

    affected_keys = self._lookup_col._reset_sorted_versions(rec, self._sort_key)
    affected_keys = self._invalidated_keys_cache.add_keys(affected_keys)
    self._lookup_col._relation_tracker.invalidate_affected_keys(affected_keys)

  def _get_keys(self, row_id):
    # For _LookupRelation to know which keys are affected when the given looked-up row_id changes.
    return self._lookup_col._get_keys(row_id)

  def used_col_ids(self):
    return set(self._sort_col_ids) | self._lookup_col.used_col_ids()

  def destroy(self):
    self._lookup_col._relation_tracker.remove_sorted_lookup_map(self)
    super().destroy()

#----------------------------------------------------------------------

class BaseLookupMapping:
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

  def used_col_ids(self):
    return {extract_column_id(c) for c in self._col_ids_tuple}

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
    try:
      return [tuple(_extract(getattr(rec, _col_id)) for _col_id in self._col_ids_tuple)]
    except Exception as e:
      return []

  def update_record(self, rec):
    old_key = self._get_mapped_key(rec._row_id)
    new_keys = self.get_new_keys_iter(rec)
    new_key = new_keys[0] if new_keys else None
    if new_key == old_key:
      return set()

    if new_key is None:
      self._row_key_map.remove(rec._row_id, old_key)
    else:
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
      try:
        value = getattr(rec, extract_column_id(col_id))
        group = _get_group_values(col_id, value)
      except Exception:
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

def _get_group_values(col_id, value):
  if isinstance(col_id, _Contains):
    # Check that the cell targeted by CONTAINS() has an appropriate type.
    # Don't iterate over characters of a string.
    # group = [] essentially means there are no new keys in this call
    if isinstance(value, (bytes, str,)):
      return []
    elif not value and col_id.match_empty != _Contains.no_match_empty:
      return [col_id.match_empty]
  else:
    return [value]

  try:
    # We only care about the unique key values
    return set(value)
  except TypeError:
    return []

class AllLookupMapping(BaseLookupMapping):
  """
  AllLookupMapping is used specifically for T.lookupRecords(), i.e. without any lookup columns.
  This is also what powers T.all. This is a particularly simple mapping: the empty-tuple is the
  one key, and it maps to all rows.
  """
  def __init__(self, col_ids_tuple):
    super().__init__(col_ids_tuple)
    self._rowset = LookupSet()

  def _make_row_key_map(self):
    return None

  def get_mapped_keys(self, row_id):
    return {()}

  def get_new_keys_iter(self, rec):
    return [()]

  def update_record(self, rec):
    if rec._row_id not in self._rowset:
      self._rowset.add(rec._row_id)
      return {()}
    return set()

  def remove_row_id(self, row_id):
    self._rowset.discard(row_id)
    return {()}

  def lookup_by_key(self, key, default=None):
    return self._rowset if key == () else default


class ReferenceLookupMapping(BaseLookupMapping):
  """
  ReferenceLookupMapping is used for T.lookupRecords(RefCol=...), for both Reference and
  ReferenceList types. We can avoid maintaining a mapping because those column types both already
  maintain a reverse mapping (back from pointed-to rows), maintained for the sake of
  invalidations, and we can reuse it.
  """
  def __init__(self, col_ids_tuple, ref_col):
    super().__init__(col_ids_tuple)
    # Resolve the ref column live by id rather than caching the object, so that we don't have to
    # do anything special in cases where the column object is rebuilt (e.g. when its type changes).
    self._table = ref_col._table
    self._ref_col_id = ref_col.col_id

  @property
  def ref_col(self):
    return self._table.get_column(self._ref_col_id)

  def _make_row_key_map(self):
    return None

  def _get_keys_iterable(self, row_id):
    return ((r,) for r in self.ref_col._value_iterable_full(self.ref_col.raw_get(row_id)))

  def get_mapped_keys(self, row_id):
    return set(self._get_keys_iterable(row_id))

  def get_new_keys_iter(self, rec):
    return self._get_keys_iterable(rec._row_id)

  def update_record(self, rec):
    assert False, "not used in ReferenceLookupMapping"

  def remove_row_id(self, row_id):
    assert False, "not used in ReferenceLookupMapping"

  def lookup_by_key(self, key, default=None):
    if isinstance(key, tuple) and len(key) == 1:
      # _extract() is already applied to elements of the key tuple when lookup_by_key is called.
      return self.ref_col.do_reverse_lookup(key[0], default)
    return default


class LookupMapColumnForReferences(LookupMapColumn):
  # We need to override some of the LookupMapColumn, but most of the optimization is in its use of
  # ReferenceLookupMapping. The overriding is to do invalidations when the underlying reference
  # column is updated, since at that point we know both the "before" and "after" values without
  # needing to keep a copy of the mapping.
  #
  # (Note: if some day we support reliable update triggers that provide "before" and "after"
  # versions of the updated row, then this same idea can be used for all lookups to reduce their
  # memory needs: instead of a TwoWayMap, it would be enough to have a single map from key to
  # LookupSet of row_ids.)
  def __init__(self, table, col_id, col_ids_tuple):
    super().__init__(table, col_id, col_ids_tuple)
    self._table = table
    self._ref_col_id = self._mapping._ref_col_id
    # Register our update hook on the table keyed by col_id (not on the ref column object,
    # so it survives rebuilds of that column). Note that renames are handled differently: the
    # lookup formula is rebuilt in that case, so the lookup map is replaced entirely.
    table.add_col_update_hook(self._ref_col_id, self._on_ref_update)
    # Whether this is a CONTAINS(..., match_empty=0) lookup, which treats a lookup value of 0 as
    # matching an empty reference list. is_reference_lookup routes only match_empty of 0 or
    # no_match_empty here, we just need to know which one.
    key = col_ids_tuple[0]
    self._matches_empty = (isinstance(key, _Contains) and key.match_empty == 0 and
        isinstance(self._ref_col, column.ReferenceListColumn))

  @property
  def _ref_col(self):
    return self._mapping.ref_col

  def destroy(self):
    self._table.remove_col_update_hook(self._ref_col_id, self._on_ref_update)
    super().destroy()

  def _adjust_key(self, key):
    # For a match_empty=0 lookup, looking up the empty value (0) must find rows with an empty
    # reference list. ReferenceListColumn's inverse_map stores those under _empty_sentinel.
    if self._matches_empty and len(key) == 1 and _extract(key[0]) == 0:
      key = (column._empty_sentinel,)
    return super()._adjust_key(key)

  def _on_ref_update(self, row_id, old_value, new_value):   # pylint: disable=unused-argument
    # After updating references (called on .set() and .unset(), in particular), invalidate the
    # affected keys. Recall, keys here are single-element tuples with the value of the reference.
    affected_keys = (
        set((r,) for r in self._ref_col._value_iterable_full(old_value)) |
        set((r,) for r in self._ref_col._value_iterable_full(new_value)))
    affected_keys = self._invalidated_keys_cache.add_keys(affected_keys)
    self._relation_tracker.invalidate_affected_keys(affected_keys)

  def _recalc_rec_method(self, rec, _table):
    # Read the ref column, so that this lookup map depends on it. The dependency is what makes the
    # engine order a formula ref column (and bring it up to date) ahead of any lookup served against
    # this map, and what makes the map recompute for newly-added rows. Index maintenance and
    # invalidation still ride on the ref column's update hook (_on_ref_update); here we only need to
    # establish the dependency, so the value itself is unused.
    getattr(rec, self._ref_col_id)

  def unset(self, row_id):
    # Nothing here. Instead, we do invalidations on a hook when the underlying ref column updates.
    pass

  def make_relation(self, relation_tracker, referring_node):
    if referring_node.table_id == self._ref_col.target_table_id():
      return _SelfLookupRelation(self, relation_tracker, referring_node)
    else:
      return _LookupRelation(self, relation_tracker, referring_node)


#----------------------------------------------------------------------

class _RelationTracker(object):
  """
  Owned by a LookupMapColumn; keeps track of the _LookupRelations between referring nodes and
  that column. Shared by the column's SortedLookupMapColumn helpers, so that each referring node
  needs just one relation, whether its lookups are sorted or not.
  """
  def __init__(self, engine, lookup_map):
    self._engine = engine
    self._lookup_map = lookup_map
    self._sorted_lookup_maps = set()

    # Map of referring Node to _LookupRelation. Different tables may do lookups using a
    # (Sorted)LookupMapColumn, and that creates a dependency from other Nodes to us, with a
    # relation between referring rows and the lookup keys. This map stores these relations.
    self._lookup_relations = {}

  def add_sorted_lookup_map(self, sorted_lookup_map):
    self._sorted_lookup_maps.add(sorted_lookup_map)

  def remove_sorted_lookup_map(self, sorted_lookup_map):
    self._sorted_lookup_maps.discard(sorted_lookup_map)

  def update_relation_from_current_node(self, key):
    """
    Updates the relation by which the currently evaluated formula (if any) depends on us, to
    record which key it looked up. Return the relevant Relation object.
    """
    engine = self._engine
    if not engine._is_current_node_formula:
      return None

    rel = self._get_relation(engine._current_node)
    try:
      rel._add_lookup(engine._current_row_id, key)
    except TypeError:
      # An unhashable key can't be recorded in the relation, which is fine (the lookup itself will
      # fail with the same error). We still return the relation, so that the calling cell can get
      # recalculated when the lookup map is rebuilt.
      pass
    return rel

  def invalidate_affected_keys(self, affected_keys):
    # For each known relation, figure out which referring rows are affected, and invalidate them.
    # The engine will notice that there have been more invalidations, and recompute things again.
    for rel in self._lookup_relations.values():
      rel.invalidate_affected_keys(affected_keys, self._engine)

  def _get_relation(self, referring_node):
    """
    Helper which returns an existing or new _LookupRelation object for the given referring Node.
    """
    rel = self._lookup_relations.get(referring_node)
    if not rel:
      rel = self._lookup_map.make_relation(self, referring_node)
      self._lookup_relations[referring_node] = rel
    return rel

  def _delete_relation(self, referring_node):
    self._lookup_relations.pop(referring_node, None)
    if not self._lookup_relations:
      self._engine.mark_lookupmap_for_cleanup(self._lookup_map)
    # Even when relations remain, mark all *sorted* helpers: their usage isn't tracked
    # individually, so any one of them may have just lost its last user. Marking is safe, as a
    # marked column only gets cleaned up if nothing is using it.
    for slm in self._sorted_lookup_maps:
      self._engine.mark_lookupmap_for_cleanup(slm)


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
    affected_rows = self.get_affected_rows_by_keys(affected_keys)
    if affected_rows:
      node = self._referring_node
      engine.invalidate_records(node.table_id, affected_rows, col_ids=(node.col_id,))

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
    self._relation_tracker._delete_relation(self._referring_node)


class _AllLookupRelation(relation.Relation):
  # When looking up all records, the relation is simple: there is only one key (the empty tuple)
  # whose lookup yields anything. We still remember which rows actually looked it up.
  def __init__(self, lookup_map, relation_tracker, referring_node):
    super().__init__(referring_node.table_id, lookup_map.table_id)
    self._relation_tracker = relation_tracker
    self._referring_node = referring_node
    self._rowset = set()

  def __str__(self):
    return "_AllLookupRelation(%s->%s)" % (self._referring_node, self.target_table)

  def get_affected_rows(self, target_row_ids):
    if target_row_ids == depend.ALL_ROWS:
      return depend.ALL_ROWS
    return set(self._rowset)

  def invalidate_affected_keys(self, affected_keys, engine):   # pylint:disable=unused-argument
    node = self._referring_node
    if () in affected_keys:
      engine.invalidate_records(node.table_id, self._rowset, col_ids=(node.col_id,))

  def _add_lookup(self, referring_row_id, key):   # pylint:disable=unused-argument
    self._rowset.add(referring_row_id)

  def reset_rows(self, referring_rows):
    if referring_rows == depend.ALL_ROWS:
      self._rowset.clear()
    else:
      self._rowset.difference_update(referring_rows)

  def reset_all(self):
    self._rowset.clear()
    self._relation_tracker._delete_relation(self._referring_node)


# For a lookup like T.lookupRecords(refCol=$id), it's common to be looking up $id. If so, it's
# easy to remember which row looks up which key, and we don't need to maintain a whole extra
# mapping. But we do maintain one for those cases when we look up any other values.
class _SelfLookupRelation(_LookupRelation):
  def __init__(self, lookup_map, relation_tracker, referring_node):
    super().__init__(lookup_map, relation_tracker, referring_node)
    # These are the rows that looked up $id.
    self._self_lookups = set()

  def __str__(self):
    return "_SelfLookupRelation(%s->%s)" % (self._referring_node, self.target_table)

  def get_affected_rows_by_keys(self, keys):
    affected_rows = super().get_affected_rows_by_keys(keys)
    # Add in any keys of the form ($id,) where the ID is in self._self_lookups.
    affected_rows.update(k[0] for k in keys
        if isinstance(k, tuple) and len(k) == 1 and k[0] in self._self_lookups)
    return affected_rows

  def _add_lookup(self, referring_row_id, key):
    if key == (referring_row_id,):
      self._self_lookups.add(referring_row_id)
    else:
      super()._add_lookup(referring_row_id, key)

  def reset_rows(self, referring_rows):
    super().reset_rows(referring_rows)
    if referring_rows == depend.ALL_ROWS:
      self._self_lookups.clear()
    else:
      self._self_lookups.difference_update(referring_rows)

  def reset_all(self):
    self._self_lookups.clear()
    super().reset_all()


# This is for an optimization. Our LookupMapColumn maintain one or more _LookupRelations, which
# remember which caller row looked up which key. When the result for a key changes, use them to
# invalidate calling rows. We may invalidate the same key many times (possibly O(N)
# times), which will lead to invalidating the same O(N) records over and over, resulting in
# O(N^2) work. By remembering the keys we invalidated, we can avoid that waste.
class InvalidatedKeysCache:
  def __init__(self):
    self._cache = set()

  def clear_keys(self):
    self._cache.clear()

  def add_keys(self, keys):
    """
    Add keys to the cache, returning only those keys that were not already in the cache. The
    returned ones are the only ones that actually need to be invalidated.
    """
    new_keys = keys - self._cache
    self._cache.update(new_keys)
    return new_keys


def extract_column_id(c):
  if isinstance(c, _Contains):
    return c.value
  else:
    return c

def is_reference_lookup(table, col_ids_tuple):
  if len(col_ids_tuple) != 1:
    return False
  key = col_ids_tuple[0]
  # The reference-column optimization reuses the ref column's reverse map, which can only represent
  # an empty value as the column's default (key 0 / the empty-list sentinel).
  # Other forms of CONTAINS(match_empty=N) can't be handled by the optimized reference lookup.
  if isinstance(key, _Contains) and key.match_empty not in (_Contains.no_match_empty, 0):
    return False
  # Note that this routes CONTAINS() on a plain Ref column here too, where it matches by
  # equality: a Ref cell behaves as a single-element (or empty) RefList, so that converting a
  # column between Ref and RefList keeps CONTAINS formulas working unchanged.
  col = table.get_column(extract_column_id(key))
  return isinstance(col, column.BaseReferenceColumn)
