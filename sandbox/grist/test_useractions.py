# pylint:disable=too-many-lines
import json
import types
import logging
import useractions

import testutil
import test_engine
from test_engine import Table, Column, View, Section, Field
from schema import RecalcWhen

log = logging.getLogger(__name__)

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
      [1,   23,   ""],
      [2,   23,   ""],
      [3,   23,   ""],
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
      ["AddRecord", "_grist_Views_section_field", 4, {
        "colRef": 24, "parentId": 2, "parentPos": 4.0
      }],
      ["AddRecord", "_grist_Views_section_field", 5, {
        "colRef": 24, "parentId": 3, "parentPos": 5.0
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
      ["BulkRemoveRecord", "_grist_Views_section_field", [4, 5]],
      ['RemoveRecord', '_grist_Tables_column', 24],
      ['RemoveColumn', 'Schools', 'grist_Transform'],
    ]})

  #----------------------------------------------------------------------
  def test_create_section_existing_view(self):
    # Test that CreateViewSection works for an existing view.

    self.load_sample(self.sample)
    self.assertTables([self.starting_table])

    # Create a view + section for the initial table.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", None, None])

    # Verify that we got a new view, with one section, and three fields.
    self.assertViews([View(1, sections=[
      Section(1, parentKey="record", tableRef=1, fields=[
        Field(1, colRef=21),
      ])
    ]) ])

    # Create a new section for the same view, check that only a section is added.
    self.apply_user_action(["CreateViewSection", 1, 1, "record", None, None])
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
    self.apply_user_action(["CreateViewSection", 1, 1, "record", [21], None])
    summary_table = Table(2, "Address_summary_city", 0, summarySourceTable=1, columns=[
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
      Section(4, parentKey="record", tableRef=2, fields=[
        Field(5, colRef=22),
        Field(6, colRef=24),
      ]),
    ])
    self.assertTables([self.starting_table, summary_table])
    self.assertViews([view])

    # Try to create a summary table for an invalid column, and check that it fails.
    with self.assertRaises(ValueError):
      self.apply_user_action(["CreateViewSection", 1, 1, "record", [23], None])
    self.assertTables([self.starting_table, summary_table])
    self.assertViews([view])

  #----------------------------------------------------------------------
  def test_creates_section_new_table(self):
    # Test that CreateViewSection works for adding a new table.

    self.load_sample(self.sample)
    self.assertTables([self.starting_table])
    self.assertViews([])

    # When we create a section/view for new table, we got the new view we are creating,
    # without primary view.
    self.apply_user_action(["CreateViewSection", 0, 0, "record", None, None])
    new_table = Table(2, "Table1", primaryViewId=0, summarySourceTable=0, columns=[
      Column(22, "manualSort", "ManualSortPos", isFormula=False, formula="", summarySourceCol=0),
      Column(23, "A", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(24, "B", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(25, "C", "Any", isFormula=True, formula="", summarySourceCol=0),
    ])
    new_view = View(1, sections=[
      Section(3, parentKey="record", tableRef=2, fields=[
        Field(7, colRef=23),
        Field(8, colRef=24),
        Field(9, colRef=25),
      ])
    ])
    self.assertTables([self.starting_table, new_table])
    self.assertViews([new_view])

    # Create another section in an existing view for a new table.
    self.apply_user_action(["CreateViewSection", 0, 1, "record", None, None])
    new_table2 = Table(3, "Table2", primaryViewId=0, summarySourceTable=0, columns=[
      Column(26, "manualSort", "ManualSortPos", isFormula=False, formula="", summarySourceCol=0),
      Column(27, "A", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(28, "B", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(29, "C", "Any", isFormula=True, formula="", summarySourceCol=0),
    ])
    new_view.sections.append(
      Section(6, parentKey="record", tableRef=3, fields=[
        Field(16, colRef=27),
        Field(17, colRef=28),
        Field(18, colRef=29),
      ])
    )
    # Check that we have a new table, only the new view; and a new section.
    self.assertTables([self.starting_table, new_table, new_table2])
    self.assertViews([new_view])

    # Check that we can't create a summary of a table grouped by a column that doesn't exist yet.
    with self.assertRaises(ValueError):
      self.apply_user_action(["CreateViewSection", 0, 1, "record", [31], None])
    self.assertTables([self.starting_table, new_table, new_table2])
    self.assertViews([new_view])

    # But creating a new table and showing totals for it is possible though dumb.
    self.apply_user_action(["CreateViewSection", 0, 1, "record", [], None])

    # We expect a new table.
    new_table3 = Table(4, "Table3", primaryViewId=0, summarySourceTable=0, columns=[
      Column(30, "manualSort", "ManualSortPos", isFormula=False, formula="", summarySourceCol=0),
      Column(31, "A", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(32, "B", "Any", isFormula=True, formula="", summarySourceCol=0),
      Column(33, "C", "Any", isFormula=True, formula="", summarySourceCol=0),
    ])
    # A summary of it.
    summary_table = Table(5, "Table3_summary", 0, summarySourceTable=4, columns=[
      Column(34, "group", "RefList:Table3", isFormula=True,
             formula="table.getSummarySourceGroup(rec)", summarySourceCol=0),
      Column(35, "count", "Int", isFormula=True, formula="len($group)", summarySourceCol=0),
    ])
    self.assertTables([self.starting_table, new_table, new_table2, new_table3, summary_table])
    new_view.sections.append(Section(10, parentKey="record", tableRef=5, fields=[
      Field(26, colRef=35)
    ]))
    self.assertViews([new_view])

  #----------------------------------------------------------------------

  def init_views_sample(self):
    # Add a new table and a view, to get some Views/Sections/Fields, and TabBar items.
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
    self.apply_user_action(['CreateViewSection', 1, 0, 'detail', None, None])
    self.apply_user_action(['CreateViewSection', 1, 2, 'record', [3], None])
    self.apply_user_action(['CreateViewSection', 1, 0, 'chart', None, None])
    self.apply_user_action(['CreateViewSection', 0, 2, 'record', None, None])

    # Verify the new structure of tables and views.
    self.assertTables([
      Table(1, "Schools", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "city",  "Text", False, "", 0),
        Column(3, "state", "Text", False, "", 0),
        Column(4, "size",  "Numeric", False, "", 0),
      ]),
      Table(2, "Schools_summary_state", 0, 1, columns=[
        Column(5, "state", "Text", False, "", 3),
        Column(6, "group", "RefList:Schools", True, "table.getSummarySourceGroup(rec)", 0),
        Column(7, "count", "Int",     True, "len($group)", 0),
        Column(8, "size",  "Numeric", True, "SUM($group.size)", 0),
      ]),
      Table(3, 'Table1', 0, 0, columns=[
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
        Section(4, parentKey="detail", tableRef=1, fields=[
          Field(10, colRef=2),
          Field(11, colRef=3),
          Field(12, colRef=4),
        ]),
        Section(6, parentKey="record", tableRef=2, fields=[
          Field(16, colRef=5),
          Field(17, colRef=7),
          Field(18, colRef=8),
        ]),
        Section(10, parentKey='record', tableRef=3, fields=[
          Field(27, colRef=10),
          Field(28, colRef=11),
          Field(29, colRef=12),
        ]),
      ]),
      View(3, sections=[
        Section(7, parentKey="chart", tableRef=1, fields=[
          Field(19, colRef=2),
          Field(20, colRef=3),
        ]),
      ])
    ])
    self.assertTableData('_grist_TabBar', cols="subset", data=[
      ["id",  "viewRef"],
      [1,     1],
      [2,     2],
      [3,     3],
    ])
    self.assertTableData('_grist_Pages', cols="subset", data=[
      ["id", "viewRef"],
      [1,    1],
      [2,    2],
      [3,    3]
    ])

  #----------------------------------------------------------------------

  def test_view_remove(self):
    # Add a couple of tables and views, to trigger creation of some related items.
    self.init_views_sample()

    # Remove a view. Ensure related items, sections, fields get removed.
    self.apply_user_action(["BulkRemoveRecord", "_grist_Views", [2, 3]])

    # Verify the new structure of tables and views.
    self.assertTables([
      Table(1, "Schools", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "city",  "Text", False, "", 0),
        Column(3, "state", "Text", False, "", 0),
        Column(4, "size",  "Numeric", False, "", 0),
      ]),
      # Note that the summary table is gone.
      Table(3, 'Table1', 0, 0, columns=[
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
      ])
    ])
    self.assertTableData('_grist_TabBar', cols="subset", data=[
      ["id",  "viewRef"],
      [1,     1],
    ])
    self.assertTableData('_grist_Pages', cols="subset", data=[
      ["id",  "viewRef"],
      [1,     1],
    ])

  #----------------------------------------------------------------------

  def test_view_rename(self):
    # Add a couple of tables and views, to trigger creation of some related items.
    self.init_views_sample()

    # Verify the new structure of tables and views.
    self.assertTableData('_grist_Tables', cols="subset", data=[
      [ 'id', 'tableId',  'primaryViewId'  ],
      [ 1,    'Schools',                1],
      [ 2,    'Schools_summary_state', 0],
      [ 3,    'Table1',                 0],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      [ 'id',   'name',   'primaryViewTable'  ],
      [ 1,      'Schools',    1],
      [ 2,      'New page',   0],
      [ 3,      'New page',   0],
    ])

    # Update the names in a few views, and ensure that primary ones won't cause tables to
    # get renamed.
    self.apply_user_action(['BulkUpdateRecord', '_grist_Views', [2, 3],
                            {'name': ['A', 'B']}])

    self.assertTableData('_grist_Tables', cols="subset", data=[
      [ 'id', 'tableId',  'primaryViewId'  ],
      [ 1,    'Schools',                1],
      [ 2,    'Schools_summary_state', 0],
      [ 3,    'Table1',                      0],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      [ 'id',   'name',   'primaryViewTable'  ],
      [ 1,      'Schools',  1],
      [ 2,      'A',        0],
      [ 3,      'B',        0]
    ])

    # Now rename a table (by raw view section) and make sure that a view with the same name
    # was renamed
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 2,
                            {'title': 'Bars'}])

    self.assertTableData('_grist_Tables', cols="subset", data=[
      ['id', 'tableId'],
      [1, 'Bars', 1],
      [2, 'Bars_summary_state', 0],
      [3, 'Table1', 0],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      ['id', 'name'],
      [1, 'Bars'],
      [2, 'A'],
      [3, 'B']
    ])

    # Now rename tables so that two tables will have same names, to test if only the view
    # with a page will be renamed.
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 2,
                            {'title': 'A'}])

    self.assertTableData('_grist_Tables', cols="subset", data=[
      ['id', 'tableId'],
      [1, 'A', 1],
      [2, 'A_summary_state', 0],
      [3, 'Table1', 0],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      ['id', 'name'],
      [1, 'A'],
      [2, 'A'],
      [3, 'B'],
    ])

    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 2,
                            {'title': 'Z'}])

    self.assertTableData('_grist_Tables', cols="subset", data=[
      ['id', 'tableId', 'primaryViewId', 'rawViewSectionRef', 'recordCardViewSectionRef'],
      [1, 'Z', 1, 2, 3],
      [2, 'Z_summary_state', 0, 5, 0],
      [3, 'Table1', 0, 8, 9],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      ['id', 'name'],
      [1, 'Z'],
      [2, 'Z'],
      [3, 'B'],
    ])

    # Add new table, with a view with the same name (Z) and make sure it won't be renamed
    self.apply_user_action(['AddTable', 'Stations', [
      {'id': 'city', 'type': 'Text'},
    ]])
    self.assertTableData('_grist_Tables', cols="subset", data=[
      ['id', 'tableId', 'primaryViewId', 'rawViewSectionRef', 'recordCardViewSectionRef'],
      [1, 'Z', 1, 2, 3],
      [2, 'Z_summary_state', 0, 5, 0],
      [3, 'Table1', 0, 8, 9],
      [4, 'Stations', 4, 12, 13],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      ['id', 'name'],
      [1, 'Z'],
      [2, 'Z'],
      [3, 'B'],
      [4, 'Stations'],
    ])
    # Replacing only a page name (though primary)
    self.apply_user_action(['UpdateRecord', '_grist_Views', 4, {'name': 'Z'}])
    self.assertTableData('_grist_Views', cols="subset", data=[
      ['id', 'name'],
      [1, 'Z'],
      [2, 'Z'],
      [3, 'B'],
      [4, 'Z']
    ])

    # Rename table Z to Schools. Primary view for Stations (Z) should not be renamed.
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 2,
                            {'title': 'Schools'}])

    self.assertTableData('_grist_Tables', cols="subset", data=[
      ['id', 'tableId'],
      [1, 'Schools'],
      [2, 'Schools_summary_state'],
      [3, 'Table1'],
      [4, 'Stations'],
    ])
    self.assertTableData('_grist_Views', cols="subset", data=[
      ['id', 'name'],
      [1, 'Schools'],
      [2, 'Schools'],
      [3, 'B'],
      [4, 'Z']
    ])

  #----------------------------------------------------------------------

  def test_section_removes(self):
    # Add a couple of tables and views, to trigger creation of some related items.
    self.init_views_sample()

    self.assertViews([
      View(1, sections=[
        Section(1, parentKey="record", tableRef=1, fields=[
          Field(1, colRef=2),
          Field(2, colRef=3),
          Field(3, colRef=4),
        ]),
      ]),
      View(2, sections=[
        Section(4, parentKey="detail", tableRef=1, fields=[
          Field(10, colRef=2),
          Field(11, colRef=3),
          Field(12, colRef=4),
        ]),
        Section(6, parentKey="record", tableRef=2, fields=[
          Field(16, colRef=5),
          Field(17, colRef=7),
          Field(18, colRef=8),
        ]),
        Section(10, parentKey='record', tableRef=3, fields=[
          Field(27, colRef=10),
          Field(28, colRef=11),
          Field(29, colRef=12),
        ]),
      ]),
      View(3, sections=[
        Section(7, parentKey="chart", tableRef=1, fields=[
          Field(19, colRef=2),
          Field(20, colRef=3),
        ]),
      ])
    ])

    # Remove a couple of sections. Ensure their fields get removed.
    self.apply_user_action(['BulkRemoveRecord', '_grist_Views_section', [6, 10]])

    self.assertViews([
      View(1, sections=[
        Section(1, parentKey="record", tableRef=1, fields=[
          Field(1, colRef=2),
          Field(2, colRef=3),
          Field(3, colRef=4),
        ]),
      ]),
      View(2, sections=[
        Section(4, parentKey="detail", tableRef=1, fields=[
          Field(10, colRef=2),
          Field(11, colRef=3),
          Field(12, colRef=4),
        ])
      ]),
      View(3, sections=[
        Section(7, parentKey="chart", tableRef=1, fields=[
          Field(19, colRef=2),
          Field(20, colRef=3),
        ]),
      ])
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

    # Do a non-schema action to ensure it doesn't get called.
    self.apply_user_action(['UpdateRecord', '_grist_Views', 2, {'name': 'A'}])
    self.assertEqual(count_calls[0], 0)

    # Do a schema action to ensure it gets called: this causes a table rename.
    # 8 is id of raw view section for the Table1 table
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 8, {'title': 'C'}])
    self.assertEqual(count_calls[0], 1)

    self.assertTableData('_grist_Tables', cols="subset", data=[
      [ 'id', 'tableId',  'primaryViewId'  ],
      [ 1,    'Schools',                1],
      [ 2,    'Schools_summary_state', 0],
      [ 3,    'C',                      0],
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
    ])

    # Verify that removing page 1 fixes page 2 indentation.
    self.apply_user_action(['RemoveRecord', '_grist_Pages', 1])
    self.assertTableData('_grist_Pages', cols='subset', data=[
      ['id', 'indentation'],
      [   2,             0],
      [   3,             0],
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

    # Test filters rename

    # Create new view section
    self.apply_user_action(["CreateViewSection", 1, 0, "record", None, None])

    # Filter it by first column
    self.apply_user_action(['BulkAddRecord', '_grist_Filters', [None], {
      "viewSectionRef": [1],
      "colRef": [1],
      "filter": [json.dumps({"included": ["b", "c"]})],
      "pinned": [True],
    }])

    # Add the same filter for second column (to make sure it is not renamed)
    self.apply_user_action(['BulkAddRecord', '_grist_Filters', [None], {
      "viewSectionRef": [1],
      "colRef": [2],
      "filter": [json.dumps({"included": ["b", "c"]})],
      "pinned": [False],
    }])

    # Rename choices
    renames = {"b": "z", "c": "b"}
    self.apply_user_action(
      ["RenameChoices", "ChoiceTable", "ChoiceColumn", renames])

    # Test filters
    self.assertTableData('_grist_Filters', data=[
      ["id", "colRef", "filter", "setAutoRemove", "viewSectionRef", "pinned"],
      [1, 1, json.dumps({"included": ["z", "b"]}), None, 1, True],
      [2, 2, json.dumps({"included": ["b", "c"]}), None, 1, False]
    ])

  def test_add_or_update(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "first_name", "Text", False, "",     "first_name", ""],
          [2, "last_name",  "Text", False, "",     "last_name",  ""],
          [3, "pet",        "Text", False, "",     "pet",        ""],
          [4, "color",      "Text", False, "",     "color",      ""],
          [5, "formula",    "Text", True,  "''",   "formula",    ""],
          [6, "date",       "Date", False, None,   "date",       ""],
        ]],
      ],
      "DATA": {
        "Table1": [
          ["id", "first_name", "last_name"],
          [1, "John", "Doe"],
          [2, "John", "Smith"],
        ],
      }
    })
    self.load_sample(sample)

    def check(require, values, options, stored):
      self.assertPartialOutActions(
        self.apply_user_action(["AddOrUpdateRecord", "Table1", require, values, options]),
        {"stored": stored},
      )

    # Exactly one match, so on_many=none has no effect
    check(
      {"first_name": "John", "last_name": "Smith"},
      {"pet": "dog", "color": "red"},
      {"on_many": "none"},
      [["UpdateRecord", "Table1", 2, {"color": "red", "pet": "dog"}]],
    )

    # Look for a record with pet=dog and change it to pet=cat
    check(
      {"first_name": "John", "pet": "dog"},
      {"pet": "cat"},
      {},
      [["UpdateRecord", "Table1", 2, {"pet": "cat"}]],
    )

    # Two records match first_name=John, by default we only update the first
    check(
      {"first_name": "John"},
      {"color": "blue"},
      {},
      [["UpdateRecord", "Table1", 1, {"color": "blue"}]],
    )

    # Update all matching records
    check(
      {"first_name": "John"},
      {"color": "green"},
      {"on_many": "all"},
      [
        ["BulkUpdateRecord", "Table1", [1, 2], {"color": ["green", "green"]}],
      ],
    )

    # Update all records with empty require and allow_empty_require
    check(
      {},
      {"color": "greener"},
      {"on_many": "all", "allow_empty_require": True},
      [
        ["BulkUpdateRecord", "Table1", [1, 2], {"color": ["greener", "greener"]}],
      ],
    )

    # Missing allow_empty_require
    with self.assertRaises(ValueError):
      check(
        {},
        {"color": "greenest"},
        {},
        [],
      )

    # Don't update any records when there's several matches
    check(
      {"first_name": "John"},
      {"color": "yellow"},
      {"on_many": "none"},
      [],
    )

    # Invalid value of on_many
    with self.assertRaises(ValueError):
      check(
        {"first_name": "John"},
        {"color": "yellow"},
        {"on_many": "other"},
        [],
      )

    # Since there's at least one matching record and update=False, do nothing
    check(
      {"first_name": "John"},
      {"color": "yellow"},
      {"update": False},
      [],
    )

    # Since there's no matching records and add=False, do nothing
    check(
      {"first_name": "John", "last_name": "Johnson"},
      {"first_name": "Jack", "color": "yellow"},
      {"add": False},
      [],
    )

    # No matching record, make a new one.
    # first_name=Jack in `values` overrides first_name=John in `require`
    check(
      {"first_name": "John", "last_name": "Johnson"},
      {"first_name": "Jack", "color": "yellow"},
      {},
      [
        ["AddRecord", "Table1", 3,
        {"color": "yellow", "first_name": "Jack", "last_name": "Johnson"}]
      ],
    )

    # Specifying a row ID in `require` is allowed
    check(
      {"first_name": "Bob", "id": 100},
      {"pet": "fish"},
      {},
      [["AddRecord", "Table1", 100, {"first_name": "Bob", "pet": "fish"}]],
    )

    # Now the row already exists
    check(
      {"first_name": "Bob", "id": 100},
      {"pet": "fish"},
      {},
      [],
    )

    # Nothing matches this `require`, but the row ID already exists
    with self.assertRaises(AssertionError):
      check(
        {"first_name": "Alice", "id": 100},
        {"pet": "fish"},
        {},
        [],
      )

    # Formula columns in `require` can't be used as values when creating records
    check(
      {"formula": "anything"},
      {"first_name": "Alice"},
      {},
      [["AddRecord", "Table1", 101, {"first_name": "Alice"}]],
    )

    with self.assertRaises(ValueError):
      # Row ID too high
      check(
        {"first_name": "Alice", "id": 2000000},
        {"pet": "fish"},
        {},
        [],
      )

    # Check that encoded objects are decoded correctly
    check(
      {"date": ['d', 950400]},
      {},
      {},
      [["AddRecord", "Table1", 102, {"date": 950400}]],
    )
    check(
      {"date": ['d', 950400]},
      {"date": ['d', 1900800]},
      {},
      [["UpdateRecord", "Table1", 102, {"date": 1900800}]],
    )

    # Empty both does nothing
    check(
      {},
      {},
      {"allow_empty_require": True},
      [],
    )

  def test_bulk_add_or_update(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "first_name", "Text", False, "",     "first_name", ""],
          [2, "last_name",  "Text", False, "",     "last_name",  ""],
          [4, "color",      "Text", False, "",     "color",      ""],
        ]],
      ],
      "DATA": {
        "Table1": [
          ["id", "first_name", "last_name"],
          [1, "John", "Doe"],
          [2, "John", "Smith"],
        ],
      }
    })
    self.load_sample(sample)

    def check(require, values, options, stored):
      self.assertPartialOutActions(
        self.apply_user_action(["BulkAddOrUpdateRecord", "Table1", require, values, options]),
        {"stored": stored},
      )

    check(
      {
        "first_name": [
        "John",
        "John",
        "John",
        "Bob",
      ],
      "last_name": [
        "Doe",
        "Smith",
        "Johnson",
        "Johnson",
      ],
      },
      {
        "color": [
          "red",
          "blue",
          "green",
          "yellow",
        ],
      },
      {},
      [
        ["BulkAddRecord", "Table1", [3, 4], {
          "color": ["green", "yellow"],
          "first_name": ["John", "Bob"],
          "last_name": ["Johnson", "Johnson"],
        }],
        ["BulkUpdateRecord", "Table1", [1, 2], {"color": ["red", "blue"]}],
      ],
    )

    with self.assertRaises(ValueError) as cm:
      check(
        {"color": ["yellow"]},
        {"color": ["red", "blue", "green"]},
        {},
        [],
      )
    self.assertEqual(
      str(cm.exception),
      'Value lists must all have the same length, '
      'got {"col_values color": 3, "require color": 1}',
    )

    with self.assertRaises(ValueError) as cm:
      check(
        {
          "first_name": [
            "John",
            "John",
          ],
          "last_name": [
            "Doe",
          ],
        },
        {},
        {},
        [],
      )
    self.assertEqual(
      str(cm.exception),
      'Value lists must all have the same length, '
      'got {"require first_name": 2, "require last_name": 1}',
    )

    with self.assertRaises(ValueError) as cm:
      check(
        {
          "first_name": [
            "John",
            "John",
          ],
          "last_name": [
            "Doe",
            "Doe",
          ],
        },
        {},
        {},
        [],
      )
    self.assertEqual(
      str(cm.exception),
      "require values must be unique",
    )

  def test_reference_lookup(self):
    sample = testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "name",    "Text",           False, "", "name",    ""],
          [2, "ref",     "Ref:Table1",     False, "", "ref",     ""],
          [3, "reflist", "RefList:Table1", False, "", "reflist", ""],
        ]],
      ],
      "DATA": {
        "Table1": [
          ["id", "name"],
          [1, "a"],
          [2, "b"],
        ],
      }
    })
    self.load_sample(sample)
    self.update_record("_grist_Tables_column", 2, visibleCol=1)

    # Normal case
    out_actions = self.apply_user_action(
      ["UpdateRecord", "Table1", 1, {"ref": ["l", "b", {"column": "name"}]}])
    self.assertPartialOutActions(out_actions, {'stored': [
      ["UpdateRecord", "Table1", 1, {"ref": 2}]]})

    # Use ref.visibleCol (name) as default lookup column
    out_actions = self.apply_user_action(
      ["UpdateRecord", "Table1", 2, {"ref": ["l", "a"]}])
    self.assertPartialOutActions(out_actions, {'stored': [
      ["UpdateRecord", "Table1", 2, {"ref": 1}]]})

    # No match found, generate alttext from value
    out_actions = self.apply_user_action(
      ["UpdateRecord", "Table1", 2, {"ref": ["l", "foo", {"column": "name"}]}])
    self.assertPartialOutActions(out_actions, {'stored': [
      ["UpdateRecord", "Table1", 2, {"ref": "foo"}]]})

    # No match found, use provided alttext
    out_actions = self.apply_user_action(
      ["UpdateRecord", "Table1", 2, {"ref": ["l", "foo", {"column": "name", "raw": "alt"}]}])
    self.assertPartialOutActions(out_actions, {'stored': [
      ["UpdateRecord", "Table1", 2, {"ref": "alt"}]]})

    # Normal case, adding instead of updating
    out_actions = self.apply_user_action(
      ["AddRecord", "Table1", 3,
       {"ref": ["l", "b", {"column": "name"}],
        "name": "c"}])
    self.assertPartialOutActions(out_actions, {'stored': [
      ["AddRecord", "Table1", 3,
       {"ref": 2,
        "name": "c"}]]})

    # Testing reflist and bulk action
    out_actions = self.apply_user_action(
      ["BulkUpdateRecord", "Table1", [1, 2, 3],
       {"reflist": [
         ["l", "c", {"column": "name"}],  # value gets wrapped in list automatically
         ["l", ["a", "b"], {"column": "name"}],  # normal case
         # "a" matches but "foo" doesn't so the whole thing fails
         ["l", ["a", "foo"], {"column": "name", "raw": "alt"}],
       ]}])
    self.assertPartialOutActions(out_actions, {'stored': [
      ["BulkUpdateRecord", "Table1", [1, 2, 3],
       {"reflist": [
         ["L", 3],
         ["L", 1, 2],
         "alt",
       ]}]]})

    self.assertTableData('Table1', data=[
      ["id", "name", "ref", "reflist"],
      [1,    "a",    2,      [3]],
      [2,    "b",    "alt",  [1, 2]],
      [3,    "c",    2,      "alt"],
    ])

    # 'id' is used as the default visibleCol
    out_actions = self.apply_user_action(
      ["BulkUpdateRecord", "Table1", [1, 2],
       {"reflist": [
         ["l", 2],
         ["l", 999],  # this row ID doesn't exist
       ]}])
    self.assertPartialOutActions(out_actions, {'stored': [
      ["BulkUpdateRecord", "Table1", [1, 2],
       {"reflist": [
         ["L", 2],
         "999",
       ]}]]})

  def test_num_rows(self):
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Address", [
          [21, "city", "Text", False, "", "", ""],
        ]],
      ],
      "DATA": {
      }
    }))

    table = self.engine.tables["Address"]
    for i in range(20):
      self.add_record("Address", None)
      self.assertEqual(i + 1, table._num_rows())
      self.assertEqual({1: i + 1, "total": i + 1}, self.engine.count_rows())

  def test_raw_view_section_restrictions(self):
    # load_sample handles loading basic metadata, but doesn't create any view sections
    self.load_sample(self.sample)
    # Create a new table which automatically gets a raw view section
    self.apply_user_action(["AddEmptyTable", None])

    # Note the row IDs of the raw view section (2) and fields (4, 5, 6)
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "parentId", "tableRef"],
      [1, 1, 2],
      [2, 0, 2],  # the raw view section
      [3, 0, 2],  # the record card view section
    ])
    self.assertTableData('_grist_Views_section_field', cols="subset", data=[
      ["id",  "parentId"],
      [1, 1],
      [2, 1],
      [3, 1],

      # the raw view section
      [4, 2],
      [5, 2],
      [6, 2],

      # the record card view section
      [7, 3],
      [8, 3],
      [9, 3],
    ])

    # Test that the records cannot be removed by normal user actions
    with self.assertRaisesRegex(ValueError, "Cannot remove raw view section$"):
      self.apply_user_action(["RemoveRecord", '_grist_Views_section', 2])
    with self.assertRaisesRegex(ValueError, "Cannot remove raw view section field$"):
      self.apply_user_action(["RemoveRecord", '_grist_Views_section_field', 4])

    # and most of their column values can't be changed
    with self.assertRaisesRegex(ValueError, "Cannot modify raw view section$"):
      self.apply_user_action(["UpdateRecord", '_grist_Views_section', 2, {"parentId": 1}])
    with self.assertRaisesRegex(ValueError, "Cannot modify raw view section fields$"):
      self.apply_user_action(["UpdateRecord", '_grist_Views_section_field', 5, {"parentId": 1}])

    # Confirm that the records are unchanged
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id",  "parentId", "tableRef"],
      [1, 1, 2],
      [2, 0, 2],  # the raw view section
      [3, 0, 2],  # the record card view section
    ])
    self.assertTableData('_grist_Views_section_field', cols="subset", data=[
      ["id",  "parentId"],
      [1, 1],
      [2, 1],
      [3, 1],

      # the raw view section
      [4, 2],
      [5, 2],
      [6, 2],

      # the record card view section
      [7, 3],
      [8, 3],
      [9, 3],
    ])

  def test_record_card_view_section_restrictions(self):
    self.load_sample(self.sample)
    self.apply_user_action(["AddEmptyTable", None])

    # Check that record card view sections cannot be removed by normal user actions.
    with self.assertRaisesRegex(ValueError, "Cannot remove record card view section$"):
      self.apply_user_action(["RemoveRecord", '_grist_Views_section', 3])

    # Check that most of their column values can't be changed.
    with self.assertRaisesRegex(ValueError, "Cannot modify record card view section$"):
      self.apply_user_action(["UpdateRecord", '_grist_Views_section', 3, {"parentId": 1}])
    with self.assertRaisesRegex(ValueError, "Cannot modify record card view section fields$"):
      self.apply_user_action(["UpdateRecord", '_grist_Views_section_field', 9, {"parentId": 1}])

    # Make sure nothing got removed or updated.
    self.assertTableData('_grist_Views_section', cols="subset", data=[
      ["id", "parentId", "tableRef"],
      [1, 1, 2],
      [2, 0, 2],
      [3, 0, 2],
    ])
    self.assertTableData('_grist_Views_section_field', cols="subset", data=[
      ["id", "parentId"],
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 2],
      [5, 2],
      [6, 2],
      [7, 3],
      [8, 3],
      [9, 3],
    ])

  def test_update_current_time(self):
    self.load_sample(self.sample)
    self.apply_user_action(["AddEmptyTable", None])
    self.add_column('Table1', 'now', isFormula=True, formula='NOW()', type='Any')

    # No records with NOW() in a formula yet, so this action should have no effect at all.
    out_actions = self.apply_user_action(["UpdateCurrentTime"])
    self.assertOutActions(out_actions, {})

    class FakeDatetime(object):
      counter = 0

      @classmethod
      def now(cls, *_):
        cls.counter += 1
        return cls.counter

    import datetime
    original = datetime.datetime
    # This monkeypatch depends on NOW() using `import datetime`
    # as opposed to `from datetime import datetime`
    datetime.datetime = FakeDatetime

    def check(expected_now):
      self.assertEqual(expected_now, FakeDatetime.counter)
      self.assertTableData('Table1', cols="subset", data=[
        ["id", "now"],
        [1, expected_now],
      ])

    try:
      # The counter starts at 0. Adding an initial record calls FakeDatetime.now() for the 1st time.
      # The call increments the counter to 1 before returning.
      self.add_record('Table1')
      check(1)

      # Testing that unrelated actions don't change the time
      self.apply_user_action(["AddEmptyTable", None])
      self.add_record("Table2")
      self.apply_user_action(["Calculate"])  # only recalculates for fresh docs
      check(1)

      # Actually testing that the time is updated as requested
      self.apply_user_action(["UpdateCurrentTime"])
      check(2)
      out_actions = self.apply_user_action(["UpdateCurrentTime"])
      check(3)
      self.assertOutActions(out_actions, {
        "direct": [False],
        "stored": [["UpdateRecord", "Table1", 1, {"now": 3}]],
        "undo": [["UpdateRecord", "Table1", 1, {"now": 2}]],
      })
    finally:
      # Revert the monkeypatch
      datetime.datetime = original

  def test_duplicate_table(self):
    self.load_sample(self.sample)

    # Create a new table, Table1, and populate it with some data.
    self.apply_user_action(['AddEmptyTable', None])
    self.apply_user_action(['AddColumn', 'Table1', None, {
      'formula': '$B * 100 + len(Table1.all)',
    }])
    self.add_column('Table1', 'E',
      type='DateTime:UTC', isFormula=False, formula="NOW()", recalcWhen=RecalcWhen.MANUAL_UPDATES)
    self.apply_user_action(['AddColumn', 'Table1', None, {
      'type': 'Ref:Address',
      'visibleCol': 21,
    }])
    self.apply_user_action(['AddColumn', 'Table1', None, {
      'type': 'Ref:Table1',
      'visibleCol': 23,
    }])
    self.apply_user_action(['AddColumn', 'Table1', None, {
      'type': 'RefList:Table1',
      'visibleCol': 23,
    }])
    self.apply_user_action(['BulkAddRecord', 'Table1', [1, 2, 3, 4], {
      'A': ['Foo', 'Bar', 'Baz', ''],
      'B': [123, 456, 789, 0],
      'C': ['', '', '', ''],
      'F': [11, 12, 0, 0],
      'G': [1, 2, 0, 0],
      'H': [['L', 1, 2], ['L', 1], None, None],
    }])

    # Add a row conditional style.
    self.apply_user_action(['AddEmptyRule', 'Table1', 0, 0])
    rules = self.engine.docmodel.tables.lookupOne(tableId='Table1').rawViewSectionRef.rules
    rule = list(rules)[0]
    self.apply_user_action(['UpdateRecord', '_grist_Tables_column', rule.id, {
      'formula': 'rec.id % 2 == 0',
    }])

    # Add a column conditional style.
    self.apply_user_action(['AddEmptyRule', 'Table1', 0, 23])
    rules = self.engine.docmodel.columns.table.get_record(23).rules
    rule = list(rules)[0]
    self.apply_user_action(['UpdateRecord', '_grist_Tables_column', rule.id, {
      'formula': '$A == "Foo"',
    }])

    # Add a column and widget description.
    self.apply_user_action(['UpdateRecord', '_grist_Tables_column', 23, {
      'description': 'A column description.',
    }])
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 2, {
      'description': 'A widget description.',
    }])

    # Duplicate Table1 as Foo without including any of its data.
    self.apply_user_action(['DuplicateTable', 'Table1', 'Foo', False])

    # Check that the correct table and options were duplicated.
    existing_table = Table(2, 'Table1', primaryViewId=1, summarySourceTable=0, columns=[
      Column(22, 'manualSort', 'ManualSortPos', isFormula=False, formula='', summarySourceCol=0),
      Column(23, 'A', 'Text', isFormula=False, formula='', summarySourceCol=0),
      Column(24, 'B', 'Numeric', isFormula=False, formula='', summarySourceCol=0),
      Column(25, 'C', 'Any', isFormula=True, formula='', summarySourceCol=0),
      Column(26, 'D', 'Any', isFormula=True, formula='$B * 100 + len(Table1.all)',
        summarySourceCol=0),
      Column(27, 'E', 'DateTime:UTC', isFormula=False, formula='NOW()',
        summarySourceCol=0),
      Column(28, 'F', 'Ref:Address', isFormula=False, formula='', summarySourceCol=0),
      Column(29, 'G', 'Ref:Table1', isFormula=False, formula='', summarySourceCol=0),
      Column(30, 'H', 'RefList:Table1', isFormula=False, formula='', summarySourceCol=0),
      Column(31, 'gristHelper_RowConditionalRule', 'Any', isFormula=True,
        formula='rec.id % 2 == 0', summarySourceCol=0),
      Column(32, 'gristHelper_ConditionalRule', 'Any', isFormula=True, formula='$A == \"Foo\"',
        summarySourceCol=0),
    ])
    duplicated_table = Table(3, 'Foo', primaryViewId=0, summarySourceTable=0, columns=[
      Column(33, 'manualSort', 'ManualSortPos', isFormula=False, formula='', summarySourceCol=0),
      Column(34, 'A', 'Text', isFormula=False, formula='', summarySourceCol=0),
      Column(35, 'B', 'Numeric', isFormula=False, formula='', summarySourceCol=0),
      Column(36, 'C', 'Any', isFormula=True, formula='', summarySourceCol=0),
      Column(37, 'D', 'Any', isFormula=True, formula='$B * 100 + len(Foo.all)',
        summarySourceCol=0),
      Column(38, 'E', 'DateTime:UTC', isFormula=False, formula='NOW()',
        summarySourceCol=0),
      Column(39, 'F', 'Ref:Address', isFormula=False, formula='', summarySourceCol=0),
      Column(40, 'G', 'Ref:Foo', isFormula=False, formula='', summarySourceCol=0),
      Column(41, 'H', 'RefList:Foo', isFormula=False, formula='', summarySourceCol=0),
      Column(42, 'gristHelper_ConditionalRule', 'Any', isFormula=True, formula='$A == \"Foo\"',
        summarySourceCol=0),
      Column(43, 'gristHelper_RowConditionalRule', 'Any', isFormula=True,
        formula='rec.id % 2 == 0', summarySourceCol=0),
    ])
    self.assertTables([self.starting_table, existing_table, duplicated_table])
    self.assertTableData('Foo', data=[
      ["id", "A", "B", "C", "D", "E", "F", "G", "H", "gristHelper_ConditionalRule",
        "gristHelper_RowConditionalRule", "manualSort"],
    ])
    self.assertTableData('_grist_Tables_column', rows='subset', cols='subset', data=[
      ['id', 'description'],
      [23, 'A column description.'],
      [34, 'A column description.'],
    ])
    self.assertTableData('_grist_Views_section', rows='subset', cols='subset', data=[
      ['id', 'description'],
      [2, 'A widget description.'],
      [4, 'A widget description.'],
    ])

    # Duplicate Table1 as FooData and include all of its data.
    self.apply_user_action(['DuplicateTable', 'Table1', 'FooData', True])

    # Check that the correct table, options, and data were duplicated.
    duplicated_table_with_data = Table(4, 'FooData', primaryViewId=0, summarySourceTable=0,
      columns=[
        Column(44, 'manualSort', 'ManualSortPos', isFormula=False, formula='', summarySourceCol=0),
        Column(45, 'A', 'Text', isFormula=False, formula='', summarySourceCol=0),
        Column(46, 'B', 'Numeric', isFormula=False, formula='', summarySourceCol=0),
        Column(47, 'C', 'Any', isFormula=True, formula='', summarySourceCol=0),
        Column(48, 'D', 'Any', isFormula=True, formula='$B * 100 + len(FooData.all)',
          summarySourceCol=0),
        Column(49, 'E', 'DateTime:UTC', isFormula=False, formula='NOW()',
          summarySourceCol=0),
        Column(50, 'F', 'Ref:Address', isFormula=False, formula='', summarySourceCol=0),
        Column(51, 'G', 'Ref:FooData', isFormula=False, formula='', summarySourceCol=0),
        Column(52, 'H', 'RefList:FooData', isFormula=False, formula='', summarySourceCol=0),
        Column(53, 'gristHelper_ConditionalRule', 'Any', isFormula=True, formula='$A == \"Foo\"',
          summarySourceCol=0),
        Column(54, 'gristHelper_RowConditionalRule', 'Any', isFormula=True,
          formula='rec.id % 2 == 0', summarySourceCol=0),
      ]
    )
    self.assertTables([
      self.starting_table, existing_table, duplicated_table, duplicated_table_with_data])
    self.assertTableData('Foo', data=[
      ["id", "A", "B", "C", "D", "E", "F", "G", "H", "gristHelper_ConditionalRule",
        "gristHelper_RowConditionalRule", "manualSort"],
    ], rows="subset")
    self.assertTableData('FooData', data=[
      ["id", "A", "B", "C", "D", "F", "G", "H", "gristHelper_ConditionalRule",
        "gristHelper_RowConditionalRule", "manualSort"],
      [1, 'Foo', 123, None, 12304.0, 11, 1, [1, 2], True, False, 1.0],
      [2, 'Bar', 456, None, 45604.0, 12, 2, [1], False, True, 2.0],
      [3, 'Baz', 789, None, 78904.0, 0, 0, None, False, False, 3.0],
      [4, '', 0, None, 4.0, 0, 0, None, False, True, 4.0],
    ], cols="subset")

    # Check that values for the duplicated trigger formula were not re-calculated.
    existing_times = self.engine.fetch_table('Table1').columns['E']
    duplicated_times = self.engine.fetch_table('FooData').columns['E']
    self.assertEqual(existing_times, duplicated_times)

  def test_duplicate_table_untie_col_id_bug(self):
    # This test case verifies a bug fix: when a column doesn't match its label despite
    # untieColIdFromLabel being False (which is possible), ensure that duplicating still works.

    self.load_sample(self.sample)

    # This is the problem situation: "State2" doesn't match "State". It can happen legitimately in
    # the wild if a second column labeled "State" is added, and then the first one removed.
    self.apply_user_action(['AddTable', 'Table1', [
      {'id': 'State2', 'type': 'Text', 'label': 'State'}
    ]])
    self.apply_user_action(['BulkAddRecord', 'Table1', [1], {
      'State2': ['NY'],
    }])
    self.apply_user_action(['DuplicateTable', 'Table1', 'Foo', True])
    self.assertTableData('Table1', data=[["id", "State2", 'manualSort'], [1, 'NY', 1.0]])
    self.assertTableData('Foo', data=[["id", "State2", 'manualSort'], [1, 'NY', 1.0]])

  def test_duplicate_table_record_card(self):
    self.load_sample(self.sample)
    self.apply_user_action(['AddEmptyTable', None])
    self.apply_user_action(['AddColumn', 'Table1', None, {
      'type': 'Ref:Table1',
      'visibleCol': 23,
    }])
    self.apply_user_action(['AddColumn', 'Table1', None, {
      'type': 'RefList:Table1',
      'visibleCol': 24,
    }])
    self.apply_user_action(['BulkUpdateRecord', '_grist_Views_section_field', [11, 13], {
      'visibleCol': [23, 24],
    }])
    self.apply_user_action(['UpdateRecord', '_grist_Views_section', 3, {
      'layoutSpec': '{"children":[{"children":[{"leaf":7},{"leaf":8}]},{"leaf":9},{"leaf":11}]}',
      'options': '{"verticalGridlines":true,"horizontalGridlines":true,"zebraStripes":false,' +
        '"customView":"","numFrozen":0,"disabled":true}',
      'theme': 'compact',
    }])
    self.apply_user_action(['DuplicateTable', 'Table1', 'Foo', False])

    self.assertTableData('_grist_Views_section', rows="subset", cols="subset", data=[
      ["id", "parentId", "tableRef", "layoutSpec", "options", "theme"],
      # The original record card section.
      [3, 0, 2, '{"children":[{"children":[{"leaf":7},{"leaf":8}]},{"leaf":9},{"leaf":11}]}',
        '{"verticalGridlines":true,"horizontalGridlines":true,"zebraStripes":false,' +
          '"customView":"","numFrozen":0,"disabled":true}', 'compact'],
      # The duplicated record card section.
      [5, 0, 3,
        '{"children": [{"children": [{"leaf": 19}, {"leaf": 20}]}, {"leaf": 21}, ' +
          '{"leaf": 22}]}',
        '{"verticalGridlines":true,"horizontalGridlines":true,"zebraStripes":false,' +
          '"customView":"","numFrozen":0,"disabled":true}', 'compact'],
    ])
    self.assertTableData('_grist_Views_section_field', rows="subset", cols="subset", data=[
      ["id", "parentId", "parentPos", "visibleCol"],
      # The original record card fields.
      [7, 3, 7.0, 0],
      [8, 3, 8.0, 0],
      [9, 3, 9.0, 0],
      [11, 3, 11.0, 23],
      [13, 3, 13.0, 24],
      [19, 5, 6.5, 0],
      [20, 5, 7.5, 0],
      [21, 5, 8.5, 0],
      [22, 5, 10.5, 29],
      [23, 5, 12.5, 30],
    ])
