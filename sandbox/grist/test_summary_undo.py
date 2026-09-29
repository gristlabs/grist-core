"""
Some more test cases for summary tables, involving UNDO.
"""
import logging
import actions
import testutil
import test_engine

log = logging.getLogger(__name__)

class TestSummaryUndo(test_engine.EngineTestCase):
  sample = testutil.parse_test_sample({
    "SCHEMA": [
      [1, "Person", [
        [1, "state",        "Text",       False],
      ]]
    ],
    "DATA": {
      "Person": [
        ["id",  "state", ],
        [   1,     "NY", ],
        [   2,     "IL", ],
        [   3,     "ME", ],
        [   4,     "NY", ],
        [   5,     "IL", ],
      ]
    }
  })

  def test_summary_undo1(self):
    # This tests a particular case of a bug when a summary table wasn't fully updated after UNDO.
    self.load_sample(self.sample)
    # Create a summary section, grouped by the "State" column.
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [1], None])
    self.assertTableData('Person_summary_state', cols="subset", data=[
      [ "id", "state", "count"],
      [ 1,    "NY",    2],
      [ 2,    "IL",    2],
      [ 3,    "ME",    1],
    ])

    out_actions = self.update_record('Person', 4, state='ME')
    self.assertTableData('Person_summary_state', cols="subset", data=[
      [ "id", "state", "count"],
      [ 1,    "NY",    1],
      [ 2,    "IL",    2],
      [ 3,    "ME",    2],
    ])

    self.apply_undo_actions(out_actions.undo[0:1])
    self.assertTableData('Person_summary_state', cols="subset", data=[
      [ "id", "state", "count"],
      [ 1,    "NY",    2],
      [ 2,    "IL",    2],
      [ 3,    "ME",    1],
    ])

  def test_summary_dup_key(self):
    """
    An undo stream can re-add a summary row whose group key already exists (an undo of a
    summary-row removal, after an equivalent group was auto-created). The duplicate gets
    auto-removed; the summary bookkeeping must keep track of the surviving row, so that later
    removals and recalcs still behave.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [[1, "Address", [[11, "City", "Text", False, "", "", ""]]]],
      "DATA": {"Address": [["id", "City"], [1, "New York"], [2, "New York"]]},
    }))
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11], None])
    st = "Address_summary_City"

    # Undo-style re-add of a summary row with the already-existing key.
    self.apply_undo_actions([actions.AddRecord(st, 9, {"City": "New York"})])
    # The duplicate was auto-removed. Now remove the survivor too.
    self.apply_undo_actions([actions.RemoveRecord(st, 1)])

    # The engine ends healthy: the group is recreated for the still-existing source rows.
    self.assertTableData(st, cols="subset", data=[
      ["id", "City", "count"],
      [1, "New York", 2],
    ])
