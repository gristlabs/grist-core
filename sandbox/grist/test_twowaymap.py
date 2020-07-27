import unittest
import twowaymap

class TestTwoWayMap(unittest.TestCase):
  def assertTwoWayMap(self, twmap, forward, reverse):
    map_repr = (
      { k: twmap.lookup_left(k) for k in twmap.left_all() },
      { k: twmap.lookup_right(k) for k in twmap.right_all() }
    )
    self.assertEqual(map_repr, (forward, reverse))

  def test_set_list(self):
    tmap = twowaymap.TwoWayMap(left=set, right=list)

    self.assertFalse(tmap)
    tmap.insert(1, "a")
    self.assertTrue(tmap)
    self.assertTwoWayMap(tmap, {1: ["a"]}, {"a": {1}})

    tmap.insert(1, "a")   # should be a no-op, since this pair already exists
    tmap.insert(1, "b")
    tmap.insert(2, "a")
    self.assertTwoWayMap(tmap, {1: ["a", "b"], 2: ["a"]}, {"a": {1,2}, "b": {1}})

    tmap.insert(1, "b")
    tmap.insert(2, "b")
    self.assertTwoWayMap(tmap, {1: ["a", "b"], 2: ["a", "b"]}, {"a": {1,2}, "b": {1,2}})

    tmap.remove(1, "b")
    tmap.remove(2, "b")
    self.assertTwoWayMap(tmap, {1: ["a"], 2: ["a"]}, {"a": {1,2}})

    tmap.insert(1, "b")
    tmap.insert(2, "b")
    tmap.remove_left(1)
    self.assertTwoWayMap(tmap, {2: ["a", "b"]}, {"a": {2}, "b": {2}})

    tmap.insert(1, "a")
    tmap.insert(2, "b")
    tmap.remove_right("b")
    self.assertTwoWayMap(tmap, {1: ["a"], 2: ["a"]}, {"a": {1,2}})

    self.assertTrue(tmap)
    tmap.clear()
    self.assertTwoWayMap(tmap, {}, {})
    self.assertFalse(tmap)

  def test_set_single(self):
    tmap = twowaymap.TwoWayMap(left=set, right="single")

    self.assertFalse(tmap)
    tmap.insert(1, "a")
    self.assertTrue(tmap)
    self.assertTwoWayMap(tmap, {1: "a"}, {"a": {1}})

    tmap.insert(1, "a")   # should be a no-op, since this pair already exists
    tmap.insert(1, "b")
    tmap.insert(2, "a")
    self.assertTwoWayMap(tmap, {1: "b", 2: "a"}, {"a": {2}, "b": {1}})

    tmap.insert(1, "b")
    tmap.insert(2, "b")
    self.assertTwoWayMap(tmap, {1: "b", 2: "b"}, {"b": {1,2}})

    tmap.remove(1, "b")
    self.assertTwoWayMap(tmap, {2: "b"}, {"b": {2}})
    tmap.remove(2, "b")
    self.assertTwoWayMap(tmap, {}, {})

    tmap.insert(1, "b")
    tmap.insert(2, "b")
    self.assertTwoWayMap(tmap, {1: "b", 2: "b"}, {"b": {1,2}})
    tmap.remove_left(1)
    self.assertTwoWayMap(tmap, {2: "b"}, {"b": {2}})

    tmap.insert(1, "a")
    tmap.insert(2, "b")
    tmap.remove_right("b")
    self.assertTwoWayMap(tmap, {1: "a"}, {"a": {1}})

    self.assertTrue(tmap)
    tmap.clear()
    self.assertTwoWayMap(tmap, {}, {})
    self.assertFalse(tmap)

  def test_strict_list(self):
    tmap = twowaymap.TwoWayMap(left="strict", right=list)

    self.assertFalse(tmap)
    tmap.insert(1, "a")
    self.assertTrue(tmap)
    self.assertTwoWayMap(tmap, {1: ["a"]}, {"a": 1})

    tmap.insert(1, "a")   # should be a no-op, since this pair already exists
    tmap.insert(1, "b")
    with self.assertRaises(ValueError):
      tmap.insert(2, "a")
    self.assertTwoWayMap(tmap, {1: ["a", "b"]}, {"a": 1, "b": 1})

    tmap.insert(1, "b")
    with self.assertRaises(ValueError):
      tmap.insert(2, "b")
    tmap.insert(2, "c")
    self.assertTwoWayMap(tmap, {1: ["a", "b"], 2: ["c"]}, {"a": 1, "b": 1, "c": 2})

    tmap.remove(1, "b")
    self.assertTwoWayMap(tmap, {1: ["a"], 2: ["c"]}, {"a": 1, "c": 2})
    tmap.remove(2, "b")
    self.assertTwoWayMap(tmap, {1: ["a"], 2: ["c"]}, {"a": 1, "c": 2})

    tmap.insert(1, "b")
    with self.assertRaises(ValueError):
      tmap.insert(2, "b")
    self.assertTwoWayMap(tmap, {1: ["a", "b"], 2: ["c"]}, {"a": 1, "b": 1, "c": 2})
    tmap.remove_left(1)
    self.assertTwoWayMap(tmap, {2: ["c"]}, {"c": 2})

    tmap.insert(1, "a")
    tmap.insert(2, "b")
    tmap.remove_right("b")
    self.assertTwoWayMap(tmap, {1: ["a"], 2: ["c"]}, {"a": 1, "c": 2})

    self.assertTrue(tmap)
    tmap.clear()
    self.assertTwoWayMap(tmap, {}, {})
    self.assertFalse(tmap)

  def test_strict_single(self):
    tmap = twowaymap.TwoWayMap(left="strict", right="single")
    tmap.insert(1, "a")
    tmap.insert(2, "b")
    tmap.insert(2, "c")
    self.assertTwoWayMap(tmap, {1: "a", 2: "c"}, {"a": 1, "c": 2})
    with self.assertRaises(ValueError):
      tmap.insert(2, "a")
    tmap.insert(2, "c")   # This pair already exists, so not an error.
    self.assertTwoWayMap(tmap, {1: "a", 2: "c"}, {"a": 1, "c": 2})

  def test_nonhashable(self):
    # Test that we don't get into an inconsistent state if we attempt to use a non-hashable value.
    tmap = twowaymap.TwoWayMap(left=list, right=list)
    tmap.insert(1, "a")
    self.assertTwoWayMap(tmap, {1: ["a"]}, {"a": [1]})

    with self.assertRaises(TypeError):
      tmap.insert(1, {})
    with self.assertRaises(TypeError):
      tmap.insert({}, "a")

    self.assertTwoWayMap(tmap, {1: ["a"]}, {"a": [1]})


if __name__ == "__main__":
  unittest.main()
