# pylint: disable=line-too-long
"""
Regression tests for an undo that failed after a table or column rename in the same bundle.

When a bundle removes an entity whose stored values were set aside (a formula conversion discards
a column's data; removing that column then defers putting the data back), the engine emits a
"front restore" -- a deferred undo that re-applies those values. It is inserted at the *front* of
the undo list, and undo replays the list in reverse, so the front restore is the *last* undo
action applied. By the time it runs, every direct action's undo has already run, including the
rollback of any RenameTable/RenameColumn in the bundle, so the entity is back to the name it had
before the bundle. The restore therefore has to refer to the table and column by their
*pre-rename* names. Stamping it with the post-rename name made undo fail with a KeyError on a
name that no longer existed, leaving the document stuck (the batch could not be rolled back).
"""
import test_engine
import useractions


class TestUndoRename(test_engine.EngineTestCase):

  def apply_bundle(self, *user_actions):
    """Apply several user actions as a single bundle (one undo step), like a real batch edit."""
    return self.engine.apply_user_actions([useractions.from_repr(a) for a in user_actions])

  def assert_bundle_round_trips(self, *user_actions):
    """Apply the bundle, then undo it, and require the document to return to its prior state."""
    before = self.getFullEngineData()
    out_actions = self.apply_bundle(*user_actions)
    # The undo must apply cleanly (the bug threw a KeyError here) and restore the prior state.
    self.apply_undo_actions(out_actions.undo)
    self.assertEqualDocData(self.getFullEngineData(), before)

  def make_one_column_table(self):
    self.apply_user_action(["AddTable", "T1", [{"id": "c1", "type": "Text"}]])
    self.apply_user_action(["AddRecord", "T1", 1, {"c1": "hello"}])
    self.apply_user_action(["AddRecord", "T1", 2, {"c1": "world"}])

  def test_convert_remove_column_then_rename_table(self):
    # The exact reproduction from plans/ENGINE_BUG.md: turn a column into a formula (its stored
    # values are set aside), remove it, and rename its table -- all in one bundle. Before the fix,
    # undo failed with KeyError 'T2'.
    self.make_one_column_table()
    self.assert_bundle_round_trips(
      ["ModifyColumn", "T1", "c1", {"isFormula": True, "formula": "'z'"}],
      ["RemoveColumn", "T1", "c1"],
      ["RenameTable", "T1", "T2"],
    )

  def test_convert_remove_column_then_rename_table_chain(self):
    # A rename chain (T1 -> T2 -> T3) must still resolve back to the original name, not just the
    # immediately-previous one.
    self.make_one_column_table()
    self.assert_bundle_round_trips(
      ["ModifyColumn", "T1", "c1", {"isFormula": True, "formula": "'z'"}],
      ["RemoveColumn", "T1", "c1"],
      ["RenameTable", "T1", "T2"],
      ["RenameTable", "T2", "T3"],
    )

  def test_rename_then_convert_remove_column(self):
    # The column analog: rename a column, then convert and remove it in the same bundle. The front
    # restore must use the column's pre-rename name. Before the fix, undo failed with KeyError 'c2'.
    self.make_one_column_table()
    self.assert_bundle_round_trips(
      ["RenameColumn", "T1", "c1", "c2"],
      ["ModifyColumn", "T1", "c2", {"isFormula": True, "formula": "'z'"}],
      ["RemoveColumn", "T1", "c2"],
    )

  def test_rename_both_table_and_column(self):
    # Both a column and its table are renamed in the bundle that removes the column; the restore
    # must use the pre-rename names for both.
    self.make_one_column_table()
    self.assert_bundle_round_trips(
      ["RenameColumn", "T1", "c1", "c2"],
      ["ModifyColumn", "T1", "c2", {"isFormula": True, "formula": "'z'"}],
      ["RemoveColumn", "T1", "c2"],
      ["RenameTable", "T1", "T2"],
    )


if __name__ == "__main__":
  test_engine.main()
