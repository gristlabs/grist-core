import unittest
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


  def test_flattens_lookups_in_reflist(self):
    # Add table Users with column Name
    self.apply_user_action(["AddTable", "Users", [
      {"id": "Name", "type": "Text"},
      # People who liked my posts
      {"id": "Likes", "type": "RefList:Users"},
    ]])

    # Add table Posts with column Title, Owner and Likes (of type RefList:Users)
    self.apply_user_action(["AddTable", "Posts", [
      {"id": "Title", "type": "Text"},
      {"id": "Owner", "type": "Ref:Users"},
      {"id": "Likes", "type": "RefList:Users"},
      {"id": "ByAuthor", "type": "RefList:Posts", "isFormula": True,
        "formula": "Posts.lookupRecords(Owner=$Owner)"}
    ]])

    # Add 3 users.
    self.apply_user_action(["BulkAddRecord", "Users", [None]*3,
      {"Name": ["Alice", "Bob", "Charlie"]}])

    Alice = 1
    Bob = 2
    Charlie = 3

    # Add 2 posts, first one liked by Alice and Bob, second one liked by Bob and Charlie, in
    # same category
    self.apply_user_action(["BulkAddRecord", "Posts", [None]*2,
      {
        "Title": ["Post1", "Post2"],
        "Owner": [Alice, Alice],
        "Likes": [["L", Bob, Charlie], ["L", Charlie, Bob, Alice]]
      }
    ])

    # Make sure data is ok
    self.assertTableData("Posts", cols="subset", data=[
      ["id", "Title", "Owner", "Likes"],
      [1, "Post1", Alice, [Bob, Charlie]],
      [2, "Post2", Alice, [Charlie, Bob, Alice]],
    ])

    # Now change Like column in the Users table to formula column that grabs all people who liked
    # posts of the user.
    self.apply_user_action(["ModifyColumn", "Users", "Likes", {
      "isFormula": True,
      "formula": "Posts.lookupRecords(Owner=$id, order_by=\"Title\").Likes"
    }])

    # Check the data, make sure the order is correct and we don't have duplicates.
    self.assertTableData("Users", cols="subset", data=[
      ["id", "Name", "Likes"],
      [Alice, "Alice", [Bob, Charlie, Alice]],
      [Bob, "Bob", None],
      [Charlie, "Charlie", None],
    ])

    # Now order it in descending order by Name.
    self.apply_user_action(["ModifyColumn", "Users", "Likes", {
      "isFormula": True,
      "formula": "Posts.lookupRecords(Owner=$id, order_by=\"-Title\").Likes"
    }])

    # Check the data, make sure the order is correct.
    self.assertTableData("Users", cols="subset", data=[
      ["id", "Name", "Likes"],
      [Alice, "Alice", [Charlie, Bob, Alice]], # First likes from Post2, then from Post1
      [Bob, "Bob", None],
      [Charlie, "Charlie", None],
    ])

    # Now reorder the lookup by swapping the order of the posts.
    self.apply_user_action(["BulkUpdateRecord", "Posts", [1, 2], {"Title": ["Post2", "Post1"]}])

    # Check the data, make sure the order is correct.
    self.assertTableData("Users", cols="subset", data=[
      ["id", "Name", "Likes"],
      [Alice, "Alice", [Bob, Charlie, Alice]], # First likes from Post1, then from Post2
      [Bob, "Bob", None],
      [Charlie, "Charlie", None],
    ])

    # Now switch back to the original order by setting Post1 to Post3.
    self.update_record("Posts", 2, Title="Post3")

    # Check the data, make sure the order is correct.
    self.assertTableData("Users", cols="subset", data=[
      ["id", "Name", "Likes"],
      [Alice, "Alice", [Charlie, Bob, Alice]], # First likes from Post2, then from Post3
      [Bob, "Bob", None],
      [Charlie, "Charlie", None],
    ])

    # Now modify the formula so that it contains other records, not Users.
    self.apply_user_action(["ModifyColumn", "Users", "Likes", {
      "isFormula": True,
      "formula": "Posts.lookupRecords(Owner=$id).ByAuthor"
    }])

    self.assertTableData("Users", cols="subset", data=[
      ["id", "Name", "Likes"],
      [Alice, "Alice", "[Posts[RecordList([1, 2], group_by={'Owner': Users[1]}, sort_by=None)], " +
                        "Posts[RecordList([1, 2], group_by={'Owner': Users[1]}, sort_by=None)]]"],
      [Bob, "Bob", None],
      [Charlie, "Charlie", None],
    ])


if __name__ == "__main__":
  unittest.main()
