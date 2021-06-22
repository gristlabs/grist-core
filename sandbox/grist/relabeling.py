"""
This module is used in the implementation of ordering of records in Grist. Order is maintained
using floating-point "positions". E.g. inserting a record will normally add a record with position
being the average of its neighbor's positions.

The difficulty is that it's possible (and sometimes easy) to get floats closer and closer
together, until they are too close (and average of neighbors is equal to one of them). This
requires adjusting existing positions.

This problem is known in computer science as the List-Labeling Problem. There are known algorithms
which maintain ordered labels using fixed number of bits. We use an approach that requires
amortized log(N) relabelings per insert.

For references:
  [Wikipedia] https://en.wikipedia.org/wiki/Order-maintenance_problem
    The Wikipedia article describes in particular an approach using Scapegoat Trees.
  [Bender] http://erikdemaine.org/papers/DietzSleator_ESA2002/paper.pdf
    This paper by Bender et al is the best I found that describes the theory and a reasonably
    simple solution that doesn't require explicit trees. This is what we rely on here.

What complicates our approach is that inserts never modify positions directly; instead, when we
have items to insert, we need to prepare adjustments (both to new and existing positions), which
are then turned into DocActions to be communicated and applied (both in memory and in storage).

The interface offered by this class is a single `prepare_inserts()` function, which takes a sorted
list and a list of keys, and returns the adjustments to existing records and to the new keys.

Note that we rely heavily here on availability of a sorted container, for which we use the
sortedcontainers module from here:
  http://www.grantjenks.com/docs/sortedcontainers/sortedlist.html
  https://github.com/grantjenks/sorted_containers

Note also that unlike the original paper we deal with floats rather than integers. This is to
maximize the number of usable bits, since other parts of the system (namely Javascript) don't
support 64-bits integers. We also avoid renumbering everything when we double the number of
elements. The changes aren't vetted theoretically, and may break some conclusions from the paper.

Throughout this file, "key" refers to the floating point value that's called a "label" in
list-labeling papers, "position" elsewhere in Grist code, and "key" in sortedcontainers docs.
"""

import bisect
import itertools
import math
import struct

from six.moves import zip, xrange
from sortedcontainers import SortedList, SortedListWithKey


def prepare_inserts_dumb(sortedlist, keys):
  """
  This is the dumb implementation of repositioning: whenever we don't have enough space to insert
  keys, just renumber everything 1 through N.
  """
  # It's still a bit tricky to do this because we need to return adjustments to existing and new
  # keys, without actually inserting and renumbering.
  ins_groups, ungroup_func = _group_insertions(sortedlist, keys)
  insertions = []
  adjustments = []

  def get_endpoints(index, count):
    before = sortedlist._key(sortedlist[index - 1]) if index > 0 else 0.0
    after = (sortedlist._key(sortedlist[index])
             if index < len(sortedlist) else before + count + 1)
    return (before, after)

  def is_valid_insert(index, count):
    before, after = get_endpoints(index, count)
    return is_valid_range(before, get_range(before, after, count), after)

  if all(is_valid_insert(index, ins_count) for index, ins_count in ins_groups):
    for index, ins_count in ins_groups:
      before, after = get_endpoints(index, ins_count)
      insertions.extend(get_range(before, after, ins_count))
  else:
    next_key = 1.0
    prev_index = 0
    # Complete the renumbering by forcing an extra empty group at the end.
    ins_groups.append((len(sortedlist), 0))
    for index, ins_count in ins_groups:
      adj_count = index - prev_index
      adjustments.extend(zip(xrange(prev_index, index),
                                        frange_from(next_key, adj_count)))
      next_key += adj_count
      insertions.extend(frange_from(next_key, ins_count))
      next_key += ins_count
      prev_index = index

  return adjustments, ungroup_func(insertions)


def prepare_inserts(sortedlist, keys):
  """
  Takes a SortedListWithKey and a list of keys to insert. The keys should be floats.
  Returns two lists: [(index, new_key), ...], [new_keys...]

  The first list contains pairs for existing items in sortedlist that need to be adjusted to have
  new keys (these will not change the ordering). The second is a list of new keys to use in place
  of keys. To avoid reorderings, adjustments should be applied before insertions.
  """
  worklist = ListWithAdjustments(sortedlist)
  ins_groups, ungroup_func = _group_insertions(sortedlist, keys)
  for index, ins_count in ins_groups:
    worklist.prep_inserts_at_index(index, ins_count)
  return worklist.get_adjustments(), ungroup_func(worklist.get_insertions())


