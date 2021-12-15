"""
Some more test cases for summary tables, involving UNDO.
"""
import logger
import testutil
import test_engine

log = logger.Logger(__name__, logger.INFO)

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
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [1]])
    self.assertTableData('GristSummary_6_Person', cols="subset", data=[
      [ "id", "state", "count"],
      [ 1,    "NY",    2],
      [ 2,    "IL",    2],
      [ 3,    "ME",    1],
    ])

    out_actions = self.update_record('Person', 4, state='ME')
    self.assertTableData('GristSummary_6_Person', cols="subset", data=[
      [ "id", "state", "count"],
      [ 1,    "NY",    1],
      [ 2,    "IL",    2],
      [ 3,    "ME",    2],
    ])

    self.apply_undo_actions(out_actions.undo[0:1])
    self.assertTableData('GristSummary_6_Person', cols="subset", data=[
      [ "id", "state", "count"],
      [ 1,    "NY",    2],
      [ 2,    "IL",    2],
      [ 3,    "ME",    1],
    ])
