import logging
import actions

import testsamples
import test_engine
from test_engine import Table, Column

log = logging.getLogger(__name__)

class TestDocModel(test_engine.EngineTestCase):

  def test_meta_tables(self):
    """
    Test changes to records accessed via lookup.
    """
    self.load_sample(testsamples.sample_students)
    self.assertPartialData("_grist_Tables", ["id", "columns"], [
      [1,   [1,2,4,5,6]],
      [2,   [10,12]],
      [3,   [21]],
    ])

    # Test that adding a column produces a change to 'columns' without emitting an action.
    out_actions = self.add_column('Students', 'test', type='Text', isFormula=False)
    self.assertPartialData("_grist_Tables", ["id", "columns"], [
      [1,   [1,2,4,5,6,22]],
      [2,   [10,12]],
      [3,   [21]],
    ])
    self.assertPartialOutActions(out_actions, {
      "calc": [],
      "stored": [
        ["AddColumn", "Students", "test",
         {"formula": "", "isFormula": False, "type": "Text"}
        ],
        ["AddRecord", "_grist_Tables_column", 22,
         {"colId": "test", "formula": "", "isFormula": False, "label": "test",
          "parentId": 1, "parentPos": 6.0, "type": "Text", "widgetOptions": ""}
        ],
      ],
      "undo": [
        ["RemoveColumn", "Students", "test"],
        ["RemoveRecord", "_grist_Tables_column", 22],
      ]
    })

    # Undo the AddColumn action. Check that actions are in correct order, and still produce undos.
    out_actions = self.apply_user_action(
      ['ApplyUndoActions', [actions.get_action_repr(a) for a in out_actions.undo]])
    self.assertPartialOutActions(out_actions, {
      "calc": [],
      "stored": [
        ["RemoveRecord", "_grist_Tables_column", 22],
        ["RemoveColumn", "Students", "test"],
      ],
      "undo": [
        ["AddRecord", "_grist_Tables_column", 22, {"colId": "test", "label": "test",
         "parentId": 1, "parentPos": 6.0, "type": "Text"}],
        ["AddColumn", "Students", "test", {"formula": "", "isFormula": False, "type": "Text"}],
      ]
    })

    # Test that when we add a table, .column is set correctly.
    out_actions = self.apply_user_action(['AddTable', 'Test2', [
      {'id': 'A', 'type': 'Text'},
      {'id': 'B', 'type': 'Numeric'},
      {'id': 'C', 'type': 'Numeric', 'formula': 'len($A)', 'isFormula': True}
    ]])
    self.assertPartialData("_grist_Tables", ["id", "columns"], [
      [1,   [1,2,4,5,6]],
      [2,   [10,12]],
      [3,   [21]],
      [4,   [22,23,24,25]],
    ])
    self.assertPartialData("_grist_Tables_column", ["id", "colId", "parentId"], [
      [1, "firstName",    1],
      [2, "lastName",     1],
      [4, "schoolName",   1],
      [5, "schoolIds",    1],
      [6, "schoolCities", 1],
      [10, "name",        2],
      [12, "address",     2],
      [21, "city",        3],
      # Newly added columns:
      [22,  'manualSort', 4],
      [23,  'A',          4],
      [24,  'B',          4],
      [25,  'C',          4],
    ])

  def test_add_column_position(self):
    self.load_sample(testsamples.sample_students)

    # Client may send AddColumn actions with fractional positions. Test that it works.
    # TODO: this should probably use parentPos in the future and be done via metadata AddRecord.
    out_actions = self.add_column('Students', 'test', type='Text', _position=2.75)
    self.assertPartialData("_grist_Tables", ["id", "columns"], [
      [1,   [1,2,22,4,5,6]],
      [2,   [10,12]],
      [3,   [21]],
    ])

    out_actions = self.add_column('Students', None, type='Text', _position=6)
    self.assertPartialData("_grist_Tables", ["id", "columns"], [
      [1,   [1,2,22,4,5,6,23]],
      [2,   [10,12]],
      [3,   [21]],
    ])
    self.assertPartialData("_grist_Tables_column", ["id", "colId", "parentId"], [
      [1, "firstName",    1],
      [2, "lastName",     1],
      [4, "schoolName",   1],
      [5, "schoolIds",    1],
      [6, "schoolCities", 1],
      [10, "name",        2],
      [12, "address",     2],
      [21, "city",        3],
      [22, "test",        1],
      [23, "A",           1],
    ])

  def assertRecordSet(self, record_set, expected_row_ids):
    self.assertEqual(list(record_set.id), expected_row_ids)

  def test_lookup_recompute(self):
    self.load_sample(testsamples.sample_students)
    self.apply_user_action(['AddTable', 'Test2', [
      {'id': 'A', 'type': 'Text'},
      {'id': 'B', 'type': 'Numeric'},
    ]])
    self.apply_user_action(['AddTable', 'Test3', [
      {'id': 'A', 'type': 'Text'},
      {'id': 'B', 'type': 'Numeric'},
    ]])
    self.apply_user_action(['AddViewSection', 'Section2', 'record', 1, 'Test2'])
    self.apply_user_action(['AddViewSection', 'Section3', 'record', 1, 'Test3'])
    self.assertPartialData('_grist_Views', ["id"], [
      [1],
      [2],
    ])
    self.assertPartialData('_grist_Views_section', ["id", "parentId", "tableRef"], [
      [1, 1, 4],
      [2, 0, 4],
      [3, 0, 4],
      [4, 2, 5],
      [5, 0, 5],
      [6, 0, 5],
      [7, 1, 4],
      [8, 1, 5],
    ])
    self.assertPartialData('_grist_Views_section_field', ["id", "parentId", "parentPos"], [
      [1,  1,  1.0],
      [2,  1,  2.0],
      [3,  2,  3.0],
      [4,  2,  4.0],
      [5,  3,  5.0],
      [6,  3,  6.0],
      [7,  4,  7.0],
      [8,  4,  8.0],
      [9,  5,  9.0],
      [10, 5, 10.0],
      [11, 6, 11.0],
      [12, 6, 12.0],
      [13, 7, 13.0],
      [14, 7, 14.0],
      [15, 8, 15.0],
      [16, 8, 16.0],
    ])

    table = self.engine.docmodel.tables.lookupOne(tableId='Test2')
    self.assertRecordSet(table.viewSections, [1, 2, 3, 7])
    self.assertRecordSet(list(table.viewSections)[0].fields, [1, 2])
    self.assertRecordSet(list(table.viewSections)[3].fields, [13, 14])
    view = self.engine.docmodel.views.lookupOne(id=1)
    self.assertRecordSet(view.viewSections, [1, 7, 8])

    self.engine.docmodel.remove(set(table.viewSections) -
      {table.rawViewSectionRef, table.recordCardViewSectionRef})
    self.assertRecordSet(view.viewSections, [8])


  def test_modifications(self):
    # Test the add/remove/update methods of DocModel.
    self.load_sample(testsamples.sample_students)
    table = self.engine.docmodel.get_table('Students')
    records = table.lookupRecords(lastName='Bush')
    self.assertEqual([r.id for r in records], [2, 4])
    self.assertEqual([r.schoolName for r in records], ["Yale", "Yale"])
    self.assertEqual([r.firstName for r in records], ["George W", "George H"])

    # Test the update() method.
    self.engine.docmodel.update(records, schoolName="Test", firstName=["george w", "george h"])
    self.assertEqual([r.schoolName for r in records], ["Test", "Test"])
    self.assertEqual([r.firstName for r in records], ["george w", "george h"])

    # Test the remove() method.
    self.engine.docmodel.remove(records)
    records = table.lookupRecords(lastName='Bush')
    self.assertEqual(list(records), [])
    self.assertTableData("Students", cols="subset", data=[
        ["id","firstName","lastName", "schoolName" ],
        [1,   "Barack",   "Obama",    "Columbia"   ],
        [3,   "Bill",     "Clinton",  "Columbia"   ],
        [5,   "Ronald",   "Reagan",   "Eureka"     ],
        [6,   "Gerald",   "Ford",     "Yale"       ]])

    # Test the add() method.
    self.engine.docmodel.add(table, schoolName="Foo", firstName=["X", "Y"])
    self.assertTableData("Students", cols="subset", data=[
        ["id","firstName","lastName", "schoolName" ],
        [1,   "Barack",   "Obama",    "Columbia"   ],
        [3,   "Bill",     "Clinton",  "Columbia"   ],
        [5,   "Ronald",   "Reagan",   "Eureka"     ],
        [6,   "Gerald",   "Ford",     "Yale"       ],
        [7,   "X",        "",         "Foo"        ],
        [8,   "Y",        "",         "Foo"        ],
    ])

  def test_inserts(self):
    # Test the insert() method. We do this on the columns metadata table, so that we can sort by
    # a PositionNumber column.
    self.load_sample(testsamples.sample_students)
    student_columns = self.engine.docmodel.tables.lookupOne(tableId='Students').columns
    school_columns = self.engine.docmodel.tables.lookupOne(tableId='Schools').columns

    # Should go at the end of the Students table.
    cols = self.engine.docmodel.insert(student_columns, None, colId=["a", "b"], type="Text")
    # Should go at the start of the Schools table.
    self.engine.docmodel.insert_after(school_columns, None, colId="foo", type="Int")
    # Should go before the new "a", "b" columns of the Students table.
    self.engine.docmodel.insert(student_columns, cols[0].parentPos, colId="bar", type="Date")

    # Verify that the right columns were added to the right tables. This doesn't check positions.
    self.assertTables([
      Table(1, "Students", 0, 0, columns=[
        Column(1, "firstName",    "Text",  False, "", 0),
        Column(2, "lastName",     "Text",  False, "", 0),
        Column(4, "schoolName",   "Text",  False, "", 0),
        Column(5, "schoolIds",    "Text",  True,
               "':'.join(str(id) for id in Schools.lookupRecords(name=$schoolName).id)", 0),
        Column(6, "schoolCities", "Text",  True,
               "':'.join(r.address.city for r in Schools.lookupRecords(name=$schoolName))", 0),
        Column(22, "a",           "Text", False, "", 0),
        Column(23, "b",           "Text", False, "", 0),
        Column(25, "bar",         "Date", False, "", 0),
      ]),
      Table(2, "Schools", 0, 0, columns=[
        Column(10, "name",        "Text", False, "", 0),
        Column(12, "address",     "Ref:Address",False, "", 0),
        Column(24, "foo",         "Int", False, "", 0),
      ]),
      Table(3, "Address", 0, 0, columns=[
        Column(21, "city",        "Text", False, "", 0),
      ])
    ])

    # Verify that positions are set such that the order is what we asked for.
    student_columns = self.engine.docmodel.tables.lookupOne(tableId='Students').columns
    self.assertEqual(list(map(int, student_columns)), [1,2,4,5,6,25,22,23])
    school_columns = self.engine.docmodel.tables.lookupOne(tableId='Schools').columns
    self.assertEqual(list(map(int, school_columns)), [24,10,12])
