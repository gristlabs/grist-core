import re
import test_engine
import testsamples

class TestUndo(test_engine.EngineTestCase):
  def test_bad_undo(self):
    # Sometimes undo can make metadata inconsistent with schema. Check that we disallow it.
    self.load_sample(testsamples.sample_students)
    out_actions1 = self.apply_user_action(['AddEmptyTable'])
    self.assertPartialData("_grist_Tables", ["id", "tableId", "columns"], [
      [1,   "Students", [1,2,4,5,6]],
      [2,   "Schools", [10,12]],
      [3,   "Address", [21]],
      [4,   "Table1", [22,23,24,25]],
    ])

    # Add a column, and check that it's present in the metadata.
    self.add_column('Table1', 'NewCol', type='Text')
    self.assertPartialData("_grist_Tables", ["id", "tableId", "columns"], [
      [1,   "Students", [1,2,4,5,6]],
      [2,   "Schools", [10,12]],
      [3,   "Address", [21]],
      [4,   "Table1", [22,23,24,25,26]],
    ])

    # Now undo just the first action. The list of undo DocActions for it does not mention the
    # newly added column, and fails to clean it up. This would leave the doc in an inconsistent
    # state, and we should not allow it.
    with self.assertRaisesRegexp(AssertionError,
        re.compile(r"Internal schema inconsistent.*'NewCol'", re.S)):
      self.apply_undo_actions(out_actions1.undo)

    # Doc state should be unchanged.

    # A little cheating here: assertPartialData() below checks the same thing, but the private
    # calculated field "columns" in _grist_Tables metadata is left out of date by the failed undo.
    # In practice it's harmless: properly calculated fields get restored correct, and the private
    # metadata fields get brought up-to-date when used via Record interface, which is what we do
    # using this assertEqual().
    self.assertEqual([[r.id, r.tableId, map(int, r.columns)]
                      for r in self.engine.docmodel.tables.table.filter_records()], [
      [1,   "Students", [1,2,4,5,6]],
      [2,   "Schools", [10,12]],
      [3,   "Address", [21]],
      [4,   "Table1", [22,23,24,25,26]],
    ])

    self.assertPartialData("_grist_Tables", ["id", "tableId", "columns"], [
      [1,   "Students", [1,2,4,5,6]],
      [2,   "Schools", [10,12]],
      [3,   "Address", [21]],
      [4,   "Table1", [22,23,24,25,26]],
    ])
