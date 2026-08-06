"""
Tests of summary group membership.
"""

import testutil
import test_engine


class TestSummaryGroups(test_engine.EngineTestCase):

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
