# pylint:disable=too-many-lines
"""
Test of Summary tables. This has many test cases, so to keep files smaller, it's split into two
files: test_summary.py and test_summary2.py.
"""
import logging
import actions
import test_engine
from test_engine import Table, Column, View, Section, Field
import test_summary
import testutil

log = logging.getLogger(__name__)


class TestSummary2(test_engine.EngineTestCase):
  sample = test_summary.TestSummary.sample
  starting_table = test_summary.TestSummary.starting_table
  starting_table_data = test_summary.TestSummary.starting_table_data


  @test_engine.test_undo
  def test_add_summary_formula(self):
    # Verify that we can add a summary formula; that new sections automatically get columns
    # matching the source table, and not other columns. Check that group-by columns override
    # formula columns (if there are any by the same name).

    # Start as in test_change_summary_formula() test case; see there for what tables and columns
    # we expect to have at this point.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [], None])

    # Check that we cannot add a non-formula column.
    with self.assertRaisesRegex(ValueError, r'non-formula column'):
      self.apply_user_action(["AddColumn", "Address_summary_city_state", "average",
                              {"type": "Text", "isFormula": False}])

    # Add two formula columns: one for 'state' (an existing column name, and a group-by column in
    # some tables), and one for 'average' (a new column name).
    self.apply_user_action(["AddVisibleColumn", "Address_summary", "state",
                            {"formula": "':'.join(sorted(set($group.state)))"}])

    self.apply_user_action(["AddVisibleColumn", "Address_summary_city_state", "average",
                            {"formula": "$amount / $count"}])

    # Add two more summary tables: by 'city', and by 'state', and see what columns they get.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11], None])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12], None])
    # And also a summary table for an existing breakdown.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])

    # Check the table and columns for all the summary tables.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_city_state", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(23, "average", "Any",      True,   "$amount / $count", 0),
      ]),
      Table(3, "Address_summary", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(22, "state",   "Any",      True,   "':'.join(sorted(set($group.state)))", 0),
      ]),
      Table(4, "Address_summary_city", 0, 1, columns=[
        Column(24, "city",    "Text",     False,  "", 11),
        Column(25, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(26, "count",   "Int",      True,   "len($group)", 0),
        Column(27, "state",   "Any",      True,   "':'.join(sorted(set($group.state)))", 0),
        Column(28, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      # Note that since 'state' is used as a group-by column here, we skip the 'state' formula.
      Table(5, "Address_summary_state", 0, 1, columns=[
        Column(29, "state",   "Text",     False,  "", 12),
        Column(30, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(31, "count",   "Int",      True,   "len($group)", 0),
        Column(32, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])


    # We should now have three sections for table 2 (the one with two group-by fields). One for
    # the raw summary table view, and two for the non-raw views.
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "parentId", "tableRef"],
      [1,     0,          2],
      [2,     1,          2],
      [9,     5,          2],
    ], rows=lambda r: r.tableRef.id == 2)
    self.assertTableData('_grist_Views_section_field', cols="subset", data=[
      ["id", "parentId", "colRef"],
      [1,     1,          14],
      [2,     1,          15],
      [3,     1,          17],
      [4,     1,          18],
      [15,    1,          23],
      [17,    5,          24],
      [18,    5,          26],
      [19,    5,          27],
      [20,    5,          28],  # new section doesn't automatically get 'average' column
    ], rows=lambda r: r.parentId.id in {1,5})


    # Check that the data is as we expect.
    self.assertTableData('Address_summary_city_state', cols="all", data=[
      [ "id", "city",     "state", "group", "count", "amount", "average"   ],
      [ 1,    "New York", "NY"   , [21,26,31],3,     1.+6+11 , (1.+6+11)/3 ],
      [ 2,    "Albany",   "NY"   , [22],    1,       2.      , 2.  ],
      [ 3,    "Seattle",  "WA"   , [23],    1,       3.      , 3.  ],
      [ 4,    "Chicago",  "IL"   , [24],    1,       4.      , 4.  ],
      [ 5,    "Bedford",  "MA"   , [25],    1,       5.      , 5.  ],
      [ 6,    "Buffalo",  "NY"   , [27],    1,       7.      , 7.  ],
      [ 7,    "Bedford",  "NY"   , [28],    1,       8.      , 8.  ],
      [ 8,    "Boston",   "MA"   , [29],    1,       9.      , 9.  ],
      [ 9,    "Yonkers",  "NY"   , [30],    1,       10.     , 10. ],
    ])
    self.assertTableData('Address_summary', cols="all", data=[
      [ "id", "count",  "amount", "state"       , "group" ],
      [ 1,    11,       66.0    , "IL:MA:NY:WA" , [21,22,23,24,25,26,27,28,29,30,31]],
    ])
    self.assertTableData('Address_summary_city', cols="subset", data=[
      [ "id", "city",     "count",  "amount", "state" ],
      [ 1,    "New York",  3,       1.+6+11   , "NY"  ],
      [ 2,    "Albany",    1,       2.        , "NY"  ],
      [ 3,    "Seattle",   1,       3.        , "WA"  ],
      [ 4,    "Chicago",   1,       4.        , "IL"  ],
      [ 5,    "Bedford",   2,       5.+8      , "MA:NY"],
      [ 6,    "Buffalo",   1,       7.        , "NY"  ],
      [ 7,    "Boston",    1,       9.        , "MA"  ],
      [ 8,    "Yonkers",   1,       10.       , "NY"  ],
    ])
    self.assertTableData('Address_summary_state', cols="subset", data=[
      [ "id", "state", "count", "amount" ],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11 ],
      [ 2,    "WA",     1,      3.       ],
      [ 3,    "IL",     1,      4.       ],
      [ 4,    "MA",     2,      5.+9     ],
    ])

    # Modify a value, and check that various tables got updated correctly.
    out_actions = self.update_record("Address", 28, state="MA")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord("Address", 28, {'state': 'MA'}),
        actions.RemoveRecord("Address_summary_city_state", 7),
        actions.UpdateRecord("Address_summary_city", 5,  {'state': "MA"}),
        actions.UpdateRecord("Address_summary_city_state", 5, {'amount': 5.0 + 8.0}),
        actions.UpdateRecord("Address_summary_city_state", 5, {'average': 6.5}),
        actions.UpdateRecord("Address_summary_city_state", 5, {'count': 2}),
        actions.UpdateRecord("Address_summary_city_state", 5, {'group': [25, 28]}),
        actions.BulkUpdateRecord("Address_summary_state", [1,4],
                                 {'amount': [1.+2+6+7+10+11, 5.+8+9]}),
        actions.BulkUpdateRecord("Address_summary_state", [1,4], {'count': [6, 3]}),
        actions.BulkUpdateRecord("Address_summary_state", [1,4],
                                 {'group': [[21,22,26,27,30,31], [25,28,29]]}),
      ]
    })

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_summary_col_rename(self):
    # Verify that renaming a column in a source table causes appropriate renames in the summary
    # tables, and that renames of group-by columns in summary tables are disallowed.

    # Start as in test_change_summary_formula() test case; see there for what tables and columns
    # we expect to have at this point.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [], None])

    # Check that we cannot rename a summary group-by column. (Perhaps it's better to raise an
    # exception, but currently we translate the invalid request to a no-op.)
    with self.assertRaisesRegex(ValueError, r'Cannot modify .* group-by'):
      self.apply_user_action(["RenameColumn", "Address_summary_city_state", "state", "s"])

    # Verify all data. We'll repeat this after renamings to make sure there are no errors.
    self.assertTableData("Address", self.starting_table_data)
    self.assertTableData('Address_summary_city_state', cols="all", data=[
      [ "id", "city",     "state", "group", "count", "amount" ],
      [ 1,    "New York", "NY"   , [21,26,31],3,     1.+6+11  ],
      [ 2,    "Albany",   "NY"   , [22],    1,       2.       ],
      [ 3,    "Seattle",  "WA"   , [23],    1,       3.       ],
      [ 4,    "Chicago",  "IL"   , [24],    1,       4.       ],
      [ 5,    "Bedford",  "MA"   , [25],    1,       5.       ],
      [ 6,    "Buffalo",  "NY"   , [27],    1,       7.       ],
      [ 7,    "Bedford",  "NY"   , [28],    1,       8.       ],
      [ 8,    "Boston",   "MA"   , [29],    1,       9.       ],
      [ 9,    "Yonkers",  "NY"   , [30],    1,       10.      ],
    ])
    self.assertTableData('Address_summary', cols="all", data=[
      [ "id", "count",  "amount", "group" ],
      [ 1,    11,       66.0    , [21,22,23,24,25,26,27,28,29,30,31]],
    ])

    # This should work fine, and should affect sister tables.
    self.apply_user_action(["RenameColumn", "Address_summary_city_state", "count", "xcount"])

    # These are the tables and columns we automatically get.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_city_state", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "xcount",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(3, "Address_summary", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "xcount",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ])
    ])

    # Check that renames in the source table translate to renames in the summary table.
    self.apply_user_action(["RenameColumn", "Address", "state", "xstate"])
    self.apply_user_action(["RenameColumn", "Address", "amount", "xamount"])

    self.assertTables([
      Table(1, "Address", primaryViewId=0, summarySourceTable=0, columns=[
        Column(11, "city",    "Text",      False,  "", 0),
        Column(12, "xstate",  "Text",      False,  "", 0),
        Column(13, "xamount", "Numeric",   False,  "", 0),
      ]),
      Table(2, "Address_summary_city_xstate", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "xstate",  "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "xcount",  "Int",      True,   "len($group)", 0),
        Column(18, "xamount", "Numeric",  True,   "SUM($group.xamount)", 0),
      ]),
      Table(3, "Address_summary", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "xcount",  "Int",      True,   "len($group)", 0),
        Column(21, "xamount", "Numeric",  True,   "SUM($group.xamount)", 0),
      ])
    ])

    def replace_col_names(data, **col_renames):
      return [[col_renames.get(c, c) for c in data[0]]] + data[1:]

    # Verify actual data to make sure we don't have formula errors.
    address_table_data = replace_col_names(
      self.starting_table_data, state='xstate', amount='xamount')
    self.assertTableData("Address", address_table_data)
    self.assertTableData('Address_summary_city_xstate', cols="all", data=[
      [ "id", "city",    "xstate", "group", "xcount", "xamount" ],
      [ 1,    "New York", "NY"   , [21,26,31],3,     1.+6+11  ],
      [ 2,    "Albany",   "NY"   , [22],    1,       2.       ],
      [ 3,    "Seattle",  "WA"   , [23],    1,       3.       ],
      [ 4,    "Chicago",  "IL"   , [24],    1,       4.       ],
      [ 5,    "Bedford",  "MA"   , [25],    1,       5.       ],
      [ 6,    "Buffalo",  "NY"   , [27],    1,       7.       ],
      [ 7,    "Bedford",  "NY"   , [28],    1,       8.       ],
      [ 8,    "Boston",   "MA"   , [29],    1,       9.       ],
      [ 9,    "Yonkers",  "NY"   , [30],    1,       10.      ],
    ])
    self.assertTableData('Address_summary', cols="all", data=[
      [ "id", "xcount",  "xamount", "group" ],
      [ 1,    11,       66.0      , [21,22,23,24,25,26,27,28,29,30,31]],
    ])


    # Add a conflicting name to a summary table and see how renames behave.
    self.apply_user_action(["AddColumn", "Address_summary_city_xstate", "foo",
                            {"formula": "$xamount * 100"}])
    self.apply_user_action(["RenameColumn", "Address", "xstate", "foo"])
    self.apply_user_action(["RenameColumn", "Address", "xamount", "foo"])
    self.apply_user_action(["RenameColumn", "Address", "city", "city"])

    self.assertTables([
      Table(1, "Address", primaryViewId=0, summarySourceTable=0, columns=[
        Column(11, "city",    "Text",      False,  "", 0),
        Column(12, "foo2",    "Text",      False,  "", 0),
        Column(13, "foo3",    "Numeric",   False,  "", 0),
      ]),
      Table(2, "Address_summary_city_foo2", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "foo2",    "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "xcount",  "Int",      True,   "len($group)", 0),
        Column(18, "foo3",    "Numeric",  True,   "SUM($group.foo3)", 0),
        Column(22, "foo",     "Any",      True,   "$foo3 * 100", 0),
      ]),
      Table(3, "Address_summary", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "xcount",  "Int",      True,   "len($group)", 0),
        Column(21, "foo3",    "Numeric",  True,   "SUM($group.foo3)", 0),
      ])
    ])

    # Verify actual data again to make sure we don't have formula errors.
    address_table_data = replace_col_names(
      address_table_data, xstate='foo2', xamount='foo3')
    self.assertTableData("Address", address_table_data)
    self.assertTableData('Address_summary_city_foo2', cols="all", data=[
      [ "id", "city",     "foo2" , "group", "xcount", "foo3", "foo" ],
      [ 1,    "New York", "NY"   , [21,26,31],3,     1.+6+11, 100*(1.+6+11) ],
      [ 2,    "Albany",   "NY"   , [22],    1,       2.     , 100*(2.)      ],
      [ 3,    "Seattle",  "WA"   , [23],    1,       3.     , 100*(3.)      ],
      [ 4,    "Chicago",  "IL"   , [24],    1,       4.     , 100*(4.)      ],
      [ 5,    "Bedford",  "MA"   , [25],    1,       5.     , 100*(5.)      ],
      [ 6,    "Buffalo",  "NY"   , [27],    1,       7.     , 100*(7.)      ],
      [ 7,    "Bedford",  "NY"   , [28],    1,       8.     , 100*(8.)      ],
      [ 8,    "Boston",   "MA"   , [29],    1,       9.     , 100*(9.)      ],
      [ 9,    "Yonkers",  "NY"   , [30],    1,       10.    , 100*(10.)     ],
    ])
    self.assertTableData('Address_summary', cols="all", data=[
      [ "id", "xcount",  "foo3" , "group" ],
      [ 1,    11,       66.0    , [21,22,23,24,25,26,27,28,29,30,31]],
    ])

    # Check that update to widgetOptions in source table affects group-by columns and not formula
    # columns. (Same should be true for type, but not tested here.)
    self.apply_user_action(["ModifyColumn", "Address", "foo2", {"widgetOptions": "hello"}])
    self.apply_user_action(["ModifyColumn", "Address", "foo3", {"widgetOptions": "world"}])

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ['id', 'colId',   'isFormula',  'widgetOptions'],
      [12,   'foo2',    False,        'hello'],
      [13,   'foo3',    False,        'world'],
      [15,   'foo2',    False,        'hello'],
      [18,   'foo3',    True,         'WidgetOptions2'],
      [21,   'foo3',    True,         'WidgetOptions2'],
    ], rows=lambda r: r.colId in ('foo2', 'foo3'))

  @test_engine.test_undo
  def test_summary_col_rename_conflict(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [11, "A", "Text", False, "", "A", ""],
          [12, "B", "Text", False, "", "B", ""],
        ]],
        [2, "Table1_summary_A_B", [
          [13, "A", "Text", False, "", "A", ""],
        ]],
      ],
      "DATA": {}
    })
    self.load_sample(sample)

    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11, 12], None])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11], None])

    table1 = Table(
      1, "Table1", primaryViewId=0, summarySourceTable=0, columns=[
        Column(11, "A", "Text", False, "", 0),
        Column(12, "B", "Text", False, "", 0),
      ],
    )

    # Normal table whose name conflicts with the automatically-generated summary table name below
    fake_summary = Table(
      2, "Table1_summary_A_B", primaryViewId=0, summarySourceTable=0, columns=[
        Column(13, "A", "Text", False, "", 0),
      ],
    )

    # Auto-generated name has to have a '2' to disambiguate from the normal table.
    summary_by_a_and_b = Table(
      3, "Table1_summary_A_B2", primaryViewId=0, summarySourceTable=1, columns=[
        Column(14, "A", "Text", False, "", 11),
        Column(15, "B", "Text", False, "", 12),
        Column(16, "group", "RefList:Table1", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count", "Int", True, "len($group)", 0),
      ],
    )

    # nothing special here yet
    summary_by_a = Table(
      4, "Table1_summary_A", primaryViewId=0, summarySourceTable=1, columns=[
        Column(18, "A", "Text", False, "", 11),
        Column(19, "group", "RefList:Table1", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count", "Int", True, "len($group)", 0),
      ],
    )

    tables = [table1, fake_summary, summary_by_a_and_b, summary_by_a]
    self.assertTables(tables)

    # Add some formulas using summary table names that are about to change
    self.add_column("Table1", "summary_ref1",
                    type="RefList:Table1_summary_A_B2",
                    formula="Table1_summary_A_B2.lookupRecords(A=1)",
                    isFormula=True)
    self.add_column("Table1", "summary_ref2",
                    type="Ref:Table1_summary_A",
                    formula="Table1_summary_A.lookupOne(A=23)",
                    isFormula=True)

    # I got the weirdest heisenbug ever when renaming straight from A to A_B.
    # The order of renaming is not deterministic so it may end up with
    # 'Table1_summary_A_B3', but asserting that name made it come out as
    # 'Table1_summary_A_B2' instead. Seems that file contents play a role in
    # order in sets/dictionaries?
    self.apply_user_action(["RenameColumn", "Table1", "A", "A2"])
    self.apply_user_action(["RenameColumn", "Table1", "A2", "A_B"])

    # Summary tables are automatically renamed to match the new column names.
    summary_by_a_and_b = summary_by_a_and_b._replace(tableId="Table1_summary_A_B_B")
    summary_by_a = summary_by_a._replace(tableId="Table1_summary_A_B2")

    table1.columns[0] = table1.columns[0]._replace(colId="A_B")
    summary_by_a_and_b.columns[0] = summary_by_a_and_b.columns[0]._replace(colId="A_B")
    summary_by_a.columns[0] = summary_by_a.columns[0]._replace(colId="A_B")

    table1.columns.extend([
      Column(21, "summary_ref1", "RefList:Table1_summary_A_B_B", True,
             "Table1_summary_A_B_B.lookupRecords(A_B=1)", 0),
      Column(22, "summary_ref2", "Ref:Table1_summary_A_B2", True,
              "Table1_summary_A_B2.lookupOne(A_B=23)", 0),
    ])

    tables = [table1, fake_summary, summary_by_a_and_b, summary_by_a]
    self.assertTables(tables)

  @test_engine.test_undo
  def test_source_table_rename_conflict(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [11, "A", "Text", False, "", "A", ""],
        ]],
        [2, "Table2_summary", [
          [13, "A", "Text", False, "", "A", ""],
        ]],
      ],
      "DATA": {}
    })
    self.load_sample(sample)

    self.apply_user_action(["CreateViewSection", 1, 0, "record", [], None])

    table1 = Table(
      1, "Table1", primaryViewId=0, summarySourceTable=0, columns=[
        Column(11, "A", "Text", False, "", 0),
      ],
    )

    fake_summary = Table(
      2, "Table2_summary", primaryViewId=0, summarySourceTable=0, columns=[
        Column(13, "A", "Text", False, "", 0),
      ],
    )

    summary = Table(
      3, "Table1_summary", primaryViewId=0, summarySourceTable=1, columns=[
        Column(14, "group", "RefList:Table1", True, "table.getSummarySourceGroup(rec)", 0),
        Column(15, "count", "Int", True, "len($group)", 0),
      ],
    )

    tables = [table1, fake_summary, summary]
    self.assertTables(tables)

    self.apply_user_action(["RenameTable", "Table1", "Table2"])

    table1 = table1._replace(tableId="Table2")
    # Summary table is automatically renamed to match the new table name.
    # Needs a '2' to disambiguate from the fake_summary table.
    summary = summary._replace(tableId="Table2_summary2")
    summary.columns[0] = summary.columns[0]._replace(type="RefList:Table2")

    tables = [table1, fake_summary, summary]
    self.assertTables(tables)

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_restrictions(self):
    # Verify various restrictions on summary tables
    # (1) no adding/removing/renaming non-formula columns.
    # (2) no converting between formula/non-formula
    # (3) no editing values in non-formula columns
    # (4) no removing rows (this is questionable b/c empty rows might be OK to remove)
    # (5) no renaming summary tables.

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [], None])

    self.assertTableData('Address_summary_city_state', cols="all", data=[
      [ "id", "city",     "state", "group", "count", "amount" ],
      [ 1,    "New York", "NY"   , [21,26,31],3,     1.+6+11  ],
      [ 2,    "Albany",   "NY"   , [22],    1,       2.       ],
      [ 3,    "Seattle",  "WA"   , [23],    1,       3.       ],
      [ 4,    "Chicago",  "IL"   , [24],    1,       4.       ],
      [ 5,    "Bedford",  "MA"   , [25],    1,       5.       ],
      [ 6,    "Buffalo",  "NY"   , [27],    1,       7.       ],
      [ 7,    "Bedford",  "NY"   , [28],    1,       8.       ],
      [ 8,    "Boston",   "MA"   , [29],    1,       9.       ],
      [ 9,    "Yonkers",  "NY"   , [30],    1,       10.      ],
    ])

    # (1) no adding/removing/renaming non-formula columns.
    with self.assertRaisesRegex(ValueError, r'non-formula column'):
      self.apply_user_action(["AddColumn", "Address_summary_city_state", "foo",
                              {"type": "Numeric", "isFormula": False}])

    with self.assertRaisesRegex(ValueError, r'group-by column'):
      self.apply_user_action(["RemoveColumn", "Address_summary_city_state", "state"])

    with self.assertRaisesRegex(ValueError, r'Cannot modify .* group-by'):
      self.apply_user_action(["RenameColumn", "Address_summary_city_state", "state", "st"])

    # (2) no converting between formula/non-formula
    with self.assertRaisesRegex(ValueError, r'Cannot change .* formula and data'):
      self.apply_user_action(["ModifyColumn", "Address_summary_city_state", "amount",
                              {"isFormula": False}])

    with self.assertRaisesRegex(ValueError, r'Cannot change .* formula and data'):
      self.apply_user_action(["ModifyColumn", "Address_summary_city_state", "state",
                              {"isFormula": True}])

    # (3) no editing values in non-formula columns
    with self.assertRaisesRegex(ValueError, r'Cannot enter data .* group-by'):
      self.apply_user_action(["UpdateRecord", "Address_summary_city_state", 6, {"state": "ny"}])

    # (4) no removing rows (this is questionable b/c empty rows might be OK to remove)
    with self.assertRaisesRegex(ValueError, r'Cannot remove record .* summary'):
      self.apply_user_action(["RemoveRecord", "Address_summary_city_state", 6])

    # (5) no renaming summary tables.
    with self.assertRaisesRegex(ValueError, r'cannot rename .* summary'):
      self.apply_user_action(["RenameTable", "Address_summary_city_state", "Address_summary_X"])

    # Check that we can add an empty column, then set a formula for it.
    self.apply_user_action(["AddColumn", "Address_summary_city_state", "foo", {}])
    self.apply_user_action(["ModifyColumn", "Address_summary_city_state", "foo",
                            {"formula": "1+1"}])
    with self.assertRaisesRegex(ValueError, "Can't save .* to formula"):
      self.apply_user_action(["UpdateRecord", "Address_summary_city_state", 1, {"foo": "hello"}])

    # But we cannot add an empty column, then add a value to it.
    self.apply_user_action(["AddColumn", "Address_summary_city_state", "foo2", {}])
    with self.assertRaisesRegex(ValueError, r'Cannot change .* between formula and data'):
      self.apply_user_action(["UpdateRecord", "Address_summary_city_state", 1, {"foo2": "hello"}])

    self.assertTableData('Address_summary_city_state', cols="all", data=[
      [ "id", "city",     "state", "group", "count", "amount", "foo", "foo2" ],
      [ 1,    "New York", "NY"   , [21,26,31],3,     1.+6+11 , 2    , None   ],
      [ 2,    "Albany",   "NY"   , [22],    1,       2.      , 2    , None   ],
      [ 3,    "Seattle",  "WA"   , [23],    1,       3.      , 2    , None   ],
      [ 4,    "Chicago",  "IL"   , [24],    1,       4.      , 2    , None   ],
      [ 5,    "Bedford",  "MA"   , [25],    1,       5.      , 2    , None   ],
      [ 6,    "Buffalo",  "NY"   , [27],    1,       7.      , 2    , None   ],
      [ 7,    "Bedford",  "NY"   , [28],    1,       8.      , 2    , None   ],
      [ 8,    "Boston",   "MA"   , [29],    1,       9.      , 2    , None   ],
      [ 9,    "Yonkers",  "NY"   , [30],    1,       10.     , 2    , None   ],
    ])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_update_summary_section(self):
    # Verify that we can change the group-by for a view section, and that unused tables get
    # removed.

    def get_helper_cols(table_id):
      return [c for c in self.engine.tables[table_id].all_columns if c.startswith('#summary#')]

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])

    # We should have a single summary table, and a single section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_city_state", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=2, fields=[
        Field(5, colRef=14),
        Field(6, colRef=15),
        Field(7, colRef=17),
        Field(8, colRef=18),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary_city_state'])

    # Verify more fields of some of the new column objects.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',            'widgetOptions',  'label'],
      [14,   'city',   'Text',    '',                   '',               'City'],
      [15,   'state',  'Text',    '',                   'WidgetOptions1', 'State'],
      [18,   'amount', 'Numeric', 'SUM($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Now change the group-by to just one of the columns ('state')
    self.apply_user_action(["UpdateSummaryViewSection", 2, [12]])
    self.assertTables([
      self.starting_table,
      # Note that Table #2 is gone at this point, since it's unused.
      Table(3, "Address_summary_state", 0, 1, columns=[
        Column(19, "state",   "Text",     False,  "", 12),
        Column(20, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(21, "count",   "Int",      True,   "len($group)", 0),
        Column(22, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=3, fields=[
        Field(6, colRef=19),
        Field(7, colRef=21),
        Field(8, colRef=22),
      ])
    ])])
    self.assertTableData('Address_summary_state', cols="subset", data=[
      [ "id", "state", "count", "amount"          ],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  ],
      [ 2,    "WA",     1,      3.                ],
      [ 3,    "IL",     1,      4.                ],
      [ 4,    "MA",     2,      5.+9              ],
    ])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary_state'])

    # Verify more fields of some of the new column objects.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',            'widgetOptions',  'label'],
      [19,   'state',  'Text',    '',                   'WidgetOptions1', 'State'],
      [22,   'amount', 'Numeric', 'SUM($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Change group-by to a different single column ('city')
    self.apply_user_action(["UpdateSummaryViewSection", 2, [11]])
    self.assertTables([
      self.starting_table,
      # Note that Table #3 is gone at this point, since it's unused.
      Table(4, "Address_summary_city", 0, 1, columns=[
        Column(23, "city",    "Text",     False,  "", 11),
        Column(24, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(25, "count",   "Int",      True,   "len($group)", 0),
        Column(26, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=4, fields=[
        Field(15, colRef=23),
        Field(7, colRef=25),
        Field(8, colRef=26),
      ])
    ])])
    self.assertTableData('Address_summary_city', cols="subset", data=[
      [ "id", "city",     "count",  "amount" ],
      [ 1,    "New York",  3,       1.+6+11  ],
      [ 2,    "Albany",    1,       2.       ],
      [ 3,    "Seattle",   1,       3.       ],
      [ 4,    "Chicago",   1,       4.       ],
      [ 5,    "Bedford",   2,       5.+8     ],
      [ 6,    "Buffalo",   1,       7.       ],
      [ 7,    "Boston",    1,       9.       ],
      [ 8,    "Yonkers",   1,       10.      ],
    ])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary_city'])

    # Verify more fields of some of the new column objects.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',            'widgetOptions',  'label'],
      [23,   'city',   'Text',    '',                   '',               'City'],
      [26,   'amount', 'Numeric', 'SUM($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Change group-by to no columns (totals)
    self.apply_user_action(["UpdateSummaryViewSection", 2, []])
    self.assertTables([
      self.starting_table,
      # Note that Table #4 is gone at this point, since it's unused.
      Table(5, "Address_summary", 0, 1, columns=[
        Column(27, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(28, "count",   "Int",      True,   "len($group)", 0),
        Column(29, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=5, fields=[
        Field(7, colRef=28),
        Field(8, colRef=29),
      ])
    ])])
    self.assertTableData('Address_summary', cols="subset", data=[
      [ "id", "count",  "amount"],
      [ 1,    11,       66.0    ],
    ])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary'])

    # Back to full circle, but with group-by columns differently arranged.
    self.apply_user_action(["UpdateSummaryViewSection", 2, [12,11]])
    self.assertTables([
      self.starting_table,
      # Note that Table #5 is gone at this point, since it's unused.
      Table(6, "Address_summary_city_state", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(33, "count",   "Int",      True,   "len($group)", 0),
        Column(34, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=6, fields=[
        Field(22, colRef=30),
        Field(23, colRef=31),
        Field(7, colRef=33),
        Field(8, colRef=34),
      ])
    ])])
    self.assertTableData('Address_summary_city_state', cols="subset", data=[
      [ "id", "city",     "state", "count", "amount"  ],
      [ 1,    "New York", "NY"   , 3,       1.+6+11   ],
      [ 2,    "Albany",   "NY"   , 1,       2.        ],
      [ 3,    "Seattle",  "WA"   , 1,       3.        ],
      [ 4,    "Chicago",  "IL"   , 1,       4.        ],
      [ 5,    "Bedford",  "MA"   , 1,       5.        ],
      [ 6,    "Buffalo",  "NY"   , 1,       7.        ],
      [ 7,    "Bedford",  "NY"   , 1,       8.        ],
      [ 8,    "Boston",   "MA"   , 1,       9.        ],
      [ 9,    "Yonkers",  "NY"   , 1,       10.       ],
    ])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary_city_state'])

    # Now add a different view section with the same group-by columns.
    self.apply_user_action(["CreateViewSection", 1, 1, "record", [11,12], None])
    self.assertTables([
      self.starting_table,
      Table(6, "Address_summary_city_state", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(33, "count",   "Int",      True,   "len($group)", 0),
        Column(34, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=6, fields=[
        Field(22, colRef=30),
        Field(23, colRef=31),
        Field(7, colRef=33),
        Field(8, colRef=34),
      ]),
      Section(7, parentKey="record", tableRef=6, fields=[
        Field(24,  colRef=31),
        Field(25,  colRef=30),
        Field(26,  colRef=33),
        Field(27, colRef=34),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary_city_state'])

    # Change one view section, and ensure there are now two summary tables.
    self.apply_user_action(["UpdateSummaryViewSection", 7, []])
    self.assertTables([
      self.starting_table,
      Table(6, "Address_summary_city_state", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(33, "count",   "Int",      True,   "len($group)", 0),
        Column(34, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(7, "Address_summary", 0, 1, columns=[
        Column(35, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(36, "count",   "Int",      True,   "len($group)", 0),
        Column(37, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=6, fields=[
        Field(22, colRef=30),
        Field(23, colRef=31),
        Field(7, colRef=33),
        Field(8, colRef=34),
      ]),
      Section(7, parentKey="record", tableRef=7, fields=[
        Field(26,  colRef=36),
        Field(27, colRef=37),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary_city_state',
                                                  '#summary#Address_summary'])

    # Delete one view section, and see that the summary table is gone.
    self.apply_user_action(["RemoveViewSection", 7])
    self.assertTables([
      self.starting_table,
      # Note that Table #7 is gone at this point, since it's now unused.
      Table(6, "Address_summary_city_state", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(33, "count",   "Int",      True,   "len($group)", 0),
        Column(34, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ])
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=6, fields=[
        Field(22, colRef=30),
        Field(23, colRef=31),
        Field(7, colRef=33),
        Field(8, colRef=34),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#Address_summary_city_state'])

    # Change the section to add and then remove the "amount" to the group-by column; check that
    # column "amount" was correctly restored
    self.apply_user_action(["UpdateSummaryViewSection", 2, [11, 12, 13]])
    self.assertTables([
      self.starting_table,
      Table(7, "Address_summary_amount_city_state", 0, 1, columns=[
        Column(35, "city",    "Text",     False,  "", 11),
        Column(36, "state",   "Text",     False,  "", 12),
        Column(37, "amount",  "Numeric",  False,   "", 13),
        Column(38, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(39, "count",   "Int",      True,   "len($group)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=7, fields=[
        Field(23, colRef=35),
        Field(22, colRef=36),
        Field(28, colRef=37),
        Field(7, colRef=39),
      ])
    ])])
    self.apply_user_action(["UpdateSummaryViewSection", 2, [11,12]])
    self.assertTables([
      self.starting_table,
      Table(8, "Address_summary_city_state", 0, 1, columns=[
        Column(40, "city",    "Text",     False,  "", 11),
        Column(41, "state",   "Text",     False,  "", 12),
        Column(42, "amount",  "Numeric",  True, "SUM($group.amount)", 0),
        Column(43, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(44, "count",   "Int",      True,   "len($group)", 0),

      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=8, fields=[
        Field(23, colRef=40),
        Field(22, colRef=41),
        Field(28, colRef=42),
        Field(7, colRef=44),
      ])
    ])])

    # Hide a formula and update group by columns; check that the formula columns had not been
    # deleted
    self.apply_user_action(['RemoveRecord', '_grist_Views_section_field', 7])
    self.apply_user_action(["UpdateSummaryViewSection", 2, [11]])
    self.assertTables([
      self.starting_table,
      Table(9, "Address_summary_city", 0, 1, columns=[
        Column(45, "city",    "Text",     False,  "", 11),
        Column(46, "amount",  "Numeric",  True, "SUM($group.amount)", 0),
        Column(48, "count",   "Int",      True,   "len($group)", 0),
        Column(47, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=9, fields=[
        Field(23, colRef=45),
        Field(28, colRef=46),
      ])
    ])])

    # Delete source table, and ensure its summary table is also gone.
    self.apply_user_action(["RemoveTable", "Address"])
    self.assertTables([])
    self.assertViews([])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_update_groupby_override(self):
    # Verify that if we add a group-by column that conflicts with a formula, group-by column wins.

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12], None])
    self.apply_user_action(["AddVisibleColumn", "Address_summary_state", "city",
                            {"formula": "$state.lower()"}])

    # We should have a single summary table, and a single section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_state", 0, 1, columns=[
        Column(14, "state",   "Text",     False,  "", 12),
        Column(15, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(16, "count",   "Int",      True,   "len($group)", 0),
        Column(17, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(18, "city",    "Any",      True,   "$state.lower()", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=2, fields=[
        Field(4, colRef=14),
        Field(5, colRef=16),
        Field(6, colRef=17),
        Field(8, colRef=18),
      ])
    ])])
    self.assertTableData('Address_summary_state', cols="subset", data=[
      [ "id", "state", "count", "amount"          , "city"],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  , "ny"  ],
      [ 2,    "WA",     1,      3.                , "wa"  ],
      [ 3,    "IL",     1,      4.                , "il"  ],
      [ 4,    "MA",     2,      5.+9              , "ma"  ],
    ])

    # Change the section to add "city" as a group-by column; check that the formula is gone.
    self.apply_user_action(["UpdateSummaryViewSection", 2, [11,12]])
    self.assertTables([
      self.starting_table,
      Table(3, "Address_summary_city_state", 0, 1, columns=[
        Column(19, "city",    "Text",     False,  "", 11),
        Column(20, "state",   "Text",     False,  "", 12),
        Column(21, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(22, "count",   "Int",      True,   "len($group)", 0),
        Column(23, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=3, fields=[
        # We requested 'city' to come before 'state', check that this is the case.
        Field(13, colRef=19),
        Field(4, colRef=20),
        Field(5, colRef=22),
        Field(6, colRef=23),
      ])
    ])])

    # TODO We should have more tests on UpdateSummaryViewSection that rearranges columns in
    # interesting ways (e.g. add new column to middle of existing group-by columns; put group-by
    # columns in the middle of other fields then UpdateSummary to rearrange them).

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_cleanup_on_view_remove(self):
    # Verify that if we remove a view, that unused summary tables get cleaned up.

    # Create one view with one summary section, and another view with three sections.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None]) # Creates View #1
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [], None])      # Creates View #2
    self.apply_user_action(["CreateViewSection", 1, 2, "record", [11,12], None]) # Refers to View #2
    self.apply_user_action(["CreateViewSection", 1, 2, "record", [12], None])    # Refers to View #2

    # We should have a single summary table, and a single section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_city_state", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(3, "Address_summary", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(4, "Address_summary_state", 0, 1, columns=[
        Column(22, "state",   "Text",     False,  "", 12),
        Column(23, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(24, "count",   "Int",      True,   "len($group)", 0),
        Column(25, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=2, fields=[
        Field(5, colRef=14),
        Field(6, colRef=15),
        Field(7, colRef=17),
        Field(8, colRef=18),
      ])
    ]), View(2, sections=[
      Section(4, parentKey="record", tableRef=3, fields=[
        Field(11, colRef=20),
        Field(12, colRef=21),
      ]),
      Section(5, parentKey="record", tableRef=2, fields=[
        Field(13, colRef=14),
        Field(14, colRef=15),
        Field(15, colRef=17),
        Field(16, colRef=18),
      ]),
      Section(7, parentKey="record", tableRef=4, fields=[
        Field(20, colRef=22),
        Field(21, colRef=24),
        Field(22, colRef=25),
      ])
    ])])

    # Now change the group-by to just one of the columns ('state')
    self.apply_user_action(["RemoveView", 2])

    # Verify that unused summary tables are also gone, but the one used remains.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_city_state", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(2, parentKey="record", tableRef=2, fields=[
        Field(5, colRef=14),
        Field(6, colRef=15),
        Field(7, colRef=17),
        Field(8, colRef=18),
      ])
    ])])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_update_sort_spec(self):
    # Verify that we correctly update sort spec when we update a summary view section.

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])
    self.apply_user_action(["UpdateRecord", "_grist_Views_section", 2,
                            {"sortColRefs": "[15,14,-17]"}])

    # We should have a single summary table, and a single (non-raw) section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_city_state", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "tableRef", "sortColRefs"],
      [1,     2,          ""], # This is the raw section.
      [2,     2,          "[15,14,-17]"],
    ])

    # Now change the group-by to just one of the columns ('state')
    self.apply_user_action(["UpdateSummaryViewSection", 2, [12]])
    self.assertTables([
      self.starting_table,
      # Note that Table #2 is gone at this point, since it's unused.
      Table(3, "Address_summary_state", 0, 1, columns=[
        Column(19, "state",   "Text",     False,  "", 12),
        Column(20, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(21, "count",   "Int",      True,   "len($group)", 0),
        Column(22, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    # Verify that sortColRefs refers to new columns.
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "tableRef", "sortColRefs"],
      [2,     3,          "[19,-21]"],
      [3,     3,          ""], # This is the raw section.
    ])

  #----------------------------------------------------------------------
  @test_engine.test_undo
  def test_detach_summary_section(self):
    # Verify that "DetachSummaryViewSection" useraction works correctly.

    self.load_sample(self.sample)
    # Add a couple of summary tables.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [], None])
    # Add a formula column
    self.apply_user_action(["AddVisibleColumn", "Address_summary_city_state", "average",
                            {"formula": "$amount / $count"}])

    # Check the table and columns for all the summary tables.
    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary_city_state", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(22, "average", "Any",      True,   "$amount / $count", 0),
      ]),
      Table(3, "Address_summary", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "parentId", "tableRef"],
      [1,     0,          2],
      [2,     1,          2],
      [3,     0,          3],
      [4,     2,          3],
    ])
    self.assertTableData('_grist_Views_section_field', cols="subset", data=[
      ["id", "parentId", "colRef"],
      [1,     1,          14],
      [2,     1,          15],
      [3,     1,          17],
      [4,     1,          18],
      [13,    1,          22],
      [5,     2,          14],
      [6,     2,          15],
      [7,     2,          17],
      [8,     2,          18],
      [14,    2,          22],
      [9,     3,          20],
      [10,    3,          21],
      [11,    4,          20],
      [12,    4,          21],
    ], sort=lambda r: (r.parentId, r.id))

    # Now save one section as a separate table, i.e. "detach" it from its source.
    self.apply_user_action(["DetachSummaryViewSection", 2])

    # Check the table and columns for all the summary tables.
    self.assertTables([
      self.starting_table,
      Table(3, "Address_summary", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(4, "Table1", primaryViewId=3, summarySourceTable=0, columns=[
        Column(23, "manualSort", "ManualSortPos",  False,  "", 0),
        Column(24, "city",    "Text",     False,  "", 0),
        Column(25, "state",   "Text",     False,  "", 0),
        Column(26, "count",   "Int",      True,   "len($group)", 0),
        Column(27, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(28, "average", "Any",      True,   "$amount / $count", 0),
        Column(29, "group",   "RefList:Address", True,
               "Address.lookupRecords(city=$city, state=$state)", 0),
      ]),
    ])
    # We should now have two sections for table 2 (the one with two group-by fields).
    self.assertTableData('_grist_Views_section', cols="subset", rows=lambda r: r.parentId, data=[
      ["id",  "parentId", "tableRef"],
      [2,     1,          4],
      [4,     2,          3],
      [5,     3,          4],
    ])
    self.assertTableData(
      '_grist_Views_section_field', cols="subset", rows=lambda r: r.parentId.parentId, data=[
      ["id", "parentId", "colRef"],
      [5,     2,         24],
      [6,     2,         25],
      [7,     2,         26],
      [8,     2,         27],
      [14,    2,         28],
      [11,    4,         20],
      [12,    4,         21],
      [15,    5,         24],
      [16,    5,         25],
      [17,    5,         26],
      [18,    5,         27],
      [19,    5,         28],
    ], sort=lambda r: (r.parentId, r.id))

    # Check that the data is as we expect.
    self.assertTableData('Table1', cols="all", data=[
      [ "id", "manualSort", "city",     "state", "group", "count", "amount", "average"   ],
      [ 1,    1.0,          "New York", "NY"   , [21,26,31],3,     1.+6+11 , (1.+6+11)/3 ],
      [ 2,    2.0,          "Albany",   "NY"   , [22],    1,       2.      , 2.  ],
      [ 3,    3.0,          "Seattle",  "WA"   , [23],    1,       3.      , 3.  ],
      [ 4,    4.0,          "Chicago",  "IL"   , [24],    1,       4.      , 4.  ],
      [ 5,    5.0,          "Bedford",  "MA"   , [25],    1,       5.      , 5.  ],
      [ 6,    6.0,          "Buffalo",  "NY"   , [27],    1,       7.      , 7.  ],
      [ 7,    7.0,          "Bedford",  "NY"   , [28],    1,       8.      , 8.  ],
      [ 8,    8.0,          "Boston",   "MA"   , [29],    1,       9.      , 9.  ],
      [ 9,    9.0,          "Yonkers",  "NY"   , [30],    1,       10.     , 10. ],
    ])
    self.assertTableData('Address_summary', cols="all", data=[
      [ "id", "count",  "amount", "group" ],
      [ 1,    11,       66.0    , [21,22,23,24,25,26,27,28,29,30,31]],
    ])

  #----------------------------------------------------------------------
  @test_engine.test_undo
  def test_summary_of_detached(self):
    # Verify that we can make a summary table of a detached table. This is mainly to ensure that
    # we handle well the presence of columns like 'group' and 'count' in the source table.

    # Add a summary table and detach it. Then add a summary table of that table.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12], None])
    self.apply_user_action(["DetachSummaryViewSection", 2])

    # Create a summary of the detached table (tableRef 3) by state (colRef 21).
    self.apply_user_action(["CreateViewSection", 3, 0, "record", [21], None])

    # Verify the resulting metadata.
    self.assertTables([
      self.starting_table,
      Table(3, "Table1", primaryViewId=2, summarySourceTable=0, columns=[
        Column(19, "manualSort", "ManualSortPos",  False,  "", 0),
        Column(20, "city",    "Text",     False,  "", 0),
        Column(21, "state",   "Text",     False,  "", 0),
        Column(22, "count",   "Int",      True,   "len($group)", 0),
        Column(23, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(24, "group",   "RefList:Address", True,
               "Address.lookupRecords(city=$city, state=$state)", 0),
      ]),
      Table(4, "Table1_summary_state", primaryViewId=0, summarySourceTable=3, columns=[
        Column(25, "state",   "Text",     False,  "", 21),
        Column(26, "group",   "RefList:Table1", True, "table.getSummarySourceGroup(rec)", 0),
        Column(27, "count",   "Int",      True,   "SUM($group.count)", 0),
        Column(28, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])

    # Check that the data is as we expect. Table1 is the same as in the previous test case.
    self.assertTableData('Table1', cols="all", data=[
      [ "id", "manualSort", "city",     "state", "group", "count", "amount" ],
      [ 1,    1.0,          "New York", "NY"   , [21,26,31],3,     1.+6+11  ],
      [ 2,    2.0,          "Albany",   "NY"   , [22],    1,       2.       ],
      [ 3,    3.0,          "Seattle",  "WA"   , [23],    1,       3.       ],
      [ 4,    4.0,          "Chicago",  "IL"   , [24],    1,       4.       ],
      [ 5,    5.0,          "Bedford",  "MA"   , [25],    1,       5.       ],
      [ 6,    6.0,          "Buffalo",  "NY"   , [27],    1,       7.       ],
      [ 7,    7.0,          "Bedford",  "NY"   , [28],    1,       8.       ],
      [ 8,    8.0,          "Boston",   "MA"   , [29],    1,       9.       ],
      [ 9,    9.0,          "Yonkers",  "NY"   , [30],    1,       10.      ],
    ])
    self.assertTableData('Table1_summary_state', cols="all", data=[
      [ "id", "state",  "group",      "count",  "amount"         ],
      [ 1,    "NY",     [1,2,6,7,9],  7,        1.+6+11+2+7+8+10 ],
      [ 2,    "WA",     [3],          1,        3.               ],
      [ 3,    "IL",     [4],          1,        4.               ],
      [ 4,    "MA",     [5,8],        2,        5.+9             ],
    ])

  #----------------------------------------------------------------------
  @test_engine.test_undo
  def test_update_summary_with_suffixed_colId(self):
    # Verifies that summary update correctly when one of the formula
    # columns has a suffixed colId

    self.load_sample(self.sample)

    # Let's create two summary table, one with totals (no grouped by columns) and one grouped by
    # "city".
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [], None])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11], None])

    # Change type of Amount columns to "Any" only for table Address_summary_city. User actions keep
    # types consistent across same-named columns for all summary tables with the same source table,
    # but here we want to test for the case where types are inconsistent. Hence we bypass user
    # actions and directly use doc actions.
    self.engine.apply_doc_action(actions.UpdateRecord("_grist_Tables_column", 20, {'type': 'Any'}))
    self.engine.apply_doc_action(actions.ModifyColumn("Address_summary_city", "amount", {'type':
                                                                                         'Any'}))
    self.engine.assert_schema_consistent()

    self.assertTables([
      self.starting_table,
      Table(2, "Address_summary", primaryViewId=0, summarySourceTable=1, columns=[
        Column(14, "group", "RefList:Address", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(15, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
        # This column has type Numeric
        Column(16, "amount", "Numeric", isFormula=True, summarySourceCol=0,
               formula="SUM($group.amount)"),
      ]),
      Table(3, "Address_summary_city", primaryViewId=0, summarySourceTable=1, columns=[
        Column(17, "city", "Text", isFormula=False, summarySourceCol=11,
               formula=""),
        Column(18, "group", "RefList:Address", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(19, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
        # This column has type Any
        Column(20, "amount", "Any", isFormula=True, summarySourceCol=0,
               formula="SUM($group.amount)"),
      ]),
    ])

    # Now let's add "city" to the summary table with no grouped by column
    self.apply_user_action(["UpdateSummaryViewSection", 2, [11]])

    # Check that summary table now has one column Amount of type Any.
    self.assertTables([
      self.starting_table,
      Table(3, "Address_summary_city", primaryViewId=0, summarySourceTable=1, columns=[
        Column(17, "city", "Text", isFormula=False, summarySourceCol=11,
               formula=""),
        Column(18, "group", "RefList:Address", isFormula=True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(19, "count", "Int", isFormula=True, summarySourceCol=0,
               formula="len($group)"),
        Column(20, "amount", "Any", isFormula=True, summarySourceCol=0,
               formula="SUM($group.amount)"),
      ])
    ])
