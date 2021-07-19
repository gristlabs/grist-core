"""
Test of Summary tables grouped by ChoiceList columns.
"""
import column
import logger
import lookup
import testutil
from test_engine import EngineTestCase, Table, Column

log = logger.Logger(__name__, logger.INFO)


class TestSummaryChoiceList(EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Source", [
        [10, "other", "Text", False, "", "other", ""],
        [11, "choices1", "ChoiceList", False, "", "choices1", ""],
        [12, "choices2", "ChoiceList", False, "", "choices2", ""],
      ]]
    ],
    "DATA": {
      "Source": [
        ["id", "choices1", "choices2", "other"],
        [21, ["a", "b"], ["c", "d"], "foo"],
      ]
    }
  })

  starting_table = Table(1, "Source", primaryViewId=0, summarySourceTable=0, columns=[
    Column(10, "other", "Text", isFormula=False, formula="", summarySourceCol=0),
    Column(11, "choices1", "ChoiceList", isFormula=False, formula="", summarySourceCol=0),
    Column(12, "choices2", "ChoiceList", isFormula=False, formula="", summarySourceCol=0),
  ])

  # ----------------------------------------------------------------------

  def test_create_view_section(self):
    self.load_sample(self.sample)

    # Verify the starting table; there should be no views yet.
    self.assertTables([self.starting_table])
    self.assertViews([])

    # Create a summary section, grouped by the "choices1" column.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11]])

    summary_table1 = Table(
      2, "GristSummary_6_Source", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(13, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=11),
        Column(14, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(15, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    # Create another summary section, grouped by both choicelist columns.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11, 12]])

    summary_table2 = Table(
      3, "GristSummary_6_Source2", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(16, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=11),
        Column(17, "choices2", "Choice", isFormula=False, formula="", summarySourceCol=12),
        Column(18, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(19, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    # Create another summary section, grouped by the non-choicelist column
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [10]])

    summary_table3 = Table(
      4, "GristSummary_6_Source3", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(20, "other", "Text", isFormula=False, formula="", summarySourceCol=10),
        Column(21, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(22, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    # Create another summary section, grouped by the non-choicelist column and choices1
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [10, 11]])

    summary_table4 = Table(
      5, "GristSummary_6_Source4", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(23, "other", "Text", isFormula=False, formula="", summarySourceCol=10),
        Column(24, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=11),
        Column(25, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(26, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    self.assertTables(
      [self.starting_table, summary_table1, summary_table2, summary_table3, summary_table4]
    )

    # Verify the summarized data.
    self.assertTableData('GristSummary_6_Source', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [21], 1],
      [2, "b", [21], 1],
    ])

    self.assertTableData('GristSummary_6_Source2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [21], 1],
      [2, "a", "d", [21], 1],
      [3, "b", "c", [21], 1],
      [4, "b", "d", [21], 1],
    ])

    self.assertTableData('GristSummary_6_Source3', data=[
      ["id", "other", "group", "count"],
      [1, "foo", [21], 1],
    ])

    self.assertTableData('GristSummary_6_Source4', data=[
      ["id", "other", "choices1", "group", "count"],
      [1, "foo", "a", [21], 1],
      [2, "foo", "b", [21], 1],
    ])

    # Verify the optimisation works for the table without choicelists
    self.assertIs(self.engine.tables["Source"]._summary_simple, None)
    self.assertIs(self.engine.tables["GristSummary_6_Source"]._summary_simple, False)
    self.assertIs(self.engine.tables["GristSummary_6_Source2"]._summary_simple, False)
    # simple summary and lookup
    self.assertIs(self.engine.tables["GristSummary_6_Source3"]._summary_simple, True)
    self.assertIs(self.engine.tables["GristSummary_6_Source4"]._summary_simple, False)

    self.assertEqual(
      {k: type(v) for k, v in self.engine.tables["Source"]._special_cols.items()},
      {
        '#summary#GristSummary_6_Source': column.ReferenceListColumn,
        "#lookup#CONTAINS(value='#summary#GristSummary_6_Source')":
          lookup.ContainsLookupMapColumn,
        '#summary#GristSummary_6_Source2': column.ReferenceListColumn,
        "#lookup#CONTAINS(value='#summary#GristSummary_6_Source2')":
          lookup.ContainsLookupMapColumn,

        # simple summary and lookup
        '#summary#GristSummary_6_Source3': column.ReferenceColumn,
        '#lookup##summary#GristSummary_6_Source3': lookup.SimpleLookupMapColumn,

        '#summary#GristSummary_6_Source4': column.ReferenceListColumn,
        "#lookup#CONTAINS(value='#summary#GristSummary_6_Source4')":
          lookup.ContainsLookupMapColumn,
      }
    )

    # Remove 'b' from choices1
    self.update_record("Source", 21, choices1=["L", "a"])

    self.assertTableData('Source', data=[
      ["id", "choices1", "choices2", "other"],
      [21, ["a"], ["c", "d"], "foo"],
    ])

    # Verify that the summary table rows containing 'b' are empty
    self.assertTableData('GristSummary_6_Source', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [21], 1],
      [2, "b", [], 0],
    ])

    self.assertTableData('GristSummary_6_Source2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [21], 1],
      [2, "a", "d", [21], 1],
      [3, "b", "c", [], 0],
      [4, "b", "d", [], 0],
    ])

    # Add 'e' to choices2
    self.update_record("Source", 21, choices2=["L", "c", "d", "e"])

    # First summary table unaffected
    self.assertTableData('GristSummary_6_Source', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [21], 1],
      [2, "b", [], 0],
    ])

    # New row added for 'e'
    self.assertTableData('GristSummary_6_Source2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [21], 1],
      [2, "a", "d", [21], 1],
      [3, "b", "c", [], 0],
      [4, "b", "d", [], 0],
      [5, "a", "e", [21], 1],
    ])

    # Remove record from source
    self.remove_record("Source", 21)

    # All summary rows are now empty
    self.assertTableData('GristSummary_6_Source', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [], 0],
      [2, "b", [], 0],
    ])

    self.assertTableData('GristSummary_6_Source2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [], 0],
      [2, "a", "d", [], 0],
      [3, "b", "c", [], 0],
      [4, "b", "d", [], 0],
      [5, "a", "e", [], 0],
    ])

    # Make rows with every combination of {a,b,ab} and {c,d,cd}
    self.add_records(
      'Source',
      ["id", "choices1",       "choices2"],
      [
        [101, ["L", "a"],      ["L", "c"]],
        [102, ["L", "b"],      ["L", "c"]],
        [103, ["L", "a", "b"], ["L", "c"]],
        [104, ["L", "a"],      ["L", "d"]],
        [105, ["L", "b"],      ["L", "d"]],
        [106, ["L", "a", "b"], ["L", "d"]],
        [107, ["L", "a"],      ["L", "c", "d"]],
        [108, ["L", "b"],      ["L", "c", "d"]],
        [109, ["L", "a", "b"], ["L", "c", "d"]],
      ]
    )

    self.assertTableData('Source', cols="subset", data=[
      ["id", "choices1", "choices2"],
      [101, ["a"],      ["c"]],
      [102, ["b"],      ["c"]],
      [103, ["a", "b"], ["c"]],
      [104, ["a"],      ["d"]],
      [105, ["b"],      ["d"]],
      [106, ["a", "b"], ["d"]],
      [107, ["a"],      ["c", "d"]],
      [108, ["b"],      ["c", "d"]],
      [109, ["a", "b"], ["c", "d"]],
    ])

    # Summary tables now have an even distribution of combinations
    self.assertTableData('GristSummary_6_Source', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [101, 103, 104, 106, 107, 109], 6],
      [2, "b", [102, 103, 105, 106, 108, 109], 6],
    ])

    self.assertTableData('GristSummary_6_Source2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [101, 103, 107, 109], 4],
      [2, "a", "d", [104, 106, 107, 109], 4],
      [3, "b", "c", [102, 103, 108, 109], 4],
      [4, "b", "d", [105, 106, 108, 109], 4],
      [5, "a", "e", [], 0],
    ])
