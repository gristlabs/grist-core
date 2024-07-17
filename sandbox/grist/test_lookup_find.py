import datetime
import logging
import unittest

import six

import moment
import objtypes
import testutil
import test_engine

log = logging.getLogger(__name__)

def D(year, month, day):
  return moment.date_to_ts(datetime.date(year, month, day))

class TestLookupFind(test_engine.EngineTestCase):

  def do_setup(self):
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Customers", [
          [11, "Name", "Text", False, "", "", ""],
          [12, "MyDate", "Date", False, "", "", ""],
        ]],
        [2, "Purchases", [
          [20, "manualSort", "PositionNumber", False, "", "", ""],
          [21, "Customer", "Ref:Customers", False, "", "", ""],
          [22, "Date", "Date", False, "", "", ""],
          [24, "Category", "Text", False, "", "", ""],
          [25, "Amount", "Numeric", False, "", "", ""],
          [26, "Prev", "Ref:Purchases", True, "None", "", ""],    # To be filled
          [27, "Cumul", "Numeric", True, "$Prev.Cumul + $Amount", "", ""],
        ]],
      ],
      "DATA": {
        "Customers": [
          ["id", "Name",    "MyDate"],
          [1,    "Alice",   D(2023,12,5)],
          [2,    "Bob",     D(2023,12,10)],
        ],
        "Purchases": [
          [ "id",   "manualSort", "Customer", "Date",       "Category", "Amount", ],
          [1,       1.0,          1,          D(2023,12,1), "A",        10],
          [2,       2.0,          2,          D(2023,12,4), "A",        17],
          [3,       3.0,          1,          D(2023,12,3), "A",        20],
          [4,       4.0,          1,          D(2023,12,9), "A",        40],
          [5,       5.0,          1,          D(2023,12,2), "B",        80],
          [6,       6.0,          1,          D(2023,12,6), "B",        160],
          [7,       7.0,          1,          D(2023,12,7), "A",        320],
          [8,       8.0,          1,          D(2023,12,5), "A",        640],
        ],
      }
    }))

  def do_test_lookup_find(self, find="find", ref_type_to_use=None):
    self.do_setup()

    if ref_type_to_use:
      self.add_column("Customers", "PurchasesByDate", type=ref_type_to_use,
          formula="Purchases.lookupRecords(Customer=$id, sort_by='Date')")
      lookup = "$PurchasesByDate"
    else:
      lookup = "Purchases.lookupRecords(Customer=$id, sort_by='Date')"

    self.add_column("Customers", "LTDate", type="Ref:Purchases",
        formula="{}.{}.lt($MyDate)".format(lookup, find))
    self.add_column("Customers", "LEDate", type="Ref:Purchases",
        formula="{}.{}.le($MyDate)".format(lookup, find))
    self.add_column("Customers", "GTDate", type="Ref:Purchases",
        formula="{}.{}.gt($MyDate)".format(lookup, find))
    self.add_column("Customers", "GEDate", type="Ref:Purchases",
        formula="{}.{}.ge($MyDate)".format(lookup, find))
    self.add_column("Customers", "EQDate", type="Ref:Purchases",
        formula="{}.{}.eq($MyDate)".format(lookup, find))

    # Here's the purchase data sorted by Customer and Date
    # id      Customer      Date
    # 1,       1,          D(2023,12,1)
    # 5,       1,          D(2023,12,2)
    # 3,       1,          D(2023,12,3)
    # 8,       1,          D(2023,12,5)
    # 6,       1,          D(2023,12,6)
    # 7,       1,          D(2023,12,7)
    # 4,       1,          D(2023,12,9)
    # 2,       2,          D(2023,12,4)

    # pylint: disable=line-too-long
    self.assertTableData('Customers', cols="subset", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,5), LTDate=3, LEDate=8, GTDate=6, GEDate=8, EQDate=8),
      dict(id=2, Name="Bob", MyDate=D(2023,12,10), LTDate=2, LEDate=2, GTDate=0, GEDate=0, EQDate=0),
    ])

    # Change Dates for Alice and Bob
    self.update_record('Customers', 1, MyDate=D(2023,12,4))
    self.update_record('Customers', 2, MyDate=D(2023,12,4))
    self.assertTableData('Customers', cols="subset", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,4), LTDate=3, LEDate=3, GTDate=8, GEDate=8, EQDate=0),
      dict(id=2, Name="Bob", MyDate=D(2023,12,4), LTDate=0, LEDate=2, GTDate=0, GEDate=2, EQDate=2),
    ])

    # Change a Purchase from Alice to Bob, and remove a purchase for Alice
    self.update_record('Purchases', 5, Customer=2)
    self.remove_record('Purchases', 3)
    self.assertTableData('Customers', cols="subset", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,4), LTDate=1, LEDate=1, GTDate=8, GEDate=8, EQDate=0),
      dict(id=2, Name="Bob", MyDate=D(2023,12,4), LTDate=5, LEDate=2, GTDate=0, GEDate=2, EQDate=2),
    ])

    # Another update to the lookup date for Bob.
    self.update_record('Customers', 2, MyDate=D(2023,1,1))
    self.assertTableData('Customers', cols="subset", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,4), LTDate=1, LEDate=1, GTDate=8, GEDate=8, EQDate=0),
      dict(id=2, Name="Bob", MyDate=D(2023,1,1), LTDate=0, LEDate=0, GTDate=5, GEDate=5, EQDate=0),
    ])

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_lookup_find(self):
    self.do_test_lookup_find()

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_lookup_underscore_find(self):
    # Repeat the previous test case with _find in place of find. Normally, we can use
    # lookupRecords(...).find.*, but if a column named "find" exists, it will shadow this method,
    # and lookupRecords(...)._find.* may be used instead (with an underscore). Check that it works.
    self.do_test_lookup_find(find="_find")

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_lookup_find_ref_any(self):
    self.do_test_lookup_find(ref_type_to_use='Any')

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_lookup_find_ref_reflist(self):
    self.do_test_lookup_find(ref_type_to_use='RefList:Purchases')

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_lookup_find_empty(self):
    self.do_setup()
    self.add_column("Customers", "P", type='RefList:Purchases',
        formula="Purchases.lookupRecords(Customer=$id, Category='C', sort_by='Date')")
    self.add_column("Customers", "LTDate", type="Ref:Purchases", formula="$P.find.lt($MyDate)")
    self.add_column("Customers", "LEDate", type="Ref:Purchases", formula="$P.find.le($MyDate)")
    self.add_column("Customers", "GTDate", type="Ref:Purchases", formula="$P.find.gt($MyDate)")
    self.add_column("Customers", "GEDate", type="Ref:Purchases", formula="$P.find.ge($MyDate)")
    self.add_column("Customers", "EQDate", type="Ref:Purchases", formula="$P.find.eq($MyDate)")

    # pylint: disable=line-too-long
    self.assertTableData('Customers', cols="subset", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,5), LTDate=0, LEDate=0, GTDate=0, GEDate=0, EQDate=0),
      dict(id=2, Name="Bob", MyDate=D(2023,12,10), LTDate=0, LEDate=0, GTDate=0, GEDate=0, EQDate=0),
    ])

    # Check find.* results once the lookup result becomes non-empty.
    self.update_record('Purchases', 5, Category="C")
    self.assertTableData('Customers', cols="subset", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,5), LTDate=5, LEDate=5, GTDate=0, GEDate=0, EQDate=0),
      dict(id=2, Name="Bob", MyDate=D(2023,12,10), LTDate=0, LEDate=0, GTDate=0, GEDate=0, EQDate=0),
    ])

  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_lookup_find_unsorted(self):
    self.do_setup()
    self.add_column("Customers", "P", type='RefList:Purchases',
        formula="[Purchases.lookupOne(Customer=$id)]")
    self.add_column("Customers", "LTDate", type="Ref:Purchases", formula="$P.find.lt($MyDate)")
    err = objtypes.RaisedException(ValueError())
    self.assertTableData('Customers', cols="subset", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,5), LTDate=err),
      dict(id=2, Name="Bob", MyDate=D(2023,12,10), LTDate=err),
    ])


  @unittest.skipUnless(six.PY2, "Python 2 only")
  def test_lookup_find_py2(self):
    self.do_setup()

    self.add_column("Customers", "LTDate", type="Ref:Purchases",
        formula="Purchases.lookupRecords(Customer=$id, sort_by='Date').find.lt($MyDate)")

    err = objtypes.RaisedException(NotImplementedError())
    self.assertTableData('Customers', data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,5), LTDate=err),
      dict(id=2, Name="Bob", MyDate=D(2023,12,10), LTDate=err),
    ])


  def test_column_named_find(self):
    # Test that we can add a column named "find", use it, and remove it.
    self.do_setup()
    self.add_column("Customers", "find", type="Text")

    # Check that the column is usable.
    self.update_record("Customers", 1, find="Hello")
    self.assertTableData('Customers', cols="all", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,5), find="Hello"),
      dict(id=2, Name="Bob", MyDate=D(2023,12,10), find=""),
    ])

    # Check that we can remove the column.
    self.remove_column("Customers", "find")
    self.assertTableData('Customers', cols="all", data=[
      dict(id=1, Name="Alice", MyDate=D(2023,12,5)),
      dict(id=2, Name="Bob", MyDate=D(2023,12,10)),
    ])


  @unittest.skipUnless(six.PY3, "Python 3 only")
  def test_rename_find_attrs(self):
    """
    Check that in formulas like Table.lookupRecords(...).find.lt(...).ColID, renames of ColID
    update the formula.
    """
    # Create a simple table (People) with a couple records.
    self.apply_user_action(["AddTable", "People", [
      dict(id="Name", type="Text")
    ]])
    self.add_record("People", Name="Alice")
    self.add_record("People", Name="Bob")

    # Create a separate table that does a lookup in the People table.
    self.apply_user_action(["AddTable", "Test", [
      dict(id="Lookup1", type="Any", isFormula=True,
        formula="People.lookupRecords(order_by='Name').find.ge('B').Name"),
      dict(id="Lookup2", type="Any", isFormula=True,
        formula="People.lookupRecords(order_by='Name')._find.eq('Alice').Name"),
      dict(id="Lookup3", type="Any", isFormula=True,
        formula="r = People.lookupRecords(order_by='Name').find.ge('B')\n" +
                "PREVIOUS(r, order_by=None).Name"),
      dict(id="Lookup4", type="Any", isFormula=True,
        formula="r = People.lookupRecords(order_by='Name').find.eq('Alice')\n" +
                "People.lookupRecords(order_by='Name').find.next(r).Name")
    ]])
    self.add_record("Test")

    # Test that lookups return data as expected.
    self.assertTableData('Test', cols="subset", data=[
      dict(id=1, Lookup1="Bob", Lookup2="Alice", Lookup3="Alice", Lookup4="Bob")
    ])

    # Rename a column used for lookups or order_by. Lookup result shouldn't change.
    self.apply_user_action(["RenameColumn", "People", "Name", "FullName"])
    self.assertTableData('Test', cols="subset", data=[
      dict(id=1, Lookup1="Bob", Lookup2="Alice", Lookup3="Alice", Lookup4="Bob")
    ])

    self.assertTableData('_grist_Tables_column', cols="subset", rows="subset", data=[
      dict(id=6, colId="Lookup3",
        formula="r = People.lookupRecords(order_by='FullName').find.ge('B')\n" +
                "PREVIOUS(r, order_by=None).FullName"),
      dict(id=7, colId="Lookup4",
        formula="r = People.lookupRecords(order_by='FullName').find.eq('Alice')\n" +
                "People.lookupRecords(order_by='FullName').find.next(r).FullName")
    ])
