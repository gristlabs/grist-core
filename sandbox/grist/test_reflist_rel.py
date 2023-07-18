"""
This test replicates a bug involving a column conversion after a table rename in the presence of
a RefList. A RefList column type today only appears as a result of detaching a summary table.
"""
import logging
import test_engine
from test_engine import Table, Column

log = logging.getLogger(__name__)

class TestRefListRelation(test_engine.EngineTestCase):
  def test_ref_list_relation(self):
    # Create two tables, the second referring to the first using a RefList and a Ref column.
    self.apply_user_action(["AddTable", "TableA", [
      {"id": "ColA", "type": "Text"}
    ]])
    self.apply_user_action(["AddTable", "TableB", [
      {"id": "ColB", "type": "Text"},
      {"id": "group", "type": "RefList:TableA", "isFormula": True,
        "formula": "TableA.lookupRecords(ColA=$ColB)"},
      {"id": "ref", "type": "Ref:TableA", "isFormula": True,
        "formula": "TableA.lookupOne(ColA=$ColB)"},
    ]])

    # Populate the tables with some data.
    self.apply_user_action(["BulkAddRecord", "TableA", [None]*4,
      {"ColA": ["a", "b", "c", "d"]}])
    self.apply_user_action(["BulkAddRecord", "TableB", [None]*3,
      {"ColB": ["d", "b", "a"]}])

    # Rename the second table. This causes some Column objects to be re-created and copied from
    # the previous table instance. This logic had a bug.
    self.apply_user_action(["RenameTable", "TableB", "TableC"])

    # Let's see what we've set up here.
    self.assertTables([
      Table(1, "TableA", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "ColA",   "Text", False, "", 0),
      ]),
      Table(2, "TableC", 2, 0, columns=[
        Column(3, "manualSort", "ManualSortPos", False, "", 0),
        Column(4, "ColB",   "Text", False, "", 0),
        Column(5, "group",  "RefList:TableA", True, "TableA.lookupRecords(ColA=$ColB)", 0),
        Column(6, "ref",    "Ref:TableA", True, "TableA.lookupOne(ColA=$ColB)", 0),
      ]),
    ])
    self.assertTableData('TableA', cols="subset", data=[
      [ "id", "ColA"],
      [ 1,    "a",  ],
      [ 2,    "b",  ],
      [ 3,    "c",  ],
      [ 4,    "d",  ],
    ])
    self.assertTableData('TableC', cols="subset", data=[
      [ "id", "ColB", "group", "ref" ],
      [ 1,    "d",    [4],     4 ],
      [ 2,    "b",    [2],     2 ],
      [ 3,    "a",    [1],     1 ],
    ])

    # Now when the logic was buggy, this sequence of action, as emitted by a user-initiated column
    # conversion, triggered an internal exception. Ensure it no longer happens.
    self.apply_user_action(
        ['AddColumn', 'TableC', 'gristHelper_Transform', {
          "type": 'Ref:TableA', "isFormula": True,
          "formula": "TableA.lookupOne(ColA=$ColB)", "visibleCol": 2,
        }])
    self.apply_user_action(
        ['SetDisplayFormula', 'TableC', None, 7, '$gristHelper_Transform.ColA'])
    self.apply_user_action(
        ['CopyFromColumn', 'TableC', 'gristHelper_Transform', 'ColB', '{"widget":"Reference"}'])
    self.apply_user_action(
        ['RemoveColumn', 'TableC', 'gristHelper_Transform'])

    # Check what we have now.
    self.assertTables([
      Table(1, "TableA", 1, 0, columns=[
        Column(1, "manualSort", "ManualSortPos", False, "", 0),
        Column(2, "ColA",   "Text", False, "", 0),
      ]),
      Table(2, "TableC", 2, 0, columns=[
        Column(3, "manualSort", "ManualSortPos", False, "", 0),
        Column(4, "ColB",   "Ref:TableA", False, "", 0),
        Column(5, "group",  "RefList:TableA", True, "TableA.lookupRecords(ColA=$ColB)", 0),
        Column(6, "ref",    "Ref:TableA", True, "TableA.lookupOne(ColA=$ColB)", 0),
        Column(9, "gristHelper_Display2", "Any", True, "$ColB.ColA", 0),
      ]),
    ])
    self.assertTableData('TableA', cols="subset", data=[
      [ "id", "ColA"],
      [ 1,    "a",  ],
      [ 2,    "b",  ],
      [ 3,    "c",  ],
      [ 4,    "d",  ],
    ])
    self.assertTableData('TableC', cols="subset", data=[
      [ "id", "ColB", "gristHelper_Display2", "group", "ref" ],
      [ 1,      4,    "d",                    [],     0 ],
      [ 2,      2,    "b",                    [],     0 ],
      [ 3,      1,    "a",                    [],     0 ],
    ])
