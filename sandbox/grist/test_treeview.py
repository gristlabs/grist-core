from collections import namedtuple
import unittest

from treeview import fix_indents

Item = namedtuple('Item', 'id indentation')

def fix_and_check(items, changes):
  #  convert from strings to items with ids and indents (e.g. "A0" -> {id: "A", indent: 0} returns
  #  the pair (adjustments, resulting items converted to strings) for verification
  all_items = [Item(i[0], int(i[1:])) for i in items]
  adjustments = fix_indents(all_items, changes)
  fix_map = {id: indentation for id, indentation in adjustments}
  all_items = [i for i in all_items if i.id not in changes]
  result = ['%s%s' % (i.id, fix_map.get(i.id, i.indentation)) for i in all_items]
  return (adjustments, result)

class TestTreeView(unittest.TestCase):

  def test_fix_indents(self):
    self.assertEqual(fix_and_check(["A0", "B0", "C1", "D1"], {"B"}), (
      [("C", 0)],
      ["A0", "C0", "D1"]))

    self.assertEqual(fix_and_check(["A0", "B1", "C1", "D1"], {"B"}), (
      [],
      ["A0", "C1", "D1"]))

    self.assertEqual(fix_and_check(["A0", "B0", "C1", "D2", "E3", "F2", "G1", "H0"], {"B"}), (
      [("C", 0), ("D", 1), ("E", 2)],
      ["A0", "C0", "D1", "E2", "F2", "G1", "H0"]))

    self.assertEqual(fix_and_check(["A0", "B1", "C1", "D1"], {"A", "B"}), (
      [("C", 0)],
      ["C0", "D1"]))

    self.assertEqual(fix_and_check(["A0", "B0", "C1", "D1"], {"A", "B"}), (
      [("C", 0)],
      ["C0", "D1"]))

    self.assertEqual(fix_and_check(["A0", "B1", "C2", "D0"], {"A", "B"}), (
      [("C", 0)],
      ["C0", "D0"]))

    self.assertEqual(fix_and_check(["A0", "B1", "C2", "D0"], {"A", "C"}), (
      [("B", 0)],
      ["B0", "D0"]))

    self.assertEqual(fix_and_check(["A0", "B1", "C2", "D0"], {"B", "C"}), (
      [],
      ["A0", "D0"]))

    self.assertEqual(fix_and_check(["A0", "B1", "C2", "D0", "E0"], {"B", "D"}), (
      [("C", 1)],
      ["A0", "C1", "E0"]))

    self.assertEqual(fix_and_check(["A0", "B1", "C2", "D0", "E1"], {"B", "D"}), (
      [("C", 1), ("E", 0)],
      ["A0", "C1", "E0"]))
