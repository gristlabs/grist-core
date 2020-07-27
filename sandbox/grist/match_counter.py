"""
Simple class which, given a sample, can quickly count the size of overlap with an iterable.
All elements of sample must be hashable.

This is mainly in its own file in order to be able to test and time possible alternative
implementations.
"""
class MatchCounter(object):
  def __init__(self, sample):
    self.sample = set(sample)

  def count_unique(self, iterable):
    """
    Returns the count of unique elements of iterable that are present in sample. The sample may
    only contain hashable elements, so non-hashable elements of iterable are never counted.
    """
    # The simplest implementation is 5 times faster:
    #     len(self.sample.intersection(iterable))
    # but fails if iterable can ever contain non-hashable values (e.g. list). This is the next
    # best alternative. Attempting to skip non-hashable values with `isinstance(v, Hashable)` is
    # another order of magnitude slower.
    seen = set()
    for v in iterable:
      try:
        if v in self.sample:
          seen.add(v)
      except TypeError:
        # Non-hashable values can't possibly be in self.sample, so just don't count those.
        pass

    return len(seen)
