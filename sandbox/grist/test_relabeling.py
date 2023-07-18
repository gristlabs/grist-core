import unittest
import sys
import relabeling

from sortedcontainers import SortedListWithKey
from six.moves import zip as izip, xrange

# Shortcut to keep code more concise.
r = relabeling

def skipfloats(x, n):
  for i in xrange(n):
    x = relabeling.nextfloat(x)
  return x


class Item(object):
  """
  Tests use Item for items of the sorted lists we maintain.
  """
  def __init__(self, value, key):
    self.value = value
    self.key = key

  def __repr__(self):
    return "Item(v=%s,k=%s)" % (self.value, self.key)


class ItemList(object):
  def __init__(self, val_key_pairs):
    self._slist = SortedListWithKey(key=lambda item: item.key)
    self._slist.update(Item(v, k) for (v, k) in val_key_pairs)
    self.num_update_events = 0
    self.num_updated_keys = 0

  def get_values(self):
    return [item.value for item in self._slist]

  def get_list(self):
    return self._slist

  def find_value(self, value):
    return next((item for item in self._slist if item.value == value), None)

  def avg_updated_keys(self):
    return float(self.num_updated_keys) / len(self._slist)

  def next(self, item):
    return self._slist[self._slist.index(item) + 1]

  def prev(self, item):
    return self._slist[self._slist.index(item) - 1]

  def insert_items(self, val_key_pairs, prepare_inserts=r.prepare_inserts):
    keys = [k for (v, k) in val_key_pairs]
    adjustments, new_keys = prepare_inserts(self._slist, keys)
    if adjustments:
      self.num_update_events += 1
      self.num_updated_keys += len(adjustments)

    # Updating items is a bit tricky: we have to do it without violating order (just changing
    # key of an existing item easily might), so we remove items first. And we can only rely on
    # indices if we scan items in a backwards order.
    items = [self._slist.pop(index) for (index, key) in reversed(adjustments)]
    items.reverse()
    for (index, key), item in izip(adjustments, items):
      item.key = key
    self._slist.update(items)

    # Now add the new items.
    self._slist.update(Item(val, new_key) for (val, _), new_key in izip(val_key_pairs, new_keys))

    # For testing, pass along the return value from prepare_inserts.
    return adjustments, new_keys


