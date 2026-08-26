"""
Tests that formula values holding Record/RecordSet objects in Any columns stay usable across
renaming the table or column holding them. Such values carry Relation objects for dependency
tracking; these tests verify that renames don't leave stale relations behind, which used to break
dependent formulas (AssertionError) or silently stop recalculation.
"""
import test_engine
import testutil


class TestRenameRelations(test_engine.EngineTestCase):

  def make_sample(self, lookup_formula, cost_formula):
    return testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Values", [
          [11, "Key", "Numeric", False, "", "", ""],
          [12, "Cost", "Numeric", False, "", "", ""],
        ]],
        [2, "Sequence", [
          [21, "ValueKey", "Numeric", False, "", "", ""],
          [22, "ValueRow", "Any", True, lookup_formula, "", ""],
          [23, "Cost", "Any", True, cost_formula, "", ""],
        ]],
      ],
      "DATA": {
        "Values": [
          ["id", "Key", "Cost"],
          [1, 1, 10],
          [2, 2, 20],
        ],
        "Sequence": [
          ["id", "ValueKey"],
          [1, 1],
          [2, 2],
        ],
      }
    })

  def check_rename_scenario(self, lookup_formula, cost_formula, rename_action, table_id):
    """
    Loads the sample, applies the given rename, and checks that the dependent "Cost" column
    (in the table named table_id after the rename) both survives the rename and still
    recalculates when the looked-up records change.
    """
    self.load_sample(self.make_sample(lookup_formula, cost_formula))
    self.apply_user_action(rename_action)
    self.assertTableData(table_id, cols="subset", data=[
      ["id", "ValueKey", "Cost"],
      [1, 1, 10],
      [2, 2, 20],
    ])
    self.update_record("Values", 1, Cost=99)
    self.assertTableData(table_id, cols="subset", data=[
      ["id", "ValueKey", "Cost"],
      [1, 1, 99],
      [2, 2, 20],
    ])

  def test_table_rename_with_record_value(self):
    self.check_rename_scenario(
      "Values.lookupOne(Key=$ValueKey)", "$ValueRow.Cost",
      ["RenameTable", "Sequence", "Sequence2"], "Sequence2")

  def test_column_rename_with_record_value(self):
    self.check_rename_scenario(
      "Values.lookupOne(Key=$ValueKey)", "$ValueRow.Cost",
      ["RenameColumn", "Sequence", "ValueRow", "ValueRow2"], "Sequence")

  def test_table_rename_with_recordset_value(self):
    self.check_rename_scenario(
      "Values.lookupRecords(Key=$ValueKey)", "SUM($ValueRow.Cost)",
      ["RenameTable", "Sequence", "Sequence2"], "Sequence2")

  def test_table_rename_with_record_in_frozenset(self):
    # A container type with value-based equality that the engine doesn't specifically know about.
    self.check_rename_scenario(
      "frozenset([Values.lookupOne(Key=$ValueKey)])", "sum(r.Cost for r in $ValueRow)",
      ["RenameTable", "Sequence", "Sequence2"], "Sequence2")

  def test_table_rename_with_nested_record_value(self):
    self.check_rename_scenario(
      "[Values.lookupOne(Key=$ValueKey)]", "$ValueRow[0].Cost",
      ["RenameTable", "Sequence", "Sequence2"], "Sequence2")

  def test_table_rename_emits_no_changes(self):
    # A rename doesn't change any computed values, so it should produce no value updates.
    self.load_sample(self.make_sample("Values.lookupOne(Key=$ValueKey)", "$ValueRow.Cost"))
    out_actions = self.apply_user_action(["RenameTable", "Sequence", "Sequence2"])
    updates = [action for action in out_actions.stored + out_actions.calc
               if getattr(action, 'table_id', None) in ("Sequence", "Sequence2")]
    self.assertEqual(updates, [])
