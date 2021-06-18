import testutil
import test_engine

class TestDependencies(test_engine.EngineTestCase):
  sample_desc = {
    "SCHEMA": [
      [1, "Table1", [
        [1, "Prev",       "Ref:Table1",  True, "Table1.lookupOne(id=$id-1)", "", ""],
        [2, "Value",      "Numeric",     False, "", "", ""],
        [3, "Sum",        "Numeric",     True, "($Prev.Sum or 0) + $Value", "", ""],
      ]]
    ],
    "DATA": {
      "Table1": [
        ["id","Value"],
      ] + [[n + 1, n + 1] for n in range(3200)]
    }
  }

  def test_recursive_column_dependencies(self):
    sample = testutil.parse_test_sample(self.sample_desc)
    self.load_sample(sample)
    self.apply_user_action(['Calculate'])

    # The Sum column contains a cumulative total of the Value column
    self.assertTableData("Table1", cols="subset", rows="subset", data=[
      ["id", "Value", "Sum"],
      [1,    1,       1],
      [2,    2,       3],
      [3,    3,       6],
      [3200, 3200,    5121600],
    ])

    # Updating the first Value causes a cascade of changes to Sum,
    # invalidating dependencies one cell at a time.
    # Previously this cause a recursion error.
    self.update_record("Table1", 1, Value=11)
    self.assertTableData("Table1", cols="subset", rows="subset", data=[
      ["id", "Value", "Sum"],
      [1,    11,      11],
      [2,    2,       13],
      [3,    3,       16],
      [3200, 3200,    5121610],
    ])
