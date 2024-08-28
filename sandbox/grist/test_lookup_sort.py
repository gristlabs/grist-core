import datetime
import logging
import moment
import testutil
import test_engine
from table import make_sort_spec

log = logging.getLogger(__name__)

def D(year, month, day):
  return moment.date_to_ts(datetime.date(year, month, day))

class TestLookupSort(test_engine.EngineTestCase):

  def do_setup(self, order_by_arg):
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Customers", [
          [11, "Name", "Text", False, "", "", ""],
          [12, "Lookup", "RefList:Purchases", True,
            "Purchases.lookupRecords(Customer=$id, %s)" % order_by_arg, "", ""],
          [13, "LookupAmount", "Any", True,
            "Purchases.lookupRecords(Customer=$id, %s).Amount" % order_by_arg, "", ""],
          [14, "LookupDotAmount", "Any", True, "$Lookup.Amount", "", ""],
          [15, "LookupContains", "RefList:Purchases", True,
            "Purchases.lookupRecords(Customer=$id, Tags=CONTAINS('foo'), %s)" % order_by_arg,
            "", ""],
          [16, "LookupContainsDotAmount", "Any", True, "$LookupContains.Amount", "", ""],
        ]],
        [2, "Purchases", [
          [21, "Customer", "Ref:Customers", False, "", "", ""],
          [22, "Date", "Date", False, "", "", ""],
          [23, "Tags", "ChoiceList", False, "", "", ""],
          [24, "Category", "Text", False, "", "", ""],
          [25, "Amount", "Numeric", False, "", "", ""],
        ]],
      ],
      "DATA": {
        "Customers": [
          ["id", "Name"],
          [1,    "Alice"],
          [2,    "Bob"],
        ],
        "Purchases": [
          [ "id",   "Customer", "Date",       "Tags",   "Category", "Amount", ],
          # Note: the tenths digit of Amount corresponds to day, for easier ordering of expected
          # sort results.
          [1,       1,          D(2023,12,1), ["foo"],  "A",        10.1],
          [2,       2,          D(2023,12,4), ["foo"],  "A",        17.4],
          [3,       1,          D(2023,12,3), ["bar"],  "A",        20.3],
          [4,       1,          D(2023,12,9), ["foo", "bar"],  "A", 40.9],
          [5,       1,          D(2023,12,2), ["foo", "bar"],  "B", 80.2],
          [6,       1,          D(2023,12,6), ["bar"],  "B",        160.6],
          [7,       1,          D(2023,12,7), ["foo"],  "A",        320.7],
          [8,       1,          D(2023,12,5), ["bar", "foo"],  "A", 640.5],
        ],
      }
    }))

  def test_make_sort_spec(self):
    """
    Test interpretations of different kinds of order_by and sort_by params.
    """
    # Test the default for Table.lookupRecords.
    self.assertEqual(make_sort_spec(('id',), None, True), ())
    self.assertEqual(make_sort_spec(('id',), None, False), ())

    # Test legacy sort_by
    self.assertEqual(make_sort_spec(('Doh',), 'Foo', True), ('Foo',))
    self.assertEqual(make_sort_spec(None, '-Foo', False), ('-Foo',))

    # Test None, string, tuple, without manualSort.
    self.assertEqual(make_sort_spec(None, None, False), ())
    self.assertEqual(make_sort_spec('Bar', None, False), ('Bar',))
    self.assertEqual(make_sort_spec(('Foo', '-Bar'), None, False), ('Foo', '-Bar'))

    # Test None, string, tuple, WITH manualSort.
    self.assertEqual(make_sort_spec(None, None, True), ('manualSort',))
    self.assertEqual(make_sort_spec('Bar', None, True), ('Bar', 'manualSort'))
    self.assertEqual(make_sort_spec(('Foo', '-Bar'), None, True), ('Foo', '-Bar', 'manualSort'))

    # If 'manualSort' is present, should not be added twice.
    self.assertEqual(make_sort_spec(('Foo', 'manualSort'), None, True), ('Foo', 'manualSort'))

    # If 'id' is present, fields starting with it are dropped.
    self.assertEqual(make_sort_spec(('Bar', 'id'), None, True), ('Bar',))
    self.assertEqual(make_sort_spec(('Foo', 'id', 'manualSort', 'X'), None, True), ('Foo',))
    self.assertEqual(make_sort_spec('id', None, True), ())

  def test_lookup_sort_by_default(self):
    """
    Tests lookups with default sort (by row_id) using sort_by=None, and how it reacts to changes.
    """
    self.do_setup('sort_by=None')
    self._do_test_lookup_sort_by_default()

  def test_lookup_order_by_none(self):
    # order_by=None means default to manualSort. But this test case should not be affected.
    self.do_setup('order_by=None')
    self._do_test_lookup_sort_by_default()

  def _do_test_lookup_sort_by_default(self):
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [1, 3, 4, 5, 6, 7, 8],
        LookupAmount = [10.1, 20.3, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupDotAmount = [10.1, 20.3, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupContains = [1, 4, 5, 7, 8],
        LookupContainsDotAmount = [10.1, 40.9, 80.2, 320.7, 640.5],
      )
    ])

    # Change Customer of Purchase #2 (Bob -> Alice) and check that all got updated.
    # (The list of purchases for Alice gets the new purchase #2.)
    out_actions = self.update_record("Purchases", 2, Customer=1)
    self.assertEqual(out_actions.calls["Customers"], {
      "Lookup": 2, "LookupAmount": 2, "LookupDotAmount": 2,
      "LookupContains": 2, "LookupContainsDotAmount": 2,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [1, 2, 3, 4, 5, 6, 7, 8],
        LookupAmount = [10.1, 17.4, 20.3, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupDotAmount = [10.1, 17.4, 20.3, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupContains = [1, 2, 4, 5, 7, 8],
        LookupContainsDotAmount = [10.1, 17.4, 40.9, 80.2, 320.7, 640.5],
      )
    ])

    # Change Customer of Purchase #1 (Alice -> Bob) and check that all got updated.
    # (The list of purchases for Alice loses the purchase #1.)
    out_actions = self.update_record("Purchases", 1, Customer=2)
    self.assertEqual(out_actions.calls["Customers"], {
      "Lookup": 2, "LookupAmount": 2, "LookupDotAmount": 2,
      "LookupContains": 2, "LookupContainsDotAmount": 2,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [2, 3, 4, 5, 6, 7, 8],
        LookupAmount = [17.4, 20.3, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupDotAmount = [17.4, 20.3, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupContains = [2, 4, 5, 7, 8],
        LookupContainsDotAmount = [17.4, 40.9, 80.2, 320.7, 640.5],
      )
    ])

    # Change Date of Purchase #3 to much earlier, and check that all got updated.
    out_actions = self.update_record("Purchases", 3, Date=D(2023,8,1))
    # Nothing to recompute in this case, since it doesn't depend on Date.
    self.assertEqual(out_actions.calls.get("Customers"), None)

    # Change Amount of Purchase #3 to much larger, and check that just amounts got updated.
    out_actions = self.update_record("Purchases", 3, Amount=999999)
    self.assertEqual(out_actions.calls["Customers"], {
      # Lookups that don't depend on Amount aren't recalculated
      "LookupAmount": 1, "LookupDotAmount": 1,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [2, 3, 4, 5, 6, 7, 8],
        LookupAmount = [17.4, 999999, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupDotAmount = [17.4, 999999, 40.9, 80.2, 160.6, 320.7, 640.5],
        LookupContains = [2, 4, 5, 7, 8],
        LookupContainsDotAmount = [17.4, 40.9, 80.2, 320.7, 640.5],
      )
    ])

  def test_lookup_sort_by_date(self):
    """
    Tests lookups with sort by "-Date", and how it reacts to changes.
    """
    self.do_setup('sort_by="-Date"')
    self._do_test_lookup_sort_by_date()

  def test_lookup_order_by_date(self):
    # With order_by, we'll fall back to manualSort, but this shouldn't matter here.
    self.do_setup('order_by="-Date"')
    self._do_test_lookup_sort_by_date()

  def _do_test_lookup_sort_by_date(self):
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 6, 8, 3, 5, 1],
        LookupAmount = [40.9, 320.7, 160.6, 640.5, 20.3, 80.2, 10.1],
        LookupDotAmount = [40.9, 320.7, 160.6, 640.5, 20.3, 80.2, 10.1],
        LookupContains = [4, 7, 8, 5, 1],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 80.2, 10.1],
      )
    ])

    # Change Customer of Purchase #2 (Bob -> Alice) and check that all got updated.
    # (The list of purchases for Alice gets the new purchase #2.)
    out_actions = self.update_record("Purchases", 2, Customer=1)
    self.assertEqual(out_actions.calls["Customers"], {
      "Lookup": 2, "LookupAmount": 2, "LookupDotAmount": 2,
      "LookupContains": 2, "LookupContainsDotAmount": 2,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 6, 8, 2, 3, 5, 1],
        LookupAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 20.3, 80.2, 10.1],
        LookupDotAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 20.3, 80.2, 10.1],
        LookupContains = [4, 7, 8, 2, 5, 1],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2, 10.1],
      )
    ])

    # Change Customer of Purchase #1 (Alice -> Bob) and check that all got updated.
    # (The list of purchases for Alice loses the purchase #1.)
    out_actions = self.update_record("Purchases", 1, Customer=2)
    self.assertEqual(out_actions.calls["Customers"], {
      "Lookup": 2, "LookupAmount": 2, "LookupDotAmount": 2,
      "LookupContains": 2, "LookupContainsDotAmount": 2,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 6, 8, 2, 3, 5],
        LookupAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 20.3, 80.2],
        LookupDotAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 20.3, 80.2],
        LookupContains = [4, 7, 8, 2, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2],
      )
    ])

    # Change Date of Purchase #3 to much earlier, and check that all got updated.
    out_actions = self.update_record("Purchases", 3, Date=D(2023,8,1))
    self.assertEqual(out_actions.calls.get("Customers"), {
      # Only the affected lookups are affected
      "Lookup": 1, "LookupAmount": 1, "LookupDotAmount": 1
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 6, 8, 2, 5, 3],
        LookupAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 80.2, 20.3],
        LookupDotAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 80.2, 20.3],
        LookupContains = [4, 7, 8, 2, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2],
      )
    ])

    # Change Amount of Purchase #3 to much larger, and check that just amounts got updated.
    out_actions = self.update_record("Purchases", 3, Amount=999999)
    self.assertEqual(out_actions.calls["Customers"], {
      # Lookups that don't depend on Amount aren't recalculated
      "LookupAmount": 1, "LookupDotAmount": 1,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 6, 8, 2, 5, 3],
        LookupAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 80.2, 999999],
        LookupDotAmount = [40.9, 320.7, 160.6, 640.5, 17.4, 80.2, 999999],
        LookupContains = [4, 7, 8, 2, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2],
      )
    ])


  def test_lookup_order_by_tuple(self):
    """
    Tests lookups with order by ("Category", "-Date"), and how it reacts to changes.
    """
    self.do_setup('order_by=("Category", "-Date")')
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 3, 1, 6, 5],
        LookupAmount = [40.9, 320.7, 640.5, 20.3, 10.1, 160.6, 80.2],
        LookupDotAmount = [40.9, 320.7, 640.5, 20.3, 10.1, 160.6, 80.2],
        LookupContains = [4, 7, 8, 1, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 10.1, 80.2],
      )
    ])

    # Change Customer of Purchase #2 (Bob -> Alice) and check that all got updated.
    # (The list of purchases for Alice gets the new purchase #2.)
    out_actions = self.update_record("Purchases", 2, Customer=1)
    self.assertEqual(out_actions.calls["Customers"], {
      "Lookup": 2, "LookupAmount": 2, "LookupDotAmount": 2,
      "LookupContains": 2, "LookupContainsDotAmount": 2,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 2, 3, 1, 6, 5],
        LookupAmount = [40.9, 320.7, 640.5, 17.4, 20.3, 10.1, 160.6, 80.2],
        LookupDotAmount = [40.9, 320.7, 640.5, 17.4, 20.3, 10.1, 160.6, 80.2],
        LookupContains = [4, 7, 8, 2, 1, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 10.1, 80.2],
      )
    ])

    # Change Customer of Purchase #1 (Alice -> Bob) and check that all got updated.
    # (The list of purchases for Alice loses the purchase #1.)
    out_actions = self.update_record("Purchases", 1, Customer=2)
    self.assertEqual(out_actions.calls["Customers"], {
      "Lookup": 2, "LookupAmount": 2, "LookupDotAmount": 2,
      "LookupContains": 2, "LookupContainsDotAmount": 2,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 2, 3, 6, 5],
        LookupAmount = [40.9, 320.7, 640.5, 17.4, 20.3, 160.6, 80.2],
        LookupDotAmount = [40.9, 320.7, 640.5, 17.4, 20.3, 160.6, 80.2],
        LookupContains = [4, 7, 8, 2, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2],
      )
    ])

    # Change Date of Purchase #3 to much earlier, and check that all got updated.
    out_actions = self.update_record("Purchases", 3, Date=D(2023,8,1))
    self.assertEqual(out_actions.calls.get("Customers"), {
      # Only the affected lookups are affected
      "Lookup": 1, "LookupAmount": 1, "LookupDotAmount": 1
    })
    # Actually this happens to be unchanged, because within the category, the new date is still in
    # the same position.
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 2, 3, 6, 5],
        LookupAmount = [40.9, 320.7, 640.5, 17.4, 20.3, 160.6, 80.2],
        LookupDotAmount = [40.9, 320.7, 640.5, 17.4, 20.3, 160.6, 80.2],
        LookupContains = [4, 7, 8, 2, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2],
      )
    ])

    # Change Category of Purchase #3 to "B", and check that it got moved.
    out_actions = self.update_record("Purchases", 3, Category="B")
    self.assertEqual(out_actions.calls.get("Customers"), {
      # Only the affected lookups are affected
      "Lookup": 1, "LookupAmount": 1, "LookupDotAmount": 1
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 2, 6, 5, 3],
        LookupAmount = [40.9, 320.7, 640.5, 17.4, 160.6, 80.2, 20.3],
        LookupDotAmount = [40.9, 320.7, 640.5, 17.4, 160.6, 80.2, 20.3],
        LookupContains = [4, 7, 8, 2, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2],
      )
    ])

    # Change Amount of Purchase #3 to much larger, and check that just amounts got updated.
    out_actions = self.update_record("Purchases", 3, Amount=999999)
    self.assertEqual(out_actions.calls["Customers"], {
      # Lookups that don't depend on Amount aren't recalculated
      "LookupAmount": 1, "LookupDotAmount": 1,
    })
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 2, 6, 5, 3],
        LookupAmount = [40.9, 320.7, 640.5, 17.4, 160.6, 80.2, 999999],
        LookupDotAmount = [40.9, 320.7, 640.5, 17.4, 160.6, 80.2, 999999],
        LookupContains = [4, 7, 8, 2, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 17.4, 80.2],
      )
    ])

  def test_lookup_one(self):
    self.do_setup('order_by=None')

    # Check that the first value returned by default is the one with the lowest row ID.
    self.add_column('Customers', 'One', type="Ref:Purchases",
        formula="Purchases.lookupOne(Customer=$id)")
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(id = 1, Name = "Alice", One = 1),
      dict(id = 2, Name = "Bob", One = 2),
    ])

    # Check that the first value returned with "-Date" is the one with the highest Date.
    self.modify_column('Customers', 'One',
        formula="Purchases.lookupOne(Customer=$id, order_by=('-Date',))")
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(id = 1, Name = "Alice", One = 4),
      dict(id = 2, Name = "Bob", One = 2),
    ])

    # Check that the first value returned with "-id" is the one with the highest row ID.
    self.modify_column('Customers', 'One',
        formula="Purchases.lookupOne(Customer=$id, order_by='-id')")
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(id = 1, Name = "Alice", One = 8),
      dict(id = 2, Name = "Bob", One = 2),
    ])


  def test_renaming_order_by_str(self):
    # Given some lookups with order_by, rename a column used in order_by. Check order_by got
    # adjusted, and the results are correct. Try for order_by as string.
    self.do_setup("order_by='-Date'")
    self.apply_user_action(['RenameColumn', 'Purchases', 'Category', 'cat'])
    self.apply_user_action(['RenameColumn', 'Purchases', 'Date', 'Fecha'])

    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      dict(id=12, colId="Lookup",
        formula="Purchases.lookupRecords(Customer=$id, order_by='-Fecha')"),
      dict(id=13, colId="LookupAmount",
        formula="Purchases.lookupRecords(Customer=$id, order_by='-Fecha').Amount"),
    ])

    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 6, 8, 3, 5, 1],
        LookupAmount = [40.9, 320.7, 160.6, 640.5, 20.3, 80.2, 10.1],
        LookupDotAmount = [40.9, 320.7, 160.6, 640.5, 20.3, 80.2, 10.1],
        LookupContains = [4, 7, 8, 5, 1],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 80.2, 10.1],
      )
    ])

    # Change the (renamed) Date of Purchase #1 to much later, and check that all got updated.
    self.update_record("Purchases", 1, Fecha=D(2024,12,31))
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [1, 4, 7, 6, 8, 3, 5],
        LookupAmount = [10.1, 40.9, 320.7, 160.6, 640.5, 20.3, 80.2],
        LookupDotAmount = [10.1, 40.9, 320.7, 160.6, 640.5, 20.3, 80.2],
        LookupContains = [1, 4, 7, 8, 5],
        LookupContainsDotAmount = [10.1, 40.9, 320.7, 640.5, 80.2],
      )
    ])


  def test_renaming_order_by_tuple(self):
    # Given some lookups with order_by, rename a column used in order_by. Check order_by got
    # adjusted, and the results are correct. Try for order_by as tuple.
    self.do_setup("order_by=('Category', '-Date')")

    out_actions = self.apply_user_action(['RenameColumn', 'Purchases', 'Category', 'cat'])

    # Check returned actions to ensure we don't produce actions for any stale lookup helper columns
    # (this is a way to check that we don't forget to clean up stale lookup helper columns).
    # pylint: disable=line-too-long
    self.assertPartialOutActions(out_actions, {
      "stored": [
        ["RenameColumn", "Purchases", "Category", "cat"],
        ["ModifyColumn", "Customers", "Lookup", {"formula": "Purchases.lookupRecords(Customer=$id, order_by=('cat', '-Date'))"}],
        ["ModifyColumn", "Customers", "LookupAmount", {"formula": "Purchases.lookupRecords(Customer=$id, order_by=('cat', '-Date')).Amount"}],
        ["ModifyColumn", "Customers", "LookupContains", {"formula": "Purchases.lookupRecords(Customer=$id, Tags=CONTAINS('foo'), order_by=('cat', '-Date'))"}],
        ["BulkUpdateRecord", "_grist_Tables_column", [24, 12, 13, 15], {"colId": ["cat", "Lookup", "LookupAmount", "LookupContains"], "formula": [
          "",
          "Purchases.lookupRecords(Customer=$id, order_by=('cat', '-Date'))",
          "Purchases.lookupRecords(Customer=$id, order_by=('cat', '-Date')).Amount",
          "Purchases.lookupRecords(Customer=$id, Tags=CONTAINS('foo'), order_by=('cat', '-Date'))",
          ]}],
        ]
    })

    self.apply_user_action(['RenameColumn', 'Purchases', 'Date', 'Fecha'])

    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      dict(id=12, colId="Lookup",
        formula="Purchases.lookupRecords(Customer=$id, order_by=('cat', '-Fecha'))"),
      dict(id=13, colId="LookupAmount",
        formula="Purchases.lookupRecords(Customer=$id, order_by=('cat', '-Fecha')).Amount"),
    ])

    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 3, 1, 6, 5],
        LookupAmount = [40.9, 320.7, 640.5, 20.3, 10.1, 160.6, 80.2],
        LookupDotAmount = [40.9, 320.7, 640.5, 20.3, 10.1, 160.6, 80.2],
        LookupContains = [4, 7, 8, 1, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 10.1, 80.2],
      )
    ])

    # Change the (renamed) Date of Purchase #3 to much earlier, and check that all got updated.
    self.update_record("Purchases", 3, Fecha=D(2023,8,1))
    self.assertTableData("Customers", cols="subset", rows="subset", data=[
      dict(
        id = 1,
        Name = "Alice",
        Lookup = [4, 7, 8, 1, 3, 6, 5],
        LookupAmount = [40.9, 320.7, 640.5, 10.1, 20.3, 160.6, 80.2],
        LookupDotAmount = [40.9, 320.7, 640.5, 10.1, 20.3, 160.6, 80.2],
        LookupContains = [4, 7, 8, 1, 5],
        LookupContainsDotAmount = [40.9, 320.7, 640.5, 10.1, 80.2],
      )
    ])
