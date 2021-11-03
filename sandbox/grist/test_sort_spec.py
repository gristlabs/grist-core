# coding=utf-8
import unittest

import sort_specs

class TestSortSpec(unittest.TestCase):
  def test_direction(self):
    self.assertEqual(sort_specs.direction(1), 1)
    self.assertEqual(sort_specs.direction(-1), -1)
    self.assertEqual(sort_specs.direction('1'), 1)
    self.assertEqual(sort_specs.direction('-1'), -1)
    self.assertEqual(sort_specs.direction('1:emptyLast'), 1)
    self.assertEqual(sort_specs.direction('1:emptyLast;orderByChoice'), 1)
    self.assertEqual(sort_specs.direction('-1:emptyLast;orderByChoice'), -1)

  def test_col_ref(self):
    self.assertEqual(sort_specs.col_ref(1), 1)
    self.assertEqual(sort_specs.col_ref(-1), 1)
    self.assertEqual(sort_specs.col_ref('1'), 1)
    self.assertEqual(sort_specs.col_ref('-1'), 1)
    self.assertEqual(sort_specs.col_ref('1:emptyLast'), 1)
    self.assertEqual(sort_specs.col_ref('1:emptyLast;orderByChoice'), 1)
    self.assertEqual(sort_specs.col_ref('-1:emptyLast;orderByChoice'), 1)

  def test_swap_col_ref(self):
    self.assertEqual(sort_specs.swap_col_ref(1, 2), 2)
    self.assertEqual(sort_specs.swap_col_ref(-1, 2), -2)
    self.assertEqual(sort_specs.swap_col_ref('1', 2), '2')
    self.assertEqual(sort_specs.swap_col_ref('-1', 2), '-2')
    self.assertEqual(sort_specs.swap_col_ref('1:emptyLast', 2), '2:emptyLast')
    self.assertEqual(
      sort_specs.swap_col_ref('1:emptyLast;orderByChoice', 2),
      '2:emptyLast;orderByChoice')
    self.assertEqual(
      sort_specs.swap_col_ref('-1:emptyLast;orderByChoice', 2),
      '-2:emptyLast;orderByChoice')
