import unittest

import actions

class TestActions(unittest.TestCase):
  action_obj1 = actions.UpdateRecord("foo", 17, {"bar": "baz"})
  doc_action1 = ["UpdateRecord", "foo", 17, {"bar": "baz"}]

  def test_convert(self):
    self.assertEqual(actions.get_action_repr(self.action_obj1), self.doc_action1)
    self.assertEqual(actions.action_from_repr(self.doc_action1), self.action_obj1)

    with self.assertRaises(ValueError) as err:
      actions.action_from_repr(["Foo", "bar"])
    self.assertTrue("Foo" in str(err.exception))

  def test_prune_actions(self):
    # prune_actions is in-place, so we make a new list every time.
    def alist():
      return [
        actions.BulkUpdateRecord("Table1", [1,2,3], {'Foo': [10,20,30]}),
        actions.BulkUpdateRecord("Table2", [1,2,3], {'Foo': [10,20,30], 'Bar': ['a','b','c']}),
        actions.UpdateRecord("Table1", 17, {'Foo': 10}),
        actions.UpdateRecord("Table2", 18, {'Foo': 10, 'Bar': 'a'}),
        actions.AddRecord("Table1", 17, {'Foo': 10}),
        actions.BulkAddRecord("Table2", 18, {'Foo': 10, 'Bar': 'a'}),
        actions.ReplaceTableData("Table2", 18, {'Foo': 10, 'Bar': 'a'}),
        actions.RemoveRecord("Table1", 17),
        actions.BulkRemoveRecord("Table2", [17,18]),
        actions.AddColumn("Table1", "Foo", {"type": "Text"}),
        actions.RenameColumn("Table1", "Foo", "Bar"),
        actions.ModifyColumn("Table1", "Foo", {"type": "Text"}),
        actions.RemoveColumn("Table1", "Foo"),
        actions.AddTable("THello", [{"id": "Foo"}, {"id": "Bar"}]),
        actions.RemoveTable("THello"),
        actions.RenameTable("THello", "TWorld"),
      ]

    def prune(table_id, col_id):
      a = alist()
      actions.prune_actions(a, table_id, col_id)
      return a

    self.assertEqual(prune('Table1', 'Foo'), [
      actions.BulkUpdateRecord("Table2", [1,2,3], {'Foo': [10,20,30], 'Bar': ['a','b','c']}),
      actions.UpdateRecord("Table2", 18, {'Foo': 10, 'Bar': 'a'}),
      actions.BulkAddRecord("Table2", 18, {'Foo': 10, 'Bar': 'a'}),
      actions.ReplaceTableData("Table2", 18, {'Foo': 10, 'Bar': 'a'}),
      actions.RemoveRecord("Table1", 17),
      actions.BulkRemoveRecord("Table2", [17,18]),
      # It doesn't do anything with column renames; it can be addressed if needed.
      actions.RenameColumn("Table1", "Foo", "Bar"),
      # It doesn't do anything with AddTable, which is expected.
      actions.AddTable("THello", [{"id": "Foo"}, {"id": "Bar"}]),
      actions.RemoveTable("THello"),
      actions.RenameTable("THello", "TWorld"),
    ])

    self.assertEqual(prune('Table2', 'Foo'), [
      actions.BulkUpdateRecord("Table1", [1,2,3], {'Foo': [10,20,30]}),
      actions.BulkUpdateRecord("Table2", [1,2,3], {'Bar': ['a','b','c']}),
      actions.UpdateRecord("Table1", 17, {'Foo': 10}),
      actions.UpdateRecord("Table2", 18, {'Bar': 'a'}),
      actions.AddRecord("Table1", 17, {'Foo': 10}),
      actions.BulkAddRecord("Table2", 18, {'Bar': 'a'}),
      actions.ReplaceTableData("Table2", 18, {'Bar': 'a'}),
      actions.RemoveRecord("Table1", 17),
      actions.BulkRemoveRecord("Table2", [17,18]),
      actions.AddColumn("Table1", "Foo", {"type": "Text"}),
      actions.RenameColumn("Table1", "Foo", "Bar"),
      actions.ModifyColumn("Table1", "Foo", {"type": "Text"}),
      actions.RemoveColumn("Table1", "Foo"),
      actions.AddTable("THello", [{"id": "Foo"}, {"id": "Bar"}]),
      actions.RemoveTable("THello"),
      actions.RenameTable("THello", "TWorld"),
    ])

if __name__ == "__main__":
  unittest.main()
