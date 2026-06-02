"""
Test that Date/DateTimes produce correct types as seen by other formulas.
"""
import datetime
import testutil
import test_engine
import moment

def D(year, month, day):
  return moment.date_to_ts(datetime.date(year, month, day))

class TestDateTypes(test_engine.EngineTestCase):
  def test_date_types(self):
    date1 = D(2025, 12, 6)
    datetime1 = D(2025, 12, 6) + (9 * 60 + 30) * 60   # Make it 9:30 on that date.
    dateZero = D(1970, 1, 1)        # This should just be 0
    datetimeZero = D(1970, 1, 1)    # This should just be 0
    self.load_sample(testutil.parse_test_sample({
      "SCHEMA": [
        [1, "Test", [
          [1, "DateCol",        "Date",     False],
          [2, "DateColType",    "Any",      True, "type($DateCol).__name__"],
          [3, "DTCol",          "DateTime:UTC", False],
          [4, "DTColType",      "Any",      True, "type($DTCol).__name__"],
        ]]
      ],
      "DATA": {
        "Test": [
          ["id",  "DateCol",      "DTCol"],
          [   1,  date1,          datetime1],
          [   2,  dateZero,       datetimeZero],
          [   3,  0,              0],
          [   5,  None,           None],
          [   6,  "n/a",          "unknown"],
        ]
      }
    }))

    self.apply_user_action(["CreateViewSection", 1, 0, "record", [1], None])
    self.assertTableData('Test', cols="all", data=[
      ["id",  "DateCol",    "DTCol",      "DateColType",  "DTColType"],
      [   1,  date1,        datetime1,    "date",         "datetime"],
      [   2,  dateZero,     datetimeZero, "date",         "datetime"],
      [   3,  0,            0,            "date",         "datetime"],
      [   5,  None,         None,         "NoneType",     "NoneType"],
      [   6,  "n/a",        "unknown",    "AltText",      "AltText"],
    ])
