import unittest
from lookupset import LookupSet

class TestLookupSet(unittest.TestCase):
  def test_get_sorted_version(self):
    by_last = make_sort_key_by_last_digit()
    as_text = make_sort_key_as_text()
    s = LookupSet([100, 42, 25])
    for n in (107, 35, 42, 100):
      s.add(n)
    self.assertEqual(s, {100, 42, 25, 107, 35})
    self.assertEqual(s.get_sorted_version(None), [25, 35, 42, 100, 107])
    self.assertEqual(s.get_sorted_version(by_last), [100, 42, 25, 35, 107])
    self.assertEqual(s.get_sorted_version(as_text), [100, 107, 25, 35, 42])
    s.discard(25)
    s.discard(107)
    self.assertEqual(s, {100, 42, 35})
    self.assertEqual(s.get_sorted_version(None), [35, 42, 100])
    self.assertEqual(s.get_sorted_version(by_last), [100, 42, 35])
    self.assertEqual(s.get_sorted_version(as_text), [100, 35, 42])

  def test_reset_sorted_version(self):
    by_last = make_sort_key_by_last_digit()
    as_text = make_sort_key_as_text()
    s = LookupSet([100, 107, 42, 25, 35])
    self.assertEqual(s.get_sorted_version(None), [25, 35, 42, 100, 107])
    self.assertEqual(s.get_sorted_version(by_last), [100, 42, 25, 35, 107])
    # Make a different order with the same *sort_spec* by switching the sort_spec of as_text.
    as_text.sort_spec = by_last.sort_spec
    # This doesn't take effect yet because the sorted version is cached.
    self.assertEqual(s.get_sorted_version(as_text), [100, 42, 25, 35, 107])
    # But reset_sorted_version is what should clear it.
    s.reset_sorted_version(as_text)
    self.assertEqual(s.get_sorted_version(as_text), [100, 107, 25, 35, 42])


# A couple of fake sort_keys to test with.
# This one compares by last digit first: e.g. 42 < 25 < 35
def make_sort_key_by_last_digit():
  class SortKey:
    sort_spec = ("by_last_digit",)

    def __init__(self, row_id):
      self.row_id = row_id

    def __lt__(self, other):
      return (self.row_id % 10, self.row_id) < (other.row_id % 10, other.row_id)

  return SortKey

# This one compares numbers as strings, e.g. 100 < 2 < 23
def make_sort_key_as_text():
  class SortKey:
    sort_spec = ("as_text",)

    def __init__(self, row_id):
      self.row_id = str(row_id)

    def __lt__(self, other):
      return self.row_id < other.row_id

  return SortKey
