import testutil
import test_engine
from objtypes import RecordSetStub


class TestRecordList(test_engine.EngineTestCase):
  col = testutil.col_schema_row
  sample_desc = {
    "SCHEMA": [
      [1, "Creatures", [
        col(1, "Name",   "Text", False),
        col(2, "Class",  "Ref:Class", False),
      ]],
      [2, "Class", [
        col(11, "Name",       "Text",               False),
        col(12, "Creatures",  "RefList:Creatures",  False),
      ]],
    ],
    "DATA": {
      "Class": [
        ["id", "Name", "Creatures"],
        [1, "Mammals",  [1, 3]],
        [2, "Reptilia", [2, 4]],
      ],
      "Creatures": [
        ["id","Name",    "Class"],
        [1,   "Cat",     1],
        [2,   "Chicken", 2],
        [3,   "Dolphin", 1],
        [4,   "Turtle",  2],
      ],
    }
  }
  sample = testutil.parse_test_sample(sample_desc)

  def test_removals(self):
    # Removing target rows should remove them from RefList columns.
    self.load_sample(self.sample)
    self.assertTableData("Class", data=[
      ["id", "Name", "Creatures"],
      [1, "Mammals",  [1, 3]],
      [2, "Reptilia", [2, 4]],
    ])

    self.remove_record("Creatures", 2)
    self.assertTableData("Class", data=[
      ["id", "Name", "Creatures"],
      [1, "Mammals",  [1, 3]],
      [2, "Reptilia", [4]],
    ])

    self.remove_record("Creatures", 4)
    self.assertTableData("Class", data=[
      ["id", "Name", "Creatures"],
      [1, "Mammals",  [1, 3]],
      [2, "Reptilia", None]
    ])


  def test_contains(self):
    self.load_sample(self.sample)
    self.add_column('Class', 'ContainsInt', type='Any', isFormula=True,
        formula="2 in $Creatures")
    self.add_column('Class', 'ContainsRec', type='Any', isFormula=True,
        formula="Creatures.lookupOne(Name='Chicken') in $Creatures")
    self.add_column('Class', 'ContainsWrong', type='Any', isFormula=True,
        formula="Class.lookupOne(Name='Reptilia') in $Creatures")

    self.assertTableData("Class", data=[
      ["id", "Name", "Creatures", "ContainsInt", "ContainsRec", "ContainsWrong"],
      [1, "Mammals",  [1, 3],     False,          False,        False],
      [2, "Reptilia", [2, 4],     True,           True,         False]
    ])


  def test_equals(self):
    self.load_sample(self.sample)
    self.add_column('Class', 'Lookup', type='RefList:Creatures', isFormula=True,
        formula="Creatures.lookupRecords(Class=$id)")
    self.add_column('Class', 'Equal', type='Any', isFormula=True,
        formula="$Lookup == $Creatures")

    self.assertTableData("Class", data=[
      ["id", "Name", "Creatures", "Lookup", "Equal"],
      [1, "Mammals",  [1, 3],     [1, 3],   True],
      [2, "Reptilia", [2, 4],     [2, 4],   True],
    ])

  def test_attribute_chain(self):
    self.load_sample(self.sample)
    self.add_column('Class', 'Names', type='Any', isFormula=True,
        formula="$Creatures.Class.Name")
    self.add_column('Class', 'Creatures2', type='Any', isFormula=True,
        formula="$Creatures.Class.Creatures")

    mammals = RecordSetStub("Creatures", [1, 3])
    reptiles = RecordSetStub("Creatures", [2, 4])
    self.assertTableData("Class", data=[
      ["id", "Name",     "Creatures", "Names",                  "Creatures2"],
      [1,    "Mammals",  [1, 3],      ["Mammals", "Mammals"],   [mammals, mammals]],
      [2,    "Reptilia", [2, 4],      ["Reptilia", "Reptilia"], [reptiles, reptiles]],
    ])
