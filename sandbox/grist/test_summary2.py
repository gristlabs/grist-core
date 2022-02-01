"""
Test of Summary tables. This has many test cases, so to keep files smaller, it's split into two
files: test_summary.py and test_summary2.py.
"""
import actions
import logger
import objtypes
import test_engine
import test_summary

from test_engine import Table, Column, View, Section, Field

log = logger.Logger(__name__, logger.INFO)


class TestSummary2(test_engine.EngineTestCase):
  sample = test_summary.TestSummary.sample
  starting_table = test_summary.TestSummary.starting_table
  starting_table_data = test_summary.TestSummary.starting_table_data


  def test_add_summary_formula(self):
    # Verify that we can add a summary formula; that new sections automatically get columns
    # matching the source table, and not other columns. Check that group-by columns override
    # formula columns (if there are any by the same name).

    # Start as in test_change_summary_formula() test case; see there for what tables and columns
    # we expect to have at this point.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])

    # Check that we cannot add a non-formula column.
    with self.assertRaisesRegex(ValueError, r'non-formula column'):
      self.apply_user_action(["AddColumn", "GristSummary_7_Address", "average",
                              {"type": "Text", "isFormula": False}])

    # Add two formula columns: one for 'state' (an existing column name, and a group-by column in
    # some tables), and one for 'average' (a new column name).
    self.apply_user_action(["AddColumn", "GristSummary_7_Address2", "state",
                            {"formula": "':'.join(sorted(set($group.state)))"}])
    self.apply_user_action(["AddColumn", "GristSummary_7_Address", "average",
                            {"formula": "$amount / $count"}])

    # Add two more summary tables: by 'city', and by 'state', and see what columns they get.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12]])
    # And also a summary table for an existing breakdown.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])

    # Check the table and columns for all the summary tables.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(23, "average", "Any",      True,   "$amount / $count", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(22, "state",   "Any",      True,   "':'.join(sorted(set($group.state)))", 0),
      ]),
      Table(4, "GristSummary_7_Address3", 0, 1, columns=[
        Column(24, "city",    "Text",     False,  "", 11),
        Column(25, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(26, "count",   "Int",      True,   "len($group)", 0),
        Column(27, "state",   "Any",      True,   "':'.join(sorted(set($group.state)))", 0),
        Column(28, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      # Note that since 'state' is used as a group-by column here, we skip the 'state' formula.
      Table(5, "GristSummary_7_Address4", 0, 1, columns=[
        Column(29, "state",   "Text",     False,  "", 12),
        Column(30, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(31, "count",   "Int",      True,   "len($group)", 0),
        Column(32, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])


    # We should now have two sections for table 2 (the one with two group-by fields).
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "parentId", "tableRef"],
      [1,     1,          2],
      [5,     5,          2],
    ], rows=lambda r: r.tableRef.id == 2)
    self.assertTableData('_grist_Views_section_field', cols="subset", data=[
      ["id", "parentId", "colRef"],
      [1,     1,          14],
      [2,     1,          15],
      [3,     1,          17],
      [4,     1,          18],
      [8,     1,          23],
      [16,    5,          14],
      [17,    5,          15],
      [18,    5,          17],
      [19,    5,          18],    # new section doesn't automatically get 'average' column
    ], rows=lambda r: r.parentId.id in {1,5})


    # Check that the data is as we expect.
    self.assertTableData('GristSummary_7_Address', cols="all", data=[
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
    self.assertTableData('GristSummary_7_Address2', cols="all", data=[
      [ "id", "count",  "amount", "state"       , "group" ],
      [ 1,    11,       66.0    , "IL:MA:NY:WA" , [21,22,23,24,25,26,27,28,29,30,31]],
    ])
    self.assertTableData('GristSummary_7_Address3', cols="subset", data=[
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
    self.assertTableData('GristSummary_7_Address4', cols="subset", data=[
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
        actions.BulkUpdateRecord("GristSummary_7_Address", [5,7], {'amount': [5.0 + 8.0, 0.0]}),
        actions.BulkUpdateRecord("GristSummary_7_Address", [5,7],
                                 {'average': [6.5, objtypes.RaisedException(ZeroDivisionError())]}),
        actions.BulkUpdateRecord("GristSummary_7_Address", [5,7], {'count': [2, 0]}),
        actions.BulkUpdateRecord("GristSummary_7_Address", [5,7], {'group': [[25, 28], []]}),
        actions.UpdateRecord("GristSummary_7_Address3", 5,  {'state': "MA"}),
        actions.BulkUpdateRecord("GristSummary_7_Address4", [1,4],
                                 {'amount': [1.+2+6+7+10+11, 5.+8+9]}),
        actions.BulkUpdateRecord("GristSummary_7_Address4", [1,4], {'count': [6, 3]}),
        actions.BulkUpdateRecord("GristSummary_7_Address4", [1,4],
                                 {'group': [[21,22,26,27,30,31], [25,28,29]]}),
      ]
    })

  #----------------------------------------------------------------------

  def test_summary_col_rename(self):
    # Verify that renaming a column in a source table causes appropriate renames in the summary
    # tables, and that renames of group-by columns in summary tables are disallowed.

    # Start as in test_change_summary_formula() test case; see there for what tables and columns
    # we expect to have at this point.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])

    # Check that we cannot rename a summary group-by column. (Perhaps it's better to raise an
    # exception, but currently we translate the invalid request to a no-op.)
    with self.assertRaisesRegex(ValueError, r'Cannot modify .* group-by'):
      self.apply_user_action(["RenameColumn", "GristSummary_7_Address", "state", "s"])

    # Verify all data. We'll repeat this after renamings to make sure there are no errors.
    self.assertTableData("Address", self.starting_table_data)
    self.assertTableData('GristSummary_7_Address', cols="all", data=[
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
    self.assertTableData('GristSummary_7_Address2', cols="all", data=[
      [ "id", "count",  "amount", "group" ],
      [ 1,    11,       66.0    , [21,22,23,24,25,26,27,28,29,30,31]],
    ])

    # This should work fine, and should affect sister tables.
    self.apply_user_action(["RenameColumn", "GristSummary_7_Address", "count", "xcount"])

    # These are the tables and columns we automatically get.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "xcount",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
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
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "xstate",  "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "xcount",  "Int",      True,   "len($group)", 0),
        Column(18, "xamount", "Numeric",  True,   "SUM($group.xamount)", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
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
    self.assertTableData('GristSummary_7_Address', cols="all", data=[
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
    self.assertTableData('GristSummary_7_Address2', cols="all", data=[
      [ "id", "xcount",  "xamount", "group" ],
      [ 1,    11,       66.0      , [21,22,23,24,25,26,27,28,29,30,31]],
    ])


    # Add a conflicting name to a summary table and see how renames behave.
    self.apply_user_action(["AddColumn", "GristSummary_7_Address", "foo",
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
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "foo2",    "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "xcount",  "Int",      True,   "len($group)", 0),
        Column(18, "foo3",    "Numeric",  True,   "SUM($group.foo3)", 0),
        Column(22, "foo",     "Any",      True,   "$foo3 * 100", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "xcount",  "Int",      True,   "len($group)", 0),
        Column(21, "foo3",    "Numeric",  True,   "SUM($group.foo3)", 0),
      ])
    ])

    # Verify actual data again to make sure we don't have formula errors.
    address_table_data = replace_col_names(
      address_table_data, xstate='foo2', xamount='foo3')
    self.assertTableData("Address", address_table_data)
    self.assertTableData('GristSummary_7_Address', cols="all", data=[
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
    self.assertTableData('GristSummary_7_Address2', cols="all", data=[
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

  #----------------------------------------------------------------------

  def test_restrictions(self):
    # Verify various restrictions on summary tables
    # (1) no adding/removing/renaming non-formula columns.
    # (2) no converting between formula/non-formula
    # (3) no editing values in non-formula columns
    # (4) no removing rows (this is questionable b/c empty rows might be OK to remove)
    # (5) no renaming summary tables.

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])

    self.assertTableData('GristSummary_7_Address', cols="all", data=[
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
      self.apply_user_action(["AddColumn", "GristSummary_7_Address", "foo",
                              {"type": "Numeric", "isFormula": False}])

    with self.assertRaisesRegex(ValueError, r'group-by column'):
      self.apply_user_action(["RemoveColumn", "GristSummary_7_Address", "state"])

    with self.assertRaisesRegex(ValueError, r'Cannot modify .* group-by'):
      self.apply_user_action(["RenameColumn", "GristSummary_7_Address", "state", "st"])

    # (2) no converting between formula/non-formula
    with self.assertRaisesRegex(ValueError, r'Cannot change .* formula and data'):
      self.apply_user_action(["ModifyColumn", "GristSummary_7_Address", "amount",
                              {"isFormula": False}])

    with self.assertRaisesRegex(ValueError, r'Cannot change .* formula and data'):
      self.apply_user_action(["ModifyColumn", "GristSummary_7_Address", "state",
                              {"isFormula": True}])

    # (3) no editing values in non-formula columns
    with self.assertRaisesRegex(ValueError, r'Cannot enter data .* group-by'):
      self.apply_user_action(["UpdateRecord", "GristSummary_7_Address", 6, {"state": "ny"}])

    # (4) no removing rows (this is questionable b/c empty rows might be OK to remove)
    with self.assertRaisesRegex(ValueError, r'Cannot remove record .* summary'):
      self.apply_user_action(["RemoveRecord", "GristSummary_7_Address", 6])

    # (5) no renaming summary tables.
    with self.assertRaisesRegex(ValueError, r'cannot rename .* summary'):
      self.apply_user_action(["RenameTable", "GristSummary_7_Address", "GristSummary_hello"])

    # Check that we can add an empty column, then set a formula for it.
    self.apply_user_action(["AddColumn", "GristSummary_7_Address", "foo", {}])
    self.apply_user_action(["ModifyColumn", "GristSummary_7_Address", "foo", {"formula": "1+1"}])
    with self.assertRaisesRegex(ValueError, "Can't save .* to formula"):
      self.apply_user_action(["UpdateRecord", "GristSummary_7_Address", 1, {"foo": "hello"}])

    # But we cannot add an empty column, then add a value to it.
    self.apply_user_action(["AddColumn", "GristSummary_7_Address", "foo2", {}])
    with self.assertRaisesRegex(ValueError, r'Cannot change .* between formula and data'):
      self.apply_user_action(["UpdateRecord", "GristSummary_7_Address", 1, {"foo2": "hello"}])

    self.assertTableData('GristSummary_7_Address', cols="all", data=[
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

  def test_update_summary_section(self):
    # Verify that we can change the group-by for a view section, and that unused tables get
    # removed.

    def get_helper_cols(table_id):
      return [c for c in self.engine.tables[table_id].all_columns if c.startswith('#summary#')]

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])

    # We should have a single summary table, and a single section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=2, fields=[
        Field(1, colRef=14),
        Field(2, colRef=15),
        Field(3, colRef=17),
        Field(4, colRef=18),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address'])

    # Verify more fields of some of the new column objects.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',            'widgetOptions',  'label'],
      [14,   'city',   'Text',    '',                   '',               'City'],
      [15,   'state',  'Text',    '',                   'WidgetOptions1', 'State'],
      [18,   'amount', 'Numeric', 'SUM($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Now change the group-by to just one of the columns ('state')
    self.apply_user_action(["UpdateSummaryViewSection", 1, [12]])
    self.assertTables([
      self.starting_table,
      # Note that Table #2 is gone at this point, since it's unused.
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "state",   "Text",     False,  "", 12),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(22, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=3, fields=[
        Field(2, colRef=19),
        Field(3, colRef=20),
        Field(4, colRef=21),
      ])
    ])])
    self.assertTableData('GristSummary_7_Address2', cols="subset", data=[
      [ "id", "state", "count", "amount"          ],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  ],
      [ 2,    "WA",     1,      3.                ],
      [ 3,    "IL",     1,      4.                ],
      [ 4,    "MA",     2,      5.+9              ],
    ])
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address2'])

    # Verify more fields of some of the new column objects.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',            'widgetOptions',  'label'],
      [19,   'state',  'Text',    '',                   'WidgetOptions1', 'State'],
      [21,   'amount', 'Numeric', 'SUM($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Change group-by to a different single column ('city')
    self.apply_user_action(["UpdateSummaryViewSection", 1, [11]])
    self.assertTables([
      self.starting_table,
      # Note that Table #3 is gone at this point, since it's unused.
      Table(4, "GristSummary_7_Address", 0, 1, columns=[
        Column(23, "city",    "Text",     False,  "", 11),
        Column(24, "count",   "Int",      True,   "len($group)", 0),
        Column(25, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(26, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=4, fields=[
        Field(5, colRef=23),
        Field(3, colRef=24),
        Field(4, colRef=25),
      ])
    ])])
    self.assertTableData('GristSummary_7_Address', cols="subset", data=[
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
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address'])

    # Verify more fields of some of the new column objects.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',            'widgetOptions',  'label'],
      [23,   'city',   'Text',    '',                   '',               'City'],
      [25,   'amount', 'Numeric', 'SUM($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Change group-by to no columns (totals)
    self.apply_user_action(["UpdateSummaryViewSection", 1, []])
    self.assertTables([
      self.starting_table,
      # Note that Table #4 is gone at this point, since it's unused.
      Table(5, "GristSummary_7_Address2", 0, 1, columns=[
        Column(27, "count",   "Int",      True,   "len($group)", 0),
        Column(28, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(29, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=5, fields=[
        Field(3, colRef=27),
        Field(4, colRef=28),
      ])
    ])])
    self.assertTableData('GristSummary_7_Address2', cols="subset", data=[
      [ "id", "count",  "amount"],
      [ 1,    11,       66.0    ],
    ])
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address2'])

    # Back to full circle, but with group-by columns differently arranged.
    self.apply_user_action(["UpdateSummaryViewSection", 1, [12,11]])
    self.assertTables([
      self.starting_table,
      # Note that Table #5 is gone at this point, since it's unused.
      Table(6, "GristSummary_7_Address", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "count",   "Int",      True,   "len($group)", 0),
        Column(33, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(34, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=6, fields=[
        Field(5, colRef=30),
        Field(6, colRef=31),
        Field(3, colRef=32),
        Field(4, colRef=33),
      ])
    ])])
    self.assertTableData('GristSummary_7_Address', cols="subset", data=[
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
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address'])

    # Now add a different view section with the same group-by columns.
    self.apply_user_action(["CreateViewSection", 1, 1, "record", [11,12]])
    self.assertTables([
      self.starting_table,
      Table(6, "GristSummary_7_Address", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "count",   "Int",      True,   "len($group)", 0),
        Column(33, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(34, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=6, fields=[
        Field(5, colRef=30),
        Field(6, colRef=31),
        Field(3, colRef=32),
        Field(4, colRef=33),
      ]),
      Section(2, parentKey="record", tableRef=6, fields=[
        Field(7,  colRef=31),
        Field(8,  colRef=30),
        Field(9,  colRef=32),
        Field(10, colRef=33),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address'])

    # Change one view section, and ensure there are now two summary tables.
    self.apply_user_action(["UpdateSummaryViewSection", 2, []])
    self.assertTables([
      self.starting_table,
      Table(6, "GristSummary_7_Address", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "count",   "Int",      True,   "len($group)", 0),
        Column(33, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(34, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
      Table(7, "GristSummary_7_Address2", 0, 1, columns=[
        Column(35, "count",   "Int",      True,   "len($group)", 0),
        Column(36, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(37, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=6, fields=[
        Field(5, colRef=30),
        Field(6, colRef=31),
        Field(3, colRef=32),
        Field(4, colRef=33),
      ]),
      Section(2, parentKey="record", tableRef=7, fields=[
        Field(9,  colRef=35),
        Field(10, colRef=36),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address',
                                                  '#summary#GristSummary_7_Address2'])

    # Delete one view section, and see that the summary table is gone.
    self.apply_user_action(["RemoveViewSection", 2])
    self.assertTables([
      self.starting_table,
      # Note that Table #7 is gone at this point, since it's now unused.
      Table(6, "GristSummary_7_Address", 0, 1, columns=[
        Column(30, "state",   "Text",     False,  "", 12),
        Column(31, "city",    "Text",     False,  "", 11),
        Column(32, "count",   "Int",      True,   "len($group)", 0),
        Column(33, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(34, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ])
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=6, fields=[
        Field(5, colRef=30),
        Field(6, colRef=31),
        Field(3, colRef=32),
        Field(4, colRef=33),
      ])
    ])])
    self.assertEqual(get_helper_cols('Address'), ['#summary#GristSummary_7_Address'])

    # Delete source table, and ensure its summary table is also gone.
    self.apply_user_action(["RemoveTable", "Address"])
    self.assertTables([])
    self.assertViews([])

  #----------------------------------------------------------------------

  def test_update_groupby_override(self):
    # Verify that if we add a group-by column that conflicts with a formula, group-by column wins.

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12]])
    self.apply_user_action(["AddColumn", "GristSummary_7_Address", "city",
                            {"formula": "$state.lower()"}])

    # We should have a single summary table, and a single section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "state",   "Text",     False,  "", 12),
        Column(15, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(16, "count",   "Int",      True,   "len($group)", 0),
        Column(17, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(18, "city",    "Any",      True,   "$state.lower()", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=2, fields=[
        Field(1, colRef=14),
        Field(2, colRef=16),
        Field(3, colRef=17),
        Field(4, colRef=18),
      ])
    ])])
    self.assertTableData('GristSummary_7_Address', cols="subset", data=[
      [ "id", "state", "count", "amount"          , "city"],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  , "ny"  ],
      [ 2,    "WA",     1,      3.                , "wa"  ],
      [ 3,    "IL",     1,      4.                , "il"  ],
      [ 4,    "MA",     2,      5.+9              , "ma"  ],
    ])

    # Change the section to add "city" as a group-by column; check that the formula is gone.
    self.apply_user_action(["UpdateSummaryViewSection", 1, [11,12]])
    self.assertTables([
      self.starting_table,
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "city",    "Text",     False,  "", 11),
        Column(20, "state",   "Text",     False,  "", 12),
        Column(21, "count",   "Int",      True,   "len($group)", 0),
        Column(22, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(23, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=3, fields=[
        # We requested 'city' to come before 'state', check that this is the case.
        Field(4, colRef=19),
        Field(1, colRef=20),
        Field(2, colRef=21),
        Field(3, colRef=22),
      ])
    ])])

    # TODO We should have more tests on UpdateSummaryViewSection that rearranges columns in
    # interesting ways (e.g. add new column to middle of existing group-by columns; put group-by
    # columns in the middle of other fields then UpdateSummary to rearrange them).

  #----------------------------------------------------------------------

  def test_cleanup_on_view_remove(self):
    # Verify that if we remove a view, that unused summary tables get cleaned up.

    # Create one view with one summary section, and another view with three sections.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])  # Creates View #1
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])       # Creates View #2
    self.apply_user_action(["CreateViewSection", 1, 2, "record", [11,12]])  # Refers to View #2
    self.apply_user_action(["CreateViewSection", 1, 2, "record", [12]])     # Refers to View #2

    # We should have a single summary table, and a single section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(4, "GristSummary_7_Address3", 0, 1, columns=[
        Column(22, "state",   "Text",     False,  "", 12),
        Column(23, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(24, "count",   "Int",      True,   "len($group)", 0),
        Column(25, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=2, fields=[
        Field(1, colRef=14),
        Field(2, colRef=15),
        Field(3, colRef=17),
        Field(4, colRef=18),
      ])
    ]), View(2, sections=[
      Section(2, parentKey="record", tableRef=3, fields=[
        Field(5, colRef=20),
        Field(6, colRef=21),
      ]),
      Section(3, parentKey="record", tableRef=2, fields=[
        Field(7, colRef=14),
        Field(8, colRef=15),
        Field(9, colRef=17),
        Field(10, colRef=18),
      ]),
      Section(4, parentKey="record", tableRef=4, fields=[
        Field(11, colRef=22),
        Field(12, colRef=24),
        Field(13, colRef=25),
      ])
    ])])

    # Now change the group-by to just one of the columns ('state')
    self.apply_user_action(["RemoveView", 2])

    # Verify that unused summary tables are also gone, but the one used remains.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=2, fields=[
        Field(1, colRef=14),
        Field(2, colRef=15),
        Field(3, colRef=17),
        Field(4, colRef=18),
      ])
    ])])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_update_sort_spec(self):
    # Verify that we correctly update sort spec when we update a summary view section.

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["UpdateRecord", "_grist_Views_section", 1,
                            {"sortColRefs": "[15,14,-17]"}])

    # We should have a single summary table, and a single section referring to it.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "tableRef", "sortColRefs"],
      [1,     2,          "[15,14,-17]"],
    ])

    # Now change the group-by to just one of the columns ('state')
    self.apply_user_action(["UpdateSummaryViewSection", 1, [12]])
    self.assertTables([
      self.starting_table,
      # Note that Table #2 is gone at this point, since it's unused.
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "state",   "Text",     False,  "", 12),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(22, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
      ]),
    ])
    # Verify that sortColRefs refers to new columns.
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "tableRef", "sortColRefs"],
      [1,     3,          "[19,-20]"],
    ])

  #----------------------------------------------------------------------
  def test_detach_summary_section(self):
    # Verify that "DetachSummaryViewSection" useraction works correctly.

    self.load_sample(self.sample)
    # Add a couple of summary tables.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])
    # Add a formula column
    self.apply_user_action(["AddColumn", "GristSummary_7_Address", "average",
                            {"formula": "$amount / $count"}])

    # Check the table and columns for all the summary tables.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
        Column(22, "average", "Any",      True,   "$amount / $count", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "parentId", "tableRef"],
      [1,     1,          2],
      [2,     2,          3],
    ])
    self.assertTableData('_grist_Views_section_field', cols="subset", data=[
      ["id", "parentId", "colRef"],
      [1,     1,          14],
      [2,     1,          15],
      [3,     1,          17],
      [4,     1,          18],
      [7,     1,          22],
      [5,     2,          20],
      [6,     2,          21],
    ], sort=lambda r: (r.parentId, r.id))

    # Now save one section as a separate table, i.e. "detach" it from its source.
    self.apply_user_action(["DetachSummaryViewSection", 1])

    # Check the table and columns for all the summary tables.
    self.assertTables([
      self.starting_table,
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
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
      [1,     1,          4],
      [2,     2,          3],
      [3,     3,          4],
    ])
    self.assertTableData(
      '_grist_Views_section_field', cols="subset", rows=lambda r: r.parentId.parentId, data=[
      ["id", "parentId", "colRef"],
      [1,     1,          24],
      [2,     1,          25],
      [3,     1,          26],
      [4,     1,          27],
      [7,     1,          28],
      [5,     2,          20],
      [6,     2,          21],
      [8,     3,          24],
      [9,     3,          25],
      [10,    3,          26],
      [11,    3,          27],
      [12,    3,          28],
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
    self.assertTableData('GristSummary_7_Address2', cols="all", data=[
      [ "id", "count",  "amount", "group" ],
      [ 1,    11,       66.0    , [21,22,23,24,25,26,27,28,29,30,31]],
    ])

  #----------------------------------------------------------------------
  def test_summary_of_detached(self):
    # Verify that we can make a summary table of a detached table. This is mainly to ensure that
    # we handle well the presence of columns like 'group' and 'count' in the source table.

    # Add a summary table and detach it. Then add a summary table of that table.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["DetachSummaryViewSection", 1])

    # Create a summary of the detached table (tableRef 3) by state (colRef 21).
    self.apply_user_action(["CreateViewSection", 3, 0, "record", [21]])

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
      Table(4, "GristSummary_6_Table1", primaryViewId=0, summarySourceTable=3, columns=[
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
    self.assertTableData('GristSummary_6_Table1', cols="all", data=[
      [ "id", "state",  "group",      "count",  "amount"         ],
      [ 1,    "NY",     [1,2,6,7,9],  7,        1.+6+11+2+7+8+10 ],
      [ 2,    "WA",     [3],          1,        3.               ],
      [ 3,    "IL",     [4],          1,        4.               ],
      [ 4,    "MA",     [5,8],        2,        5.+9             ],
    ])
