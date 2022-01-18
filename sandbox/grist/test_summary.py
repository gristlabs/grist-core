"""
Test of Summary tables. This has many test cases, so to keep files smaller, it's split into two
files: test_summary.py and test_summary2.py.
"""

import actions
import logger
import summary
import testutil
import test_engine
from useractions import allowed_summary_change

from test_engine import Table, Column, View, Section, Field

log = logger.Logger(__name__, logger.INFO)


class TestSummary(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Address", [
        [11, "city",        "Text",       False, "", "City", ""],
        [12, "state",       "Text",       False, "", "State", "WidgetOptions1"],
        [13, "amount",      "Numeric",    False, "", "Amount", "WidgetOptions2"],
      ]]
    ],
    "DATA": {
      "Address": [
        ["id",  "city",     "state", "amount" ],
        [ 21,   "New York", "NY"   , 1.       ],
        [ 22,   "Albany",   "NY"   , 2.       ],
        [ 23,   "Seattle",  "WA"   , 3.       ],
        [ 24,   "Chicago",  "IL"   , 4.       ],
        [ 25,   "Bedford",  "MA"   , 5.       ],
        [ 26,   "New York", "NY"   , 6.       ],
        [ 27,   "Buffalo",  "NY"   , 7.       ],
        [ 28,   "Bedford",  "NY"   , 8.       ],
        [ 29,   "Boston",   "MA"   , 9.       ],
        [ 30,   "Yonkers",  "NY"   , 10.      ],
        [ 31,   "New York", "NY"   , 11.      ],
      ]
    }
  })

  starting_table = Table(1, "Address", primaryViewId=0, summarySourceTable=0, columns=[
    Column(11, "city",  "Text", isFormula=False, formula="", summarySourceCol=0),
    Column(12, "state", "Text", isFormula=False, formula="", summarySourceCol=0),
    Column(13, "amount", "Numeric", isFormula=False, formula="", summarySourceCol=0),
  ])

  starting_table_data = [
    ["id",  "city",     "state", "amount" ],
    [ 21,   "New York", "NY"   , 1        ],
    [ 22,   "Albany",   "NY"   , 2        ],
    [ 23,   "Seattle",  "WA"   , 3        ],
    [ 24,   "Chicago",  "IL"   , 4        ],
    [ 25,   "Bedford",  "MA"   , 5        ],
    [ 26,   "New York", "NY"   , 6        ],
    [ 27,   "Buffalo",  "NY"   , 7        ],
    [ 28,   "Bedford",  "NY"   , 8        ],
    [ 29,   "Boston",   "MA"   , 9        ],
    [ 30,   "Yonkers",  "NY"   , 10       ],
    [ 31,   "New York", "NY"   , 11       ],
  ]

  #----------------------------------------------------------------------

  def test_encode_summary_table_name(self):
    self.assertEqual(summary.encode_summary_table_name("Foo"), "GristSummary_3_Foo")
    self.assertEqual(summary.encode_summary_table_name("Foo2"), "GristSummary_4_Foo2")
    self.assertEqual(summary.decode_summary_table_name("GristSummary_3_Foo"), "Foo")
    self.assertEqual(summary.decode_summary_table_name("GristSummary_4_Foo2"), "Foo2")
    self.assertEqual(summary.decode_summary_table_name("GristSummary_3_Foo2"), "Foo")
    self.assertEqual(summary.decode_summary_table_name("GristSummary_4_Foo2_2"), "Foo2")
    # Test that underscore in the name is OK.
    self.assertEqual(summary.decode_summary_table_name("GristSummary_5_Foo_234"), "Foo_2")
    self.assertEqual(summary.decode_summary_table_name("GristSummary_4_Foo_234"), "Foo_")
    self.assertEqual(summary.decode_summary_table_name("GristSummary_6__Foo_234"), "_Foo_2")
    # Test that we return None for invalid values.
    self.assertEqual(summary.decode_summary_table_name("Foo2"), None)
    self.assertEqual(summary.decode_summary_table_name("GristSummary_3Foo"), None)
    self.assertEqual(summary.decode_summary_table_name("GristSummary_4_Foo"), None)
    self.assertEqual(summary.decode_summary_table_name("GristSummary_3X_Foo"), None)
    self.assertEqual(summary.decode_summary_table_name("_5_Foo_234"), None)
    self.assertEqual(summary.decode_summary_table_name("_GristSummary_3_Foo"), None)
    self.assertEqual(summary.decode_summary_table_name("gristsummary_3_Foo"), None)
    self.assertEqual(summary.decode_summary_table_name("GristSummary3_Foo"), None)

  #----------------------------------------------------------------------

  def test_create_view_section(self):
    self.load_sample(self.sample)

    # Verify the starting table; there should be no views yet.
    self.assertTables([self.starting_table])
    self.assertViews([])

    # Create a view + section for the initial table.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", None])

    # Verify that we got a new view, with one section, and three fields.
    self.assertTables([self.starting_table])
    basic_view = View(1, sections=[
      Section(1, parentKey="record", tableRef=1, fields=[
        Field(1, colRef=11),
        Field(2, colRef=12),
        Field(3, colRef=13),
      ])
    ])
    self.assertViews([basic_view])

    self.assertTableData("Address", self.starting_table_data)

    # Create a "Totals" section, i.e. a summary with no group-by columns.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])

    # Verify that a new table gets created, and a new view, with a section for that table,
    # and some auto-generated summary fields.
    summary_table1 = Table(2, "GristSummary_7_Address", primaryViewId=0, summarySourceTable=1,
                           columns=[
      Column(14, "group", "RefList:Address", isFormula=True, summarySourceCol=0,
             formula="table.getSummarySourceGroup(rec)"),
      Column(15, "count", "Int", isFormula=True, summarySourceCol=0,
             formula="len($group)"),
      Column(16, "amount", "Numeric", isFormula=True, summarySourceCol=0,
             formula="SUM($group.amount)"),
    ])
    summary_view1 = View(2, sections=[
      Section(2, parentKey="record", tableRef=2, fields=[
        Field(4, colRef=15),
        Field(5, colRef=16),
      ])
    ])
    self.assertTables([self.starting_table, summary_table1])
    self.assertViews([basic_view, summary_view1])

    # Verify the summarized data.
    self.assertTableData('GristSummary_7_Address', cols="subset", data=[
      [ "id", "count",  "amount"],
      [ 1,    11,       66.0    ],
    ])

    # Create a summary section, grouped by the "State" column.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12]])

    # Verify that a new table gets created again, a new view, and a section for that table.
    # Note that we also check that summarySourceTable and summarySourceCol fields are correct.
    summary_table2 = Table(3, "GristSummary_7_Address2", primaryViewId=0, summarySourceTable=1,
                           columns=[
      Column(17, "state", "Text", isFormula=False, formula="", summarySourceCol=12),
      Column(18, "group", "RefList:Address", isFormula=True, summarySourceCol=0,
             formula="table.getSummarySourceGroup(rec)"),
      Column(19, "count", "Int", isFormula=True, summarySourceCol=0,
             formula="len($group)"),
      Column(20, "amount", "Numeric", isFormula=True, summarySourceCol=0,
             formula="SUM($group.amount)"),
    ])
    summary_view2 = View(3, sections=[
      Section(3, parentKey="record", tableRef=3, fields=[
        Field(6, colRef=17),
        Field(7, colRef=19),
        Field(8, colRef=20),
      ])
    ])
    self.assertTables([self.starting_table, summary_table1, summary_table2])
    self.assertViews([basic_view, summary_view1, summary_view2])

    # Verify more fields of the new column objects.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',            'widgetOptions', 'label'],
      [17,   'state',  'Text',    '',                   'WidgetOptions1', 'State'],
      [20,   'amount', 'Numeric', 'SUM($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Verify the summarized data.
    self.assertTableData('GristSummary_7_Address2', cols="subset", data=[
      [ "id", "state", "count", "amount"          ],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  ],
      [ 2,    "WA",     1,      3.                ],
      [ 3,    "IL",     1,      4.                ],
      [ 4,    "MA",     2,      5.+9              ],
    ])

    # Create a summary section grouped by two columns ("city" and "state").
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])

    # Verify the new table and views.
    summary_table3 = Table(4, "GristSummary_7_Address3", primaryViewId=0, summarySourceTable=1,
                           columns=[
      Column(21, "city", "Text", isFormula=False, formula="", summarySourceCol=11),
      Column(22, "state", "Text", isFormula=False, formula="", summarySourceCol=12),
      Column(23, "group", "RefList:Address", isFormula=True, summarySourceCol=0,
             formula="table.getSummarySourceGroup(rec)"),
      Column(24, "count", "Int", isFormula=True, summarySourceCol=0,
             formula="len($group)"),
      Column(25, "amount", "Numeric", isFormula=True, summarySourceCol=0,
             formula="SUM($group.amount)"),
    ])
    summary_view3 = View(4, sections=[
      Section(4, parentKey="record", tableRef=4, fields=[
        Field(9, colRef=21),
        Field(10, colRef=22),
        Field(11, colRef=24),
        Field(12, colRef=25),
      ])
    ])
    self.assertTables([self.starting_table, summary_table1, summary_table2, summary_table3])
    self.assertViews([basic_view, summary_view1, summary_view2, summary_view3])

    # Verify the summarized data.
    self.assertTableData('GristSummary_7_Address3', cols="subset", data=[
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

    # The original table's data should not have changed.
    self.assertTableData("Address", self.starting_table_data)

  #----------------------------------------------------------------------

  def test_summary_gencode(self):
    self.maxDiff = 1000       # If there is a discrepancy, allow the bigger diff.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.assertMultiLineEqual(self.engine.fetch_table_schema(),
"""import grist
from functions import *       # global uppercase functions
import datetime, math, re     # modules commonly needed in formulas


@grist.UserTable
class Address:
  city = grist.Text()
  state = grist.Text()
  amount = grist.Numeric()

  class _Summary:

    @grist.formulaType(grist.ReferenceList('Address'))
    def group(rec, table):
      return table.getSummarySourceGroup(rec)

    @grist.formulaType(grist.Int())
    def count(rec, table):
      return len(rec.group)

    @grist.formulaType(grist.Numeric())
    def amount(rec, table):
      return SUM(rec.group.amount)
""")

  #----------------------------------------------------------------------

  def test_summary_table_reuse(self):
    # Test that we'll reuse a suitable summary table when already available.

    self.load_sample(self.sample)

    # Create a summary section grouped by two columns ("city" and "state").
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])

    # Verify the new table and views.
    summary_table = Table(2, "GristSummary_7_Address", primaryViewId=0, summarySourceTable=1,
                           columns=[
      Column(14, "city", "Text", isFormula=False, formula="", summarySourceCol=11),
      Column(15, "state", "Text", isFormula=False, formula="", summarySourceCol=12),
      Column(16, "group", "RefList:Address", isFormula=True, summarySourceCol=0,
             formula="table.getSummarySourceGroup(rec)"),
      Column(17, "count", "Int", isFormula=True, summarySourceCol=0,
             formula="len($group)"),
      Column(18, "amount", "Numeric", isFormula=True, summarySourceCol=0,
             formula="SUM($group.amount)"),
    ])
    summary_view = View(1, sections=[
      Section(1, parentKey="record", tableRef=2, fields=[
        Field(1, colRef=14),
        Field(2, colRef=15),
        Field(3, colRef=17),
        Field(4, colRef=18),
      ])
    ])
    self.assertTables([self.starting_table, summary_table])
    self.assertViews([summary_view])

    # Create twoo other views + view sections with the same breakdown (in different order
    # of group-by fields, which should still reuse the same table).
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12,11]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    summary_view2 = View(2, sections=[
      Section(2, parentKey="record", tableRef=2, fields=[
        Field(5, colRef=15),
        Field(6, colRef=14),
        Field(7, colRef=17),
        Field(8, colRef=18),
      ])
    ])
    summary_view3 = View(3, sections=[
      Section(3, parentKey="record", tableRef=2, fields=[
        Field(9, colRef=14),
        Field(10, colRef=15),
        Field(11, colRef=17),
        Field(12, colRef=18),
      ])
    ])
    # Verify that we have a new view, but are reusing the table.
    self.assertTables([self.starting_table, summary_table])
    self.assertViews([summary_view, summary_view2, summary_view3])

    # Verify the summarized data.
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

  #----------------------------------------------------------------------

  def test_summary_no_invalid_reuse(self):
    # Verify that if we have some summary tables for one table, they don't mistakenly get used
    # when we need a summary for another table.

    # Load table and create a couple summary sections, for totals, and grouped by "state".
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12]])

    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(15, "count",   "Int",      True,   "len($group)", 0),
        Column(16, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(17, "state",   "Text",     False,  "", 12),
        Column(18, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(19, "count",   "Int",      True,   "len($group)", 0),
        Column(20, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])

    # Create another table similar to the first one.
    self.apply_user_action(["AddTable", "Address2", [
      { "id": "city", "type": "Text" },
      { "id": "state", "type": "Text" },
      { "id": "amount", "type": "Numeric" },
    ]])
    data = self.sample["DATA"]["Address"]
    self.apply_user_action(["BulkAddRecord", "Address2", data.row_ids, data.columns])

    # Check that we've loaded the right data, and have the new table.
    self.assertTableData("Address", cols="subset", data=self.starting_table_data)
    self.assertTableData("Address2", cols="subset", data=self.starting_table_data)
    self.assertTableData("_grist_Tables", cols="subset", data=[
      ['id',    'tableId',  'summarySourceTable'],
      [ 1,      'Address',                  0],
      [ 2,      'GristSummary_7_Address',   1],
      [ 3,      'GristSummary_7_Address2',  1],
      [ 4,      'Address2',                 0],
    ])

    # Now create similar summary sections for the new table.
    self.apply_user_action(["CreateViewSection", 4, 0, "record", []])
    self.apply_user_action(["CreateViewSection", 4, 0, "record", [23]])

    # Make sure this creates new section rather than reuses similar ones for the wrong table.
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(15, "count",   "Int",      True,   "len($group)", 0),
        Column(16, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(17, "state",   "Text",     False,  "", 12),
        Column(18, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(19, "count",   "Int",      True,   "len($group)", 0),
        Column(20, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(4, "Address2", primaryViewId=3, summarySourceTable=0, columns=[
        Column(21, "manualSort", "ManualSortPos",False, "", 0),
        Column(22, "city",    "Text",     False, "", 0),
        Column(23, "state",   "Text",     False, "", 0),
        Column(24, "amount",  "Numeric",  False, "", 0),
      ]),
      Table(5, "GristSummary_8_Address2", 0, 4, columns=[
        Column(25, "group",   "RefList:Address2", True, "table.getSummarySourceGroup(rec)", 0),
        Column(26, "count",   "Int",      True,   "len($group)", 0),
        Column(27, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
      Table(6, "GristSummary_8_Address2_2", 0, 4, columns=[
        Column(28, "state",   "Text",     False,  "", 23),
        Column(29, "group",   "RefList:Address2", True, "table.getSummarySourceGroup(rec)", 0),
        Column(30, "count",   "Int",      True,   "len($group)", 0),
        Column(31, "amount",  "Numeric",  True,   "SUM($group.amount)", 0),
      ]),
    ])

  #----------------------------------------------------------------------

  def test_summary_updates(self):
    # Verify that summary tables update automatically when we change a value used in a summary
    # formula; or a value in a group-by column; or add/remove a record; that records get
    # auto-added when new group-by combinations appear.

    # Load sample and create a summary section grouped by two columns ("city" and "state").
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])

    # Verify that the summary table respects all updates to the source table.
    self._do_test_updates("Address", "GristSummary_7_Address")

  def _do_test_updates(self, source_tbl_name, summary_tbl_name):
    # This is the main part of test_summary_updates(). It's moved to its own method so that
    # updates can be verified the same way after a table rename.

    # Verify the summarized data.
    self.assertTableData(summary_tbl_name, cols="subset", data=[
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

    # Change an amount (New York, NY, 6 -> 106), check that the right calc action gets emitted.
    out_actions = self.update_record(source_tbl_name, 26, amount=106)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord(source_tbl_name, 26, {'amount': 106}),
        actions.UpdateRecord(summary_tbl_name, 1, {'amount': 1.+106+11}),
      ]
    })

    # Change a groupby value so that a record moves from one summary group to another.
    # Bedford, NY, 8.0 -> Bedford, MA, 8.0
    out_actions = self.update_record(source_tbl_name, 28, state="MA")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord(source_tbl_name, 28, {'state': 'MA'}),
        actions.BulkUpdateRecord(summary_tbl_name, [5,7], {'amount': [5.0 + 8.0, 0.0]}),
        actions.BulkUpdateRecord(summary_tbl_name, [5,7], {'count': [2, 0]}),
        actions.BulkUpdateRecord(summary_tbl_name, [5,7], {'group': [[25, 28], []]}),
      ]
    })

    # Add a record to an existing group (Bedford, MA, 108.0)
    out_actions = self.add_record(source_tbl_name, city="Bedford", state="MA", amount=108.0)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.AddRecord(source_tbl_name, 32,
                          {'city': 'Bedford', 'state': 'MA', 'amount': 108.0}),
        actions.UpdateRecord(summary_tbl_name, 5, {'amount': 5.0 + 8.0 + 108.0}),
        actions.UpdateRecord(summary_tbl_name, 5, {'count': 3}),
        actions.UpdateRecord(summary_tbl_name, 5, {'group': [25, 28, 32]}),
      ]
    })

    # Remove a record (rowId=28, Bedford, MA, 8.0)
    out_actions = self.remove_record(source_tbl_name, 28)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.RemoveRecord(source_tbl_name, 28),
        actions.UpdateRecord(summary_tbl_name, 5, {'amount': 5.0 + 108.0}),
        actions.UpdateRecord(summary_tbl_name, 5, {'count': 2}),
        actions.UpdateRecord(summary_tbl_name, 5, {'group': [25, 32]}),
      ]
    })

    # Change groupby value to create a new combination (rowId 25, Bedford, MA, 5.0 -> Salem, MA).
    # A new summary record should be added.
    out_actions = self.update_record(source_tbl_name, 25, city="Salem")
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.UpdateRecord(source_tbl_name, 25, {'city': 'Salem'}),
        actions.AddRecord(summary_tbl_name, 10, {'city': 'Salem', 'state': 'MA'}),
        actions.BulkUpdateRecord(summary_tbl_name, [5,10], {'amount': [108.0, 5.0]}),
        actions.BulkUpdateRecord(summary_tbl_name, [5,10], {'count': [1, 1]}),
        actions.BulkUpdateRecord(summary_tbl_name, [5,10], {'group': [[32], [25]]}),
      ]
    })

    # Add a record with a new combination (Amherst, MA, 17)
    out_actions = self.add_record(source_tbl_name, city="Amherst", state="MA", amount=17.0)
    self.assertPartialOutActions(out_actions, {
      "stored": [
        actions.AddRecord(source_tbl_name, 33, {'city': 'Amherst', 'state': 'MA', 'amount': 17.}),
        actions.AddRecord(summary_tbl_name, 11, {'city': 'Amherst', 'state': 'MA'}),
        actions.UpdateRecord(summary_tbl_name, 11, {'amount': 17.0}),
        actions.UpdateRecord(summary_tbl_name, 11, {'count': 1}),
        actions.UpdateRecord(summary_tbl_name, 11, {'group': [33]}),
      ]
    })

    # Verify the resulting data after all the updates.
    self.assertTableData(summary_tbl_name, cols="subset", data=[
      [ "id", "city",     "state", "count", "amount"  ],
      [ 1,    "New York", "NY"   , 3,       1.+106+11 ],
      [ 2,    "Albany",   "NY"   , 1,       2.        ],
      [ 3,    "Seattle",  "WA"   , 1,       3.        ],
      [ 4,    "Chicago",  "IL"   , 1,       4.        ],
      [ 5,    "Bedford",  "MA"   , 1,       108.      ],
      [ 6,    "Buffalo",  "NY"   , 1,       7.        ],
      [ 7,    "Bedford",  "NY"   , 0,       0.        ],
      [ 8,    "Boston",   "MA"   , 1,       9.        ],
      [ 9,    "Yonkers",  "NY"   , 1,       10.       ],
      [ 10,   "Salem",    "MA"   , 1,       5.0       ],
      [ 11,   "Amherst",  "MA"   , 1,       17.0      ],
    ])

  #----------------------------------------------------------------------

  def test_table_rename(self):
    # Verify that summary tables keep working and updating when source table is renamed.

    # Load sample and create a couple of summary sections.
    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])

    # Check what tables we have now.
    self.assertPartialData("_grist_Tables", ["id", "tableId", "summarySourceTable"], [
      [1, "Address",                  0],
      [2, "GristSummary_7_Address",   1],
    ])

    # Rename the table: this is what we are really testing in this test case.
    self.apply_user_action(["RenameTable", "Address", "Location"])

    self.assertPartialData("_grist_Tables", ["id", "tableId", "summarySourceTable"], [
      [1, "Location",                  0],
      [2, "GristSummary_8_Location",   1],
    ])

    # Verify that the bigger summary table respects all updates to the renamed source table.
    self._do_test_updates("Location", "GristSummary_8_Location")

  #----------------------------------------------------------------------

  def test_table_rename_multiple(self):
    # Similar to the above, verify renames, but now with two summary tables.

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])
    self.assertPartialData("_grist_Tables", ["id", "tableId", "summarySourceTable"], [
      [1, "Address",                  0],
      [2, "GristSummary_7_Address",   1],
      [3, "GristSummary_7_Address2",  1],
    ])
    # Verify the data in the simple totals-only summary table.
    self.assertTableData('GristSummary_7_Address2', cols="subset", data=[
      [ "id", "count",  "amount"],
      [ 1,    11,       66.0    ],
    ])

    # Do a rename.
    self.apply_user_action(["RenameTable", "Address", "Addresses"])
    self.assertPartialData("_grist_Tables", ["id", "tableId", "summarySourceTable"], [
      [1, "Addresses",                  0],
      [2, "GristSummary_9_Addresses",   1],
      [3, "GristSummary_9_Addresses2",  1],
    ])
    self.assertTableData('GristSummary_9_Addresses2', cols="subset", data=[
      [ "id", "count",  "amount"],
      [ 1,    11,       66.0    ],
    ])

    # Remove one of the tables so that we can use _do_test_updates to verify updates still work.
    self.apply_user_action(["RemoveTable", "GristSummary_9_Addresses2"])
    self.assertPartialData("_grist_Tables", ["id", "tableId", "summarySourceTable"], [
      [1, "Addresses",                  0],
      [2, "GristSummary_9_Addresses",   1],
    ])
    self._do_test_updates("Addresses", "GristSummary_9_Addresses")

  #----------------------------------------------------------------------

  def test_change_summary_formula(self):
    # Verify that changing a summary formula affects all group-by variants, and adding a new
    # summary table gets the changed formula.
    #
    # (Recall that all summaries of a single table are *conceptually* variants of a single summary
    # table, sharing all formulas and differing only in the group-by columns.)

    self.load_sample(self.sample)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11,12]])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", []])

    # These are the tables and columns we automatically get.
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
      ])
    ])

    # Now change a formula using one of the summary tables. It should trigger an equivalent
    # change in the other.
    self.apply_user_action(["ModifyColumn", "GristSummary_7_Address", "amount",
                            {"formula": "10*sum($group.amount)"}])
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type',    'formula',               'widgetOptions', 'label'],
      [18,   'amount', 'Numeric', '10*sum($group.amount)', 'WidgetOptions2', 'Amount'],
      [21,   'amount', 'Numeric', '10*sum($group.amount)', 'WidgetOptions2', 'Amount'],
    ])

    # Change a formula and a few other fields in the other table, and verify a change to both.
    self.apply_user_action(["ModifyColumn", "GristSummary_7_Address2", "amount",
                            {"formula": "100*sum($group.amount)",
                             "type": "Text",
                             "widgetOptions": "hello",
                             "label": "AMOUNT",
                             "untieColIdFromLabel": True
                            }])
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type', 'formula',                 'widgetOptions', 'label'],
      [18,   'amount', 'Text', '100*sum($group.amount)',  'hello', 'AMOUNT'],
      [21,   'amount', 'Text', '100*sum($group.amount)',  'hello', 'AMOUNT'],
    ])

    # Check the values in the summary tables: they should reflect the new formula.
    self.assertTableData('GristSummary_7_Address', cols="subset", data=[
      [ "id", "city",     "state", "count", "amount"  ],
      [ 1,    "New York", "NY"   , 3,       str(100*(1+6+11))],
      [ 2,    "Albany",   "NY"   , 1,       "200"        ],
      [ 3,    "Seattle",  "WA"   , 1,       "300"        ],
      [ 4,    "Chicago",  "IL"   , 1,       "400"        ],
      [ 5,    "Bedford",  "MA"   , 1,       "500"        ],
      [ 6,    "Buffalo",  "NY"   , 1,       "700"        ],
      [ 7,    "Bedford",  "NY"   , 1,       "800"        ],
      [ 8,    "Boston",   "MA"   , 1,       "900"        ],
      [ 9,    "Yonkers",  "NY"   , 1,       "1000"       ],
    ])
    self.assertTableData('GristSummary_7_Address2', cols="subset", data=[
      [ "id", "count",  "amount"],
      [ 1,    11,       "6600"],
    ])

    # Add a new summary table, and check that it gets the new formula.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [12]])
    self.assertTables([
      self.starting_table,
      Table(2, "GristSummary_7_Address", 0, 1, columns=[
        Column(14, "city",    "Text",     False,  "", 11),
        Column(15, "state",   "Text",     False,  "", 12),
        Column(16, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(17, "count",   "Int",      True,   "len($group)", 0),
        Column(18, "amount",  "Text",     True,   "100*sum($group.amount)", 0),
      ]),
      Table(3, "GristSummary_7_Address2", 0, 1, columns=[
        Column(19, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(20, "count",   "Int",      True,   "len($group)", 0),
        Column(21, "amount",  "Text",     True,   "100*sum($group.amount)", 0),
      ]),
      Table(4, "GristSummary_7_Address3", 0, 1, columns=[
        Column(22, "state",   "Text",     False,  "", 12),
        Column(23, "group",   "RefList:Address", True, "table.getSummarySourceGroup(rec)", 0),
        Column(24, "count",   "Int",      True,   "len($group)", 0),
        Column(25, "amount",  "Text",     True,   "100*sum($group.amount)", 0),
      ])
    ])
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ['id', 'colId',  'type', 'formula',                 'widgetOptions', 'label'],
      [18,   'amount', 'Text', '100*sum($group.amount)',  'hello', 'AMOUNT'],
      [21,   'amount', 'Text', '100*sum($group.amount)',  'hello', 'AMOUNT'],
      [25,   'amount', 'Text', '100*sum($group.amount)',  'hello', 'AMOUNT'],
    ])

    # Verify the summarized data.
    self.assertTableData('GristSummary_7_Address3', cols="subset", data=[
      [ "id", "state", "count", "amount"                    ],
      [ 1,    "NY",     7,      str(int(100*(1.+2+6+7+8+10+11))) ],
      [ 2,    "WA",     1,      "300"                     ],
      [ 3,    "IL",     1,      "400"                     ],
      [ 4,    "MA",     2,      str(500+900)               ],
    ])

  #----------------------------------------------------------------------
  def test_convert_source_column(self):
    # Verify that we can convert the type of a column when there is a summary table using that
    # column to group by. Since converting generates extra summary records, this may cause bugs.

    self.apply_user_action(["AddEmptyTable"])
    self.apply_user_action(["BulkAddRecord", "Table1", [None]*3, {"A": [10,20,10], "B": [1,2,3]}])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [2]])

    # Verify metadata and actual data initially.
    self.assertTables([
      Table(1, "Table1", summarySourceTable=0, primaryViewId=1, columns=[
        Column(1, "manualSort", "ManualSortPos",  False,  "", 0),
        Column(2, "A",          "Numeric",        False,  "", 0),
        Column(3, "B",          "Numeric",        False,  "", 0),
        Column(4, "C",          "Any",            True,   "", 0),
      ]),
      Table(2, "GristSummary_6_Table1", summarySourceTable=1, primaryViewId=0, columns=[
        Column(5, "A",          "Numeric",        False,  "", 2),
        Column(6, "group",      "RefList:Table1", True,  "table.getSummarySourceGroup(rec)", 0),
        Column(7, "count",      "Int",            True,  "len($group)", 0),
        Column(8, "B",          "Numeric",        True,  "SUM($group.B)", 0),
      ])
    ])
    self.assertTableData('Table1', data=[
      [ "id", "manualSort", "A",  "B",  "C"   ],
      [ 1,    1.0,          10,   1.0,    None  ],
      [ 2,    2.0,          20,   2.0,    None  ],
      [ 3,    3.0,          10,   3.0,    None  ],
    ])
    self.assertTableData('GristSummary_6_Table1', data=[
      [ "id", "A",  "group",  "count",  "B" ],
      [ 1,    10,   [1,3],    2,        4   ],
      [ 2,    20,   [2],      1,        2   ],
    ])


    # Do a conversion.
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 2, {"type": "Text"}])

    # Verify that the conversion's result is as expected.
    self.assertTables([
      Table(1, "Table1", summarySourceTable=0, primaryViewId=1, columns=[
        Column(1, "manualSort", "ManualSortPos",  False,  "", 0),
        Column(2, "A",          "Text",           False,  "", 0),
        Column(3, "B",          "Numeric",        False,  "", 0),
        Column(4, "C",          "Any",            True,   "", 0),
      ]),
      Table(2, "GristSummary_6_Table1", summarySourceTable=1, primaryViewId=0, columns=[
        Column(5, "A",          "Text",           False,  "", 2),
        Column(6, "group",      "RefList:Table1", True,  "table.getSummarySourceGroup(rec)", 0),
        Column(7, "count",      "Int",            True,  "len($group)", 0),
        Column(8, "B",          "Numeric",        True,  "SUM($group.B)", 0),
      ])
    ])
    self.assertTableData('Table1', data=[
      [ "id", "manualSort", "A",  "B",  "C"   ],
      [ 1,    1.0,          "10", 1.0,  None  ],
      [ 2,    2.0,          "20", 2.0,  None  ],
      [ 3,    3.0,          "10", 3.0,  None  ],
    ])
    self.assertTableData('GristSummary_6_Table1', data=[
      [ "id", "A",  "group",  "count",  "B" ],
      [ 1,    "10", [1,3],    2,        4   ],
      [ 2,    "20", [2],      1,        2   ],
    ])

  #----------------------------------------------------------------------
  @test_engine.test_undo
  def test_remove_source_column(self):
    # Verify that we can remove a column when there is a summary table using that column to group
    # by. (Bug T188.)

    self.apply_user_action(["AddEmptyTable"])
    self.apply_user_action(["BulkAddRecord", "Table1", [None]*3,
                            {"A": ['a','b','c'], "B": [1,1,2], "C": [4,5,6]}])
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [2,3]])

    # Verify metadata and actual data initially.
    self.assertTables([
      Table(1, "Table1", summarySourceTable=0, primaryViewId=1, columns=[
        Column(1, "manualSort", "ManualSortPos",  False,  "", 0),
        Column(2, "A",          "Text",           False,  "", 0),
        Column(3, "B",          "Numeric",        False,  "", 0),
        Column(4, "C",          "Numeric",        False,  "", 0),
      ]),
      Table(2, "GristSummary_6_Table1", summarySourceTable=1, primaryViewId=0, columns=[
        Column(5, "A",          "Text",           False,  "", 2),
        Column(6, "B",          "Numeric",        False,  "", 3),
        Column(7, "group",      "RefList:Table1", True,  "table.getSummarySourceGroup(rec)", 0),
        Column(8, "count",      "Int",            True,  "len($group)", 0),
        Column(9, "C",          "Numeric",        True,  "SUM($group.C)", 0),
      ])
    ])
    self.assertTableData('Table1', data=[
      [ "id", "manualSort", "A",  "B",  "C" ],
      [ 1,    1.0,          'a',  1.0,  4   ],
      [ 2,    2.0,          'b',  1.0,  5   ],
      [ 3,    3.0,          'c',  2.0,  6   ],
    ])
    self.assertTableData('GristSummary_6_Table1', data=[
      [ "id", "A",  "B",  "group",  "count",  "C" ],
      [ 1,    'a',  1.0,  [1],      1,        4   ],
      [ 2,    'b',  1.0,  [2],      1,        5   ],
      [ 3,    'c',  2.0,  [3],      1,        6   ],
    ])

    # Remove column A, used for group-by.
    self.apply_user_action(["RemoveColumn", "Table1", "A"])

    # Verify that the conversion's result is as expected.
    self.assertTables([
      Table(1, "Table1", summarySourceTable=0, primaryViewId=1, columns=[
        Column(1, "manualSort", "ManualSortPos",  False,  "", 0),
        Column(3, "B",          "Numeric",        False,  "", 0),
        Column(4, "C",          "Numeric",        False,  "", 0),
      ]),
      Table(3, "GristSummary_6_Table1_2", summarySourceTable=1, primaryViewId=0, columns=[
        Column(10, "B",          "Numeric",        False,  "", 3),
        Column(11, "count",      "Int",            True,  "len($group)", 0),
        Column(12, "C",          "Numeric",        True,  "SUM($group.C)", 0),
        Column(13, "group",      "RefList:Table1", True,  "table.getSummarySourceGroup(rec)", 0),
      ])
    ])
    self.assertTableData('Table1', data=[
      [ "id", "manualSort", "B",  "C" ],
      [ 1,    1.0,          1.0,  4   ],
      [ 2,    2.0,          1.0,  5   ],
      [ 3,    3.0,          2.0,  6   ],
    ])
    self.assertTableData('GristSummary_6_Table1_2', data=[
      [ "id", "B",  "group",  "count",  "C" ],
      [ 1,    1.0,  [1,2],    2,        9   ],
      [ 2,    2.0,  [3],      1,        6   ],
    ])

  #----------------------------------------------------------------------
  # pylint: disable=R0915
  def test_allow_select_by_change(self):
    def widgetOptions(n, o):
      return allowed_summary_change('widgetOptions', n, o)

    # Can make no update on widgetOptions.
    new = None
    old = None
    self.assertTrue(widgetOptions(new, old))

    new = ''
    old = None
    self.assertTrue(widgetOptions(new, old))

    new = ''
    old = ''
    self.assertTrue(widgetOptions(new, old))

    new = None
    old = ''
    self.assertTrue(widgetOptions(new, old))

    # Can update when key was not present
    new = '{"widget":"TextBox","alignment":"center"}'
    old = ''
    self.assertTrue(widgetOptions(new, old))

    new = ''
    old = '{"widget":"TextBox","alignment":"center"}'
    self.assertTrue(widgetOptions(new, old))

    # Can update when key was present.
    new = '{"widget":"TextBox","alignment":"center"}'
    old = '{"widget":"Spinner","alignment":"center"}'
    self.assertTrue(widgetOptions(new, old))

    # Can update but must leave other options.
    new = '{"widget":"TextBox","cant":"center"}'
    old = '{"widget":"Spinner","cant":"center"}'
    self.assertTrue(widgetOptions(new, old))

    # Can't add protected property when old was empty.
    new = '{"widget":"TextBox","cant":"new"}'
    old = None
    self.assertFalse(widgetOptions(new, old))

    # Can't remove when there was a protected property.
    new = None
    old = '{"widget":"TextBox","cant":"old"}'
    self.assertFalse(widgetOptions(new, old))

    # Can't update by omitting.
    new = '{"widget":"TextBox"}'
    old = '{"widget":"TextBox","cant":"old"}'
    self.assertFalse(widgetOptions(new, old))

    # Can't update by changing.
    new = '{"widget":"TextBox","cant":"new"}'
    old = '{"widget":"TextBox","cant":"old"}'
    self.assertFalse(widgetOptions(new, old))

    # Can't update by adding.
    new = '{"widget":"TextBox","cant":"new"}'
    old = '{"widget":"TextBox"}'
    self.assertFalse(widgetOptions(new, old))

    # Can update objects
    new = '{"widget":"TextBox","alignment":{"prop":1},"cant":{"prop":1}}'
    old = '{"widget":"TextBox","alignment":{"prop":2},"cant":{"prop":1}}'
    self.assertTrue(widgetOptions(new, old))

    # Can't update objects
    new = '{"widget":"TextBox","cant":{"prop":1}}'
    old = '{"widget":"TextBox","cant":{"prop":2}}'
    self.assertFalse(widgetOptions(new, old))

    # Can't update lists
    new = '{"widget":"TextBox","cant":[1, 2]}'
    old = '{"widget":"TextBox","cant":[2, 1]}'
    self.assertFalse(widgetOptions(new, old))

    # Can update lists
    new = '{"widget":"TextBox","alignment":[1, 2]}'
    old = '{"widget":"TextBox","alignment":[3, 2]}'
    self.assertTrue(widgetOptions(new, old))

    # Can update without changing list.
    new = '{"widget":"TextBox","dontChange":[1, 2]}'
    old = '{"widget":"Spinner","dontChange":[1, 2]}'
    self.assertTrue(widgetOptions(new, old))
  # pylint: enable=R0915
