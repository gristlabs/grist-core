# This is a test of mixing sorted and unsorted lookups, to ensure that reuse of relation mappings
# works correctly
# pylint: disable=use-dict-literal

import datetime
import moment
import test_engine
import testutil

def D(year, month, day):
  return moment.date_to_ts(datetime.date(year, month, day))

class TestLookupRelations(test_engine.EngineTestCase):
  def do_setup(self, num_records):
    # pylint: disable=line-too-long
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Table1", [
          [1, "Date", "Date", False, "", "", ""],
          [2, "Status", "Text", False, "", "", ""],
          [3, "A1", "Ref:Table1", True, "Table1.lookupOne()", "", ""],
          [4, "A2", "Ref:Table1", True, "Table1.lookupOne(order_by='-Date')", "", ""],
          [5, "A3", "Ref:Table1", True, "Table1.lookupOne(order_by=('Date', '-id'))", "", ""],
          [6, "B1", "Ref:Table1", True, "Table1.lookupOne(Status=$Status, order_by='-Date')", "", ""],
          [7, "B2", "Ref:Table1", True, "Table1.lookupOne(Status=$Status)", "", ""],
          [8, "B3", "Ref:Table1", True, "Table1.lookupOne(Status=$Status, order_by=('Date', '-id'))", "", ""],
        ]]
      ],
      "DATA": {}
    }))

    assert num_records % 4 == 0, "Call do_setup with multiples of 4 here"
    self.add_records("Table1", ["Date", "Status"], [
      [ "2024-02-01",  "Green" ],
      [ "2024-01-03",  "Green" ],
      [ "2000-01-01",  "Blue" ],
      [ "2024-02-02",  "Blue" ],
    ] * (num_records // 4))

  @test_engine.test_undo
  def test_invalidations(self):
    self.do_setup(1000)

    # Different lookups return different records, this takes some careful eyeballing to check that
    # it's correct. E.g. for ID 3, B1 should be the row with Status=Blue, the latest date and
    # smallest rowId, which is row 4.
    self.assertTableData('Table1', cols="all", rows="subset", data=[
      dict(id=1, Date=D(2024,2,1), Status="Green", A1=1, A2=4, A3=999, B1=1, B2=1, B3=998),
      dict(id=2, Date=D(2024,1,3), Status="Green", A1=1, A2=4, A3=999, B1=1, B2=1, B3=998),
      dict(id=3, Date=D(2000,1,1), Status="Blue", A1=1, A2=4, A3=999, B1=4, B2=3, B3=999),
      dict(id=4, Date=D(2024,2,2), Status="Blue", A1=1, A2=4, A3=999, B1=4, B2=3, B3=999),
      # Rows values repeat, so we should see the same result in other rows too.
      dict(id=801, Date=D(2024,2,1), Status="Green", A1=1, A2=4, A3=999, B1=1, B2=1, B3=998),
      dict(id=802, Date=D(2024,1,3), Status="Green", A1=1, A2=4, A3=999, B1=1, B2=1, B3=998),
      dict(id=803, Date=D(2000,1,1), Status="Blue", A1=1, A2=4, A3=999, B1=4, B2=3, B3=999),
      dict(id=804, Date=D(2024,2,2), Status="Blue", A1=1, A2=4, A3=999, B1=4, B2=3, B3=999),
    ])

    # Now change a lookup value, and check that everything updates as expected.
    self.update_record('Table1', 804, Status="Green")
    self.assertTableData('Table1', cols="all", rows="subset", data=[
      dict(id=1, Date=D(2024,2,1), Status="Green", A1=1, A2=4, A3=999, B1=804, B2=1, B3=998),
      dict(id=2, Date=D(2024,1,3), Status="Green", A1=1, A2=4, A3=999, B1=804, B2=1, B3=998),
      dict(id=3, Date=D(2000,1,1), Status="Blue", A1=1, A2=4, A3=999, B1=4, B2=3, B3=999),
      dict(id=4, Date=D(2024,2,2), Status="Blue", A1=1, A2=4, A3=999, B1=4, B2=3, B3=999),

      dict(id=801, Date=D(2024,2,1), Status="Green", A1=1, A2=4, A3=999, B1=804, B2=1, B3=998),
      dict(id=802, Date=D(2024,1,3), Status="Green", A1=1, A2=4, A3=999, B1=804, B2=1, B3=998),
      dict(id=803, Date=D(2000,1,1), Status="Blue", A1=1, A2=4, A3=999, B1=4, B2=3, B3=999),
      dict(id=804, Date=D(2024,2,2), Status="Green", A1=1, A2=4, A3=999, B1=804, B2=1, B3=998),
    ])

    # Now change several order-by values, and check that everything updates as expected.
    self.update_records('Table1', ['id', 'Date'], [
      [4,   "1999-01-01"],
      [802, "2025-05-05"],
    ])
    self.assertTableData('Table1', cols="all", rows="subset", data=[
      dict(id=1, Date=D(2024,2,1), Status="Green", A1=1, A2=802, A3=4, B1=802, B2=1, B3=998),
      dict(id=2, Date=D(2024,1,3), Status="Green", A1=1, A2=802, A3=4, B1=802, B2=1, B3=998),
      dict(id=3, Date=D(2000,1,1), Status="Blue", A1=1, A2=802, A3=4, B1=8, B2=3, B3=4),
      dict(id=4, Date=D(1999,1,1), Status="Blue", A1=1, A2=802, A3=4, B1=8, B2=3, B3=4),

      dict(id=801, Date=D(2024,2,1), Status="Green", A1=1, A2=802, A3=4, B1=802, B2=1, B3=998),
      dict(id=802, Date=D(2025,5,5), Status="Green", A1=1, A2=802, A3=4, B1=802, B2=1, B3=998),
      dict(id=803, Date=D(2000,1,1), Status="Blue", A1=1, A2=802, A3=4, B1=8, B2=3, B3=4),
      dict(id=804, Date=D(2024,2,2), Status="Green", A1=1, A2=802, A3=4, B1=802, B2=1, B3=998),
    ])
