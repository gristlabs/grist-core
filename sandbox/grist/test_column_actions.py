import logging

import testutil
import test_engine
from test_engine import Table, Column, View, Section, Field

log = logging.getLogger(__name__)

class TestColumnActions(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Address", [
        [21, "city",        "Text",       False, "", "", ""],
      ]]
    ],
    "DATA": {
      "Address": [
        ["id",  "city"       ],
        [11,    "New York"   ],
        [12,    "Colombia"   ],
        [13,    "New Haven"  ],
        [14,    "West Haven" ]],
    }
  })

  @test_engine.test_undo
  def test_column_updates(self):
    # Verify various automatic adjustments for column updates
    # (1) that label gets synced to colId unless untieColIdFromLabel is set.
    # (2) that unsetting untieColId syncs the label to colId.
    # (3) that a complex BulkUpdateRecord for _grist_Tables_column is processed correctly.
    self.load_sample(self.sample)

    self.apply_user_action(["AddColumn", "Address", "foo", {"type": "Numeric"}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",  "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "city",   "",       "Text",     False                 ],
      [ 22,     1,            "foo",    "foo",    "Numeric",  False                 ],
    ])

    # Check that label is synced to colId, via either ModifyColumn or UpdateRecord useraction.
    self.apply_user_action(["ModifyColumn", "Address", "city", {"label": "Hello"}])
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 22, {"label": "World"}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",  "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Hello",  "Hello",  "Text",     False                 ],
      [ 22,     1,            "World",  "World",  "Numeric",  False                 ],
    ])

    # But check that a rename or an update that includes colId is not affected by label.
    self.apply_user_action(["RenameColumn", "Address", "Hello", "Hola"])
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 22,
                            {"label": "Foo", "colId": "Bar"}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",  "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Hola",   "Hello",  "Text",     False                 ],
      [ 22,     1,            "Bar",    "Foo",    "Numeric",  False                 ],
    ])

    # Check that setting untieColIdFromLabel doesn't change anything immediately.
    self.apply_user_action(["BulkUpdateRecord", "_grist_Tables_column", [21,22],
                            {"untieColIdFromLabel": [True, True]}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",  "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Hola",   "Hello",  "Text",     True                  ],
      [ 22,     1,            "Bar",    "Foo",    "Numeric",  True                  ],
    ])

    # Check that ModifyColumn and UpdateRecord useractions no longer copy label to colId.
    self.apply_user_action(["ModifyColumn", "Address", "Hola", {"label": "Hello"}])
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 22, {"label": "World"}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",  "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Hola",   "Hello",  "Text",     True                  ],
      [ 22,     1,            "Bar",    "World",  "Numeric",  True                  ],
    ])

    # Check that unsetting untieColIdFromLabel syncs label, whether label is provided or not.
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 21,
                            {"untieColIdFromLabel": False, "label": "Alice"}])
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 22,
                            {"untieColIdFromLabel": False}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",  "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Alice",  "Alice",  "Text",     False                 ],
      [ 22,     1,            "World",  "World",  "Numeric",  False                 ],
    ])

    # Check that column names still get sanitized and disambiguated.
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 21, {"label": "Alice M"}])
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 22, {"label": "Alice-M"}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",    "label",    "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Alice_M",  "Alice M",  "Text",     False                 ],
      [ 22,     1,            "Alice_M2", "Alice-M",  "Numeric",  False                 ],
    ])

    # Check that a column rename doesn't avoid its own name.
    self.apply_user_action(["UpdateRecord", "_grist_Tables_column", 21, {"label": "Alice*M"}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",    "label",    "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Alice_M",  "Alice*M",  "Text",     False                 ],
      [ 22,     1,            "Alice_M2", "Alice-M",  "Numeric",  False                 ],
    ])

    # Untie colIds and tie them again, and make sure it doesn't cause unneeded renames.
    self.apply_user_action(["BulkUpdateRecord", "_grist_Tables_column", [21,22],
                            { "untieColIdFromLabel": [True, True] }])
    self.apply_user_action(["BulkUpdateRecord", "_grist_Tables_column", [21,22],
                            { "untieColIdFromLabel": [False, False] }])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",    "label",    "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Alice_M",  "Alice*M",  "Text",     False                 ],
      [ 22,     1,            "Alice_M2", "Alice-M",  "Numeric",  False                 ],
    ])

    # Check that disambiguating also works correctly for bulk updates.
    self.apply_user_action(["BulkUpdateRecord", "_grist_Tables_column", [21,22],
                            {"label": ["Bob Z", "Bob-Z"]}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",  "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Bob_Z",  "Bob Z",  "Text",     False                 ],
      [ 22,     1,            "Bob_Z2", "Bob-Z",  "Numeric",  False                 ],
    ])

    # Same for changing colIds directly.
    self.apply_user_action(["BulkUpdateRecord", "_grist_Tables_column", [21,22],
                            {"colId": ["Carol X", "Carol-X"]}])
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",    "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Carol_X",  "Bob Z",  "Text",     False                 ],
      [ 22,     1,            "Carol_X2", "Bob-Z",  "Numeric",  False                 ],
    ])

    # Check confusing bulk updates with different keys changing for different records.
    out_actions = self.apply_user_action(["BulkUpdateRecord", "_grist_Tables_column", [21,22], {
      "label": ["Bob Z", "Bob-Z"],          # Unchanged from before.
      "untieColIdFromLabel": [True, False]
    }])
    self.assertPartialOutActions(out_actions, { "stored": [
      ["RenameColumn", "Address", "Carol_X2", "Bob_Z"],
      ["BulkUpdateRecord", "_grist_Tables_column", [21, 22],
       {"colId": ["Carol_X", "Bob_Z"],      # Note that only one column is changing.
        "untieColIdFromLabel": [True, False]
        # No update to label, they get trimmed as unchanged.
       }
      ],
    ]})
    self.assertTableData("_grist_Tables_column", cols="subset", data=[
      [ "id",   "parentId",   "colId",    "label",  "type",     "untieColIdFromLabel" ],
      [ 21,     1,            "Carol_X",  "Bob Z",  "Text",     True                  ],
      [ 22,     1,            "Bob_Z",    "Bob-Z",  "Numeric",  False                 ],
    ])

  #----------------------------------------------------------------------

  address_table_data =  [
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

  sample2 = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Address", [
        [11, "city",        "Text",       False, "", "", ""],
        [12, "state",       "Text",       False, "", "", ""],
        [13, "amount",      "Numeric",    False, "", "", ""],
      ]]
    ],
    "DATA": {
      "Address": address_table_data
    }
  })

  def init_sample_data(self):
    # Add a new view with a section, and a new table to that view, and a summary table.
    self.load_sample(self.sample2)
    self.apply_user_action(["CreateViewSection", 1, 0, "record", None, None])
    self.apply_user_action(["AddEmptyTable", None])
    self.apply_user_action(["CreateViewSection", 2, 1, "record", None, None])
    self.apply_user_action(["CreateViewSection", 1, 1, "record", [12], None])
    self.apply_user_action(["BulkAddRecord", "Table1", [None]*3, {
      "A": ["a", "b", "c"],
      "B": ["d", "e", "f"],
      "C": ["", "", ""]
    }])

    # Verify the new structure of tables and views.
    self.assertTables([
      Table(1, "Address", primaryViewId=0, summarySourceTable=0, columns=[
        Column(11, "city",  "Text", False, "", 0),
        Column(12, "state", "Text", False, "", 0),
        Column(13, "amount", "Numeric", False, "", 0),
      ]),
      Table(2, "Table1", 2, 0, columns=[
        Column(14, "manualSort", "ManualSortPos", False, "", 0),
        Column(15, "A", "Text", False, "", 0),
        Column(16, "B", "Text", False, "", 0),
        Column(17, "C", "Any", True, "", 0),
      ]),
      Table(3, "Address_summary_state", 0, 1, columns=[
        Column(18, "state", "Text", False, "", summarySourceCol=12),
        Column(19, "group", "RefList:Address", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(20, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
        Column(21, "amount", "Numeric", True, summarySourceCol=0, formula="SUM($group.amount)"),
      ]),
    ])
    self.assertViews([
      View(1, sections=[
        Section(1, parentKey="record", tableRef=1, fields=[
          Field(1, colRef=11),
          Field(2, colRef=12),
          Field(3, colRef=13),
        ]),
        Section(5, parentKey="record", tableRef=2, fields=[
          Field(13, colRef=15),
          Field(14, colRef=16),
          Field(15, colRef=17),
        ]),
        Section(7, parentKey="record", tableRef=3, fields=[
          Field(19, colRef=18),
          Field(20, colRef=20),
          Field(21, colRef=21),
        ]),
      ]),
      View(2, sections=[
        Section(2, parentKey="record", tableRef=2, fields=[
          Field(4, colRef=15),
          Field(5, colRef=16),
          Field(6, colRef=17),
        ]),
      ])
    ])
    self.assertTableData('Address', data=self.address_table_data)
    self.assertTableData('Table1', data=[
      ["id", "A", "B", "C", "manualSort"],
      [ 1,   "a", "d", None,    1.0],
      [ 2,   "b", "e", None,    2.0],
      [ 3,   "c", "f", None,    3.0],
    ])
    self.assertTableData("Address_summary_state", cols="subset", data=[
      [ "id", "state", "count", "amount"          ],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  ],
      [ 2,    "WA",     1,      3.                ],
      [ 3,    "IL",     1,      4.                ],
      [ 4,    "MA",     2,      5.+9              ],
    ])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_column_removals(self):
    # Verify removal of fields when columns are removed.

    self.init_sample_data()

    # Add link{Src,Target}ColRef to ViewSections. These aren't actually meaningful links, but they
    # should still get cleared automatically when columns get removed.
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 2, {
      'linkSrcSectionRef': 1,
      'linkSrcColRef': 11,
      'linkTargetColRef': 16
    }])
    self.assertTableData('_grist_Views_section', cols="subset", rows="subset", data=[
      ["id",  "linkSrcSectionRef",  "linkSrcColRef",  "linkTargetColRef"],
      [2,     1,                    11,               16                ],
    ])

    # Test that we can remove multiple columns using BulkUpdateRecord.
    self.apply_user_action(["BulkRemoveRecord", '_grist_Tables_column', [11, 16]])

    # Test that link{Src,Target}colRef back-references get unset.
    self.assertTableData('_grist_Views_section', cols="subset", rows="subset", data=[
      ["id",  "linkSrcSectionRef",  "linkSrcColRef",  "linkTargetColRef"],
      [2,     1,                    0,                0                 ],
    ])

    # Test that columns and section fields got removed.
    self.assertTables([
      Table(1, "Address", primaryViewId=0, summarySourceTable=0, columns=[
        Column(12, "state", "Text", False, "", 0),
        Column(13, "amount", "Numeric", False, "", 0),
      ]),
      Table(2, "Table1", 2, 0, columns=[
        Column(14, "manualSort", "ManualSortPos", False, "", 0),
        Column(15, "A", "Text", False, "", 0),
        Column(17, "C", "Any", True, "", 0),
      ]),
      Table(3, "Address_summary_state", 0, 1, columns=[
        Column(18, "state", "Text", False, "", summarySourceCol=12),
        Column(19, "group", "RefList:Address", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(20, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
        Column(21, "amount", "Numeric", True, summarySourceCol=0, formula="SUM($group.amount)"),
      ]),
    ])
    self.assertViews([
      View(1, sections=[
        Section(1, parentKey="record", tableRef=1, fields=[
          Field(2, colRef=12),
          Field(3, colRef=13),
        ]),
        Section(5, parentKey="record", tableRef=2, fields=[
          Field(13, colRef=15),
          Field(15, colRef=17),
        ]),
        Section(7, parentKey="record", tableRef=3, fields=[
          Field(19, colRef=18),
          Field(20, colRef=20),
          Field(21, colRef=21),
        ]),
      ]),
      View(2, sections=[
        Section(2, parentKey="record", tableRef=2, fields=[
          Field(4, colRef=15),
          Field(6, colRef=17),
        ]),
      ])
    ])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_summary_column_removals(self):
    # Verify that when we remove a column used for summary-table group-by, it updates summary
    # tables appropriately.

    self.init_sample_data()

    # Test that we cannot remove group-by columns from summary tables directly.
    with self.assertRaisesRegex(ValueError, "cannot remove .* group-by"):
      self.apply_user_action(["BulkRemoveRecord", '_grist_Tables_column', [20,18]])

    # Test that group-by columns in summary tables get removed.
    self.apply_user_action(["BulkRemoveRecord", '_grist_Tables_column', [11,12,16]])

    # Verify the new structure of tables and views.
    self.assertTables([
      Table(1, "Address", primaryViewId=0, summarySourceTable=0, columns=[
        Column(13, "amount", "Numeric", False, "", 0),
      ]),
      Table(2, "Table1", 2, 0, columns=[
        Column(14, "manualSort", "ManualSortPos", False, "", 0),
        Column(15, "A", "Text", False, "", 0),
        Column(17, "C", "Any", True, "", 0),
      ]),
      # Note that the summary table here switches to a new one, without the deleted group-by.
      Table(4, "Address_summary", 0, 1, columns=[
        Column(23, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
        Column(24, "amount", "Numeric", True, summarySourceCol=0, formula="SUM($group.amount)"),
        Column(22, "group", "RefList:Address", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
      ]),
    ])
    self.assertViews([
      View(1, sections=[
        Section(1, parentKey="record", tableRef=1, fields=[
          Field(3, colRef=13),
        ]),
        Section(5, parentKey="record", tableRef=2, fields=[
          Field(13, colRef=15),
          Field(15, colRef=17),
        ]),
        Section(7, parentKey="record", tableRef=4, fields=[
          Field(20, colRef=23),
          Field(21, colRef=24),
        ]),
      ]),
      View(2, sections=[
        Section(2, parentKey="record", tableRef=2, fields=[
          Field(4, colRef=15),
          Field(6, colRef=17),
        ]),
      ])
    ])

    # Verify the data itself.
    self.assertTableData('Address', data=[
      ["id",  "amount" ],
      [ 21,   1.       ],
      [ 22,   2.       ],
      [ 23,   3.       ],
      [ 24,   4.       ],
      [ 25,   5.       ],
      [ 26,   6.       ],
      [ 27,   7.       ],
      [ 28,   8.       ],
      [ 29,   9.       ],
      [ 30,   10.      ],
      [ 31,   11.      ],
    ])
    self.assertTableData('Table1', data=[
      ["id", "A", "C", "manualSort"],
      [ 1,   "a", None,    1.0],
      [ 2,   "b", None,    2.0],
      [ 3,   "c", None,    3.0],
    ])
    self.assertTableData("Address_summary", cols="subset", data=[
      [ "id", "count", "amount"          ],
      [ 1,     7+1+1+2,   1.+2+6+7+8+10+11+3+4+5+9  ],
    ])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_column_sort_removals(self):
    # Verify removal of sort spec entries when columns are removed.

    self.init_sample_data()

    # Add sortSpecs to ViewSections.
    self.apply_user_action(['BulkUpdateRecord', '_grist_Views_section', [2, 3, 5],
      {'sortColRefs': ['[15, -16]', '[-15, 16, 17]', '[19]']}
    ])
    self.assertTableData('_grist_Views_section', cols="subset", rows="subset", data=[
      ["id",  "sortColRefs"  ],
      [2,     '[15, -16]'    ],
      [3,     '[-15, 16, 17]'],
      [5,     '[19]'         ],
    ])

    # Remove column, and check that the correct sortColRefs items are removed.
    self.apply_user_action(["RemoveRecord", '_grist_Tables_column', 16])
    self.assertTableData('_grist_Views_section', cols="subset", rows="subset", data=[
      ["id",  "sortColRefs"],
      [2,     '[15]'       ],
      [3,     '[-15, 17]'  ],
      [5,     '[19]'       ],
    ])

    # Update sortColRefs for next test.
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 3,
      {'sortColRefs': '[-15, -16, 17]'}
    ])

    # Remove multiple columns using BulkUpdateRecord, and check that the sortSpecs are updated.
    self.apply_user_action(["BulkRemoveRecord", '_grist_Tables_column', [15, 17, 19]])
    self.assertTableData('_grist_Views_section', cols="subset", rows="subset", data=[
      ["id",  "sortColRefs"],
      [2,     '[]'         ],
      [3,     '[-16]'      ],
      [5,     '[]'         ],
    ])