class TestRelabeling(unittest.TestCase):

  def test_nextfloat(self):
    def verify_nextfloat(x):
      nx = r.nextfloat(x)
      self.assertNotEqual(nx, x)
      self.assertGreater(nx, x)
      self.assertEqual(r.prevfloat(nx), x)
      average = (nx + x) / 2
      self.assertTrue(average == nx or average == x)

    verify_nextfloat(1)
    verify_nextfloat(-1)
    verify_nextfloat(417)
    verify_nextfloat(-417)
    verify_nextfloat(12312422)
    verify_nextfloat(-12312422)
    verify_nextfloat(0.1234)
    verify_nextfloat(-0.1234)
    verify_nextfloat(0.00005)
    verify_nextfloat(-0.00005)
    verify_nextfloat(0.0)
    verify_nextfloat(r.nextfloat(0.0))
    verify_nextfloat(sys.float_info.min)
    verify_nextfloat(-sys.float_info.min)

  def test_prevfloat(self):
    def verify_prevfloat(x):
      nx = r.prevfloat(x)
      self.assertNotEqual(nx, x)
      self.assertLess(nx, x)
      self.assertEqual(r.nextfloat(nx), x)
      average = (nx + x) / 2
      self.assertTrue(average == nx or average == x)

    verify_prevfloat(1)
    verify_prevfloat(-1)
    verify_prevfloat(417)
    verify_prevfloat(-417)
    verify_prevfloat(12312422)
    verify_prevfloat(-12312422)
    verify_prevfloat(0.1234)
    verify_prevfloat(-0.1234)
    verify_prevfloat(0.00005)
    verify_prevfloat(-0.00005)
    verify_prevfloat(r.nextfloat(0.0))
    verify_prevfloat(sys.float_info.min)
    verify_prevfloat(-sys.float_info.min)

  def test_range_around_float(self):

    def verify_range(bits, begin, end):
      self.assertEqual(r.range_around_float(begin, bits), (begin, end))
      self.assertEqual(r.range_around_float((end + begin) / 2, bits), (begin, end))
      delta = r.nextfloat(begin) - begin
      if begin + delta < end:
        self.assertEqual(r.range_around_float(begin + delta, bits), (begin, end))
      if end - delta >= begin:
        self.assertEqual(r.range_around_float(end - delta, bits), (begin, end))

    def verify_small_range_at(begin):
      verify_range(0, begin, skipfloats(begin, 1))
      verify_range(1, begin, skipfloats(begin, 2))
      verify_range(4, begin, skipfloats(begin, 16))
      verify_range(10, begin, skipfloats(begin, 1024))

    verify_small_range_at(1.0)
    verify_small_range_at(0.5)
    verify_small_range_at(0.25)
    verify_small_range_at(0.75)
    verify_small_range_at(17.0)

    verify_range(52, 1.0, 2.0)
    self.assertEqual(r.range_around_float(1.4, 52), (1.0, 2.0))

    verify_range(52, 0.5, 1.0)
    self.assertEqual(r.range_around_float(0.75, 52), (0.5, 1.0))

    self.assertEqual(r.range_around_float(17, 48), (17.0, 18.0))
    self.assertEqual(r.range_around_float(17, 49), (16.0, 18.0))
    self.assertEqual(r.range_around_float(17, 50), (16.0, 20.0))
    self.assertEqual(r.range_around_float(17, 51), (16.0, 24.0))
    self.assertEqual(r.range_around_float(17, 52), (16.0, 32.0))

    verify_range(51, 0.25, 0.375)
    self.assertEqual(r.range_around_float(0.27, 51), (0.25, 0.375))
    self.assertEqual(r.range_around_float(0.30, 51), (0.25, 0.375))
    self.assertEqual(r.range_around_float(0.37, 51), (0.25, 0.375))

    verify_range(51, 0.50, 0.75)
    verify_range(51, 0.75, 1.0)
    verify_range(52, 0.25, 0.5)

    # Range around 0 isn't quite right, and possibly can't be. But we test that it's at least
    # something meaningful.
    self.assertEqual(r.range_around_float(0.00, 52), (0.00, 0.5))
    self.assertEqual(r.range_around_float(0.25, 52), (0.25, 0.5))

    self.assertEqual(r.range_around_float(0.00, 50), (0.00, 0.125))
    self.assertEqual(r.range_around_float(0.10, 50), (0.09375, 0.109375))

    self.assertEqual(r.range_around_float(0.0, 53), (0.00, 1))
    self.assertEqual(r.range_around_float(0.5, 53), (0.00, 1))

    self.assertEqual(r.range_around_float(0, 0), (0.0, skipfloats(0.5, 1) - 0.5))
    self.assertEqual(r.range_around_float(0, 1), (0.0, skipfloats(0.5, 2) - 0.5))
    self.assertEqual(r.range_around_float(0, 4), (0.0, skipfloats(0.5, 16) - 0.5))
    self.assertEqual(r.range_around_float(0, 10), (0.0, skipfloats(0.5, 1024) - 0.5))

  def test_all_distinct(self):

    # Just like r.get_range, but includes endpoints.
    def full_range(start, end, count):
      return [start] + r.get_range(start, end, count) + [end]

    self.assertTrue(r.all_distinct(range(1000)))
    self.assertTrue(r.all_distinct([]))
    self.assertTrue(r.all_distinct([1.0]))
    self.assertFalse(r.all_distinct([1.0, 1.0]))

    self.assertTrue(r.all_distinct(full_range(0, 1, 1000)))
    self.assertFalse(r.all_distinct(full_range(1.0, r.nextfloat(1.0), 1)))
    self.assertFalse(r.all_distinct(full_range(1.0, skipfloats(1.0, 10), 10)))
    self.assertTrue(r.all_distinct(full_range(1.0, skipfloats(1.0, 11), 10)))
    self.assertTrue(r.all_distinct(full_range(0.1, skipfloats(0.1, 100), 99)))
    self.assertFalse(r.all_distinct(full_range(0.1, skipfloats(0.1, 100), 100)))

  def test_get_range(self):
    self.assertEqual(r.get_range(0.0, 2.0, 3), [0.5, 1, 1.5])
    self.assertEqual(r.get_range(1, 17, 7), [3,5,7,9,11,13,15])
    self.assertEqual(r.get_range(-1, 1.5, 4), [-0.5, 0, 0.5, 1])

  def test_prepare_inserts_simple(self):
    slist = SortedListWithKey(key=lambda i: i.key)
    self.assertEqual(r.prepare_inserts(slist, [4.0]), ([], [1.0]))
    self.assertEqual(r.prepare_inserts(slist, [0.0]), ([], [1.0]))
    self.assertEqual(r.prepare_inserts(slist, [4.0, 4.0, 5, 6]), ([], [1.0, 2.0, 3.0, 4.0]))
    self.assertEqual(r.prepare_inserts(slist, [4, 5, 6, 5, 4]), ([], [1,3,5,4,2]))
    slist.update(Item(v, k) for (v, k) in zip(['a','b','c'], [3.0, 4.0, 5.0]))
    self.assertEqual(r.prepare_inserts(slist, [0.0]), ([], [1.5]))

    values = 'defgijkl'
    to_update, to_add = r.prepare_inserts(slist, [3,3,4,5,6,4,6,4])
    self.assertEqual(to_add, [1., 2., 3.25, 4.5, 6., 3.5, 7., 3.75])
    self.assertEqual(to_update, [])
    slist.update(Item(v, k) for (v, k) in zip(values, to_add))
    self.assertEqual([i.value for i in slist], list('deafjlbgcik'))

  def test_with_invalid(self):
    slist = SortedListWithKey(key=lambda i: i.key)
    slist.add(Item('a', 0))
    self.assertEqual(r.prepare_inserts(slist, [0.0]), ([(0, 2.0)], [1.0]))
    self.assertEqual(r.prepare_inserts(slist, [1.0]), ([], [1.0]))

    slist = SortedListWithKey(key=lambda i: i.key)
    slist.update(Item(v, k) for (v, k) in zip('abcdef', [0, 0, 0, 1, 1, 1]))
    # We expect the whole range to be renumbered.
    self.assertEqual(r.prepare_inserts(slist, [0.0, 0.0]),
                     ([(0, 3.0), (1, 4.0), (2, 5.0), (3, 6.0), (4, 7.0), (5, 8.0)],
                      [1.0, 2.0]))

    # We also expect a renumbering if there are negative or infinite values.
    slist = SortedListWithKey(key=lambda i: i.key)
    slist.add(Item('a', float('inf')))
    self.assertEqual(r.prepare_inserts(slist, [0.0]), ([(0, 2.0)], [1.0]))
    self.assertEqual(r.prepare_inserts(slist, [float('inf')]), ([(0, 2.0)], [1.0]))

    slist = SortedListWithKey(key=lambda i: i.key)
    slist.add(Item('a', -17.0))
    self.assertEqual(r.prepare_inserts(slist, [0.0]), ([(0, 1.0)], [2.0]))
    self.assertEqual(r.prepare_inserts(slist, [float('-inf')]), ([(0, 2.0)], [1.0]))

  def test_with_dups(self):
    slist = SortedListWithKey(key=lambda i: i.key)
    slist.update(Item(v, k) for (v, k) in zip('abcdef', [1, 1, 1, 2, 2, 2]))
    self.assertEqual(r.prepare_inserts(slist, [0.0]), ([], [0.5]))

  def test_renumber_endpoints1(self):
    self._do_test_renumber_ends([])

  def test_renumber_endpoints2(self):
    self._do_test_renumber_ends(list(zip("abcd", [40,50,60,70])))

  def _do_test_renumber_ends(self, initial):
    # Test insertions that happen together on the left and on the right.
    slist = ItemList(initial)
    for i in xrange(2000):
      slist.insert_items([(i, float('-inf')), (-i, float('inf'))])

    self.assertEqual(slist.get_values(),
                     rev_range(2000) + [v for v,k in initial] + list(xrange(0, -2000, -1)))
    #print slist.num_update_events, slist.num_updated_keys
    self.assertLess(slist.avg_updated_keys(), 3)
    self.assertLess(slist.num_update_events, 80)

  def test_renumber_left(self):
    slist = ItemList(zip("abcd", [4,5,6,7]))
    ins_item = slist.find_value('c')
    for i in xrange(1000):
      slist.insert_items([(i, ins_item.key)])

    # Check the end result
    self.assertEqual(slist.get_values(), ['a', 'b'] + list(xrange(1000)) + ['c', 'd'])
    self.assertAlmostEqual(slist.avg_updated_keys(), 3.5, delta=1)
    self.assertLess(slist.num_update_events, 40)

  def test_renumber_right(self):
    slist = ItemList(zip("abcd", [4,5,6,7]))
    ins_item = slist.find_value('b')
    for i in xrange(1000):
      slist.insert_items([(i, r.nextfloat(ins_item.key))])

    # Check the end result
    self.assertEqual(slist.get_values(), ['a', 'b'] + rev_range(1000) + ['c', 'd'])
    self.assertAlmostEqual(slist.avg_updated_keys(), 3.5, delta=1)
    self.assertLess(slist.num_update_events, 40)

  def test_renumber_left_dumb(self):
    # Here we use the "dumb" approach, and see that in our test case it's significantly worse.
    # (The badness increases with the number of insertions, but we'll keep numbers small to keep
    # the test fast.)
    slist = ItemList(zip("abcd", [4,5,6,7]))
    ins_item = slist.find_value('c')
    for i in xrange(1000):
      slist.insert_items([(i, ins_item.key)], prepare_inserts=r.prepare_inserts_dumb)
    self.assertEqual(slist.get_values(), ['a', 'b'] + list(xrange(1000)) + ['c', 'd'])
    self.assertGreater(slist.avg_updated_keys(), 8)

  def test_renumber_right_dumb(self):
    slist = ItemList(zip("abcd", [4,5,6,7]))
    ins_item = slist.find_value('b')
    for i in xrange(1000):
      slist.insert_items([(i, r.nextfloat(ins_item.key))], prepare_inserts=r.prepare_inserts_dumb)
    self.assertEqual(slist.get_values(), ['a', 'b'] + rev_range(1000) + ['c', 'd'])
    self.assertGreater(slist.avg_updated_keys(), 8)

  def test_renumber_multiple(self):
    # In this test, we make multiple difficult insertions at each step: to the left and to the
    # right of each value. This should involve some adjustments that get affected by subsequent
    # adjustments during the same prepare_inserts() call.
    slist = ItemList(zip("abcd", [4,5,6,7]))
    # We insert items on either side of each of the original items (a, b, c, d).
    ins_items = list(slist.get_list())
    N = 250
    for i in xrange(N):
      slist.insert_items([("%sr%s" % (x.value, i), r.nextfloat(x.key)) for x in ins_items] +
                         [("%sl%s" % (x.value, i), x.key) for x in ins_items] +
                         # After the first insertion, also insert items next on either side of the
                         # neighbors of the original a, b, c, d items.
                         ([("%sR%s" % (x.value, i), r.nextfloat(slist.next(x).key))
                           for x in ins_items] +
                          [("%sL%s" % (x.value, i), slist.prev(x).key) for x in ins_items]
                          if i > 0 else []))

    # The list should grow like this:
    #  a, b, c, d
    #  al0, a, ar0, ... (same for b, c, d)
    #  aL1, al0, al1, a, ar1, ar0, aR1, ...
    #  aL1, al0, aL2, al1, al2, a, ar2, ar1, aR2, ar0, aR1, ...
    def left_half(val):
      half = list(xrange(2*N - 1))
      half[0::2] = ['%sL%d' % (val, i) for i in xrange(1, N + 1)]
      half[1::2] = ['%sl%d' % (val, i) for i in xrange(0, N - 1)]
      half[-1] = '%sl%d' % (val, N - 1)
      return half

    def right_half(val):
      # Best described as the reverse of left_half
      return [v.replace('l', 'r').replace('L', 'R') for v in reversed(left_half(val))]

    # The list we expect to see is of the form [aL1, al1, aL2, al2, ... aL1000, al1000, a,
    # ar1000, aR1000, ..., aR1],
    # followed by the same sequence for b, c, and d.
    self.assertEqual(slist.get_values(), sum([left_half(v) + [v] + right_half(v)
                                              for v in ('a', 'b', 'c', 'd')], []))

    self.assertAlmostEqual(slist.avg_updated_keys(), 2.5, delta=1)
    self.assertLess(slist.num_update_events, 40)


def rev_range(n):
  return list(reversed(list(xrange(n))))

if __name__ == "__main__":
  unittest.main()
