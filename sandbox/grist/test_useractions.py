import types
import logger
import useractions

import testutil
import test_engine
from test_engine import Table, Column, View, Section, Field

log = logger.Logger(__name__, logger.INFO)

class TestUserActions(test_engine.EngineTestCase):
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

  starting_table = Table(1, "Address", primaryViewId=0, summarySourceTable=0, columns=[
    Column(21, "city", "Text", isFormula=False, formula="", summarySourceCol=0)
  ])

  #----------------------------------------------------------------------
  def test_conversions(self):
    # Test the sequence of user actions as used for transform-based conversions. This is actually
    # not exactly what the client emits, but more like what the client should ideally emit.

    # Our sample has a Schools.city text column; we'll convert it to Ref:Address.
    self.load_sample(self.sample)

    # Add a new table for Schools so that we get the associated views and fields.
    self.apply_user_action(['AddTable', 'Schools', [{'id': 'city', 'type': 'Text'}]])
    self.apply_user_action(['BulkAddRecord', 'Schools', [1,2,3,4], {
      'city': ['New York', 'Colombia', 'New York', '']
    }])
    self.assertPartialData("_grist_Tables", ["id", "tableId"], [
      [1, "Address"],
      [2, "Schools"],
    ])
    self.assertPartialData("_grist_Tables_column",
                           ["id", "colId", "parentId", "parentPos", "widgetOptions"], [
      [21, "city",        1,  1.0, ""],
      [22, "manualSort",  2,  2.0, ""],
      [23, "city",        2,  3.0, ""],
    ])
    self.assertPartialData("_grist_Views_section_field", ["id", "colRef", "widgetOptions"], [
      [1,   23,   ""]
    ])
    self.assertPartialData("Schools", ["id", "city"], [
      [1,   "New York"  ],
      [2,   "Colombia"  ],
      [3,   "New York"  ],
      [4,   ""          ],
    ])

    # Our sample has a text column city.
    out_actions = self.add_column('Schools', 'grist_Transform',
                                  isFormula=True, formula='return $city', type='Text')
    self.assertPartialOutActions(out_actions, { "stored": [
      ['AddColumn', 'Schools', 'grist_Transform', {
        'type': 'Text', 'isFormula': True, 'formula': 'return $city',
      }],
      ['AddRecord', '_grist_Tables_column', 24, {
        'widgetOptions': '', 'parentPos': 4.0, 'isFormula': True, 'parentId': 2, 'colId':
        'grist_Transform', 'formula': 'return $city', 'label': 'grist_Transform',
        'type': 'Text'
      }],
      ["AddRecord", "_grist_Views_section_field", 2, {
        "colRef": 24, "parentId": 1, "parentPos": 2.0
      }],
      ["BulkUpdateRecord", "Schools", [1, 2, 3],
        {"grist_Transform": ["New York", "Colombia", "New York"]}],
    ]})

    out_actions = self.update_record('_grist_Tables_column', 24,
                                     type='Ref:Address',
                                     formula='return Address.lookupOne(city=$city).id')
    self.assertPartialOutActions(out_actions, { "stored": [
      ['ModifyColumn', 'Schools', 'grist_Transform', {
        'formula': 'return Address.lookupOne(city=$city).id', 'type': 'Ref:Address'}],
      ['UpdateRecord', '_grist_Tables_column', 24, {
        'formula': 'return Address.lookupOne(city=$city).id', 'type': 'Ref:Address'}],
      ["BulkUpdateRecord", "Schools", [1, 2, 3, 4], {"grist_Transform": [11, 12, 11, 0]}],
    ]})

    # It seems best if TypeTransform sets widgetOptions on grist_Transform column, so that they
    # can be copied in CopyFromColumn; rather than updating them after the copy is done.
    self.update_record('_grist_Views_section_field', 1, widgetOptions="hello")
    self.update_record('_grist_Tables_column', 24, widgetOptions="world")

    out_actions = self.apply_user_action(
      ['CopyFromColumn', 'Schools', 'grist_Transform', 'city', None])
    self.assertPartialOutActions(out_actions, { "stored": [
      ['ModifyColumn', 'Schools', 'city', {'type': 'Ref:Address'}],
      ['UpdateRecord', 'Schools', 4, {'city': 0}],
      ['UpdateRecord', '_grist_Views_section_field', 1, {'widgetOptions': ''}],
      ['UpdateRecord', '_grist_Tables_column', 23, {
        'type': 'Ref:Address', 'widgetOptions': 'world'
      }],
      ['BulkUpdateRecord', 'Schools', [1, 2, 3], {'city': [11, 12, 11]}],
      ["BulkUpdateRecord", "Schools", [1, 2, 3], {"grist_Transform": [0, 0, 0]}],
    ]})

    out_actions = self.update_record('_grist_Tables_column', 23,
                                    widgetOptions='{"widget":"Reference","visibleCol":"city"}')
    self.assertPartialOutActions(out_actions, { "stored": [
      ['UpdateRecord', '_grist_Tables_column', 23, {
        'widgetOptions': '{"widget":"Reference","visibleCol":"city"}'}],
    ]})

    out_actions = self.remove_column('Schools', 'grist_Transform')
    self.assertPartialOutActions(out_actions, { "stored": [
      ['RemoveRecord', '_grist_Views_section_field', 2],
      ['RemoveRecord', '_grist_Tables_column', 24],
      ['RemoveColumn', 'Schools', 'grist_Transform'],
    ]})

  #----------------------------------------------------------------------
  def test_create_section_existing_view(self):
    # Test that CreateViewSection works for an existing view.

    self.load_sample(self.sample)
    self.assertTables([self.starting_table])

    # Create a view + section for the initial table.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", None])

    # Verify that we got a new view, with one section, and three fields.
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=1, fields=[
        Field(1, colRef=21),
      ])
    ]) ])

    # Create a new section for the same view, check that only a section is added.
    self.apply_user_action(["CreateViewSection", 1, 1, "record", None])
    self.assertTables([self.starting_table])
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=1, fields=[
        Field(1, colRef=21),
      ]),
      Section(2, parentKey="record", tableRef=1, fields=[
        Field(2, colRef=21),
      ])
    ]) ])

    # Create another section for the same view, this time summarized.
    self.apply_user_action(["CreateViewSection", 1, 1, "record", [21]])
    summary_table = Table(2, "GristSummary_7_Address", 0, summarySourceTable=1, columns=[
        Column(22, "city", "Text", isFormula=False, formula="", summarySourceCol=21),
        Column(23, "group", "RefList:Address", isFormula=True,
               formula="table.getSummarySourceGroup(rec)", summarySourceCol=0),
        Column(24, "count", "Int", isFormula=True, formula="len($group)", summarySourceCol=0),
      ])
    self.assertTables([self.starting_table, summary_table])
    # Check that we still have one view, with sections for different tables.
    view = View(1, sections=[
      Section(1, parentKey="record", tableRef=1, fields=[
        Field(1, colRef=21),
      ]),
      Section(2, parentKey="record", tableRef=1, fields=[
        Field(2, colRef=21),
      ]),
      Section(3, parentKey="record", tableRef=2, fields=[
        Field(3, colRef=22),
        Field(4, colRef=24),
      ]),
    ])
    self.assertTables([self.starting_table, summary_table])
    self.assertViews([view])

    # Try to create a summary table for an invalid column, and check that it fails.
    with self.assertRaises(ValueError):
      self.apply_user_action(["CreateViewSection", 1, 1, "record", [23]])
    self.assertTables([self.starting_table, summary_table])
    self.assertViews([view])

  #----------------------------------------------------------------------
  def test_creates_section_new_table(self):
    # Test that CreateViewSection works for adding a new table.

    self.load_sample(self.sample)
    self.assertTables([self.starting_table])
    self.assertViews([])

    # When we create a section/view for new table, we get both a primary view, and the new view we
    # are creating.
    self.apply_user_action(["CreateViewSection", 0, 0, "record", None])
    new_table = Table(2, "Table1", primaryViewId=1, summarySourceTable=0, columns=[
      Column(22, "manualSort", "ManualSortPos", isFormula=False, formula="", summarySourceCol=0),
      Column(23, "A", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(24, "B", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(25, "C", "Any", isFormula=True, formula="", summarySourceCol=0),
    ])
    primary_view = View(1, sections=[
      Section(1, parentKey="record", tableRef=2, fields=[
        Field(1, colRef=23),
        Field(2, colRef=24),
        Field(3, colRef=25),
      ])
    ])
    new_view = View(2, sections=[
      Section(2, parentKey="record", tableRef=2, fields=[
        Field(4, colRef=23),
        Field(5, colRef=24),
        Field(6, colRef=25),
      ])
    ])
    self.assertTables([self.starting_table, new_table])
    self.assertViews([primary_view, new_view])

    # Create another section in an existing view for a new table.
    self.apply_user_action(["CreateViewSection", 0, 2, "record", None])
    new_table2 = Table(3, "Table2", primaryViewId=3, summarySourceTable=0, columns=[
      Column(26, "manualSort", "ManualSortPos", isFormula=False, formula="", summarySourceCol=0),
      Column(27, "A", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(28, "B", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(29, "C", "Any", isFormula=True, formula="", summarySourceCol=0),
    ])
    primary_view2 = View(3, sections=[
      Section(3, parentKey="record", tableRef=3, fields=[
        Field(7, colRef=27),
        Field(8, colRef=28),
        Field(9, colRef=29),
      ])
    ])
    new_view.sections.append(
      Section(4, parentKey="record", tableRef=3, fields=[
        Field(10, colRef=27),
        Field(11, colRef=28),
        Field(12, colRef=29),
      ])
    )
    # Check that we have a new table, only the primary view as new view; and a new section.
    self.assertTables([self.starting_table, new_table, new_table2])
    self.assertViews([primary_view, new_view, primary_view2])

    # Check that we can't create a summary of a table grouped by a column that doesn't exist yet.
    with self.assertRaises(ValueError):
      self.apply_user_action(["CreateViewSection", 0, 2, "record", [31]])
    self.assertTables([self.starting_table, new_table, new_table2])
    self.assertViews([primary_view, new_view, primary_view2])

    # But creating a new table and showing totals for it is possible though dumb.
    self.apply_user_action(["CreateViewSection", 0, 2, "record", []])

    # We expect a new table.
    new_table3 = Table(4, "Table3", primaryViewId=4, summarySourceTable=0, columns=[
      Column(30, "manualSort", "ManualSortPos", isFormula=False, formula="", summarySourceCol=0),
      Column(31, "A", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(32, "B", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(33, "C", "Any", isFormula=True, formula="", summarySourceCol=0),
    ])
    # A summary of it.
    summary_table = Table(5, "GristSummary_6_Table3", 0, summarySourceTable=4, columns=[
      Column(34, "group", "RefList:Table3", isFormula=True,
             formula="table.getSummarySourceGroup(rec)", summarySourceCol=0),
      Column(35, "count", "Int", isFormula=True, formula="len($group)", summarySourceCol=0),
    ])
    # The primary view of the new table.
    primary_view3 = View(4, sections=[
      Section(5, parentKey="record", tableRef=4, fields=[
        Field(13, colRef=31),
        Field(14, colRef=32),
        Field(15, colRef=33),
      ])
    ])
    # And a new view section for the summary.
    new_view.sections.append(Section(6, parentKey="record", tableRef=5, fields=[
      Field(16, colRef=35)
    ]))
    self.assertTables([self.starting_table, new_table, new_table2, new_table3, summary_table])
    self.assertViews([primary_view, new_view, primary_view2, primary_view3])

  #----------------------------------------------------------------------

  def init_views_sample(self):
    # Add a new table and a view, to get some Views/Sections/Fields, and TableView/TabBar items.
    self.apply_user_action(['AddTable', 'Schools', [
      {'id': 'city', 'type': 'Text'},
      {'id': 'state', 'type': 'Text'},
      {'id': 'size', 'type': 'Numeric'},
    ]])
    self.apply_user_action(['BulkAddRecord', 'Schools', [1,2,3,4], {
      'city': ['New York', 'Colombia', 'New York', ''],
      'state': ['NY', 'NY', 'NY', ''],
      'size': [1000, 2000, 3000, 4000],
    }])
    # Add a new view; a second section (summary) to it; and a third view.
    self.apply_user_action(['CreateViewSection', 1, 0, 'detail', None])
    self.apply_user_action(['CreateViewSection', 1, 2, 'record', [3]])
    self.apply_user_action(['CreateViewSection', 1, 0, 'chart', None])
    self.apply_user_action(['CreateViewSection', 0, 2, 'record', None])

    # Verify the new structure of tables and views.
    self.assertTables([
      Table(1, "Schools", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "city",  "Text", False, "", 0),
        Column(3, "state", "Text", False, "", 0),
        Column(4, "size",  "Numeric", False, "", 0),
      ]),
      Table(2, "GristSummary_7_Schools", 0, 1, columns=[
        Column(5, "state", "Text", False, "", 3),
        Column(6, "group", "RefList:Schools", True, "table.getSummarySourceGroup(rec)", 0),
        Column(7, "count", "Int",     True, "len($group)", 0),
        Column(8, "size",  "Numeric", True, "SUM($group.size)", 0),
      ]),
      Table(3, 'Table1', 4, 0, columns=[
        Column(9, "manualSort", "ManualSortPos", False, "", 0),
        Column(10, "A", "Any", True, "", 0),
        Column(11, "B", "Any", True, "", 0),
        Column(12, "C", "Any", True, "", 0),
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
        Section(2, parentKey="detail", tableRef=1, fields=[
          Field(4, colRef=2),
          Field(5, colRef=3),
          Field(6, colRef=4),
        ]),
        Section(3, parentKey="record", tableRef=2, fields=[
          Field(7, colRef=5),
          Field(8, colRef=7),
          Field(9, colRef=8),
        ]),
        Section(6, parentKey='record', tableRef=3, fields=[
          Field(15, colRef=10),
          Field(16, colRef=11),
          Field(17, colRef=12),
        ]),
      ]),
      View(3, sections=[
        Section(4, parentKey="chart", tableRef=1, fields=[
          Field(10, colRef=2),
          Field(11, colRef=3),
        ]),
      ]),
      View(4, sections=[
        Section(5, parentKey='record', tableRef=3, fields=[
          Field(12, colRef=10),
          Field(13, colRef=11),
          Field(14, colRef=12),
        ]),
      ]),
    ])
    self.assertTableData('_grist_TableViews', data=[
      ["id",  "tableRef", "viewRef"],
      [1,     1,          2],
      [2,     1,          3],
    ])
    self.assertTableData('_grist_TabBar', cols="subset", data=[
      ["id",  "viewRef"],
      [1,     1],
      [2,     2],
      [3,     3],
      [4,     4],
    ])
    self.assertTableData('_grist_Pages', cols="subset", data=[
      ["id", "viewRef"],
      [1,    1],
      [2,    2],
      [3,    3],
      [4,    4]
    ])

  #----------------------------------------------------------------------

  def test_view_remove(self):
    # Add a couple of tables and views, to trigger creation of some related items.
    self.init_views_sample()

    # Remove a view. Ensure related items, sections, fields get removed.
    self.apply_user_action(["BulkRemoveRecord", "_grist_Views", [2,3]])

    # Verify the new structure of tables and views.
    self.assertTables([
      Table(1, "Schools", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "city",  "Text", False, "", 0),
        Column(3, "state", "Text", False, "", 0),
        Column(4, "size",  "Numeric", False, "", 0),
      ]),
      # Note that the summary table is gone.
      Table(3, 'Table1', 4, 0, columns=[
        Column(9, "manualSort", "ManualSortPos", False, "", 0),
        Column(10, "A", "Any", True, "", 0),
        Column(11, "B", "Any", True, "", 0),
        Column(12, "C", "Any", True, "", 0),
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
      View(4, sections=[
        Section(5, parentKey='record', tableRef=3, fields=[
          Field(12, colRef=10),
          Field(13, colRef=11),
          Field(14, colRef=12),
        ]),
      ]),
    ])
    self.assertTableData('_grist_TableViews', data=[
      ["id",  "tableRef", "viewRef"],
    ])
    self.assertTableData('_grist_TabBar', cols="subset", data=[
      ["id",  "viewRef"],
      [1,     1],
      [4,     4],
    ])
    self.assertTableData('_grist_Pages', cols="subset", data=[
      ["id",  "viewRef"],
      [1,     1],
      [4,     4],
    ])

  #----------------------------------------------------------------------

  def test_view_rename(self):
    # Add a couple of tables and views, to trigger creation of some related items.
    self.init_views_sample()

    # Verify the new structure of tables and views.
    self.assertTableData('_grist_Tables', cols="subset", data=[
      [ 'id', 'tableId',  'primaryViewId'  ],
      [ 1,    'Schools',                1],
      [ 2,    'GristSummary_7_Schools', 0],
      [ 3,    'Table1',                 4],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      [ 'id',   'name',   'primaryViewTable'  ],
      [ 1,      'Schools',    1],
      [ 2,      'New page',   0],
      [ 3,      'New page',   0],
      [ 4,      'Table1',     3],
    ])

    # Update the names in a few views, and ensure that primary ones cause tables to get renamed.
    self.apply_user_action(['BulkUpdateRecord', '_grist_Views', [2,3,4],
                            {'name': ['A', 'B', 'C']}])
    self.assertTableData('_grist_Tables', cols="subset", data=[
      [ 'id', 'tableId',  'primaryViewId'  ],
      [ 1,    'Schools',                1],
      [ 2,    'GristSummary_7_Schools', 0],
      [ 3,    'C',                      4],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      [ 'id',   'name',   'primaryViewTable'  ],
      [ 1,      'Schools',  1],
      [ 2,      'A',        0],
      [ 3,      'B',        0],
      [ 4,      'C',        3]
    ])

  #----------------------------------------------------------------------

  def test_section_removes(self):
    # Add a couple of tables and views, to trigger creation of some related items.
    self.init_views_sample()

    # Remove a couple of sections. Ensure their fields get removed.
    self.apply_user_action(['BulkRemoveRecord', '_grist_Views_section', [3,6]])

    self.assertViews([
      View(1, sections=[
        Section(1, parentKey="record", tableRef=1, fields=[
          Field(1, colRef=2),
          Field(2, colRef=3),
          Field(3, colRef=4),
        ]),
      ]),
      View(2, sections=[
        Section(2, parentKey="detail", tableRef=1, fields=[
          Field(4, colRef=2),
          Field(5, colRef=3),
          Field(6, colRef=4),
        ]),
      ]),
      View(3, sections=[
        Section(4, parentKey="chart", tableRef=1, fields=[
          Field(10, colRef=2),
          Field(11, colRef=3),
        ]),
      ]),
      View(4, sections=[
        Section(5, parentKey='record', tableRef=3, fields=[
          Field(12, colRef=10),
          Field(13, colRef=11),
          Field(14, colRef=12),
        ]),
      ]),
    ])

  #----------------------------------------------------------------------

  def test_schema_consistency_check(self):
    # Verify that schema consistency check actually runs, but only when schema is affected.

    self.init_views_sample()

    # Replace the engine's assert_schema_consistent() method with a mocked version.
    orig_method = self.engine.assert_schema_consistent
    count_calls = [0]
    def override(self):   # pylint: disable=unused-argument
      count_calls[0] += 1
      # pylint: disable=not-callable
      orig_method()
    self.engine.assert_schema_consistent = types.MethodType(override, self.engine)

    # Do a non-sschema action to ensure it doesn't get called.
    self.apply_user_action(['UpdateRecord', '_grist_Views', 2, {'name': 'A'}])
    self.assertEqual(count_calls[0], 0)

    # Do a schema action to ensure it gets called: this causes a table rename.
    self.apply_user_action(['UpdateRecord', '_grist_Views', 4, {'name': 'C'}])
    self.assertEqual(count_calls[0], 1)

    self.assertTableData('_grist_Tables', cols="subset", data=[
      [ 'id', 'tableId',  'primaryViewId'  ],
      [ 1,    'Schools',                1],
      [ 2,    'GristSummary_7_Schools', 0],
      [ 3,    'C',                      4],
    ])

    # Do another schema and non-schema action.
    self.apply_user_action(['UpdateRecord', 'Schools', 1, {'city': 'Seattle'}])
    self.assertEqual(count_calls[0], 1)

    self.apply_user_action(['UpdateRecord', '_grist_Tables_column', 2, {'colId': 'city2'}])
    self.assertEqual(count_calls[0], 2)

  #----------------------------------------------------------------------

  def test_new_column_conversions(self):
    self.init_views_sample()
    self.apply_user_action(['AddColumn', 'Schools', None, {}])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",         "isFormula",  "formula"],
      [1,     "manualSort", "ManualSortPos",False,        ""],
      [2,     "city",       "Text",         False,        ""],
      [3,     "state",      "Text",         False,        ""],
      [4,     "size",       "Numeric",      False,        ""],
      [13,    "A",          "Any",          True,         ""],
    ], rows=lambda r: r.parentId.id == 1)
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "city",         "A"],
      [1,     "New York",     None],
      [2,     "Colombia",     None],
      [3,     "New York",     None],
      [4,     "",             None],
    ])

    # Check that typing in text into the column produces a text column.
    out_actions = self.apply_user_action(['UpdateRecord', 'Schools', 3, {"A": "foo"}])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ["id",  "colId",      "type",         "isFormula",  "formula"],
      [13,    "A",          "Text",         False,        ""],
    ])
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "city",         "A"   ],
      [1,     "New York",     ""    ],
      [2,     "Colombia",     ""    ],
      [3,     "New York",     "foo" ],
      [4,     "",             ""    ],
    ])

    # Undo, and check that typing in a number produces a numeric column.
    self.apply_undo_actions(out_actions.undo)
    out_actions = self.apply_user_action(['UpdateRecord', 'Schools', 3, {"A": " -17.6"}])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ["id",  "colId",      "type",         "isFormula",  "formula"],
      [13,    "A",          "Numeric",      False,        ""],
    ])
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "city",         "A"   ],
      [1,     "New York",     0.0   ],
      [2,     "Colombia",     0.0   ],
      [3,     "New York",     -17.6 ],
      [4,     "",             0.0   ],
    ])

    # Undo, and set a formula for the new column instead.
    self.apply_undo_actions(out_actions.undo)
    self.apply_user_action(['UpdateRecord', '_grist_Tables_column', 13, {'formula': 'len($city)'}])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ["id",  "colId",      "type",     "isFormula",  "formula"],
      [13,    "A",          "Any",      True,         "len($city)"],
    ])
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "city",         "A" ],
      [1,     "New York",     8   ],
      [2,     "Colombia",     8   ],
      [3,     "New York",     8   ],
      [4,     "",             0   ],
    ])

    # Convert the formula column to non-formula.
    self.apply_user_action(['UpdateRecord', '_grist_Tables_column', 13, {'isFormula': False}])
    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      ["id",  "colId",      "type",     "isFormula",  "formula"],
      [13,    "A",          "Numeric",  False,        "len($city)"],
    ])
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "city",         "A" ],
      [1,     "New York",     8   ],
      [2,     "Colombia",     8   ],
      [3,     "New York",     8   ],
      [4,     "",             0   ],
    ])

    # Add some more formula columns of type 'Any'.
    self.apply_user_action(['AddColumn', 'Schools', None, {"formula": "1"}])
    self.apply_user_action(['AddColumn', 'Schools', None, {"formula": "'x'"}])
    self.apply_user_action(['AddColumn', 'Schools', None, {"formula": "$city == 'New York'"}])
    self.apply_user_action(['AddColumn', 'Schools', None, {"formula": "$city=='New York' or '-'"}])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",         "isFormula",  "formula"],
      [1,     "manualSort", "ManualSortPos",False,        ""],
      [2,     "city",       "Text",         False,        ""],
      [3,     "state",      "Text",         False,        ""],
      [4,     "size",       "Numeric",      False,        ""],
      [13,    "A",          "Numeric",      False,        "len($city)"],
      [14,    "B",          "Any",          True,         "1"],
      [15,    "C",          "Any",          True,         "'x'"],
      [16,    "D",          "Any",          True,         "$city == 'New York'"],
      [17,    "E",          "Any",          True,         "$city=='New York' or '-'"],
    ], rows=lambda r: r.parentId.id == 1)
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "city",         "A",  "B",  "C",  "D",    "E"],
      [1,     "New York",     8,    1,    "x",  True,   True],
      [2,     "Colombia",     8,    1,    "x",  False,  '-' ],
      [3,     "New York",     8,    1,    "x",  True,   True],
      [4,     "",             0,    1,    "x",  False,  '-' ],
    ])

    # Convert all these formulas to non-formulas, and see that their types get guessed OK.
    # TODO: We should also guess Int, Bool, Reference, ReferenceList, Date, and DateTime.
    # TODO: It is possibly better if B became Int, and D became Bool.
    self.apply_user_action(['BulkUpdateRecord', '_grist_Tables_column', [14,15,16,17],
                            {'isFormula': [False, False, False, False]}])
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",         "isFormula",  "formula"],
      [1,     "manualSort", "ManualSortPos",False,        ""],
      [2,     "city",       "Text",         False,        ""],
      [3,     "state",      "Text",         False,        ""],
      [4,     "size",       "Numeric",      False,        ""],
      [13,    "A",          "Numeric",      False,        "len($city)"],
      [14,    "B",          "Numeric",      False,        "1"],
      [15,    "C",          "Text",         False,        "'x'"],
      [16,    "D",          "Text",         False,        "$city == 'New York'"],
      [17,    "E",          "Text",         False,        "$city=='New York' or '-'"],
    ], rows=lambda r: r.parentId.id == 1)
    self.assertTableData('Schools', cols="subset", data=[
      ["id",  "city",         "A",  "B",  "C",  "D",    "E"],
      [1,     "New York",     8,    1.0,  "x",  "True",   'True'],
      [2,     "Colombia",     8,    1.0,  "x",  "False",  '-'   ],
      [3,     "New York",     8,    1.0,  "x",  "True",   'True'],
      [4,     "",             0,    1.0,  "x",  "False",  '-'   ],
    ])

  #----------------------------------------------------------------------

  def test_useraction_failures(self):
    # Verify that when a useraction fails, we revert any changes already applied.

    self.load_sample(self.sample)

    # Simple failure: bad action (last argument should be a dict). It shouldn't cause any actions
    # in the first place, just raise an exception about the argument being an int.
    with self.assertRaisesRegex(AttributeError, r"'int'"):
      self.apply_user_action(['AddColumn', 'Address', "A", 17])

    # Do some successful actions, just to make sure we know what they look like.
    self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
      ['AddColumn', 'Address', "B", {"isFormula": True}],
      ['UpdateRecord', 'Address', 11, {"city": "New York2"}],
    )])

    # More complicated: here some actions should succeed, but get reverted when a later one fails.
    with self.assertRaisesRegex(AttributeError, r"'int'"):
      self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
        ['UpdateRecord', 'Address', 11, {"city": "New York3"}],
        ['AddColumn', 'Address', "C", {"isFormula": True}],
        ['AddColumn', 'Address', "D", 17]
      )])

    with self.assertRaisesRegex(Exception, r"non-existent record #77"):
      self.engine.apply_user_actions([useractions.from_repr(ua) for ua in (
        ['UpdateRecord', 'Address', 11, {"city": "New York4"}],
        ['UpdateRecord', 'Address', 77, {"city": "Chicago"}],
      )])

    # Make sure that no columns got added except the intentionally successful one.
    self.assertTableData('_grist_Tables_column', cols="subset", data=[
      ["id",  "colId",      "type",         "isFormula",  "formula"],
      [21,     "city",       "Text",         False,        ""],
      [22,     "B",          "Any",          True,         ""],
    ], rows=lambda r: r.parentId.id == 1)

    # Make sure that no columns got added here either, and the only change to "New York" is the
    # one in the successful user-action.
    self.assertTableData('Address', cols="all", data=[
      ["id",  "city"      , "B"   ],
      [11,    "New York2" , None  ],
      [12,    "Colombia"  , None  ],
      [13,    "New Haven" , None  ],
      [14,    "West Haven", None  ],
    ])

  #----------------------------------------------------------------------

  def test_pages_remove(self):
    # Test that orphan pages get fixed after removing a page

    self.init_views_sample()

    # Moves page 2 to children of page 1.
    self.apply_user_action(['BulkUpdateRecord', '_grist_Pages', [2], {'indentation': [1]}])
    self.assertTableData('_grist_Pages', cols='subset', data=[
      ['id', 'indentation'],
      [   1,             0],
      [   2,             1],
      [   3,             0],
      [   4,             0],
    ])

    # Verify that removing page 1 fixes page 2 indentation.
    self.apply_user_action(['RemoveRecord', '_grist_Pages', 1])
    self.assertTableData('_grist_Pages', cols='subset', data=[
      ['id', 'indentation'],
      [   2,             0],
      [   3,             0],
      [   4,             0],
    ])

    # Removing last page should not fail
    # Verify that removing page 1 fixes page 2 indentation.
    self.apply_user_action(['RemoveRecord', '_grist_Pages', 4])
    self.assertTableData('_grist_Pages', cols='subset', data=[
      ['id', 'indentation'],
      [   2,             0],
      [   3,             0],
    ])

    # Removing a page that has no children should do nothing
    self.apply_user_action(['RemoveRecord', '_grist_Pages', 2])
    self.assertTableData('_grist_Pages', cols='subset', data=[
      ['id', 'indentation'],
      [   3,             0],
    ])

  #----------------------------------------------------------------------

  def test_rename_choices(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "ChoiceTable", [
          [1, "ChoiceColumn", "Choice", False, "", "ChoiceColumn", ""],
        ]],
        [2, "ChoiceListTable", [
          [2, "ChoiceListColumn", "ChoiceList", False, "", "ChoiceListColumn", ""],
        ]],
      ],
      "DATA": {
        "ChoiceTable": [
          ["id", "ChoiceColumn"],
          [1, "a"],
          [2, "b"],
          [3, "c"],
          [4, "d"],
          [5, None],
          [6, 5],
          [7, [[]]],
        ],
        "ChoiceListTable": [
          ["id", "ChoiceListColumn"],
          [1, ["a"]],
          [2, ["b"]],
          [3, ["c"]],
          [4, ["d"]],
          [5, None],
          [7, ["a", "b"]],
          [8, ["b", "c"]],
          [9, ["a", "c"]],
          [10, ["a", "b", "c"]],
          [11, 5],
          [12, [[]]],
        ],
      }
    })
    self.load_sample(sample)

    # Renames go in a loop to make sure that works correctly
    # a -> b -> c -> a -> b -> ...
    renames = {"a": "b", "b": "c", "c": "a"}
    out_actions_choice = self.apply_user_action(
      ["RenameChoices", "ChoiceTable", "ChoiceColumn", renames])
    out_actions_choice_list = self.apply_user_action(
      ["RenameChoices", "ChoiceListTable", "ChoiceListColumn", renames])

    self.assertPartialOutActions(
      out_actions_choice,
      {'stored':
         [['BulkUpdateRecord',
           'ChoiceTable',
           [1, 2, 3],
           {'ChoiceColumn': [u'b', u'c', u'a']}]]})

    self.assertPartialOutActions(
      out_actions_choice_list,
      {'stored':
         [['BulkUpdateRecord',
           'ChoiceListTable',
           [1, 2, 3, 7, 8, 9, 10],
           {'ChoiceListColumn': [['L', u'b'],
                                 ['L', u'c'],
                                 ['L', u'a'],
                                 ['L', u'b', u'c'],
                                 ['L', u'c', u'a'],
                                 ['L', u'b', u'a'],
                                 ['L', u'b', u'c', u'a']]}]]})

    self.assertTableData('ChoiceTable', data=[
      ["id", "ChoiceColumn"],
      [1, "b"],
      [2, "c"],
      [3, "a"],
      [4, "d"],
      [5, None],
      [6, 5],
      [7, [[]]],
    ])

    self.assertTableData('ChoiceListTable', data=[
      ["id", "ChoiceListColumn"],
      [1, ["b"]],
      [2, ["c"]],
      [3, ["a"]],
      [4, ["d"]],
      [5, None],
      [7, ["b", "c"]],
      [8, ["c", "a"]],
      [9, ["b", "a"]],
      [10, ["b", "c", "a"]],
      [11, 5],
      [12, [[]]],
    ])
