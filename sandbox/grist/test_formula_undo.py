# pylint: disable=line-too-long
import testsamples
import test_engine
from objtypes import RecordSetStub


class TestFormulaUndo(test_engine.EngineTestCase):
  def setUp(self):
    super(TestFormulaUndo, self).setUp()

  def test_change_and_undo(self):
    self.load_sample(testsamples.sample_students)

    # Test that regular lookup results behave well on undo.
    self.apply_user_action(['ModifyColumn', 'Students', 'schoolCities', {
      "type": "Any",
      "formula": "Schools.lookupRecords(name=$schoolName)"
    }])

    # Add a formula that produces different results on different invocations. This is
    # similar to some realistic scenarious (such as returning a time, a rich python object, or a
    # string like "<Foo at 0xfe65d350>"), but is convoluted to keep values deterministic.
    self.apply_user_action(['AddColumn', 'Students', 'counter', {
      "formula": """
table.my_counter = getattr(table, 'my_counter', 0) + 1
return '#%s %s' % (table.my_counter, $schoolName)
"""
    }])

    self.assertTableData("Students", cols="subset", data=[
      ["id", "schoolName", "schoolCities",                   "counter"     ],
      [1,    "Columbia",   RecordSetStub("Schools", [1, 2]), "#1 Columbia",],
      [2,    "Yale",       RecordSetStub("Schools", [3, 4]), "#2 Yale",    ],
      [3,    "Columbia",   RecordSetStub("Schools", [1, 2]), "#3 Columbia",],
      [4,    "Yale",       RecordSetStub("Schools", [3, 4]), "#4 Yale",    ],
      [5,    "Eureka",     RecordSetStub("Schools", []),     "#5 Eureka",  ],
      [6,    "Yale",       RecordSetStub("Schools", [3, 4]), "#6 Yale",    ],
    ])

    # Applying an action produces expected changes to all formula columns, and corresponding undos.
    out_actions = self.apply_user_action(['UpdateRecord', 'Students', 6, {"schoolName": "Columbia"}])
    self.assertOutActions(out_actions, {
      "stored": [
        ["UpdateRecord", "Students", 6, {"schoolName": "Columbia"}],
        ["UpdateRecord", "Students", 6, {"counter": "#7 Columbia"}],
        ["UpdateRecord", "Students", 6, {"schoolCities": ["r", "Schools", [1, 2]]}],
        ["UpdateRecord", "Students", 6, {"schoolIds": "1:2"}],
      ],
      "direct": [True, False, False, False],
      "undo": [
        ["UpdateRecord", "Students", 6, {"schoolName": "Yale"}],
        ["UpdateRecord", "Students", 6, {"counter": "#6 Yale"}],
        ["UpdateRecord", "Students", 6, {"schoolCities": ["r", "Schools", [3, 4]]}],
        ["UpdateRecord", "Students", 6, {"schoolIds": "3:4"}],
      ],
    })

    # Applying the undo actions (which include calculated values) will trigger recalculations, but
    # they should not produce extraneous actions even when the calculation results differ.
    out_actions = self.apply_user_action(['ApplyUndoActions', out_actions.get_repr()["undo"]])

    # TODO Note the double update when applying undo to non-deterministic formula. It would be
    # nice to fix, but requires further refactoring (perhaps moving towards processing actions
    # using summaries).
    self.assertOutActions(out_actions, {
      "stored": [
        ["UpdateRecord", "Students", 6, {"schoolIds": "3:4"}],
        ["UpdateRecord", "Students", 6, {"schoolCities": ["r", "Schools", [3, 4]]}],
        ["UpdateRecord", "Students", 6, {"counter": "#6 Yale"}],
        ["UpdateRecord", "Students", 6, {"schoolName": "Yale"}],
        ["UpdateRecord", "Students", 6, {"counter": "#8 Yale"}],
      ],
      "direct": [True, True, True, True, False],  # undos currently fully direct; formula update is indirect.
      "undo": [
        ["UpdateRecord", "Students", 6, {"schoolIds": "1:2"}],
        ["UpdateRecord", "Students", 6, {"schoolCities": ["r", "Schools", [1, 2]]}],
        ["UpdateRecord", "Students", 6, {"counter": "#7 Columbia"}],
        ["UpdateRecord", "Students", 6, {"schoolName": "Columbia"}],
        ["UpdateRecord", "Students", 6, {"counter": "#6 Yale"}],
      ],
    })

    self.assertTableData("Students", cols="subset", data=[
      ["id", "schoolName", "schoolCities",                    "counter" ],
      [1,    "Columbia",   RecordSetStub("Schools", [1, 2]),  "#1 Columbia"],
      [2,    "Yale",       RecordSetStub("Schools", [3, 4]),  "#2 Yale",   ],
      [3,    "Columbia",   RecordSetStub("Schools", [1, 2]),  "#3 Columbia"],
      [4,    "Yale",       RecordSetStub("Schools", [3, 4]),  "#4 Yale",   ],
      [5,    "Eureka",     RecordSetStub("Schools", []),      "#5 Eureka", ],

      # This counter got updated
      [6,    "Yale",       RecordSetStub("Schools", [3, 4]),  "#8 Yale",   ],
    ])

  def test_save_to_empty_column(self):
    # When we enter data into an empty column, it gets turned from a formula into a data column.
    # Check that this operation works.
    self.load_sample(testsamples.sample_students)
    self.apply_user_action(['AddColumn', 'Students', 'newCol', {"isFormula": True}])

    out_actions = self.apply_user_action(['UpdateRecord', 'Students', 6, {"newCol": "Boo!"}])
    self.assertTableData("Students", cols="subset", data=[
      ["id", "schoolName", "newCol" ],
      [1,    "Columbia",   ""       ],
      [2,    "Yale",       ""       ],
      [3,    "Columbia",   ""       ],
      [4,    "Yale",       ""       ],
      [5,    "Eureka",     ""       ],
      [6,    "Yale",       "Boo!"   ],
    ])

    # Check that the actions look reasonable.
    self.assertOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Students", "newCol", {"type": "Text"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Text"}],
        ["ModifyColumn", "Students", "newCol", {"isFormula": False}],
        ["BulkUpdateRecord", "Students", [1,2,3,4,5,6], {"newCol": ["", "", "", "", "", ""]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"isFormula": False}],
        ["UpdateRecord", "Students", 6, {"newCol": "Boo!"}],
      ],
      "direct": [False, False, False, False, False, True],
      "undo": [
        ["ModifyColumn", "Students", "newCol", {"type": "Any"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Any"}],
        ["BulkUpdateRecord", "Students", [1,2,3,4,5,6], {"newCol": [None, None, None, None, None, None]}],
        ["ModifyColumn", "Students", "newCol", {"isFormula": True}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"isFormula": True}],
        ["UpdateRecord", "Students", 6, {"newCol": ""}],
      ]
    })

    out_actions = self.apply_user_action(['ApplyUndoActions', out_actions.get_repr()["undo"]])
    self.assertTableData("Students", cols="subset", data=[
      ["id", "schoolName", "newCol" ],
      [1,    "Columbia",   None ],
      [2,    "Yale",       None ],
      [3,    "Columbia",   None ],
      [4,    "Yale",       None ],
      [5,    "Eureka",     None ],
      [6,    "Yale",       None ],
    ])

    # Check that undo actions are a reversal of the above, without any surprises.
    self.assertOutActions(out_actions, {
      "stored": [
        ["UpdateRecord", "Students", 6, {"newCol": ""}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"isFormula": True}],
        ["ModifyColumn", "Students", "newCol", {"isFormula": True}],
        ["BulkUpdateRecord", "Students", [1,2,3,4,5,6], {"newCol": [None, None, None, None, None, None]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Any"}],
        ["ModifyColumn", "Students", "newCol", {"type": "Any"}],
      ],
      "direct": [True, True, True, True, True, True],  # undos are currently fully direct.
      "undo": [
        ["UpdateRecord", "Students", 6, {"newCol": "Boo!"}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"isFormula": False}],
        ["ModifyColumn", "Students", "newCol", {"isFormula": False}],
        ["BulkUpdateRecord", "Students", [1,2,3,4,5,6], {"newCol": ["", "", "", "", "", ""]}],
        ["UpdateRecord", "_grist_Tables_column", 22, {"type": "Text"}],
        ["ModifyColumn", "Students", "newCol", {"type": "Text"}],
      ]
    })
