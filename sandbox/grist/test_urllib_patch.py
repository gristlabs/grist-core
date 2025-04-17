# coding=utf-8
import unittest
import urllib

from urllib_patch import original_quote


class TestUrllibPatch(unittest.TestCase):
  def test_patched_quote(self):
    self.assertEqual(urllib.quote( "a b"), u"a%20b")
    self.assertEqual(urllib.quote(u"a b"), u"a%20b")
    self.assertEqual(urllib.quote(u"a é"), u"a%20%C3%A9")

    self.assertEqual(original_quote( "a b"), u"a%20b")
    self.assertEqual(original_quote(u"a b"), u"a%20b")
    self.assertEqual(original_quote(u"a é"), u"a%20%C3%A9")
