import logging

import test_engine
from test_engine import Table, Column

log = logging.getLogger(__name__)

class TestReplaceTableData(test_engine.EngineTestCase):

  @test_engine.test_undo
  def test_replace_and_add(self):
    # This tests a fix for a bug where after ReplaceTableData, subsequent adds were causing an
    # error with "relabeling" (updating manualSort column).

    # Add a table with a couple of columns and records.
    self.apply_user_action(["AddTable", "Vessels", []])
    self.apply_user_action(["AddColumn", "Vessels", "Type", {}])
    self.apply_user_action(["AddColumn", "Vessels", "Size", {}])
    self.apply_user_action(["BulkAddRecord", "Vessels", [None, None],
      {"Type": ["cup", "pot"], "Size": [8, 64]}])

    # Check that we guessed correct column types, and the values are there.
    self.assertTables([
      Table(1, "Vessels", primaryViewId=1, summarySourceTable=0, columns=[
        Column(1, "manualSort", "ManualSortPos",  False, "", 0),
        Column(2, "Type",       "Text",           False, "", 0),
        Column(3, "Size",       "Numeric",        False, "", 0),
      ])
    ])
    self.assertTableData("Vessels", cols="subset", rows="all", data=[
      [ "id", "Type", "Size"  ],
      [ 1,    "cup",     8    ],
      [ 2,    "pot",    64    ],
    ])

    # Now do ReplaceTableData, and add more rows.
    self.apply_user_action(["ReplaceTableData", "Vessels", [], {}])

    # The bug used to happen here, manifesting as error
    # "docactions.[Bulk]UpdateRecord for non-existent # record #1"
    self.apply_user_action(["BulkAddRecord", "Vessels", [None, None],
      {"Type": ["shot", "bucket"], "Size": [1.5, 640.0]}])
    self.assertTableData("Vessels", cols="subset", rows="all", data=[
      [ "id", "Type",   "Size"  ],
      [ 1,    "shot",     1.5   ],
      [ 2,    "bucket",   640   ],
    ])
