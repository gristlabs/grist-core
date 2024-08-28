import test_engine
import testutil
from sort_key import make_sort_key

class TestSortKey(test_engine.EngineTestCase):
  def test_sort_key(self):
    # Set up a table with a few rows.
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Values", [
          [1, "Date", "Numeric", False, "", "", ""],
          [2, "Type", "Text", False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Values": [
          ["id", "Date",    "Type"],
          [1,     5,        "a"],
          [2,     4,        "a"],
          [3,     5,        "b"],
        ],
      }
    }))

    table = self.engine.tables["Values"]
    sort_key1 = make_sort_key(table, ("Date", "-Type"))
    sort_key2 = make_sort_key(table, ("-Date", "Type"))
    self.assertEqual(sorted([1, 2, 3], key=sort_key1), [2, 3, 1])
    self.assertEqual(sorted([1, 2, 3], key=sort_key2), [1, 3, 2])

    # Change some values
    self.update_record("Values", 2, Date=6)
    self.assertEqual(sorted([1, 2, 3], key=sort_key1), [3, 1, 2])
    self.assertEqual(sorted([1, 2, 3], key=sort_key2), [2, 1, 3])


  def test_column_rename(self):
    """
    Make sure that renaming a column to another name and back does not continue using stale
    references to the deleted column.
    """
    # Note that SortedLookupMapColumn does retain references to the columns it uses for sorting,
    # but lookup columns themselves get deleted and rebuilt in these cases (by mysterious voodoo).

    # Create a simple table (People) with a couple records.
    self.apply_user_action(["AddTable", "People", [
      dict(id="Name", type="Text")
    ]])
    self.add_record("People", Name="Alice")
    self.add_record("People", Name="Bob")

    # Create a separate table that does a lookup in the People table.
    self.apply_user_action(["AddTable", "Test", [
      dict(id="Lookup1", type="Any", isFormula=True,
        formula="People.lookupOne(order_by='-Name').Name"),
      dict(id="Lookup2", type="Any", isFormula=True,
        formula="People.lookupOne(order_by='Name').Name"),
      dict(id="Lookup3", type="Any", isFormula=True,
        formula="People.lookupOne(Name='Bob').Name"),
    ]])
    self.add_record("Test")

    # Test that lookups return data as expected.
    self.assertTableData('Test', cols="subset", data=[
      dict(id=1, Lookup1="Bob", Lookup2="Alice", Lookup3="Bob")
    ])

    # Rename a column used for lookups or order_by. Lookup result shouldn't change.
    self.apply_user_action(["RenameColumn", "People", "Name", "FullName"])
    self.assertTableData('Test', cols="subset", data=[
      dict(id=1, Lookup1="Bob", Lookup2="Alice", Lookup3="Bob")
    ])

    # Rename the column back. Lookup result shouldn't change.
    self.apply_user_action(["RenameColumn", "People", "FullName", "Name"])
    self.assertTableData('Test', cols="subset", data=[
      dict(id=1, Lookup1="Bob", Lookup2="Alice", Lookup3="Bob")
    ])
