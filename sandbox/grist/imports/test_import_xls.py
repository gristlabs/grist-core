# This Python file uses the following encoding: utf-8
import calendar
import datetime
import math
import os
import unittest

from imports import import_xls

def _get_fixture(filename):
  return [os.path.join(os.path.dirname(__file__), "fixtures", filename), filename]


class TestImportXLS(unittest.TestCase):

  def _check_col(self, sheet, index, name, typename, values):
    self.assertEqual(sheet["column_metadata"][index]["id"], name)
    self.assertEqual(sheet["column_metadata"][index]["type"], typename)
    self.assertEqual(sheet["table_data"][index], values)

  def test_excel(self):
    parsed_file = import_xls.parse_file(*_get_fixture('test_excel.xlsx'))

    # check that column type was correctly set to int and values are properly parsed
    self.assertEqual(parsed_file[1][0]["column_metadata"][0], {"type": "Int", "id": "numbers"})
    self.assertEqual(parsed_file[1][0]["table_data"][0], [1, 2, 3, 4, 5, 6, 7, 8])

    # check that column type was correctly set to text and values are properly parsed
    self.assertEqual(parsed_file[1][0]["column_metadata"][1], {"type": "Text", "id": "letters"})
    self.assertEqual(parsed_file[1][0]["table_data"][1],
      ["a", "b", "c", "d", "e", "f", "g", "h"])

    # messy tables does not support bool types yet, it classifies them as ints
    self.assertEqual(parsed_file[1][0]["column_metadata"][2], {"type": "Bool", "id": "boolean"})
    self.assertEqual(parsed_file[1][False]["table_data"][2],
      [True, False, True, False, True, False, True, False])

    # check that column type was correctly set to text and values are properly parsed
    self.assertEqual(parsed_file[1][0]["column_metadata"][3],
                     {"type": "Text", "id": "corner-cases"})
    self.assertEqual(parsed_file[1][0]["table_data"][3],
      # The type is detected as text, so all values should be text.
      [u'=function()', '3.0', u'two spaces after  ',
        u'  two spaces before', u'!@#$', u'€€€', u'√∫abc$$', u'line\nbreak'])

    # check that multiple tables are created when there are multiple sheets in a document
    self.assertEqual(parsed_file[1][0]["table_name"], u"Sheet1")
    self.assertEqual(parsed_file[1][1]["table_name"], u"Sheet2")
    self.assertEqual(parsed_file[1][1]["table_data"][0], ["a", "b", "c", "d"])

  def test_excel_types(self):
    parsed_file = import_xls.parse_file(*_get_fixture('test_excel_types.xlsx'))
    sheet = parsed_file[1][0]
    self._check_col(sheet, 0, "int1", "Int", [-1234123, '', ''])
    self._check_col(sheet, 1, "int2", "Int", [5, '', ''])
    self._check_col(sheet, 2, "textint", "Text", ["12345678902345689", '', ''])
    self._check_col(sheet, 3, "bigint", "Text", ["320150170634561830", '', ''])
    self._check_col(sheet, 4, "num2", "Numeric", [123456789.123456, '', ''])
    self._check_col(sheet, 5, "bignum", "Numeric", [math.exp(200), '', ''])
    self._check_col(sheet, 6, "date1", "DateTime",
             [calendar.timegm(datetime.datetime(2015, 12, 22, 11, 59, 00).timetuple()), None, None])
    self._check_col(sheet, 7, "date2", "Date",
             [calendar.timegm(datetime.datetime(2015, 12, 20, 0, 0, 0).timetuple()), None, None])
    self._check_col(sheet, 8, "datetext", "Date",
             [calendar.timegm(datetime.date(2015, 12, 22).timetuple()), None, None])
    # TODO: all dates have different format
    # self._check_col(sheet, 9, "datetimetext", "DateTime",
    #          [calendar.timegm(datetime.datetime(2015, 12, 22, 0, 0, 0).timetuple()),
    #           calendar.timegm(datetime.datetime(2015, 12, 22, 13, 15, 0).timetuple()),
    #           calendar.timegm(datetime.datetime(2018, 02, 27, 16, 8, 39).timetuple())])

  def test_excel_type_detection(self):
    # This tests goes over the second sheet of the fixture doc, which has multiple rows that try
    # to throw off the type detection.
    parsed_file = import_xls.parse_file(*_get_fixture('test_excel_types.xlsx'))
    sheet = parsed_file[1][1]
    self._check_col(sheet, 0, "date_with_other", "DateTime",
                    [1467676800.0, 1451606400.0, 1451692800.0, 1454544000.0, 1199577600.0,
                     1467732614.0, u'n/a',       1207958400.0, 1451865600.0, 1451952000.0,
                     None, 1452038400.0, 1451549340.0, 1483214940.0, None,
                     1454544000.0, 1199577600.0, 1451692800.0, 1451549340.0, 1483214940.0])
    self._check_col(sheet, 1, "float_not_int", "Numeric",
                    [1,2,3,4,5,"",6,7,8,9,10,10.25,11,12,13,14,15,16,17,18])
    self._check_col(sheet, 2, "int_not_bool", "Int",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 3, "float_not_bool", "Numeric",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 0.5, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 4, "text_as_bool", "Bool",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 5, "int_as_bool", "Bool",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 6, "float_not_date", "Numeric",
                    [4.0, 6.0, 4.0, 4.0, 6.0, 4.0, '--', 6.0, 4.0, 4.0, 4.0, 4.0, 4.0, 6.0, 6.0,
                     4.0, 6.0, '3-4', 4.0, 6.5])
    self._check_col(sheet, 7, "float_not_text", "Numeric",
                    [-10.25, -8.00, -5.75, -3.50, "n/a", 1.00, "   ???   ", 5.50, "", "-",
                     12.25, 0.00, "", 0.00, "--", 23.50, "NA", 28.00, 30.25, 32.50])
    self._check_col(sheet, 8, "dollar_amts", "Numeric",
                    [0.00, 0.75, 1.50, '', 3.00, 0.00, 0.75, 1.50, '--', 3.00, 1234.56, 1000,
                     1001.50, '-', 3000000.000, 0000.00, 1234.56, 1000, 1001.50, 1000.01])

  def test_excel_single_merged_cell(self):
    # An older version of xlrd had a bug where a single cell marked as 'merged' would cause an
    # exception.
    parsed_file = import_xls.parse_file(*_get_fixture('test_single_merged_cell.xlsx'))
    tables = parsed_file[1]
    self.assertEqual(tables, [{
      'table_name': u'Transaction Report',
      'column_metadata': [
        {'type': 'Text', 'id': u''},
        {'type': 'Numeric', 'id': u'Start'},
        {'type': 'Numeric', 'id': u''},
        {'type': 'Numeric', 'id': u''},
        {'type': 'Text', 'id': u'Seek no easy ways'},
      ],
      'table_data': [
        [u'SINGLE MERGED', u'The End'],
        [1637384.52, u''],
        [2444344.06, u''],
        [2444344.06, u''],
        [u'', u''],
      ],
    }])

  def test_excel_strange_dates(self):
    # TODO fails with xlrd.xldate.XLDateAmbiguous: 4.180902777777778
    # Check that we don't fail when encountering unusual dates and times (e.g. 0 or 38:00:00).
    parsed_file = import_xls.parse_file(*_get_fixture('strange_dates.xlsx'))
    tables = parsed_file[1]
    # We test non-failure, but the result is not really what we want. E.g. "1:10" and "100:20:30"
    # would be best left as text, but here become "01:10:00" (after xlrd parses the first as
    # datetime.time), and as 4.18... (after xlrd fails and we resort to the numerical value).
    self.assertEqual(tables, [{
      'table_name': u'Sheet1',
      'column_metadata': [
        {'id': 'a', 'type': 'Text'},
        {'id': 'b', 'type': 'Date'},
        {'id': 'c', 'type': 'Text'},
        {'id': 'd', 'type': 'Text'},
        {'id': 'e', 'type': 'Numeric'},
        {'id': 'f', 'type': 'Int'},
        {'id': 'g', 'type': 'Date'},
        {'id': 'h', 'type': 'Date'},
        {'id': 'i', 'type': 'Bool'},
      ],
      'table_data': [
        [u'21:14:00'],
        [1568851200.0],
        [u'01:10:00'],
        [u'10:20:30'],
        [4.180902777777778],
        [20],
        [-6106060800.0],
        [205286400.0],
        [False],    # This is not great either, we should be able to distinguish 0 from FALSE.
      ],
    }])

if __name__ == '__main__':
  unittest.main()
