import unittest
import gpath

class TestGpath(unittest.TestCase):
  def setUp(self):
    self.obj = {
      "foo": [{"bar": 1}, {"bar": 2}, {"baz": 3}],
      "hello": "world"
    }

  def test_get(self):
    self.assertEqual(gpath.get(self.obj, ["foo", 0, "bar"]), 1)
    self.assertEqual(gpath.get(self.obj, ["foo", 2]), {"baz": 3})
    self.assertEqual(gpath.get(self.obj, ["hello"]), "world")
    self.assertEqual(gpath.get(self.obj, []), self.obj)

    self.assertEqual(gpath.get(self.obj, ["foo", 0, "baz"]), None)
    self.assertEqual(gpath.get(self.obj, ["foo", 4]), None)
    self.assertEqual(gpath.get(self.obj, ["foo", 4, "baz"]), None)
    self.assertEqual(gpath.get(self.obj, [0]), None)

  def test_set(self):
    gpath.place(self.obj, ["foo"], {"bar": 1, "baz": 2})
    self.assertEqual(self.obj["foo"], {"bar": 1, "baz": 2})
    gpath.place(self.obj, ["foo", "bar"], 17)
    self.assertEqual(self.obj["foo"], {"bar": 17, "baz": 2})
    gpath.place(self.obj, ["foo", "baz"], None)
    self.assertEqual(self.obj["foo"], {"bar": 17})

    self.assertEqual(self.obj["hello"], "world")
    gpath.place(self.obj, ["hello"], None)
    self.assertFalse("hello" in self.obj)
    gpath.place(self.obj, ["hello"], None)    # OK to remove a non-existent property.
    self.assertFalse("hello" in self.obj)
    gpath.place(self.obj, ["hello"], "blah")
    self.assertEqual(self.obj["hello"], "blah")

  def test_set_strict(self):
    with self.assertRaisesRegexp(Exception, r"non-existent"):
      gpath.place(self.obj, ["bar", 4], 17)

    with self.assertRaisesRegexp(Exception, r"not a plain object"):
      gpath.place(self.obj, ["foo", 0], 17)


  def test_insert(self):
    self.assertEqual(self.obj["foo"], [{"bar": 1}, {"bar": 2}, {"baz": 3}])
    gpath.insert(self.obj, ["foo", 0], "asdf")
    self.assertEqual(self.obj["foo"], ["asdf", {"bar": 1}, {"bar": 2}, {"baz": 3}])
    gpath.insert(self.obj, ["foo", 3], "hello")
    self.assertEqual(self.obj["foo"], ["asdf", {"bar": 1}, {"bar": 2}, "hello", {"baz": 3}])
    gpath.insert(self.obj, ["foo", None], "world")
    self.assertEqual(self.obj["foo"],
                     ["asdf", {"bar": 1}, {"bar": 2}, "hello", {"baz": 3}, "world"])

  def test_insert_strict(self):
    with self.assertRaisesRegexp(Exception, r'not an array'):
      gpath.insert(self.obj, ["foo"], "asdf")

    with self.assertRaisesRegexp(Exception, r'invalid.*index'):
      gpath.insert(self.obj, ["foo", -1], 17)

    with self.assertRaisesRegexp(Exception, r'invalid.*index'):
      gpath.insert(self.obj, ["foo", "foo"], 17)

  def test_update(self):
    """update should update array items"""
    self.assertEqual(self.obj["foo"], [{"bar": 1}, {"bar": 2}, {"baz": 3}])
    gpath.update(self.obj, ["foo", 0], "asdf")
    self.assertEqual(self.obj["foo"], ["asdf", {"bar": 2}, {"baz": 3}])
    gpath.update(self.obj, ["foo", 2], "hello")
    self.assertEqual(self.obj["foo"], ["asdf", {"bar": 2}, "hello"])
    gpath.update(self.obj, ["foo", 1], None)
    self.assertEqual(self.obj["foo"], ["asdf", None, "hello"])

  def test_update_strict(self):
    """update should be strict"""
    with self.assertRaisesRegexp(Exception, r'non-existent'):
      gpath.update(self.obj, ["bar", 4], 17)
    with self.assertRaisesRegexp(Exception, r'not an array'):
      gpath.update(self.obj, ["foo"], 17)
    with self.assertRaisesRegexp(Exception, r'invalid.*index'):
      gpath.update(self.obj, ["foo", -1], 17)
    with self.assertRaisesRegexp(Exception, r'invalid.*index'):
      gpath.update(self.obj, ["foo", None], 17)

  def test_remove(self):
    """remove should remove indices"""
    self.assertEqual(self.obj["foo"], [{"bar": 1}, {"bar": 2}, {"baz": 3}])
    gpath.remove(self.obj, ["foo", 0])
    self.assertEqual(self.obj["foo"], [{"bar": 2}, {"baz": 3}])
    gpath.remove(self.obj, ["foo", 1])
    self.assertEqual(self.obj["foo"], [{"bar": 2}])
    gpath.remove(self.obj, ["foo", 0])
    self.assertEqual(self.obj["foo"], [])

  def test_remove_strict(self):
    """remove should be strict"""
    with self.assertRaisesRegexp(Exception, r'non-existent'):
      gpath.remove(self.obj, ["bar", 4])
    with self.assertRaisesRegexp(Exception, r'not an array'):
      gpath.remove(self.obj, ["foo"])
    with self.assertRaisesRegexp(Exception, r'invalid.*index'):
      gpath.remove(self.obj, ["foo", -1])
    with self.assertRaisesRegexp(Exception, r'invalid.*index'):
      gpath.remove(self.obj, ["foo", None])

  def test_glob(self):
    """glob should scan arrays"""
    self.assertEqual(self.obj["foo"], [{"bar": 1}, {"bar": 2}, {"baz": 3}])

    self.assertEqual(gpath.place(self.obj, ["foo", "*", "bar"], 17), 3)
    self.assertEqual(self.obj["foo"], [{"bar": 17}, {"bar": 17}, {"baz": 3, "bar": 17}])

    with self.assertRaisesRegexp(Exception, r'non-existent object at \/foo\/\*\/bad'):
      gpath.place(self.obj, ["foo", "*", "bad", "test"], 10)

    self.assertEqual(gpath.update(self.obj, ["foo", "*"], "hello"), 3)
    self.assertEqual(self.obj["foo"], ["hello", "hello", "hello"])

  def test_glob_strict_wildcard(self):
    """should only support tail wildcard for updates"""
    with self.assertRaisesRegexp(Exception, r'invalid array index'):
      gpath.remove(self.obj, ["foo", "*"])
    with self.assertRaisesRegexp(Exception, r'invalid array index'):
      gpath.insert(self.obj, ["foo", "*"], 1)

  def test_glob_wildcard_keys(self):
    """should not scan object keys"""
    self.assertEqual(self.obj["foo"], [{"bar": 1}, {"bar": 2}, {"baz": 3}])

    self.assertEqual(gpath.place(self.obj, ["foo", 0, "*"], 17), 1)
    self.assertEqual(self.obj["foo"], [{"bar": 1, '*': 17}, {"bar": 2}, {"baz": 3}])

    with self.assertRaisesRegexp(Exception, r'non-existent'):
      gpath.place(self.obj, ["*", 0, "bar"], 17)

  def test_glob_nested(self):
    """should scan nested arrays"""
    self.obj = [{"a": [1,2,3]}, {"a": [4,5,6]}, {"a": [7,8,9]}]
    self.assertEqual(gpath.update(self.obj, ["*", "a", "*"], 5), 9)
    self.assertEqual(self.obj, [{"a": [5,5,5]}, {"a": [5,5,5]}, {"a": [5,5,5]}])

  def test_dirname(self):
    """dirname should return path without last component"""
    self.assertEqual(gpath.dirname(["foo", "bar", "baz"]), ["foo", "bar"])
    self.assertEqual(gpath.dirname([1, 2]), [1])
    self.assertEqual(gpath.dirname(["foo"]), [])
    self.assertEqual(gpath.dirname([]), [])

  def test_basename(self):
    """basename should return the last component of path"""
    self.assertEqual(gpath.basename(["foo", "bar", "baz"]), "baz")
    self.assertEqual(gpath.basename([1, 2]), 2)
    self.assertEqual(gpath.basename(["foo"]), "foo")
    self.assertEqual(gpath.basename([]), None)

if __name__ == "__main__":
  unittest.main()
