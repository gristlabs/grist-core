import unittest
import asttokens
import re

import textbuilder
from textbuilder import make_patch, make_regexp_patches, Patch

class TestTextBuilder(unittest.TestCase):
  def test_validate_patch(self):
    text = "To be or not to be"
    patch = make_patch(text, 3, 8, "SEE OR")
    self.assertEqual(textbuilder.validate_patch(text, patch), None)
    with self.assertRaises(ValueError):
      textbuilder.validate_patch('X' + text, patch)

  def test_replacer(self):
    value = object()
    t1 = textbuilder.Text("To be or not\n  to be?\n", value)
    patches = make_regexp_patches(t1.get_text(), re.compile(r'be|to', re.I),
                                  lambda m: (m.group() + m.group()).upper())
    t2 = textbuilder.Replacer(t1, patches)
    self.assertEqual(t2.get_text(), "TOTO BEBE or not\n  TOTO BEBE?\n")
    self.assertEqual(t2.map_back_patch(make_patch(t2.get_text(), 0, 4, "xxx")),
                      (t1.get_text(), value, Patch(0, 2, "To", "xxx")))
    self.assertEqual(t2.map_back_patch(make_patch(t2.get_text(), 5, 9, "xxx")),
                      (t1.get_text(), value, Patch(3, 5, "be", "xxx")))
    self.assertEqual(t2.map_back_patch(make_patch(t2.get_text(), 18, 23, "xxx")),
                      (t1.get_text(), value, Patch(14, 17, " to", "xxx")))
    # Match the entire second line
    self.assertEqual(t2.map_back_patch(make_patch(t2.get_text(), 17, 29, "xxx")),
                      (t1.get_text(), value, Patch(13, 21, "  to be?", "xxx")))

  def test_combiner(self):
    valueA, valueB = object(), object()
    t1 = textbuilder.Text("To be or not\n  to be?\n", valueA)
    patches = make_regexp_patches(t1.get_text(), re.compile(r'be|to', re.I),
                                  lambda m: (m.group() + m.group()).upper())
    t2 = textbuilder.Replacer(t1, patches)
    t3 = textbuilder.Text("That is the question", valueB)
    t4 = textbuilder.Combiner(["[", t2, t3, "]"])
    self.assertEqual(t4.get_text(), "[TOTO BEBE or not\n  TOTO BEBE?\nThat is the question]")
    self.assertEqual(t4.map_back_patch(make_patch(t4.get_text(), 1, 5, "xxx")),
                     (t1.get_text(), valueA, Patch(0, 2, "To", "xxx")))
    self.assertEqual(t4.map_back_patch(make_patch(t4.get_text(), 18, 30, "xxx")),
                     (t1.get_text(), valueA, Patch(13, 21, "  to be?", "xxx")))
    self.assertEqual(t4.map_back_patch(make_patch(t4.get_text(), 0, 1, "xxx")),
                     None)
    self.assertEqual(t4.map_back_patch(make_patch(t4.get_text(), 31, 38, "xxx")),
                     (t3.get_text(), valueB, Patch(0, 7, "That is", "xxx")))

  def test_linenumbers(self):
    ln = asttokens.LineNumbers("Hello\nworld\nThis\n\nis\n\na test.\n")
    self.assertEqual(ln.line_to_offset(1, 0), 0)
    self.assertEqual(ln.line_to_offset(1, 5), 5)
    self.assertEqual(ln.line_to_offset(2, 0), 6)
    self.assertEqual(ln.line_to_offset(2, 5), 11)
    self.assertEqual(ln.line_to_offset(3, 0), 12)
    self.assertEqual(ln.line_to_offset(4, 0), 17)
    self.assertEqual(ln.line_to_offset(5, 0), 18)
    self.assertEqual(ln.line_to_offset(6, 0), 21)
    self.assertEqual(ln.line_to_offset(7, 0), 22)
    self.assertEqual(ln.line_to_offset(7, 7), 29)
    self.assertEqual(ln.offset_to_line(0),  (1, 0))
    self.assertEqual(ln.offset_to_line(5),  (1, 5))
    self.assertEqual(ln.offset_to_line(6),  (2, 0))
    self.assertEqual(ln.offset_to_line(11), (2, 5))
    self.assertEqual(ln.offset_to_line(12), (3, 0))
    self.assertEqual(ln.offset_to_line(17), (4, 0))
    self.assertEqual(ln.offset_to_line(18), (5, 0))
    self.assertEqual(ln.offset_to_line(21), (6, 0))
    self.assertEqual(ln.offset_to_line(22), (7, 0))
    self.assertEqual(ln.offset_to_line(29), (7, 7))

    # Test that out-of-bounds inputs still return something sensible.
    self.assertEqual(ln.line_to_offset(6, 19), 30)
    self.assertEqual(ln.line_to_offset(100, 99), 30)
    self.assertEqual(ln.line_to_offset(2, -1), 6)
    self.assertEqual(ln.line_to_offset(-1, 99), 0)
    self.assertEqual(ln.offset_to_line(30), (8, 0))
    self.assertEqual(ln.offset_to_line(100), (8, 0))
    self.assertEqual(ln.offset_to_line(-100), (1, 0))


if __name__ == "__main__":
  unittest.main()
