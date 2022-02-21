import random
import string
import timeit
import unittest

import six
from six.moves import xrange
from six.moves.collections_abc import Hashable  # pylint:disable-all

import match_counter
from testutil import repeat_until_passes

# Here's an alternative implementation. Unlike the simple one, it never constructs a new data
# structure, or modifies dictionary keys while iterating, but it is still slower.
class MatchCounterOther(object):
  def __init__(self, _sample):
    self.sample_counts = {v: 0 for v in _sample}

  def count_unique(self, iterable):
    for v in iterable:
      try:
        n = self.sample_counts.get(v)
        if n is not None:
          self.sample_counts[v] = n + 1
      except TypeError:
        pass

    matches = 0
    for v, n in six.iteritems(self.sample_counts):
      if n > 0:
        matches += 1
        self.sample_counts[v] = 0
    return matches


# If not for dealing with unhashable errors, `.intersection(iterable)` would be by far the
# fastest. But with the extra iteration and especially checking for Hashable, it's super slow.
class MatchCounterIntersection(object):
  def __init__(self, _sample):
    self.sample = set(_sample)

  def count_unique(self, iterable):
    return len(self.sample.intersection(v for v in iterable if isinstance(v, Hashable)))


# This implementation doesn't measure the intersection, but it's interesting to compare its
# timings: this is still slower! Presumably because set intersection is native code that's more
# optimized than checking membership many times from Python.
class MatchCounterSimple(object):
  def __init__(self, _sample):
    self.sample = set(_sample)

  def count_all(self, iterable):
    return sum(1 for r in iterable if present(r, self.sample))

# This is much faster than using `isinstance(v, Hashable) and v in value_set`
def present(v, value_set):
  try:
    return v in value_set
  except TypeError:
    return False


# Set up a predictable random number generator.
r = random.Random(17)

def random_string():
  length = r.randint(10,20)
  return ''.join(r.choice(string.ascii_letters) for x in xrange(length))

def sample_with_repl(population, n):
  return [r.choice(population) for x in xrange(n)]

# Here's some sample generated data.
sample = [random_string() for x in xrange(200)]
data1 = sample_with_repl([random_string() for x in xrange(20)] + r.sample(sample, 5), 1000)
data2 = sample_with_repl([random_string() for x in xrange(100)] + r.sample(sample, 15), 500)

# Include an example with an unhashable value, to ensure all implementation can handle it.
data3 = sample_with_repl([random_string() for x in xrange(10)] + sample, 2000) + [[1,2,3]]


class TestMatchCounter(unittest.TestCase):
  def test_match_counter(self):
    m = match_counter.MatchCounter(sample)
    self.assertEqual(m.count_unique(data1), 5)
    self.assertEqual(m.count_unique(data2), 15)
    self.assertEqual(m.count_unique(data3), 200)

    m = MatchCounterOther(sample)
    self.assertEqual(m.count_unique(data1), 5)
    self.assertEqual(m.count_unique(data2), 15)
    self.assertEqual(m.count_unique(data3), 200)
    # Do it again to ensure that we clear out state between counting.
    self.assertEqual(m.count_unique(data1), 5)
    self.assertEqual(m.count_unique(data2), 15)
    self.assertEqual(m.count_unique(data3), 200)

    m = MatchCounterIntersection(sample)
    self.assertEqual(m.count_unique(data1), 5)
    self.assertEqual(m.count_unique(data2), 15)
    self.assertEqual(m.count_unique(data3), 200)

    m = MatchCounterSimple(sample)
    self.assertGreaterEqual(m.count_all(data1), 5)
    self.assertGreaterEqual(m.count_all(data2), 15)
    self.assertGreaterEqual(m.count_all(data3), 200)

  @repeat_until_passes(3)
  def test_timing(self):
    setup='''
import match_counter
import test_match_counter as t
m1 = match_counter.MatchCounter(t.sample)
m2 = t.MatchCounterOther(t.sample)
m3 = t.MatchCounterSimple(t.sample)
m4 = t.MatchCounterIntersection(t.sample)
'''
    N = 100

    t1 = min(timeit.repeat(stmt='m1.count_unique(t.data1)', setup=setup, number=N, repeat=3)) / N
    t2 = min(timeit.repeat(stmt='m2.count_unique(t.data1)', setup=setup, number=N, repeat=3)) / N
    t3 = min(timeit.repeat(stmt='m3.count_all(t.data1)', setup=setup, number=N, repeat=3)) / N
    t4 = min(timeit.repeat(stmt='m4.count_unique(t.data1)', setup=setup, number=N, repeat=3)) / N
    #print "Timings/iter data1: %.3fus %.3fus %.3fus %.3fus" % (t1 * 1e6, t2 * 1e6, t3*1e6, t4*1e6)

    self.assertLess(t1, t2)
    self.assertLess(t1, t3)
    self.assertLess(t1, t4)

    t1 = min(timeit.repeat(stmt='m1.count_unique(t.data2)', setup=setup, number=N, repeat=3)) / N
    t2 = min(timeit.repeat(stmt='m2.count_unique(t.data2)', setup=setup, number=N, repeat=3)) / N
    t3 = min(timeit.repeat(stmt='m3.count_all(t.data2)', setup=setup, number=N, repeat=3)) / N
    t4 = min(timeit.repeat(stmt='m4.count_unique(t.data2)', setup=setup, number=N, repeat=3)) / N
    #print "Timings/iter data2: %.3fus %.3fus %.3fus %.3fus" % (t1 * 1e6, t2 * 1e6, t3*1e6, t4*1e6)
    self.assertLess(t1, t2)
    self.assertLess(t1, t3)
    self.assertLess(t1, t4)

    t1 = min(timeit.repeat(stmt='m1.count_unique(t.data3)', setup=setup, number=N, repeat=3)) / N
    t2 = min(timeit.repeat(stmt='m2.count_unique(t.data3)', setup=setup, number=N, repeat=3)) / N
    t3 = min(timeit.repeat(stmt='m3.count_all(t.data3)', setup=setup, number=N, repeat=3)) / N
    t4 = min(timeit.repeat(stmt='m4.count_unique(t.data3)', setup=setup, number=N, repeat=3)) / N
    #print "Timings/iter data3: %.3fus %.3fus %.3fus %.3fus" % (t1 * 1e6, t2 * 1e6, t3*1e6, t4*1e6)
    self.assertLess(t1, t2)
    #self.assertLess(t1, t3)    # This fails on occasion, but it's a fairly pointless check.
    self.assertLess(t1, t4)


if __name__ == "__main__":
  unittest.main()
