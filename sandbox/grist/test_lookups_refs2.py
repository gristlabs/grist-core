# More tests of lookups in a Reference or ReferenceList columns, and of automatic recalculation.

import lookup
import testutil
import test_engine
from test_reload_oracle import ReloadOracleMixin

class TestLookupsRefs2(ReloadOracleMixin, test_engine.EngineTestCase):
  def test_add_record_with_default_empty_ref(self):
    """
    Adding a record with a Ref column left at its default (empty) value must index it under the
    empty key, so T.lookupRecords(RefCol=0) finds it.

    This used to miss: the reference lookup relies on the ref column's reverse map, which is
    maintained by set()/unset(), but add_records never calls set() for omitted columns. Now
    add_records indexes the default value of reference columns not given an explicit value,
    symmetric with unset() de-indexing every column on remove.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "Friend", "Ref:Table1", False, "", "", ""],
          [2, "NumNoFriend", "Any", True,
            "len(Table1.lookupRecords(Friend=0))", "", ""],
        ]],
      ],
      "DATA": {"Table1": [["id", "Friend"]]},   # empty
    }))

    # Add a record, leaving Friend at its DEFAULT (empty) value.
    self.add_record("Table1")

    # The new row has no friend, so the empty bucket should contain it.
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "NumNoFriend"],
      [1, 1],
    ])


  def test_lookup_on_formula_ref_column(self):
    """
    Looking up a Ref column that is itself a FORMULA must return the right result at load: the
    dependent lookup must be computed after the formula ref column.

    This used to return empty (and stay empty after a full Calculate): _recalc_rec_method was a
    no-op, so bringing the lookup map "up to date" read nothing and raised no OrderError; the engine
    served the lookup against the not-yet-populated map and, since each cell is computed at most
    once per pass (_recompute_done_map), the later set()-driven invalidation was dropped. Now
    _recalc_rec_method reads the ref column, giving the lookup map a real per-row dependency, so the
    engine orders the ref column ahead of the dependent lookup within the pass. (A non-formula ref
    was correct only by luck of ordering: its values are set before any formula runs.)

    Not about empty values: this uses an unconditional ref that always points to a valid row.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Items", [
          # A formula Ref that unconditionally points every Item at the one Group.
          [1, "Group", "Ref:Groups", True, "1", "", ""],
        ]],
        [2, "Groups", [
          [2, "NumItems", "Any", True, "len(Items.lookupRecords(Group=$id))", "", ""],
        ]],
      ],
      "DATA": {
        "Items": [["id"], [1], [2]],
        "Groups": [["id"], [1]],
      },
    }))
    self.assertTableData("Groups", cols="subset", data=[
      ["id", "NumItems"],
      [1, 2],
    ])

  def test_reflist_nonzero_match_empty_crashes(self):
    """
    A RefList lookup with non-zero match_empty must compute like the general (non-optimized) path:
    an empty list matches the key equal to match_empty.

    This used to crash Calculate with a KeyError (a whole-document failure): the reference
    optimization can't represent a non-zero empty key, and LookupMapColumnForReferences.__init__
    raised to reject it -- but only after super().__init__ had registered the column's node with
    the engine and before the caller stored the column in all_columns, leaving a dangling node.
    Now is_reference_lookup routes this case to the general ContainsLookupMapping path, which
    handles it.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "Refs", "RefList:Table1", False, "", "", ""],
          [2, "Hits", "Any", True,
            "len(Table1.lookupRecords(Refs=CONTAINS(1, match_empty=1)))", "", ""],
        ]],
      ],
      "DATA": {"Table1": [["id", "Refs"], [1, None]]},
    }))
    # The empty list matches key 1 (== match_empty), so the row counts itself.
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "Hits"],
      [1, 1],
    ])

  def test_add_reverse_freezes_lookup(self):
    """
    A lookup on a Ref column must keep working after a schema op that rebuilds the column object --
    even ones keeping it a reference: AddReverseColumn (used here), Ref:A->Ref:B, data->formula Ref,
    Ref->Numeric, and their undo/removal.

    This used to freeze: LookupMapColumnForReferences cached the ref column object (for reads and
    for its update hook), and _rebuild_model reuses cached lookup helpers verbatim, so after a
    rebuild the helper pointed at the dead object and its hook sat on the dead object while edits
    flowed through the new one. It now resolves the ref column live by col_id and re-attaches its
    hook to the live column, so it survives the rebuild (as non-reference lookups always did).
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Students", [
          [1, "Name", "Text", False, "", "", ""],
          [2, "MainClass", "Ref:Classes", False, "", "", ""],
        ]],
        [2, "Classes", [
          [10, "ClassName", "Text", False, "", "", ""],
          [11, "Main", "Any", True,
            "':'.join(Students.lookupRecords(MainClass=$id).Name)", "", ""],
        ]],
      ],
      "DATA": {
        "Students": [
          ["id", "Name", "MainClass"],
          [1, "Alice", 1],
          [2, "Bob", 2],
        ],
        "Classes": [["id", "ClassName"], [1, "Lit"], [2, "Sci"]],
      }
    }))
    self.assertTableData("Classes", cols="subset", data=[
      ["id", "ClassName", "Main"],
      [1, "Lit", "Alice"],
      [2, "Sci", "Bob"],
    ])

    # One-click "make two-way reference". MainClass STAYS a Ref:Classes column.
    self.apply_user_action(["AddReverseColumn", "Students", "MainClass"])

    # Move Bob from class 2 to class 1.
    self.update_record("Students", 2, MainClass=1)

    self.assertTableData("Classes", cols="subset", data=[
      ["id", "ClassName", "Main"],
      [1, "Lit", "Alice:Bob"],
      [2, "Sci", ""],
    ])

  def test_rename_target_table_freezes_lookup(self):
    """
    A lookup on a (plain, non-formula) Ref column must keep working after RenameTable of the
    *referenced* table -- the same rebuild-the-ref-column family as test_add_reverse_freezes_lookup,
    but with a far more common trigger (renaming the target table changes the column's type from
    Ref:Groups to Ref:Cohorts, rebuilding its object).

    This used to freeze post-rename edits (the cached lookup helper kept reading/hooking the dead
    column object). Not a load-ordering issue: the data ref loads correctly; it's purely the rebuilt
    binding. Fixed by resolving the ref column live by col_id and re-attaching the hook to it.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Items", [
          [1, "Group", "Ref:Groups", False, "", "", ""],
        ]],
        [2, "Groups", [
          [2, "Names", "Any", True,
            "','.join(str(r.id) for r in Items.lookupRecords(Group=$id))", "", ""],
        ]],
      ],
      "DATA": {
        "Items": [["id", "Group"], [1, 1], [2, 1], [3, 2]],
        "Groups": [["id"], [1], [2]],
      },
    }))
    self.assertTableData("Groups", cols="subset", data=[
      ["id", "Names"],
      [1, "1,2"],
      [2, "3"],
    ])

    # Rename the referenced table. Group stays a reference (now Ref:Cohorts).
    self.apply_user_action(["RenameTable", "Groups", "Cohorts"])

    # Move item 3 from group 2 to group 1.
    self.update_record("Items", 3, Group=1)

    self.assertTableData("Cohorts", cols="subset", data=[
      ["id", "Names"],
      [1, "1,2,3"],
      [2, ""],
    ])

  def test_add_ref_column_to_existing_rows(self):
    """
    A Ref column added to a table that already has rows must index those rows under the empty
    key, so T.lookupRecords(RefCol=0) finds them.

    isFormula=False matters here: a bare AddColumn creates an empty formula column, and the
    first data write converts it via ModifyColumn, which re-sets every row and rebuilds the
    index as a side effect. Creating a typed data column directly (e.g. REST POST /columns) is
    the path that must index the pre-existing rows itself.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [[1, "Table1", [[1, "A", "Text", False, "", "", ""]]]],
      "DATA": {"Table1": [["id"], [1], [2]]},
    }))

    self.apply_user_action(["AddColumn", "Table1", "Friend",
      {"type": "Ref:Table1", "isFormula": False}])
    self.apply_user_action(["AddColumn", "Table1", "NumNoFriend",
      {"formula": "len(Table1.lookupRecords(Friend=0))"}])

    # Neither row has a friend, so the empty bucket should contain both.
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "NumNoFriend"],
      [1, 2],
      [2, 2],
    ])
    self.assert_reload_consistent("after adding a Ref column to existing rows")

  def test_convert_looked_up_ref_to_numeric(self):
    """
    Converting a looked-up Ref column to a non-reference type must keep dependent lookups
    computing (the numeric values still match the row-id keys) and reactive to further edits.
    The reference-lookup helper resolves its column by col_id and survives column rebuilds, so
    the rebuild must replace it when the column is no longer a reference.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Items", [
          [1, "Group", "Ref:Groups", False, "", "", ""],
        ]],
        [2, "Groups", [
          [2, "NumItems", "Any", True, "len(Items.lookupRecords(Group=$id))", "", ""],
        ]],
      ],
      "DATA": {
        "Items": [["id", "Group"], [1, 1], [2, 1]],
        "Groups": [["id"], [1]],
      },
    }))

    self.apply_user_action(["ModifyColumn", "Items", "Group", {"type": "Numeric"}])

    self.assertTableData("Groups", cols="subset", data=[
      ["id", "NumItems"],
      [1, 2],
    ])
    self.assert_reload_consistent("after Ref->Numeric on a lookup key column")

  def test_ref_reflist_roundtrip(self):
    """
    A Ref -> RefList -> Ref round-trip on a lookup key column (data returns to its original
    values) must leave dependent lookups correct. In the middle state the lookup legitimately
    errors (a RefList looked up by a scalar id); the second type change must invalidate the
    erroring cells so they recover rather than stay stuck on the cached error.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Classes", [
          [10, "Name", "Text", False, "", "", ""],
          [11, "Cnt", "Any", True, "len(Students.lookupRecords(MainClass=$id))", "", ""],
        ]],
        [2, "Students", [
          [20, "Name",      "Text",        False, "", "", ""],
          [21, "MainClass", "Ref:Classes", False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Classes": [["id", "Name"], [1, "Lit"], [2, "Sci"]],
        "Students": [["id", "Name", "MainClass"], [1, "A", 1], [2, "B", 1], [3, "C", 2]],
      },
    }))
    self.assertEqual(list(self.engine.fetch_table("Classes").columns["Cnt"]), [2, 1])

    self.apply_user_action(["ModifyColumn", "Students", "MainClass", {"type": "RefList:Classes"}])
    self.apply_user_action(["ModifyColumn", "Students", "MainClass", {"type": "Ref:Classes"}])

    self.assertEqual(list(self.engine.fetch_table("Classes").columns["Cnt"]), [2, 1])
    self.assert_reload_consistent("after Ref->RefList->Ref round-trip")

  def test_lookup_helper_hook_cleanup(self):
    """
    A reference lookup helper registers an update hook on its key column; when the last formula
    using the lookup goes away, the unused-helper cleanup must unregister the hook. Otherwise
    add/remove cycles accumulate dead hooks (each pinning its dead helper), all firing on every
    edit of the key column.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [[1, "Table1", [[1, "Friend", "Ref:Table1", False, "", "", ""]]]],
      "DATA": {"Table1": [["id", "Friend"], [1, 0], [2, 1]]},
    }))
    table = self.engine.tables["Table1"]
    for _ in range(3):
      self.apply_user_action(["AddColumn", "Table1", "Num",
        {"formula": "len(Table1.lookupRecords(Friend=$id))"}])
      self.assertEqual(len(table._col_update_hooks.get("Friend", [])), 1)
      self.apply_user_action(["RemoveColumn", "Table1", "Num"])
      self.assertEqual(len(table._col_update_hooks.get("Friend", [])), 0)

  def _count_ref_update_invalidation_work(self, n_src, n_watchers=8):
    # Build n_watchers formula cells that all look up the same reference key, and n_src source
    # rows that all reference that same target. Then bulk-update every source row's reference,
    # and return the total invalidation work done (rows examined across the lookup relations).
    self.setUp()
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Src",   [[1, "Ref", "Ref:Tgt", False, "", "", ""]]],
        [2, "Tgt",   [[2, "N", "Numeric", False, "", "", ""]]],
        [3, "Watch", [[3, "C", "Any", True, "len(Src.lookupRecords(Ref=1))", "", ""]]],
      ],
      "DATA": {
        "Tgt":   [["id"], [1], [2]],
        "Watch": [["id"]] + [[i] for i in range(1, n_watchers + 1)],
        "Src":   [["id", "Ref"]] + [[i, 1] for i in range(1, n_src + 1)],
      },
    }))
    total = [0]
    orig = lookup._LookupRelation.get_affected_rows_by_keys
    def counted(rel_self, keys):
      rows = orig(rel_self, keys)
      total[0] += len(rows)
      return rows
    lookup._LookupRelation.get_affected_rows_by_keys = counted
    try:
      self.apply_user_action(["BulkUpdateRecord", "Src", list(range(1, n_src + 1)),
                              {"Ref": [2] * n_src}])
    finally:
      lookup._LookupRelation.get_affected_rows_by_keys = orig
    return total[0]

  def test_bulk_ref_update_invalidation_not_quadratic(self):
    """
    Bulk-updating a looked-up reference column must not re-invalidate a shared lookup key once
    per updated row: that is O(rows * cells-looking-up-the-key). The per-key invalidation is
    deduplicated within the update, so the work depends on the number of distinct keys and the
    cells looking them up, not on the number of updated rows.
    """
    # Doubling the number of updated rows must not increase the invalidation work.
    self.assertEqual(self._count_ref_update_invalidation_work(500),
                     self._count_ref_update_invalidation_work(1000))
