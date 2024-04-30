# -*- coding: utf-8 -*-
# pylint:disable=line-too-long

import unittest
from predicate_formula import parse_predicate_formula

class TestPredicateFormula(unittest.TestCase):
  def test_basic(self):
    # Test a few basic formulas and structures, hitting everything we expect to support
    # in ACL formulas and dropdown conditions.
    self.assertEqual(parse_predicate_formula(
      "user.Email == 'X@'"),
      ["Eq", ["Attr", ["Name", "user"], "Email"],
        ["Const", "X@"]])

    self.assertEqual(parse_predicate_formula(
      "user.Role in ('editors', 'owners')"),
      ["In", ["Attr", ["Name", "user"], "Role"],
             ["List", ["Const", "editors"], ["Const", "owners"]]])

    self.assertEqual(parse_predicate_formula(
      "user.Role not in ('editors', 'owners')"),
      ["NotIn", ["Attr", ["Name", "user"], "Role"],
                ["List", ["Const", "editors"], ["Const", "owners"]]])

    self.assertEqual(parse_predicate_formula(
      "rec.office == 'Seattle' and user.email in ['sally@', 'xie@']"),
      ['And',
        ['Eq', ['Attr', ['Name', 'rec'], 'office'], ['Const', 'Seattle']],
        ['In',
         ['Attr', ['Name', 'user'], 'email'],
         ['List', ['Const', 'sally@'], ['Const', 'xie@']]
        ]])

    self.assertEqual(parse_predicate_formula(
      "$office == 'Seattle' and user.email in ['sally@', 'xie@']"),
      ['And',
        ['Eq', ['Attr', ['Name', 'rec'], 'office'], ['Const', 'Seattle']],
        ['In',
         ['Attr', ['Name', 'user'], 'email'],
         ['List', ['Const', 'sally@'], ['Const', 'xie@']]
        ]])

    self.assertEqual(parse_predicate_formula(
      "user.IsAdmin or rec.assigned is None or (not newRec.HasDuplicates and rec.StatusIndex <= newRec.StatusIndex)"),
      ['Or',
        ['Attr', ['Name', 'user'], 'IsAdmin'],
        ['Is', ['Attr', ['Name', 'rec'], 'assigned'], ['Const', None]],
        ['And',
          ['Not', ['Attr', ['Name', 'newRec'], 'HasDuplicates']],
          ['LtE', ['Attr', ['Name', 'rec'], 'StatusIndex'], ['Attr', ['Name', 'newRec'], 'StatusIndex']]
        ]
      ])

    self.assertEqual(parse_predicate_formula(
      "user.IsAdmin or $assigned is None or (not newRec.HasDuplicates and $StatusIndex <= newRec.StatusIndex)"),
      ['Or',
        ['Attr', ['Name', 'user'], 'IsAdmin'],
        ['Is', ['Attr', ['Name', 'rec'], 'assigned'], ['Const', None]],
        ['And',
          ['Not', ['Attr', ['Name', 'newRec'], 'HasDuplicates']],
          ['LtE', ['Attr', ['Name', 'rec'], 'StatusIndex'], ['Attr', ['Name', 'newRec'], 'StatusIndex']]
        ]
      ])

    self.assertEqual(parse_predicate_formula(
      "r.A <= n.A + 1 or r.A >= n.A - 1 or r.B < n.B * 2.5 or r.B > n.B / 2.5 or r.C % 2 != 0"),
      ['Or',
        ['LtE',
          ['Attr', ['Name', 'r'], 'A'],
          ['Add', ['Attr', ['Name', 'n'], 'A'], ['Const', 1]]],
        ['GtE',
          ['Attr', ['Name', 'r'], 'A'],
          ['Sub', ['Attr', ['Name', 'n'], 'A'], ['Const', 1]]],
        ['Lt',
          ['Attr', ['Name', 'r'], 'B'],
          ['Mult', ['Attr', ['Name', 'n'], 'B'], ['Const', 2.5]]],
        ['Gt',
          ['Attr', ['Name', 'r'], 'B'],
          ['Div', ['Attr', ['Name', 'n'], 'B'], ['Const', 2.5]]],
        ['NotEq',
          ['Mod', ['Attr', ['Name', 'r'], 'C'], ['Const', 2]],
          ['Const', 0]]
      ])

    self.assertEqual(parse_predicate_formula(
      "rec.A is True or rec.A is not False"),
      ['Or',
        ['Is', ['Attr', ['Name', 'rec'], 'A'], ['Const', True]],
        ['IsNot', ['Attr', ['Name', 'rec'], 'A'], ['Const', False]]
      ])

    self.assertEqual(parse_predicate_formula(
      "$A is True or $A is not False"),
      ['Or',
        ['Is', ['Attr', ['Name', 'rec'], 'A'], ['Const', True]],
        ['IsNot', ['Attr', ['Name', 'rec'], 'A'], ['Const', False]]
      ])

    self.assertEqual(parse_predicate_formula(
      "user.Office.City == 'Seattle' and user.Status.IsActive"),
      ['And',
        ['Eq',
          ['Attr', ['Attr', ['Name', 'user'], 'Office'], 'City'],
          ['Const', 'Seattle']],
        ['Attr', ['Attr', ['Name', 'user'], 'Status'], 'IsActive']
      ])

    self.assertEqual(parse_predicate_formula(
      "True # Comment!  "),
      ['Comment', ['Const', True], 'Comment!'])

    self.assertEqual(parse_predicate_formula(
      "\"#x\" == \" # Not a comment \"#Comment!"),
      ['Comment',
       ['Eq', ['Const', '#x'], ['Const', ' # Not a comment ']],
       'Comment!'
      ])

    self.assertEqual(parse_predicate_formula(
      "# Allow owners\nuser.Access == 'owners' # ignored\n# comment ignored"),
      ['Comment',
       ['Eq', ['Attr', ['Name', 'user'], 'Access'], ['Const', 'owners']],
       'Allow owners'
      ])

    self.assertEqual(parse_predicate_formula(
      "choice not in $Categories"),
      ['NotIn', ['Name', 'choice'], ['Attr', ['Name', 'rec'], 'Categories']])

    self.assertEqual(parse_predicate_formula(
      "choice.role == \"Manager\""),
      ['Eq', ['Attr', ['Name', 'choice'], 'role'], ['Const', 'Manager']])

  def test_unsupported(self):
    # Test a few constructs we expect to fail
    # Not an expression
    self.assertRaises(SyntaxError, parse_predicate_formula, "return 1")
    self.assertRaises(SyntaxError, parse_predicate_formula, "def foo(): pass")

    # Unsupported node type
    self.assertRaisesRegex(ValueError, r'Unsupported syntax', parse_predicate_formula, "max(rec)")
    self.assertRaisesRegex(ValueError, r'Unsupported syntax', parse_predicate_formula, "user.id in {1, 2, 3}")
    self.assertRaisesRegex(ValueError, r'Unsupported syntax', parse_predicate_formula, "1 if user.IsAnon else 2")

    # Unsupported operation
    self.assertRaisesRegex(ValueError, r'Unsupported syntax', parse_predicate_formula, "1 | 2")
    self.assertRaisesRegex(ValueError, r'Unsupported syntax', parse_predicate_formula, "1 << 2")
    self.assertRaisesRegex(ValueError, r'Unsupported syntax', parse_predicate_formula, "~test")

    # Syntax error
    self.assertRaises(SyntaxError, parse_predicate_formula, "[(]")
    self.assertRaises(SyntaxError, parse_predicate_formula, "user.id in (1,2))")
    self.assertRaisesRegex(SyntaxError, r'invalid syntax on line 1 col 9', parse_predicate_formula, "foo and !bar")