def _group_insertions(sortedlist, keys):
  """
  Given a list of keys to insert into sortedlist, returns the pair:
    [(index, count), ...] pairs for how many items to insert immediately before each index.
    ungroup(new_keys): a function that rearranges new keys to match the original keys.
  """
  # We'll go through keys to insert in increasing order, to process consecutive keys together.
  ins_keys = sorted((key, i) for i, key in enumerate(keys))
  # We group by the index at which a new key is to be inserted.
  ins_groups = [(index, len(list(ins_iter))) for index, ins_iter in
            itertools.groupby(ins_keys, key=lambda pair: sortedlist.bisect_key_left(pair[0]))]
  indices = [i for key, i in ins_keys]
  def ungroup(new_keys):
    return [key for _, key in sorted(zip(indices, new_keys))]

  return ins_groups, ungroup


def frange_from(start, count):
  return [start + i for i in xrange(count)]


def nextfloat(x):
  """
  Returns the next representable float after the float x. This is useful to indicate insertions
  AFTER ane existing element.
  (See http://stackoverflow.com/a/10426033/328565 for implementation info).
  """
  n = struct.unpack('<q', struct.pack('<d', x or 0.0))[0]
  n += (1 if n >= 0 else -1)
  return struct.unpack('<d', struct.pack('<q', n))[0]

def prevfloat(x):
  n = struct.unpack('<q', struct.pack('<d', x or 0.0))[0]
  n -= (1 if n >= 0 else -1)
  return struct.unpack('<d', struct.pack('<q', n))[0]

class ListWithAdjustments(object):
  """
  To prepare inserts, we adjust elements to be inserted and elements in the underlying list. We
  don't want to actually touch the underlying list, but we need to remember the adjustments,
  because later adjustments may depend on and readjust earlier ones.
  """
  def __init__(self, orig_list):
    """
    Orig_list must be a a SortedListWithKey.
    """
    self._orig_list = orig_list
    self._key = orig_list._key

    # Stores pairs (i, new_key) where i is an index into orig_list.
    #   Note that adjustments don't affect the order in the original list, so the list is sorted
    #   both on keys an on indices; and a missing index i means that (i, orig_key) fits into the
    #   adjustments list both by key and by index.
    self._adjustments = SortedListWithKey(key=lambda pair: pair[1])

    # Stores keys for new insertions.
    self._insertions = SortedList()

  def get_insertions(self):
    return self._insertions

  def get_adjustments(self):
    return self._adjustments

  def _adj_bisect_key_left(self, key):
    """
    Works as bisect_key_left(key) on the orig_list as if all adjustments have been applied.
    """
    adj_index = self._adjustments.bisect_key_left(key)
    adj_next = (self._adjustments[adj_index][0] if adj_index < len(self._adjustments)
                else len(self._orig_list))
    adj_prev = self._adjustments[adj_index - 1][0] if adj_index > 0 else -1
    orig_index = self._orig_list.bisect_key_left(key)
    if adj_prev < orig_index and orig_index < adj_next:
      return orig_index
    return adj_next

  def _adj_get_key(self, index):
    """
    Returns the key corresponding to the given index into orig_list as if all adjustments have
    been applied.
    """
    i = bisect.bisect_left(self._adjustments, (index, float('-inf')))
    if i < len(self._adjustments) and self._adjustments[i][0] == index:
      return self._adjustments[i][1]
    return self._key(self._orig_list[index])

  def count_range(self, begin, end):
    """
    Returns the number of elements with keys in the half-open interval [begin, end).
    """
    adj_begin = self._adj_bisect_key_left(begin)
    adj_end = self._adj_bisect_key_left(end)
    ins_begin = self._insertions.bisect_left(begin)
    ins_end = self._insertions.bisect_left(end)
    return (adj_end - adj_begin) + (ins_end - ins_begin)

  def _adjust_range(self, begin, end):
    """
    Make changes to stored adjustments and insertions to distribute them equally in the half-open
    interval of keys [begin, end).
    """
    adj_begin = self._adj_bisect_key_left(begin)
    adj_end = self._adj_bisect_key_left(end)
    ins_begin = self._insertions.bisect_left(begin)
    ins_end = self._insertions.bisect_left(end)
    self._do_adjust_range(adj_begin, adj_end, ins_begin, ins_end, begin, end)

  def _adjust_all(self):
    """
    Renumber everything to be equally distributed in the open interval (new_begin, new_end).
    """
    orig_len = len(self._orig_list)
    ins_len = len(self._insertions)
    self._do_adjust_range(0, orig_len, 0, ins_len, 0.0, orig_len + ins_len + 1.0)

  def _do_adjust_range(self, adj_begin, adj_end, ins_begin, ins_end, new_begin_key, new_end_key):
    """
    Implements renumbering as used by _adjust_range() and _adjust_all().
    """
    count = (adj_end - adj_begin) + (ins_end - ins_begin)

    prev_keys = ([(self._adj_get_key(i), False, i) for i in xrange(adj_begin, adj_end)] +
                 [(self._insertions[i], True, i) for i in xrange(ins_begin, ins_end)])
    prev_keys.sort()
    new_keys = get_range(new_begin_key, new_end_key, count)

    for (old_key, is_insert, i), new_key in zip(prev_keys, new_keys):
      if is_insert:
        self._insertions.remove(old_key)
        self._insertions.add(new_key)
      else:
        # (i, old_key) pair may not be among _adjustments, so we discard() rather than remove().
        self._adjustments.discard((i, old_key))
        self._adjustments.add((i, new_key))

  def prep_inserts_at_index(self, index, count):
    # This is the crux of the algorithm, inspired by the [Bender] paper (cited above).
    # Here's a brief summary of the algorithm, and of our departures from it.
    # - The algorithm inserts keys while it is able. When there isn't enough space, it walks
    #   enclosing intervals around the key it wants to insert, doubling the interval each time,
    #   until it finds an interval that doesn't overflow. The overflow threshold is calculated in
    #   such a way that the bigger the interval, the smaller the density it seeks.
    # - The algorithm uses integers, picking the number of bits to work for list length between
    #   n/2 and 2n, and rebuilding from scratch any time length moves out of this range. We don't
    #   rebuild anything, don't change number of bits, and use floats. This breaks some of the
    #   theoretical results, and thinking about floats is much harder than about integers. So we
    #   are not on particularly solid ground with these changes (but it seems to work).
    # - We try different thresholds, which seems to perform better. This is mentioned in "Variable
    #   T" section of [Bender] paper, but our approach isn't quite the same. So it's also on shaky
    #   theoretical ground.
    assert count > 0
    begin = self._adj_get_key(index - 1) if index > 0 else 0.0
    end = self._adj_get_key(index) if index < len(self._orig_list) else begin + count + 1
    if begin < 0 or end <= 0 or math.isinf(max(begin, end)):
      # This should only happen if we have some invalid positions (e.g. from before we started
      # using this logic). In this case, just renumber everything 1 through n (leaving space so
      # that the count insertions take the first count integers).
      self._insertions.update([begin if index > 0 else float('-inf')] * count)
      self._adjust_all()
      return

    self._insertions.update(get_range(begin, end, count))
    if not is_valid_range(begin, self._insertions.irange(begin, end), end):
      assert self.count_range(begin, end) > 0
      min_key, max_key = self._find_sparse_enough_range(begin, end)
      self._adjust_range(min_key, max_key)
      assert is_valid_range(begin, self._insertions.irange(begin, end), end)

  def _find_sparse_enough_range(self, begin, end):
    # frac is a parameter used for relabeling, corresponding to 2/T in [Bender]. Its
    # interpretation is that frac^i is the overflow limit for intervals of size 2^i.
    for frac in (1.14, 1.3):
      thresh = 1
      for i in xrange(64):
        rbegin, rend = range_around_float(begin, i)
        assert self.count_range(rbegin, rend) > 0
        if end <= rend and self.count_range(rbegin, rend) < thresh:
          return (rbegin, rend)
        thresh *= frac
    raise ValueError("This isn't expected")


