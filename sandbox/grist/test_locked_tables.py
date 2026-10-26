import actions
import useractions
import test_engine


# A user dict for a lock-bypassing (system) session: the server sets
# SystemOnly.CanEditLockedTables on exceptional sessions, and the data engine reads it off the
# user object (see user.py / useractions._check_locks).
BYPASS_USER = {
  'Access': 'owners', 'UserID': 1, 'Email': 'system@getgrist.com', 'Name': 'System',
  'Origin': None, 'SessionID': 'system', 'IsLoggedIn': True, 'UserRef': None, 'ShareRef': None,
  'LinkKey': {}, 'SystemOnly': {'CanEditLockedTables': True},
}


class TestLockedTables(test_engine.EngineTestCase):
  """
  Tests the data engine's enforcement of the _grist_Tables.locked flag: a locked table rejects
  every direct user modification of its data or schema (and of the flag itself), while indirect
  engine work and lock-bypassing (system) sessions still write it.
  """

  def bypass(self, *user_action_reprs):
    """Apply user actions as a lock-bypassing (system) session, as internal machinery would."""
    return self.engine.apply_user_actions(
      [useractions.from_repr(r) for r in user_action_reprs], user=BYPASS_USER)

  def apply(self, *user_action_reprs):
    """Apply user actions as an ordinary (non-bypassing) user would."""
    return self.engine.apply_user_actions(
      [useractions.from_repr(r) for r in user_action_reprs])

  def table_ref(self, table_id):
    return self.engine.docmodel.tables.lookupOne(tableId=table_id).id

  def lock(self, table_id):
    self.bypass(["UpdateRecord", "_grist_Tables", self.table_ref(table_id), {"locked": True}])

  def make_doc(self):
    # "Locked" carries a data column A and a formula column F that reads another table, so we can
    # show indirect recalc still flows. "Other" references Locked, to exercise cascade freezing.
    self.apply(
      ["AddTable", "Locked", [
        {"id": "A", "type": "Numeric"},
        {"id": "F", "isFormula": True, "formula": "Other.lookupOne(id=1).V"},
      ]],
      ["AddTable", "Other", [{"id": "V", "type": "Numeric"}, {"id": "R", "type": "Ref:Locked"}]],
      ["AddRecord", "Other", None, {"V": 10}],
      ["AddRecord", "Locked", None, {"A": 1}],
    )

  def assertRefused(self, *user_action_reprs, **kwargs):
    # Match the message so a test can't pass on an incidental, unrelated ValueError. Both lock
    # messages ("Cannot modify locked table ...", "... change a table's locked flag") contain
    # "lock".
    message = kwargs.pop("message", "lock")
    assert not kwargs, "unexpected kwargs %r" % kwargs
    with self.assertRaisesRegex(ValueError, message):
      self.apply(*user_action_reprs)

  def test_direct_modifications_refused(self):
    # Every direct user modification of a locked table's data or schema is refused, whether spelled
    # as a table action, a column action, or a raw metadata edit that the engine turns into one.
    self.make_doc()
    self.lock("Locked")
    col_a = self.engine.docmodel.columns.lookupOne(parentId=self.table_ref("Locked"), colId="A").id

    for action in [
      ["AddRecord", "Locked", None, {"A": 5}],
      ["UpdateRecord", "Locked", 1, {"A": 5}],
      ["RemoveRecord", "Locked", 1],
      ["AddColumn", "Locked", "B", {"type": "Text"}],
      ["RemoveColumn", "Locked", "A"],
      ["RenameColumn", "Locked", "A", "A2"],
      ["ModifyColumn", "Locked", "A", {"type": "Text"}],
      ["RenameTable", "Locked", "Locked2"],
      ["RemoveTable", "Locked"],
      # Raw RemoveTable with no accompanying metadata removal: caught while the _grist_Tables row
      # still exists (the normal RemoveTable removes that row before its own doc action fires).
      ["ApplyDocActions", [["RemoveTable", "Locked"]]],
      # Raw metadata variant of a type change: the engine emits a "ModifyColumn" which should be
      # blocked.
      ["UpdateRecord", "_grist_Tables_column", col_a, {"type": "Text"}],
      # A column added to Locked by naming Other via the two-way reference.
      ["AddReverseColumn", "Other", "R"],
    ]:
      with self.assertRaisesRegex(ValueError, "lock", msg="expected refusal for %r" % (action,)):
        self.apply(action)

    # The table is untouched by any of the refused actions.
    self.assertTableData("Locked", cols="subset", data=[
      ["id", "A"],
      [1,    1.0],
    ])

  def test_cascades_from_other_tables_refused(self):
    # Strict freeze: an edit to another table whose engine cascade would reach the locked table is
    # refused too. Removing/renaming a table that Locked references retargets Locked's Ref column.
    self.make_doc()
    # Give Locked a reference into Other, so Other is "referenced by" a locked table.
    self.bypass(["AddColumn", "Locked", "RefOther", {"type": "Ref:Other"}])
    self.lock("Locked")
    self.assertRefused(["RemoveTable", "Other"])
    self.assertRefused(["RenameTable", "Other", "Other2"])

  def test_bulk_table_removal_including_locked_refused(self):
    # A bulk removal of _grist_Tables rows that includes a locked table is refused even when the
    # locked table is not first. The error should name the locked table, not others.
    self.make_doc()
    self.lock("Locked")
    other_ref = self.table_ref("Other")
    locked_ref = self.table_ref("Locked")
    with self.assertRaisesRegex(ValueError, "Cannot modify locked table Locked"):
      self.apply(["ApplyDocActions",
                  [["BulkRemoveRecord", "_grist_Tables", [other_ref, locked_ref]]]])

  def test_indirect_teardown_of_a_locked_summary_allowed(self):
    # Indirect removals are engine maintenance and are allowed even on a locked table: tearing down
    # a locked summary table by removing its last view section succeeds.
    # Only direct removal of a locked table is refused.
    self.make_doc()  # make_doc already gives Other a row
    self.apply(["CreateViewSection", self.table_ref("Other"), 0, "record", [], None])
    summary_ref = self.engine.docmodel.tables.lookupOne(
      summarySourceTable=self.table_ref("Other")).id
    # lock the summary
    self.bypass(["UpdateRecord", "_grist_Tables", summary_ref, {"locked": True}])
    section = [s for s in self.engine.docmodel.view_sections.all
               if s.tableRef.id == summary_ref and not s.isRaw][0]
    # Removing the section orphans the locked summary table, whose teardown (indirect RemoveTable)
    # must be allowed.
    self.apply(["RemoveRecord", "_grist_Views_section", section.id])
    self.assertFalse(self.engine.docmodel.tables.lookupOne(id=summary_ref).id)

  def test_bypass_and_indirect_allowed(self):
    # The bypass machinery may write the locked table's data and schema; indirect engine work
    # (here, recomputing Locked.F when its input in Other changes) flows untouched.
    self.make_doc()
    self.lock("Locked")

    self.bypass(["UpdateRecord", "Locked", 1, {"A": 7}])
    self.bypass(["AddColumn", "Locked", "B", {"type": "Text"}])
    self.bypass(["AddRecord", "Locked", None, {"A": 8}])
    self.assertTableData("Locked", cols="subset", data=[
      ["id", "A",   "B"],
      [1,    7.0,   ""],
      [2,    8.0,   ""],
    ])

    # Editing Other is allowed (Other is not locked) and recomputes Locked.F indirectly.
    self.apply(["UpdateRecord", "Other", 1, {"V": 42}])
    self.assertTableData("Locked", cols="subset", data=[
      ["id", "A",   "F"],
      [1,    7.0,   42.0],
      [2,    8.0,   42.0],
    ])

    # The bypass machinery may also remove the locked table outright (e.g. sync teardown).
    self.bypass(["RemoveTable", "Locked"])
    self.assertTableData("_grist_Tables", cols="subset",
                         rows=lambda r: r.tableId == "Locked",
                         data=[["id", "tableId"]])

  def test_flip_authority(self):
    # Only the bypass path may change the locked flag, in either direction.
    self.make_doc()
    ref = self.table_ref("Locked")
    self.assertRefused(["UpdateRecord", "_grist_Tables", ref, {"locked": True}])
    self.lock("Locked")
    # Still locked: a direct unlock is refused, so the table stays protected.
    self.assertRefused(["UpdateRecord", "_grist_Tables", ref, {"locked": False}])
    self.assertRefused(["UpdateRecord", "Locked", 1, {"A": 2}])
    # The bypass path can unlock, after which ordinary edits work again.
    self.bypass(["UpdateRecord", "_grist_Tables", ref, {"locked": False}])
    self.apply(["UpdateRecord", "Locked", 1, {"A": 3}])
    self.assertTableData("Locked", cols="subset", data=[["id", "A"], [1, 3.0]])

  def test_flag_flip_requires_a_real_change(self):
    # Flipping the flag is refused for a direct user, but only when the value actually changes: a
    # direct bundle that echoes the unchanged value is fine.
    self.make_doc()
    ref = self.table_ref("Locked")
    # unlocked -> locked
    self.assertRefused(["UpdateRecord", "_grist_Tables", ref, {"locked": True}])
    self.lock("Locked")
    self.apply(["UpdateRecord", "_grist_Tables", ref, {"locked": True}])  # no-op echo: allowed
    # locked -> unlocked
    self.assertRefused(["UpdateRecord", "_grist_Tables", ref, {"locked": False}])

  def test_undo_across_a_lock_is_refused(self):
    # A pre-lock edit, replayed by a user-level undo after the table is locked, arrives as a
    # direct ApplyUndoActions and is refused - the edit cannot be undone while the table is locked.
    self.make_doc()
    out = self.apply(["UpdateRecord", "Locked", 1, {"A": 2}])
    undo_reprs = [actions.get_action_repr(a) for a in out.undo]
    self.lock("Locked")
    with self.assertRaisesRegex(ValueError, "lock"):
      self.apply(["ApplyUndoActions", undo_reprs])
    self.assertTableData("Locked", cols="subset", data=[["id", "A"], [1, 2.0]])
