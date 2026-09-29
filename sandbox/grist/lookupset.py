# A version of `set` that maintains also sorted versions of the set. Used in lookups, to cache the
# sorted lookup results.
#
# sort_key should be created using make_sort_key() in sort_key.py. In particular, we rely on it
# having a .sort_spec property to identify it.
#
# Note that not all operations clear the sorted versions; so its important to limit use to only
# those implemented.
class LookupSet(set):
  __slots__ = ('_sorted_versions',)

  def __init__(self, iterable=[]):
    super().__init__(iterable)
    self._sorted_versions = None

  def get_sorted_version(self, sort_key):
    sort_spec = sort_key.sort_spec if sort_key else ()
    if self._sorted_versions is None:
      self._sorted_versions = {}
    row_ids = self._sorted_versions.get(sort_spec)
    if row_ids is None:
      row_ids = sorted(self, key=sort_key)
      self._sorted_versions[sort_spec] = row_ids
    return row_ids

  def reset_sorted_version(self, sort_key):
    sort_spec = sort_key.sort_spec if sort_key else ()
    if self._sorted_versions:
      self._sorted_versions.pop(sort_spec, None)

  def add(self, elem):
    len_before = len(self)
    super().add(elem)
    if len(self) != len_before:   # Clear cache of sorted versions on change.
      self._sorted_versions = None

  def discard(self, elem):
    len_before = len(self)
    super().discard(elem)
    if len(self) != len_before:   # Clear cache of sorted versions on change.
      self._sorted_versions = None

  def clear(self):
    len_before = len(self)
    super().clear()
    if len(self) != len_before:   # Clear cache of sorted versions on change.
      self._sorted_versions = None