def is_valid_range(begin, iterable, end):
  """
  Return true if all inserted keys in the range [begin, end] are distinct, and different from
  the endpoints.
  """
  return all_distinct(itertools.chain((begin,), iterable, (end,)))


def all_distinct(iterable):
  """
  Returns true if none of the consecutive items in the iterable are the same.
  """
  a, b = itertools.tee(iterable)
  next(b, None)
  return all(x != y for x, y in zip(a, b))


def range_around_float(x, i):
  """
  Returns a pair (min, max) of floats such that the half-open interval [min,max) contains 2^i
  representable floats, with x among them.
  """
  # This is hard to explain (so easy for this to be wrong). m is in [0.5, 1), with 52 bits of
  # precision (for 64-bit double-precision floats, as Python uses). We are trying to zero-out the
  # last i bits of the precision. So we shift the mantissa left by (52-i) bits, round down
  # (zeroing out remaining i bits), then shift back.
  m, e = math.frexp(x)
  mf = math.floor(math.ldexp(m, 53 - i))
  exp = e + i - 53
  return (math.ldexp(mf, exp), math.ldexp(mf + 1, exp))


def get_range(start, end, count):
  """
  Returns an equally-distributed list of floats greater than start and less than end.
  """
  step = float(end - start) / (count + 1)
  # Ensure all resulting values are strictly less than end.
  limit = prevfloat(end)
  return [min(start + step * k, limit) for k in xrange(1, count + 1)]
