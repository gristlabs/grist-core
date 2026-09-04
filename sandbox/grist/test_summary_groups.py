"""
Tests of summary group membership as groups churn and across doc reloads.

Summary tables maintain membership incrementally: a key map from group-by values to summary
rows, per-row triggers, and auto-removal of emptied groups. Removing a row that other rows
reference exercises all of it at once, because the removal clears the referencing cells in a
cascade.
"""

import testutil
import test_engine
from test_reload_oracle import ReloadOracleMixin, build_fresh_engine


class TestSummaryGroups(ReloadOracleMixin, test_engine.EngineTestCase):

  def _group_counts(self, summary_table_id):
    td = self.engine.fetch_table(summary_table_id)
    return sorted(zip(td.columns["g"], td.columns["count"]))

  def _ref_group_sample(self, ref_type):
    return testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Other", [[9, "N", "Text", False, "", "", ""]]],
        [2, "T", [
          [20, "g", ref_type,  False, "", "", ""],
          [21, "x", "Numeric", False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Other": [["id", "N"], [1, "a"], [2, "b"], [3, "c"]],
        "T": [["id", "g", "x"], [1, 1, 1], [2, 1, 2], [3, 2, 3], [4, 2, 4]],
      },
    })

  def test_delete_ref_groupby_target(self):
    """
    Deleting a row that several source rows reference, when the summary groups by that Ref
    column, must collapse those source rows into a single empty-reference group: the removal
    clears their references one by one, and each must land in the same new group rather than
    mint a duplicate.
    """
    self.load_sample(self._ref_group_sample("Ref:Other"))
    self.apply_user_action(["CreateViewSection", 2, 0, "record", [20], None])
    self.assertEqual(self._group_counts("T_summary_g"), [(1, 2), (2, 2)])

    self.apply_user_action(["RemoveRecord", "Other", 1])
    # rows 1,2 lose their reference (cleared to 0) and should collapse into one empty group.
    self.assertEqual(self._group_counts("T_summary_g"), [(0, 2), (2, 2)])
    self.assert_reload_consistent("after deleting a Ref group-by target")

  def test_delete_reflist_groupby_target(self):
    """Same when grouping by a RefList column: cleared rows land in one empty-list group."""
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Other", [[9, "N", "Text", False, "", "", ""]]],
        [2, "T", [
          [20, "g", "RefList:Other", False, "", "", ""],
          [21, "x", "Numeric",       False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Other": [["id", "N"], [1, "a"], [2, "b"]],
        "T": [["id", "g", "x"], [1, [1], 1], [2, [1], 2], [3, [2], 3]],
      },
    }))
    self.apply_user_action(["CreateViewSection", 2, 0, "record", [20], None])
    self.assertEqual(self._group_counts("T_summary_g"), [(1, 2), (2, 1)])

    self.apply_user_action(["RemoveRecord", "Other", 1])
    # rows 1,2 become empty lists -> the empty-list sentinel group (key 0).
    self.assertEqual(self._group_counts("T_summary_g"), [(0, 2), (2, 1)])
    self.assert_reload_consistent("after deleting a RefList group-by target")

  def test_regroup_after_target_delete(self):
    """
    Regrouping rows after a group-by target delete must clean up the emptied groups without
    complaint: this guards the key-map bookkeeping as summary rows come and go.
    """
    self.load_sample(self._ref_group_sample("Ref:Other"))
    self.apply_user_action(["CreateViewSection", 2, 0, "record", [20], None])
    self.apply_user_action(["RemoveRecord", "Other", 1])
    self.apply_user_action(["BulkUpdateRecord", "T", [1, 2], {"g": [2, 2]}])

    self.assertEqual(self._group_counts("T_summary_g"), [(2, 4)])
    self.assert_reload_consistent("after emptying the merged group")

  def test_reload_of_summary_referenced_by_lookup(self):
    """
    Reloading a doc that has a summary table AND a formula that looks up that summary table
    must preserve the summary rows: the load-time Calculate must bring the summary machinery up
    to date before summary "group" cells are read, or the pre-loaded summary rows get
    auto-removed as empty before the source table repopulates them. This is the doc-open path,
    so getting it wrong means an affected document opens broken.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Company", [[10, "N", "Text", False, "", "", ""]]],
        [2, "People", [
          [20, "Name",    "Text",        False, "", "", ""],
          [21, "company", "Ref:Company", False, "", "", ""],
          [22, "amt",     "Numeric",     False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Company": [["id", "N"], [1, "Acme"], [2, "Beta"]],
        "People": [["id", "Name", "company", "amt"],
                   [1, "a", 1, 10], [2, "b", 1, 20], [3, "c", 2, 5]],
      },
    }))
    self.apply_user_action(["CreateViewSection", 2, 0, "record", [21], None])
    self.apply_user_action(["AddColumn", "Company", "SumAmt", {"type": "Any", "isFormula": True,
      "formula": "People_summary_company.lookupOne(company=$id).amt"}])

    live_rows = list(self.engine.fetch_table("People_summary_company").row_ids)
    self.assertEqual(live_rows, [1, 2])

    # Reloading the stored data must preserve the summary rows.
    reloaded = build_fresh_engine(self.engine)
    self.assertEqual(list(reloaded.fetch_table("People_summary_company").row_ids), live_rows)

  def test_detach_reflist_summary(self):
    """
    Detaching a summary grouped by a RefList column must produce a working "group" formula: the
    detached row's group-by cell is a single Ref, and the source cells are lists, so the lookup
    must use CONTAINS (with match_empty=0, to keep empty-list rows in the empty group).
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Other", [[9, "N", "Text", False, "", "", ""]]],
        [2, "T", [
          [20, "g", "RefList:Other", False, "", "", ""],
          [21, "x", "Numeric",       False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Other": [
          ["id", "N"],
          [1,    "a"],
          [2,    "b"],
        ],
        "T": [
          ["id", "g",    "x"],
          [1,    [1],    1],
          [2,    [1, 2], 2],
          [3,    [2],    3],
          [4,    None,   4],
        ],
      },
    }))
    result = self.apply_user_action(["CreateViewSection", 2, 0, "record", [20], None])
    # Source row 2 lists two refs, so it belongs to both of the corresponding groups.
    self.assertTableData("T_summary_g", cols="all", data=[
      ["id", "g", "group",  "count", "x"],
      [1,    1,   [1, 2],   2,       3],
      [2,    2,   [2, 3],   2,       5],
      [3,    0,   [4],      1,       4],
    ])

    self.apply_user_action(["DetachSummaryViewSection", result.retValues[0]["sectionRef"]])

    # The detached table keeps the same rows, with "group" computed by its own lookup formula.
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "g", "group",  "count", "x"],
      [1,    1,   [1, 2],   2,       3],
      [2,    2,   [2, 3],   2,       5],
      [3,    0,   [4],      1,       4],
    ])
