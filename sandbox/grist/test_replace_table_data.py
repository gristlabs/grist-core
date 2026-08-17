import logging

import testutil
import test_engine
from test_engine import Table, Column
from test_reload_oracle import ReloadOracleMixin

log = logging.getLogger(__name__)

class TestReplaceTableData(ReloadOracleMixin, test_engine.EngineTestCase):

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

  def test_lookup_after_replace(self):
    """
    ReplaceTableData (used by imports) must tear down the replaced rows' derived state: after
    the replace, lookups must see only the new references, with nothing left over from the
    replaced data.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "Friend", "Ref:Table1", False, "", "", ""],
          [2, "Hits", "Any", True, "len(Table1.lookupRecords(Friend=1))", "", ""],
        ]],
      ],
      "DATA": {"Table1": [["id", "Friend"], [1, 0], [2, 1]]},
    }))
    # After the replace, nobody points at row 1 any more.
    self.apply_user_action(["ReplaceTableData", "Table1", [1, 2], {"Friend": [0, 0]}])
    self.assertTableData("Table1", cols="subset", data=[
      ["id", "Hits"],
      [1, 0],
      [2, 0],
    ])
    self.assert_reload_consistent("after ReplaceTableData on a lookup source table")

  def test_summary_after_replace(self):
    """
    Summary groups must be recomputed from the new data after ReplaceTableData: source rows
    must not remain members of their pre-replace groups.
    """
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [[1, "Address", [[11, "City", "Text", False, "", "", ""]]]],
      "DATA": {"Address": [["id", "City"], [1, "NY"], [2, "NY"]]},
    }))
    self.apply_user_action(["CreateViewSection", 1, 0, "record", [11], None])
    self.apply_user_action(["ReplaceTableData", "Address", [1, 2], {"City": ["NY", "SF"]}])
    self.assertTableData("Address_summary_City", cols="subset", data=[
      ["id", "City", "count"],
      [1, "NY", 1],
      [2, "SF", 1],
    ])
    self.assert_reload_consistent("after ReplaceTableData on a summary source table")
