"""
Tests that formula error messages (traceback) are correct
"""
import textwrap

import six

import depend
import test_engine
import testutil
import objtypes


class TestErrorMessage(test_engine.EngineTestCase):

  syntax_err = \
"""
if sum(3, 5) > 6:
  return 6
else:
  return: 0
"""

  indent_err = \
"""
  if sum(3, 5) > 6:
    return 6
"""

  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Math", [
        [11, "excel_formula", "Text", True, "SQRT(16, 2)", "", ""],
        [12, "built_in_formula", "Text", True, "max(5)", "", ""],
        [13, "syntax_err", "Text", True, syntax_err, "", ""],
        [14, "indent_err", "Text", True, indent_err, "", ""],
        [15, "other_err", "Text", True, textwrap.dedent(indent_err), "", ""],
        [15, "custom_err", "Text", True, "raise Exception('hello')", "", ""],
      ]]
    ],
    "DATA": {
      "Math": [
        ["id"],
        [3],
      ]
    }
  })

  def test_formula_errors(self):
    self.load_sample(self.sample)

    if six.PY2:
      self.assertFormulaError(self.engine.get_formula_error('Math', 'excel_formula', 3),
                              TypeError, 'SQRT() takes exactly 1 argument (2 given)',
                              r"TypeError: SQRT\(\) takes exactly 1 argument \(2 given\)")
    else:
      self.assertFormulaError(self.engine.get_formula_error('Math', 'excel_formula', 3),
                              TypeError, 'SQRT() takes 1 positional argument but 2 were given',
                              r"TypeError: SQRT\(\) takes 1 positional argument but 2 were given")

    self.assertFormulaError(self.engine.get_formula_error('Math', 'built_in_formula', 3),
                            TypeError, "'int' object is not iterable",
                            textwrap.dedent(
                              r"""
                                File "usercode", line \d+, in built_in_formula
                                  return max\(5\)
                              TypeError: 'int' object is not iterable
                              """
                            ))

    self.assertFormulaError(self.engine.get_formula_error('Math', 'syntax_err', 3),
                            SyntaxError, "invalid syntax (usercode, line 5)",
                            textwrap.dedent(
                              r"""
                                File "usercode", line 5
                                  return: 0
                                        \^
                              SyntaxError: invalid syntax
                              """
                            ))

    if six.PY2:
      traceback_regex = textwrap.dedent(
        r"""
          File "usercode", line 2
            if sum\(3, 5\) > 6:
            \^
        IndentationError: unexpected indent
        """
      )
    else:
      traceback_regex = textwrap.dedent(
        r"""
          File "usercode", line 2
            if sum\(3, 5\) > 6:
        IndentationError: unexpected indent
        """
      )
    self.assertFormulaError(self.engine.get_formula_error('Math', 'indent_err', 3),
                            IndentationError, 'unexpected indent (usercode, line 2)',
                            traceback_regex)

    self.assertFormulaError(self.engine.get_formula_error('Math', 'other_err', 3),
                            TypeError, "'int' object is not iterable",
                            textwrap.dedent(
                              r"""
                                File "usercode", line \d+, in other_err
                                  if sum\(3, 5\) > 6:
                              TypeError: 'int' object is not iterable
                              """
                            ))

    self.assertFormulaError(self.engine.get_formula_error('Math', 'custom_err', 3),
                            Exception, "hello")


  def test_lookup_state(self):
    # Bug https://phab.getgrist.com/T297 was caused by lookup maps getting corrupted while
    # re-evaluating a formula for the sake of getting error details. This test case reproduces the
    # bug in the old code and verifies that it is fixed.
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "LookupTest", [
          [11, "A", "Numeric",  False, "", "", ""],
          [12, "B", "Text",     True, "LookupTest.lookupOne(A=2).x.upper()", "", ""],
        ]]
      ],
      "DATA": {
        "LookupTest": [
          ["id", "A"],
          [7,    2],
        ]
      }
    })

    self.load_sample(sample)
    self.assertTableData('LookupTest', data=[
      ['id', 'A', 'B'],
      [ 7,   2.,  objtypes.RaisedException(AttributeError())],
    ])

    # Updating a dependency shouldn't cause problems.
    self.update_record('LookupTest', 7, A=3)
    self.assertTableData('LookupTest', data=[
      ['id', 'A', 'B'],
      [ 7,   3.,  objtypes.RaisedException(AttributeError())],
    ])

    # Fetch the error details.
    self.assertFormulaError(self.engine.get_formula_error('LookupTest', 'B', 7),
                            AttributeError, "Table 'LookupTest' has no column 'x'")

    # Updating a dependency after the fetch used to cause the error
    # "AttributeError: 'Table' object has no attribute 'col_id'". Check that it's fixed.
    self.update_record('LookupTest', 7, A=2)    # Should NOT raise an exception.
    self.assertTableData('LookupTest', data=[
      ['id', 'A', 'B'],
      [ 7,   2.,  objtypes.RaisedException(AttributeError())],
    ])

    # Add the column that will fix the attribute error.
    self.add_column('LookupTest', 'x', type='Text')
    self.assertTableData('LookupTest', data=[
      ['id', 'A', 'x', 'B'],
      [ 7,   2.,  '',  '' ],
    ])

    # And check that the dependency still works and is recomputed.
    self.update_record('LookupTest', 7, x='hello')
    self.assertTableData('LookupTest', data=[
      ['id', 'A', 'x',      'B'],
      [ 7,   2.,  'hello',  'HELLO'],
    ])
    self.update_record('LookupTest', 7, A=3)
    self.assertTableData('LookupTest', data=[
      ['id', 'A', 'x',      'B'],
      [ 7,   3.,  'hello',  ''],
    ])

  def test_undo_side_effects(self):
    # Ensures that side-effects (i.e. generated doc actions) produced while evaluating
    # get_formula_errors() get reverted.
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Address", [
          [11, "city",        "Text",       False, "", "", ""],
          [12, "state",       "Text",       False, "", "", ""],
        ]],
        [2, "Foo", [
          # Note: the formula below is a terrible example of a formula, which intentionally
          # creates a new record every time it evaluates.
          [21, "B",           "Any",        True,
            "Address.lookupOrAddDerived(city=str(len(Address.all)))", "", ""],
        ]]
      ],
      "DATA": {
        "Foo": [["id"], [1]]
      }
    })

    self.load_sample(sample)
    self.assertTableData('Address', data=[
      ['id',  'city', 'state'],
      [1,     '0',      ''],
    ])
    # Note that evaluating the formula again would add a new record (Address[2]), but when done as
    # part of get_formula_error(), that action gets undone.
    self.assertEqual(str(self.engine.get_formula_error('Foo', 'B', 1)), "Address[2]")
    self.assertTableData('Address', data=[
      ['id',  'city', 'state'],
      [1,     '0',      ''],
    ])

  def test_formula_reading_from_an_errored_formula(self):
    # There was a bug whereby if one formula (call it D) referred to
    # another (call it T), and that other formula was in error, the
    # error values of that second formula would not be passed on the
    # client as a BulkUpdateRecord.  The bug was dependent on order of
    # evaluation of columns.  D would be evaluated first, and evaluate
    # T in a nested way.  When evaluating T, a BulkUpdateRecord would
    # be prepared correctly, and when popping back to evaluate D,
    # the BulkUpdateRecord for D would be prepared correctly, but since
    # D was an error, any nested actions would be reverted (this is
    # logic related to undoing potential side-effects on failure).

    # First, set up a table with a sequence in A, a formula to do cumulative sums in T,
    # and a formula D to copy T.
    formula = "recs = UpdateTest.lookupRecords()\nsum(r.A for r in recs if r.A <= $A)"
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "UpdateTest", [
          [20, "A", "Numeric",  False, "", "", ""],
          [21, "T", "Numeric",  True, formula, "", ""],
          [22, "D", "Numeric",  True, "$T", "", ""],
        ]]
      ],
      "DATA": {
        "UpdateTest": [
          ["id", "A"],
          [1,    1],
          [2,    2],
          [3,    3],
        ]
      }
    })

    # Check the setup is working correctly.
    self.load_sample(sample)
    self.assertTableData('UpdateTest', data=[
      ['id', 'A', 'T', 'D'],
      [ 1,   1.,  1., 1.],
      [ 2,   2.,  3., 3.],
      [ 3,   3.,  6., 6.],
    ])

    # Now rename the data column.  This rename results in a partial
    # update to the T formula that leaves it broken (not all the As are caught).
    out_actions = self.apply_user_action(["RenameColumn", "UpdateTest", "A", "AA"])

    # Make sure the we have bulk updates for both T and D, and not just D.
    err = ["E", "AttributeError"]
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "UpdateTest", "A", "AA"],
      ["ModifyColumn", "UpdateTest", "T", {
        "formula": "recs = UpdateTest.lookupRecords()\nsum(r.A for r in recs if r.A <= $AA)"}
      ],
      ["BulkUpdateRecord", "_grist_Tables_column", [20, 21], {
        "colId": ["AA", "T"],
        "formula": ["", "recs = UpdateTest.lookupRecords()\nsum(r.A for r in recs if r.A <= $AA)"]}
      ],
      [
        "BulkUpdateRecord", "UpdateTest", [1, 2, 3], {
          "D": [err, err, err]
        }
      ],
      [
        "BulkUpdateRecord", "UpdateTest", [1, 2, 3], {
          "T": [err, err, err]
        }
      ],
    ]})

    # Make sure the table is in the correct state.
    errVal = objtypes.RaisedException(AttributeError())
    self.assertTableData('UpdateTest', data=[
      ['id', 'AA', 'T', 'D'],
      [ 1,   1., errVal, errVal],
      [ 2,   2., errVal, errVal],
      [ 3,   3., errVal, errVal],
    ])

  def test_undo_side_effects_with_reordering(self):
    # As for test_undo_side_effects, but now after creating a row in a
    # formula we try to access a cell that hasn't been recomputed yet.
    # That will result in the formula evalution being abandoned, the
    # desired cell being calculated, then the formula being retried.
    # All going well, we should end up with one row, not two.
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Address", [
          [11, "city",        "Text",       False, "", "", ""],
          [12, "state",       "Text",       False, "", "", ""],
        ]],
        [2, "Foo", [
          # Note: the formula below is a terrible example of a formula, which intentionally
          # creates a new record every time it evaluates.
          [21, "B",           "Any",        True,
            "Address.lookupOrAddDerived(city=str(len(Address.all)))\nreturn $C", "", ""],
          [22, "C",           "Numeric",    True, "42", "", ""],
        ]]
      ],
      "DATA": {
        "Foo": [["id"], [1]]
      }
    })

    self.load_sample(sample)
    self.assertTableData('Address', data=[
      ['id',  'city', 'state'],
      [1,     '0',      ''],
    ])

  def test_attribute_error(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "AttrTest", [
          [30, "A", "Numeric",  False, "", "", ""],
          [31, "B", "Numeric",  True, "$AA", "", ""],
          [32, "C", "Numeric",  True, "$B", "", ""],
        ]]
      ],
      "DATA": {
        "AttrTest": [
          ["id", "A"],
          [1,    1],
          [2,    2],
        ]
      }
    })

    self.load_sample(sample)
    errVal = objtypes.RaisedException(AttributeError())
    self.assertTableData('AttrTest', data=[
      ['id',  'A', 'B', 'C'],
      [1, 1, errVal, errVal],
      [2, 2, errVal, errVal],
    ])

    self.assertFormulaError(self.engine.get_formula_error('AttrTest', 'B', 1),
                            AttributeError, "Table 'AttrTest' has no column 'AA'",
                            r"AttributeError: Table 'AttrTest' has no column 'AA'")
    cell_error = self.engine.get_formula_error('AttrTest', 'C', 1)
    self.assertFormulaError(cell_error,
                            objtypes.CellError, "AttributeError in referenced cell AttrTest[1].B",
                            r"CellError: AttributeError in referenced cell AttrTest\[1\].B")
    self.assertEqual(
      objtypes.encode_object(cell_error),
      ['E',
       'AttributeError',
       "Table 'AttrTest' has no column 'AA'\n"
       "(in referenced cell AttrTest[1].B)",
       cell_error.details]
    )

  def test_cumulative_formula(self):
    formula = ("Table1.lookupOne(A=$A-1).Principal + Table1.lookupOne(A=$A-1).Interest " +
               "if $A > 1 else 1000")
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [30, "A", "Numeric",  False, "", "", ""],
          [31, "Principal", "Numeric",  True, formula, "", ""],
          [32, "Interest", "Numeric",  True, "int($Principal * 0.1)", "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [
          ["id", "A"],
          [1,    1],
          [2,    2],
          [3,    3],
          [4,    4],
          [5,    5],
        ]
      }
    })

    self.load_sample(sample)
    self.assertTableData('Table1', data=[
      ['id', 'A', 'Principal', 'Interest'],
      [ 1,   1,    1000.0, 100.0],
      [ 2,   2,    1100.0, 110.0],
      [ 3,   3,    1210.0, 121.0],
      [ 4,   4,    1331.0, 133.0],
      [ 5,   5,    1464.0, 146.0],
    ])

    self.update_records('Table1', ['id', 'A'], [
      [1, 5], [2, 3], [3, 4], [4, 2], [5, 1]
    ])

    self.assertTableData('Table1', data=[
      ['id', 'A', 'Principal', 'Interest'],
      [ 1,   5,    1464.0, 146.0],
      [ 2,   3,    1210.0, 121.0],
      [ 3,   4,    1331.0, 133.0],
      [ 4,   2,    1100.0, 110.0],
      [ 5,   1,    1000.0, 100.0],
    ])

  def test_trivial_cycle(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [31, "A", "Numeric", False, "", "", ""],
          [31, "B", "Numeric",  True, "$B", "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [
          ["id", "A"],
          [1,    1],
          [2,    2],
          [3,    3],
        ]
      }
    })

    self.load_sample(sample)
    circle = objtypes.RaisedException(depend.CircularRefError())
    self.assertTableData('Table1', data=[
      ['id', 'A',  'B'],
      [ 1,   1,    circle],
      [ 2,   2,    circle],
      [ 3,   3,    circle],
    ])

  def test_cycle(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [30, "A", "Numeric",  False, "", "", ""],
          [31, "Principal", "Numeric",  True, "$Interest", "", ""],
          [32, "Interest", "Numeric",  True, "$Principal", "", ""],
          [33, "A2", "Numeric",  True, "$A", "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [
          ["id", "A"],
          [1,    1],
          [2,    2],
          [3,    3],
        ]
      }
    })

    self.load_sample(sample)
    circle = objtypes.RaisedException(depend.CircularRefError())
    self.assertTableData('Table1', data=[
      ['id', 'A', 'Principal', 'Interest', 'A2'],
      [ 1,   1,    circle,      circle,     1],
      [ 2,   2,    circle,      circle,     2],
      [ 3,   3,    circle,      circle,     3],
    ])

  def test_cycle_and_copy(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [31, "A", "Numeric", False, "", "", ""],
          [31, "B", "Numeric",  True, "$C", "", ""],
          [32, "C", "Numeric",  True, "$C", "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [
          ["id", "A"],
          [1,    1],
          [2,    2],
          [3,    3],
        ]
      }
    })

    self.load_sample(sample)
    circle = objtypes.RaisedException(depend.CircularRefError())
    self.assertTableData('Table1', data=[
      ['id', 'A',  'B',         'C'],
      [ 1,   1,    circle,      circle],
      [ 2,   2,    circle,      circle],
      [ 3,   3,    circle,      circle],
    ])

  def test_cycle_and_reference(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [2, "ATable", [
          [32, "A", "Ref:ZTable", False, "", "", ""],
          [33, "B", "Numeric",  True, "$A.B", "", ""],
        ]],
        [1, "ZTable", [
          [31, "A", "Numeric", False, "", "", ""],
          [31, "B", "Numeric",  True, "$B", "", ""],
        ]],
      ],
      "DATA": {
        "ATable": [
          ["id", "A"],
          [1,    1],
          [2,    2],
          [3,    3],
        ],
        "ZTable": [
          ["id", "A"],
          [1,    6],
          [2,    7],
          [3,    8],
        ]
      }
    })

    self.load_sample(sample)
    circle = objtypes.RaisedException(depend.CircularRefError())
    self.assertTableData('ATable', data=[
      ['id', 'A',  'B'],
      [ 1,   1,    circle],
      [ 2,   2,    circle],
      [ 3,   3,    circle],
    ])
    self.assertTableData('ZTable', data=[
      ['id', 'A',  'B'],
      [ 1,   6,    circle],
      [ 2,   7,    circle],
      [ 3,   8,    circle],
    ])

  def test_cumulative_efficiency(self):
    # Make sure cumulative formula evaluation doesn't fall over after more than a few rows.
    top = 250
    # Compute compound interest in ascending order of A
    formula = ("Table1.lookupOne(A=$A-1).Principal + Table1.lookupOne(A=$A-1).Interest " +
               "if $A > 1 else 1000")
    # Compute compound interest in descending order of A
    rformula = ("Table1.lookupOne(A=$A+1).RPrincipal + Table1.lookupOne(A=$A+1).RInterest " +
                "if $A < %d else 1000" % top)

    rows = [["id", "A"]]
    for i in range(1, top + 1):
      rows.append([i, i])
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [30, "A", "Numeric",  False, "", "", ""],
          [31, "Principal", "Numeric",  True, formula, "", ""],
          [32, "Interest", "Numeric",  True, "int($Principal * 0.1)", "", ""],
          [33, "RPrincipal", "Numeric",  True, rformula, "", ""],
          [34, "RInterest", "Numeric",  True, "int($RPrincipal * 0.1)", "", ""],
          [35, "Total", "Numeric", True, "$Principal + $RPrincipal", "", ""],
        ]],
        [2, "Readout", [
          [36, "LastPrincipal", "Numeric", True, "Table1.lookupOne(A=%d).Principal" % top, "", ""],
          [37, "LastRPrincipal", "Numeric", True, "Table1.lookupOne(A=1).RPrincipal", "", ""],
          [38, "FirstTotal", "Numeric", True, "Table1.lookupOne(A=1).Total", "", ""],
          [39, "LastTotal", "Numeric", True, "Table1.lookupOne(A=%d).Total" % top, "", ""],
        ]]
      ],
      "DATA": {
        "Table1": rows,
        "Readout": [["id"], [1]],
      }
    })

    self.load_sample(sample)
    principal = 20213227788876.0
    self.assertTableData('Readout', data=[
      ['id', 'LastPrincipal', 'LastRPrincipal', 'FirstTotal', 'LastTotal'],
      [1, principal, principal, principal + 1000, principal + 1000],
    ])

  def test_cumulative_formula_with_references(self):
    top = 100
    formula = "max($Prev.Principal + $Prev.Interest, 1000)"
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [41, "Prev", "Ref:Table1", True, "$id - 1", "", ""],
          [42, "Principal", "Numeric",  True, formula, "", ""],
          [43, "Interest", "Numeric",  True, "int($Principal * 0.1)", "", ""],
        ]],
        [2, "Readout", [
          [46, "LastPrincipal", "Numeric", True, "Table1.lookupOne(id=%d).Principal" % top, "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [["id"]] + [[r] for r in range(1, top + 1)],
        "Readout": [["id"], [1]],
     }
    })

    self.load_sample(sample)
    self.assertTableData('Readout', data=[
      ['id', 'LastPrincipal'],
      [1,  12494908.0],
    ])

    self.modify_column("Table1", "Prev", formula="$id - 1 if $id > 1 else 100")
    self.assertTableData('Readout', data=[
      ['id', 'LastPrincipal'],
      [1, objtypes.RaisedException(depend.CircularRefError())],
    ])

  def test_catch_all_in_formula(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [51, "A", "Numeric",  False, "", "", ""],
          [52, "B1", "Numeric",  True, "try:\n  return $A+$C\nexcept:\n  return 42", "", ""],
          [53, "B2", "Numeric",  True, "try:\n  return $D+None\nexcept:\n  return 42", "", ""],
          [54, "B3", "Numeric",  True, "try:\n  return $A+$B4+$D\nexcept:\n  return 42", "", ""],
          [55, "B4", "Numeric",  True, "try:\n  return $A+$B3+$D\nexcept:\n  return 42", "", ""],
          [56, "B5", "Numeric",  True,
           "try:\n  return $E+1\nexcept:\n  raise Exception('monkeys!')", "", ""],
          [56, "B6", "Numeric",  True,
           "try:\n  return $F+1\nexcept Exception as e:\n  e.node = e.row_id = 'monkey'", "", ""],
          [57, "C", "Numeric",  False, "", "", ""],
          [58, "D", "Numeric",   True, "$A", "", ""],
          [59, "E", "Numeric",   True, "$A", "", ""],
          [59, "F", "Numeric",   True, "$A", "", ""],
        ]],
      ],
      "DATA": {
        "Table1": [["id", "A", "C"], [1, 1, 2], [2, 20, 10]],
     }
    })
    self.load_sample(sample)
    circle = objtypes.RaisedException(depend.CircularRefError())
    # B4 is a subtle case.  B3 and B4 refer to each other.  B3 is recomputed first,
    # and cells evaluate to a CircularRefError.  Now B3 has a value, so B4 can be
    # evaluated, and results in 42 when addition of an integer and an exception value
    # fails.
    self.assertTableData('Table1', data=[
      ['id', 'A', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'C', 'D', 'E', 'F'],
      [1,     1,   3,    42, circle, 42,    2,    2,   2,   1,   1,   1],
      [2,    20,  30,    42, circle, 42,   21,   21,  10,  20,  20,  20],
    ])

  def test_reference_column(self):
    # There was a bug where self-references could result in a column being prematurely
    # considered complete.
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [40, "Ident", "Text", False, "", "", ""],
          [41, "Prev", "Ref:Table1", False, "", "", ""],
          [42, "Calc", "Numeric", True, "$Prev.Calc * 1.5 if $Prev else 1", "", ""]
        ]]],
        "DATA": {
          "Table1": [
            ['id', 'Ident', 'Prev'],
            [1, 'a', 0],
            [2, 'b', 1],
            [3, 'c', 4],
            [4, 'd', 0],
          ]
        }
    })
    self.load_sample(sample)
    self.assertTableData('Table1', data=[
      ['id', 'Ident', 'Prev', 'Calc'],
      [1, 'a', 0, 1.0],
      [2, 'b', 1, 1.5],
      [3, 'c', 4, 1.5],
      [4, 'd', 0, 1.0]
    ])

  def test_loop(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [31, "A", "Numeric", False, "", "", ""],
          [31, "B", "Numeric",  True, "$C", "", ""],
          [32, "C", "Numeric",  True, "$B", "", ""],
        ]]
      ],
      "DATA": {
        "Table1": [
          ["id", "A"],
          [1,    1],
          [2,    2],
          [3,    3],
        ]
      }
    })

    self.load_sample(sample)
    circle = objtypes.RaisedException(depend.CircularRefError())
    self.assertTableData('Table1', data=[
      ['id', 'A',  'B',         'C'],
      [ 1,   1,    circle,      circle],
      [ 2,   2,    circle,      circle],
      [ 3,   3,    circle,      circle],
    ])
