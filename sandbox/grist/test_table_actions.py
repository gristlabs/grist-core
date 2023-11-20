import logging

import testutil
import test_engine
from test_engine import Table, Column, View, Section, Field

log = logging.getLogger(__name__)

class TestTableActions(test_engine.EngineTestCase):

  address_table_data = [
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

  people_table_data = [
    ["id",  "name",   "address" ],
    [ 1,    "Alice",  22        ],
    [ 2,    "Bob",    25        ],
    [ 3,    "Carol",  27        ],
  ]

  def init_sample_data(self):
    # Add a couple of tables, including references.
    self.apply_user_action(["AddTable", "Address", [
      {"id": "city",    "type": "Text"},
      {"id": "state",   "type": "Text"},
      {"id": "amount",  "type": "Numeric"},
    ]])
    self.apply_user_action(["AddTable", "People", [
      {"id": "name",    "type": "Text"},
      {"id": "address", "type": "Ref:Address"},
      {"id": "city",    "type": "Any", "formula": "$address.city" }
    ]])

    # Populate some data.
    d = testutil.table_data_from_rows("Address", self.address_table_data[0],
                                      self.address_table_data[1:])
    self.apply_user_action(["BulkAddRecord", "Address", d.row_ids, d.columns])

    d = testutil.table_data_from_rows("People", self.people_table_data[0],
                                      self.people_table_data[1:])
    self.apply_user_action(["BulkAddRecord", "People", d.row_ids, d.columns])

    # Add a view with several sections, including a summary table.
    self.apply_user_action(["CreateViewSection", 1, 0, 'record', None, None])
    self.apply_user_action(["CreateViewSection", 1, 3, 'record', [3], None])
    self.apply_user_action(["CreateViewSection", 2, 3, 'record', None, None])

    # Verify the new structure of tables and views.
    self.assertTables([
      Table(1, "Address", primaryViewId=1, summarySourceTable=0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "city",       "Text", False, "", 0),
        Column(3, "state",      "Text", False, "", 0),
        Column(4, "amount",     "Numeric", False, "", 0),
      ]),
      Table(2, "People", primaryViewId=2, summarySourceTable=0, columns=[
        Column(5, "manualSort", "ManualSortPos", False, "", 0),
        Column(6, "name",       "Text",         False, "", 0),
        Column(7, "address",    "Ref:Address",  False, "", 0),
        Column(8, "city",       "Any", True, "$address.city", 0),
      ]),
      Table(3, "Address_summary_state", 0, 1, columns=[
        Column(9, "state", "Text", False, "", summarySourceCol=3),
        Column(10, "group", "RefList:Address", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(11, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
        Column(12, "amount", "Numeric", True, summarySourceCol=0, formula="SUM($group.amount)"),
      ]),
    ])
    self.assertViews([
      View(1, sections=[
        Section(1, parentKey="record", tableRef=1, fields=[
          Field(1, colRef=2),
          Field(2, colRef=3),
          Field(3, colRef=4),
        ]),
      ]),
      View(2, sections=[
        Section(4, parentKey="record", tableRef=2, fields=[
          Field(10, colRef=6),
          Field(11, colRef=7),
          Field(12, colRef=8),
        ]),
      ]),
      View(3, sections=[
        Section(7, parentKey="record", tableRef=1, fields=[
          Field(19, colRef=2),
          Field(20, colRef=3),
          Field(21, colRef=4),
        ]),
        Section(9, parentKey="record", tableRef=3, fields=[
          Field(25, colRef=9),
          Field(26, colRef=11),
          Field(27, colRef=12),
        ]),
        Section(10, parentKey="record", tableRef=2, fields=[
          Field(28, colRef=6),
          Field(29, colRef=7),
          Field(30, colRef=8),
        ]),
      ]),
    ])

    # Verify the data we've loaded.
    self.assertTableData('Address', cols="subset", data=self.address_table_data)
    self.assertTableData('People', cols="subset", data=self.people_table_data)
    self.assertTableData("Address_summary_state", cols="subset", data=[
      [ "id", "state", "count", "amount"          ],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  ],
      [ 2,    "WA",     1,      3.                ],
      [ 3,    "IL",     1,      4.                ],
      [ 4,    "MA",     2,      5.+9              ],
    ])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_table_updates(self):
    # Verify table renames triggered by UpdateRecord actions, and related behavior.

    # Load a sample with a few table and views.
    self.init_sample_data()

    # Verify that we can rename tables via UpdatRecord actions, including multiple tables.
    self.apply_user_action(["BulkUpdateRecord", "_grist_Tables", [1,2],
                            {"tableId": ["Location", "Persons"]}])

    # Check that requested tables and summary tables got renamed correctly.
    self.assertTableData('_grist_Tables', cols="subset", data=[
      ["id",  "tableId"],
      [1,     "Location"],
      [2,     "Persons"],
      [3,     "Location_summary_state"],
    ])

    # Check that reference columns to renamed tables get their type modified.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ["id",  "colId",    "type"],
      [7,     "address",  "Ref:Location"],
      [10,    "group",    "RefList:Location"],
    ])

    # Do a bulk update to rename A and B to conflicting names.
    self.apply_user_action(["AddTable", "A", [{"id": "a", "type": "Text"}]])
    out_actions = self.apply_user_action(["BulkUpdateRecord", "_grist_Tables", [1,2],
                            {"tableId": ["A", "A"]}])

    # See what doc-actions get generated.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "Persons", "address", {"type": "Int"}],
        ["ModifyColumn", "Location_summary_state", "group", {"type": "Int"}],
        ["RenameTable", "Location", "A2"],
        ["RenameTable", "Location_summary_state", "A2_summary_state"],
        ["RenameTable", "Persons", "A3"],
        ["BulkUpdateRecord", "_grist_Tables", [1, 3, 2],
         {"tableId": ["A2", "A2_summary_state", "A3"]}],
        ["ModifyColumn", "A3", "address", {"type": "Ref:A2"}],
        ["ModifyColumn", "A2_summary_state", "group", {"type": "RefList:A2"}],
        ["BulkUpdateRecord", "_grist_Tables_column", [7, 10], {"type": ["Ref:A2", "RefList:A2"]}],
      ]
    })

    # Check that requested tables and summary tables got renamed correctly.
    self.assertTableData('_grist_Tables', cols="subset", data=[
      ["id",  "tableId"],
      [1,     "A2"],
      [2,     "A3"],
      [3,     "A2_summary_state"],
      [4,     "A"],
    ])

    # Check that reference columns to renamed tables get their type modified.
    self.assertTableData('_grist_Tables_column', rows="subset", cols="subset", data=[
      ["id",  "colId",    "type"],
      [7,     "address",  "Ref:A2"],
      [10,    "group",    "RefList:A2"],
    ])

    # Verify the data we've loaded.
    self.assertTableData('A2', cols="subset", data=self.address_table_data)
    self.assertTableData('A3', cols="subset", data=self.people_table_data)
    self.assertTableData("A2_summary_state", cols="subset", data=[
      [ "id", "state", "count", "amount"          ],
      [ 1,    "NY",     7,      1.+2+6+7+8+10+11  ],
      [ 2,    "WA",     1,      3.                ],
      [ 3,    "IL",     1,      4.                ],
      [ 4,    "MA",     2,      5.+9              ],
    ])

  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_table_renames_summary_by_ref(self):
    # Verify table renames when there is a group-by column that's a Reference.

    # This tests a potential bug since a table rename needs to modify Reference types, but
    # group-by columns aren't supposed to be modifiable.
    self.init_sample_data()

    # Add a table grouped by a reference column (the 'Ref:Address' column named 'address').
    self.apply_user_action(["CreateViewSection", 2, 0, 'record', [7], None])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",    "type",           "isFormula",    "formula" ],
      [ 13,   "address",  "Ref:Address",    False,          ""        ],
      [ 14,   "group",    "RefList:People", True, "table.getSummarySourceGroup(rec)" ],
      [ 15,   "count",    "Int",            True,           "len($group)" ],
    ], rows=lambda r: (r.parentId.id == 4))

    # Now rename the table Address -> Location.
    out_actions = self.apply_user_action(["RenameTable", "Address", "Location"])

    # See what doc-actions get generated.
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["ModifyColumn", "People", "address", {"type": "Int"}],
        ["ModifyColumn", "Address_summary_state", "group", {"type": "Int"}],
        ["ModifyColumn", "People_summary_address", "address", {"type": "Int"}],
        ["RenameTable", "Address", "Location"],
        ["RenameTable", "Address_summary_state", "Location_summary_state"],
        ["BulkUpdateRecord", "_grist_Tables", [1, 3],
         {"tableId": ["Location", "Location_summary_state"]}],
        ["ModifyColumn", "People", "address", {"type": "Ref:Location"}],
        ["ModifyColumn", "Location_summary_state", "group", {"type": "RefList:Location"}],
        ["ModifyColumn", "People_summary_address", "address", {"type": "Ref:Location"}],
        ["BulkUpdateRecord", "_grist_Tables_column", [7, 10, 13],
         {"type": ["Ref:Location", "RefList:Location", "Ref:Location"]}],
      ]
    })

    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",    "type",           "isFormula",    "formula" ],
      [ 13,   "address",  "Ref:Location",    False,          ""        ],
      [ 14,   "group",    "RefList:People", True, "table.getSummarySourceGroup(rec)" ],
      [ 15,   "count",    "Int",            True,           "len($group)" ],
    ], rows=lambda r: (r.parentId.id == 4))


  #----------------------------------------------------------------------

  @test_engine.test_undo
  def test_table_removes(self):
    # Verify table removals triggered by UpdateRecord actions, and related behavior.

    # Same setup as previous test.
    self.init_sample_data()

    # Add one more table, and one more view for tables #1 and #4 (those we are about to delete).
    self.apply_user_action(["AddEmptyTable", None])
    out_actions = self.apply_user_action(["CreateViewSection", 1, 0, 'detail', None, None])
    self.assertEqual(out_actions.retValues[0]["viewRef"], 5)
    self.apply_user_action(["CreateViewSection", 4, 5, 'detail', None, None])

    # See what's in TabBar table, to verify after we remove a table.
    self.assertTableData('_grist_TabBar', cols="subset", data=[
      ["id",  "viewRef"],
      [1,     1],
      [2,     2],
      [3,     3],
      [4,     4],
      [5,     5],
    ])

    # Remove two tables, ensure certain views get removed.
    self.apply_user_action(["BulkRemoveRecord", "_grist_Tables", [1, 4]])

    # See that some TabBar entries disappear, or tableRef gets unset.
    self.assertTableData('_grist_TabBar', cols="subset", data=[
      ["id",  "viewRef"],
      [2,     2],
      [3,     3],
    ])

    # Check that reference columns to this table get converted
    self.assertTables([
      Table(2, "People", primaryViewId=2, summarySourceTable=0, columns=[
        Column(5, "manualSort", "ManualSortPos", False, "", 0),
        Column(6, "name",       "Text",         False, "", 0),
        Column(7, "address",    "Int", False, "", 0),
        Column(8, "city",       "Any", True, "$address.city", 0),
      ]),
      # Note that the summary table is also gone.
    ])
    self.assertViews([
      View(2, sections=[
        Section(4, parentKey="record", tableRef=2, fields=[
          Field(10, colRef=6),
          Field(11, colRef=7),
          Field(12, colRef=8),
        ]),
      ]),
      View(3, sections=[
        Section(10, parentKey="record", tableRef=2, fields=[
          Field(28, colRef=6),
          Field(29, colRef=7),
          Field(30, colRef=8),
        ]),
      ]),
    ])

  @test_engine.test_undo
  def test_remove_table_referenced_by_formula(self):
    self.init_sample_data()

    # Add a simple formula column of reference type.
    # Its type will be changed to Any.
    self.add_column(
      "People", "address2", type="Ref:Address", isFormula=True, formula="$address"
    )
    # Add a similar reflist column, but change it to a data column.
    # The formula is just an easy way to populate values for the test.
    # A data column of type reflist should be changed to text.
    self.add_column(
      "People", "addresses", type="RefList:Address", isFormula=True, formula="[$address, $address]"
    )
    self.modify_column("People", "addresses", isFormula=False)

    # Now remove the referenced table and see what happens to the ref columns.
    self.apply_user_action(["RemoveTable", "Address"])
    self.assertTables([
      Table(2, "People", primaryViewId=2, summarySourceTable=0, columns=[
        Column(5, "manualSort", "ManualSortPos", False, "", 0),
        Column(6, "name",       "Text",         False, "", 0),
        # Original data column of type Ref:Address is changed to Int.
        Column(7, "address",    "Int", False, "", 0),
        Column(8, "city",       "Any", True, "$address.city", 0),
        # Formula column of type Ref:Address is changed to Any.
        Column(13, "address2",  "Any", True, "$address", 0),
        # Data column of type RefList:Address is changed to Text.
        Column(14, "addresses", "Text", False, "[$address, $address]", 0),
      ]),
    ])
    self.assertTableData('People', cols="subset", data=[
    ["id",  "name",   "address", "address2", "addresses"],
    [ 1,    "Alice",  22,        22,         "22,22"],
    [ 2,    "Bob",    25,        25,         "25,25"],
    [ 3,    "Carol",  27,        27,         "27,27"],
  ])

  @test_engine.test_undo
  def test_remove_table_referenced_by_summary_groupby_col_without_visible_col(self):
    self.init_sample_data()
    # Create a summary table of People grouped by address (a reference column).
    self.apply_user_action(["CreateViewSection", 2, 0, 'record', [7], None])

    self.assertTables([
      Table(1, "Address", primaryViewId=1, summarySourceTable=0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "city",       "Text", False, "", 0),
        Column(3, "state",      "Text", False, "", 0),
        Column(4, "amount",     "Numeric", False, "", 0),
      ]),
      Table(2, "People", primaryViewId=2, summarySourceTable=0, columns=[
        Column(5, "manualSort", "ManualSortPos", False, "", 0),
        Column(6, "name",       "Text",         False, "", 0),
        Column(7, "address",    "Ref:Address",  False, "", 0),
        Column(8, "city",       "Any", True, "$address.city", 0),
      ]),
      Table(3, "Address_summary_state", 0, 1, columns=[
        Column(9, "state", "Text", False, "", summarySourceCol=3),
        Column(10, "group", "RefList:Address", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(11, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
        Column(12, "amount", "Numeric", True, summarySourceCol=0, formula="SUM($group.amount)"),
      ]),
      Table(4, "People_summary_address", 0, 2, columns=[
        Column(13, "address", "Ref:Address", False, "", summarySourceCol=7),
        Column(14, "group", "RefList:People", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(15, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
      ]),
    ])
    self.assertTableData('People_summary_address', data=[
      ["id", "address", "count", "group"],
      [1, 22, 1, [1]],
      [2, 25, 1, [2]],
      [3, 27, 1, [3]],
    ])

    # Now remove the referenced table.
    self.apply_user_action(["RemoveTable", "Address"])
    # In both the People and summary tables, the 'address' reference column
    # is converted to Int, because it didn't have a visible/display column.
    self.assertTables([
      Table(2, "People", primaryViewId=2, summarySourceTable=0, columns=[
        Column(5, "manualSort", "ManualSortPos", False, "", 0),
        Column(6, "name",       "Text",         False, "", 0),
        Column(7, "address",    "Int",  False, "", 0),
        Column(8, "city",       "Any", True, "$address.city", 0),
      ]),
      Table(4, "People_summary_address", 0, 2, columns=[
        Column(13, "address", "Int", False, "", summarySourceCol=7),
        Column(14, "group", "RefList:People", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(15, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
      ]),
    ])
    self.assertTableData('People', cols="subset", data=self.people_table_data)
    self.assertTableData('People_summary_address', data=[
      ["id", "address", "count", "group"],
      [1, 22, 1, [1]],
      [2, 25, 1, [2]],
      [3, 27, 1, [3]],
    ])

  @test_engine.test_undo
  def test_remove_table_referenced_by_summary_groupby_col_with_visible_col(self):
    # Similar to the test above, but now the reference column has a visible column.
    self.init_sample_data()
    self.modify_column("People", "address", visibleCol=2)
    self.apply_user_action(["SetDisplayFormula", "People", 0, 7, "$address.city"])
    self.apply_user_action(["CreateViewSection", 2, 0, 'record', [7], None])

    self.assertTables([
      Table(1, "Address", primaryViewId=1, summarySourceTable=0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "city",       "Text", False, "", 0),
        Column(3, "state",      "Text", False, "", 0),
        Column(4, "amount",     "Numeric", False, "", 0),
      ]),
      Table(2, "People", primaryViewId=2, summarySourceTable=0, columns=[
        Column(5, "manualSort", "ManualSortPos", False, "", 0),
        Column(6, "name",       "Text",         False, "", 0),
        Column(7, "address",    "Ref:Address",  False, "", 0),
        Column(8, "city",       "Any", True, "$address.city", 0),
        Column(13, "gristHelper_Display", "Any", True, "$address.city", 0),
      ]),
      Table(3, "Address_summary_state", 0, 1, columns=[
        Column(9, "state", "Text", False, "", summarySourceCol=3),
        Column(10, "group", "RefList:Address", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(11, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
        Column(12, "amount", "Numeric", True, summarySourceCol=0, formula="SUM($group.amount)"),
      ]),
      Table(4, "People_summary_address", 0, 2, columns=[
        Column(14, "address", "Ref:Address", False, "", summarySourceCol=7),
        Column(15, "group", "RefList:People", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(16, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
        Column(17, "gristHelper_Display", "Any", True, "$address.city", 0),
      ]),
    ])
    self.assertTableData('People_summary_address', data=[
      ["id", "address", "count", "group", "gristHelper_Display"],
      [1, 22, 1, [1], "Albany"],
      [2, 25, 1, [2], "Bedford"],
      [3, 27, 1, [3], "Buffalo"],
    ])

    self.apply_user_action(["RemoveTable", "Address"])
    self.assertTables([
      Table(2, "People", primaryViewId=2, summarySourceTable=0, columns=[
        Column(5, "manualSort", "ManualSortPos", False, "", 0),
        Column(6, "name",       "Text",         False, "", 0),
        # Reference column is converted to the visible column type, i.e. Text.
        Column(7, "address",    "Text",  False, "", 0),
        Column(8, "city",       "Any", True, "$address.city", 0),
      ]),
      Table(4, "People_summary_address", 0, 2, columns=[
        # Reference column is converted to the visible column type, i.e. Text.
        Column(14, "address", "Text", False, "", summarySourceCol=7),
        Column(15, "group", "RefList:People", True, summarySourceCol=0,
               formula="table.getSummarySourceGroup(rec)"),
        Column(16, "count", "Int", True, summarySourceCol=0, formula="len($group)"),
      ]),
    ])
    self.assertTableData('People', cols="subset", data=[
      ["id",  "name",   "address" ],
      [ 1,    "Alice",  "Albany"],
      [ 2,    "Bob",    "Bedford"],
      [ 3,    "Carol",  "Buffalo"],
    ])
    self.assertTableData('People_summary_address', data=[
      ["id", "address", "count", "group"],
      [ 4,   "Albany",  1,       [1]],
      [ 5,   "Bedford", 1,       [2]],
      [ 6,   "Buffalo", 1,       [3]],
    ])
