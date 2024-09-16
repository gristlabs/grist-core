import json
import logging
import unittest
import test_engine
from test_engine import Table, Column

log = logging.getLogger(__name__)

class TestRefListRelation(test_engine.EngineTestCase):
  def test_ref_list_relation(self):
    """
    This test replicates a bug involving a column conversion after a table rename in the presence of
    a RefList. A RefList column type today only appears as a result of detaching a summary table.
    """
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


  def test_ref_list_conversion_from_string(self):
    """
    RefLists can accept JSON arrays as strings, but only if they look valid.
    This feature is used by 2 way references, and column renames where type of the column
    is changed briefly to Int (or other) and the value is converted to string (to represent
    an error), then when column recovers its type, it should be able to read this string
    and restore its value
    """
    self.apply_user_action(["AddTable", "Tree", [
      {"id": "Name", "type": "Text"},
      {"id": "Children", "type": "RefList:Tree"},
    ]])

    # Add two records.
    self.apply_user_action(["BulkAddRecord", "Tree", [None]*2,
      {"Name": ["John", "Bobby"]}])


    test_literal = lambda x: self.assertTableData('Tree', cols="subset", data=[
      [ "id", "Name", "Children" ],
      [ 1,    "John", x],
      [ 2,    "Bobby", None ],
    ])

    invalid_json_arrays = (
      '["Bobby"]',
      '["2"]',
      '["2", "3"]',
      '[-1]',
      '["1", "-1"]',
      '[0]',
    )

    for value in invalid_json_arrays:
      self.apply_user_action(
        ['UpdateRecord', 'Tree', 1, {'Children': value}]
      )
      test_literal(value)

    valid_json_arrays = (
      '[2]',
      '[1, 2]',
      '[100]',
    )

    for value in valid_json_arrays:
      # Clear value
      self.apply_user_action(
        ['UpdateRecord', 'Tree', 1, {'Children': None}]
      )
      self.apply_user_action(
        ['UpdateRecord', 'Tree', 1, {'Children': value}]
      )
      self.assertTableData('Tree', cols="subset", data=[
        [ "id", "Name", "Children" ],
        [ 1,    "John", json.loads(value) ],
        [ 2,    "Bobby", None ],
      ])




if __name__ == "__main__":
  unittest.main()
