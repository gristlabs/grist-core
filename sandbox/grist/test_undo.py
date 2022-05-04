import re
import test_engine
import testsamples

class TestUndo(test_engine.EngineTestCase):
  def test_bad_undo(self):
    # Sometimes undo can make metadata inconsistent with schema. Check that we disallow it.
    self.load_sample(testsamples.sample_students)
    out_actions1 = self.apply_user_action(['AddEmptyTable', None])
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
    with self.assertRaisesRegex(AssertionError,
        re.compile(r"Internal schema inconsistent.*'NewCol'", re.S)):
      self.apply_undo_actions(out_actions1.undo)

    # Check that schema and metadata look OK.
    self.engine.assert_schema_consistent()

    # Doc state should be unchanged.

    # A little cheating here: assertPartialData() below checks the same thing, but the private
    # calculated field "columns" in _grist_Tables metadata is left out of date by the failed undo.
    # In practice it's harmless: properly calculated fields get restored correct, and the private
    # metadata fields get brought up-to-date when used via Record interface, which is what we do
    # using this assertEqual().
    self.assertEqual([[r.id, r.tableId, list(map(int, r.columns))]
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

  def test_import_undo(self):
    # Here we reproduce another bad situation. A more complex example with the same essence arose
    # during undo of imports when the undo could omit part of the action bundle.
    self.load_sample(testsamples.sample_students)

    out_actions1 = self.apply_user_action(['AddEmptyTable', None])
    out_actions2 = self.add_column('Table1', 'D', type='Text')
    out_actions3 = self.remove_column('Table1', 'D')
    out_actions4 = self.apply_user_action(['RemoveTable', 'Table1'])
    out_actions5 = self.apply_user_action(['AddTable', 'Table1', [{'id': 'X'}]])

    undo_actions = [da for out in [out_actions1, out_actions2, out_actions4, out_actions5]
                       for da in out.undo]
    with self.assertRaises(AssertionError):
      self.apply_undo_actions(undo_actions)

    # The undo failed, and data should look as before the undo.
    self.engine.assert_schema_consistent()
    self.assertEqual([[r.id, r.tableId, list(map(int, r.columns))]
                      for r in self.engine.docmodel.tables.table.filter_records()], [
      [1,   "Students", [1,2,4,5,6]],
      [2,   "Schools", [10,12]],
      [3,   "Address", [21]],
      [4,   "Table1", [22, 23]],
    ])
