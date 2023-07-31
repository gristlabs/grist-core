# pylint: disable=line-too-long
"""
Test of Summary tables grouped by ChoiceList columns.
"""
import logging
import column
import lookup
import testutil
from test_engine import EngineTestCase, Table, Column, test_undo

log = logging.getLogger(__name__)


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

  @test_undo
  def test_summary_by_choice_list(self):
    self.load_sample(self.sample)

    # Verify the starting table; there should be no views yet.
    self.assertTables([self.starting_table])
    self.assertViews([])

    # Create a summary section, grouped by the "choices1" column.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11], None])

    summary_table1 = Table(
      2, "Source_summary_choices1", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(13, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=11),
        Column(14, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(15, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    # Create another summary section, grouped by both choicelist columns.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11, 12], None])

    summary_table2 = Table(
      3, "Source_summary_choices1_choices2", primaryViewId=0, summarySourceTable=1,
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
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [10], None])

    summary_table3 = Table(
      4, "Source_summary_other", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(20, "other", "Text", isFormula=False, formula="", summarySourceCol=10),
        Column(21, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(22, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    # Create another summary section, grouped by the non-choicelist column and choices1
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [10, 11], None])

    summary_table4 = Table(
      5, "Source_summary_choices1_other", primaryViewId=0, summarySourceTable=1,
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
    self.assertTableData('Source_summary_choices1', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [21], 1],
      [2, "b", [21], 1],
    ])

    self.assertTableData('Source_summary_choices1_choices2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [21], 1],
      [2, "a", "d", [21], 1],
      [3, "b", "c", [21], 1],
      [4, "b", "d", [21], 1],
    ])

    self.assertTableData('Source_summary_other', data=[
      ["id", "other", "group", "count"],
      [1, "foo", [21], 1],
    ])

    self.assertTableData('Source_summary_choices1_other', data=[
      ["id", "other", "choices1", "group", "count"],
      [1, "foo", "a", [21], 1],
      [2, "foo", "b", [21], 1],
    ])

    # Verify the optimisation works for the table without choicelists
    self.assertIs(self.engine.tables["Source"]._summary_simple, None)
    self.assertIs(self.engine.tables["Source_summary_choices1"]._summary_simple, False)
    self.assertIs(self.engine.tables["Source_summary_choices1_choices2"]._summary_simple, False)
    # simple summary and lookup
    self.assertIs(self.engine.tables["Source_summary_other"]._summary_simple, True)
    self.assertIs(self.engine.tables["Source_summary_choices1_other"]._summary_simple, False)

    self.assertEqual(
      {k: type(v) for k, v in self.engine.tables["Source"]._special_cols.items()},
      {
        '#summary#Source_summary_choices1': column.ReferenceListColumn,
        "#lookup#_Contains(value='#summary#Source_summary_choices1', match_empty=no_match_empty)":
          lookup.ContainsLookupMapColumn,
        '#summary#Source_summary_choices1_choices2': column.ReferenceListColumn,
        "#lookup#_Contains(value='#summary#Source_summary_choices1_choices2', "
        "match_empty=no_match_empty)":
          lookup.ContainsLookupMapColumn,

        # simple summary and lookup
        '#summary#Source_summary_other': column.ReferenceColumn,
        '#lookup##summary#Source_summary_other': lookup.SimpleLookupMapColumn,

        '#summary#Source_summary_choices1_other': column.ReferenceListColumn,
        "#lookup#_Contains(value='#summary#Source_summary_choices1_other', "
        "match_empty=no_match_empty)":
          lookup.ContainsLookupMapColumn,

        "#lookup#": lookup.SimpleLookupMapColumn,
      }
    )

    # Remove 'b' from choices1
    self.update_record("Source", 21, choices1=["L", "a"])

    self.assertTableData('Source', data=[
      ["id", "choices1", "choices2", "other"],
      [21, ["a"], ["c", "d"], "foo"],
    ])

    # Verify that the summary table rows containing 'b' are removed
    self.assertTableData('Source_summary_choices1', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [21], 1],
    ])

    self.assertTableData('Source_summary_choices1_choices2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [21], 1],
      [2, "a", "d", [21], 1],
    ])

    # Add 'e' to choices2
    self.update_record("Source", 21, choices2=["L", "c", "d", "e"])

    # First summary table unaffected
    self.assertTableData('Source_summary_choices1', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [21], 1],
    ])

    # New row added for 'e'
    self.assertTableData('Source_summary_choices1_choices2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [21], 1],
      [2, "a", "d", [21], 1],
      [3, "a", "e", [21], 1],
    ])

    # Empty choices1
    self.update_record("Source", 21, choices1=None)

    self.assertTableData('Source', data=[
      ["id", "choices1", "choices2", "other"],
      [21, None, ["c", "d", "e"], "foo"],
    ])

    self.assertTableData('Source_summary_choices1', data=[
      ["id", "choices1", "group", "count"],
      [2, "", [21], 1],
    ])

    self.assertTableData('Source_summary_choices1_choices2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [4, "", "c", [21], 1],
      [5, "", "d", [21], 1],
      [6, "", "e", [21], 1],
    ])

    # Remove record from source
    self.remove_record("Source", 21)

    # All summary rows are now empty and thus removed
    self.assertTableData('Source_summary_choices1', data=[
      ["id", "choices1", "group", "count"],
    ])

    self.assertTableData('Source_summary_choices1_choices2', data=[
      ["id", "choices1", "choices2", "group", "count"],
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
        # and one row with empty lists
        [110, ["L"],           ["L"]],
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
      [110, None,       None],
    ])

    # Summary tables now have an even distribution of combinations
    self.assertTableData('Source_summary_choices1', data=[
      ["id", "choices1", "group", "count"],
      [1, "a", [101, 103, 104, 106, 107, 109], 6],
      [2, "b", [102, 103, 105, 106, 108, 109], 6],
      [3, "",  [110], 1],
    ])

    summary_data = [
      ["id", "choices1", "choices2", "group", "count"],
      [1, "a", "c", [101, 103, 107, 109], 4],
      [2, "b", "c", [102, 103, 108, 109], 4],
      [3, "a", "d", [104, 106, 107, 109], 4],
      [4, "b", "d", [105, 106, 108, 109], 4],
      [5, "", "", [110], 1],
    ]

    self.assertTableData('Source_summary_choices1_choices2', data=summary_data)

    # Verify that "DetachSummaryViewSection" useraction works correctly.
    self.apply_user_action(["DetachSummaryViewSection", 4])

    self.assertTables([
      self.starting_table, summary_table1, summary_table3, summary_table4,
      Table(
        6, "Table1", primaryViewId=5, summarySourceTable=0,
        columns=[
          Column(27, "manualSort", "ManualSortPos", isFormula=False, formula="", summarySourceCol=0),
          Column(28, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=0),
          Column(29, "choices2", "Choice", isFormula=False, formula="", summarySourceCol=0),
          Column(30, "count", "Int", isFormula=True, summarySourceCol=0,
                 formula="len($group)"),
          Column(31, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
                 formula='Source.lookupRecords('
                         'choices1=CONTAINS($choices1, match_empty=""), '
                         'choices2=CONTAINS($choices2, match_empty=""))'),
        ],
      )
    ])

    self.assertTableData('Table1', data=summary_data, cols="subset")

  @test_undo
  def test_change_choice_to_choicelist(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Source", [
          [10, "other", "Text", False, "", "other", ""],
          [11, "choices1", "Choice", False, "", "choice", ""],
        ]]
      ],
      "DATA": {
        "Source": [
          ["id", "choices1", "other"],
          [21, "a", "foo"],
          [22, "b", "bar"],
        ]
      }
    })

    starting_table = Table(1, "Source", primaryViewId=0, summarySourceTable=0, columns=[
      Column(10, "other", "Text", isFormula=False, formula="", summarySourceCol=0),
      Column(11, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=0),
    ])

    self.load_sample(sample)

    # Verify the starting table; there should be no views yet.
    self.assertTables([starting_table])
    self.assertViews([])

    # Create a summary section, grouped by the "choices1" column.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11], None])

    summary_table = Table(
      2, "Source_summary_choices1", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(12, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=11),
        Column(13, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(14, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    data = [
      ["id", "choices1", "group", "count"],
      [1, "a", [21], 1],
      [2, "b", [22], 1],
    ]

    self.assertTables([starting_table, summary_table])
    self.assertTableData('Source_summary_choices1', data=data)

    # Change the column from Choice to ChoiceList
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 11, {"type": "ChoiceList"}])

    # Changing type in reality is a bit more complex than these actions
    # so we put the correct values in place directly
    self.apply_user_action(["BulkUpdateRecord", "Source", [21, 22],
                            {"choices1": [["L", "a"], ["L", "b"]]}])

    starting_table.columns[1] = starting_table.columns[1]._replace(type="ChoiceList")
    self.assertTables([starting_table, summary_table])
    self.assertTableData('Source_summary_choices1', data=data)

  @test_undo
  def test_rename_choices(self):
    self.load_sample(self.sample)

    # Create a summary section, grouped by both choicelist columns.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11, 12], None])

    summary_table = Table(
      2, "Source_summary_choices1_choices2", primaryViewId=0, summarySourceTable=1,
      columns=[
        Column(13, "choices1", "Choice", isFormula=False, formula="", summarySourceCol=11),
        Column(14, "choices2", "Choice", isFormula=False, formula="", summarySourceCol=12),
        Column(15, "group", "RefList:Source", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(16, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
      ],
    )

    self.assertTables([self.starting_table, summary_table])

    # Rename all the choices
    out_actions = self.apply_user_action(
      ["RenameChoices", "Source", "choices1", {"a": "aa", "b": "bb"}])
    self.apply_user_action(
      ["RenameChoices", "Source", "choices2", {"c": "cc", "d": "dd"}])

    # Actions from renaming choices1 only
    self.assertPartialOutActions(out_actions, {'stored': [
      ['UpdateRecord', 'Source', 21, {'choices1': ['L', u'aa', u'bb']}],
      ['BulkAddRecord',
       'Source_summary_choices1_choices2',
       [5, 6, 7, 8],
       {'choices1': [u'aa', u'aa', u'bb', u'bb'],
        'choices2': [u'c', u'd', u'c', u'd']}],
      ['BulkRemoveRecord', 'Source_summary_choices1_choices2', [1, 2, 3, 4]],
      ['BulkUpdateRecord',
       'Source_summary_choices1_choices2',
       [5, 6, 7, 8],
       {'count': [1, 1, 1, 1]}],
      ['BulkUpdateRecord',
       'Source_summary_choices1_choices2',
       [5, 6, 7, 8],
       {'group': [['L', 21],
                  ['L', 21],
                  ['L', 21],
                  ['L', 21]]}]
    ]})

    # Final Source table is essentially the same as before, just with each letter doubled
    self.assertTableData('Source', data=[
      ["id", "choices1", "choices2", "other"],
      [21, ["aa", "bb"], ["cc", "dd"], "foo"],
    ])

    # Final summary table is very similar to before, but with two empty chunks of 4 rows
    # left over from each rename
    self.assertTableData('Source_summary_choices1_choices2', data=[
      ["id", "choices1", "choices2", "group", "count"],
      [9, "aa", "cc", [21], 1],
      [10, "aa", "dd", [21], 1],
      [11, "bb", "cc", [21], 1],
      [12, "bb", "dd", [21], 1],
    ])
