# This Python file uses the following encoding: utf-8
import calendar
import datetime
import math
import os
import unittest

from imports import import_xls

def _get_fixture(filename):
  return [os.path.join(os.path.dirname(__file__), "fixtures", filename)]


class TestImportXLS(unittest.TestCase):

  maxDiff = None  # Display full diff if any.

  def _check_col(self, sheet, index, name, typename, values):
    self.assertEqual(sheet["column_metadata"][index]["id"], name)
    self.assertEqual(sheet["column_metadata"][index]["type"], typename)
    if typename == "Any":
      # Convert values to strings to reduce changes to tests after imports were overhauled.
      values = [str(v) for v in values]
    self.assertEqual(sheet["table_data"][index], values)

  def test_excel(self):
    parsed_file = import_xls.parse_file(*_get_fixture('test_excel.xlsx'))

    # check that column type was correctly set to numeric and values are properly parsed
    self.assertEqual(parsed_file[1][0]["column_metadata"][0], {"type": "Numeric", "id": "numbers"})
    self.assertEqual(parsed_file[1][0]["table_data"][0], [1, 2, 3, 4, 5, 6, 7, 8])

    # check that column type was correctly set to text and values are properly parsed
    self.assertEqual(parsed_file[1][0]["column_metadata"][1], {"type": "Any", "id": "letters"})
    self.assertEqual(parsed_file[1][0]["table_data"][1],
      ["a", "b", "c", "d", "e", "f", "g", "h"])

    # check that column type was correctly set to bool and values are properly parsed
    self.assertEqual(parsed_file[1][0]["column_metadata"][2], {"type": "Bool", "id": "boolean"})
    self.assertEqual(parsed_file[1][0]["table_data"][2],
      [True, False, True, False, True, False, True, False])

    # check that column type was correctly set to text and values are properly parsed
    self.assertEqual(parsed_file[1][0]["column_metadata"][3],
                     {"type": "Any", "id": "corner-cases"})
    self.assertEqual(parsed_file[1][0]["table_data"][3],
      # The type is detected as text, so all values should be text.
      [u'=function()', u'3', u'two spaces after  ',
        u'  two spaces before', u'!@#$', u'€€€', u'√∫abc$$', u'line\nbreak'])

    # check that multiple tables are created when there are multiple sheets in a document
    self.assertEqual(parsed_file[1][0]["table_name"], u"Sheet1")
    self.assertEqual(parsed_file[1][1]["table_name"], u"Sheet2")
    self.assertEqual(parsed_file[1][1]["table_data"][0], ["a", "b", "c", "d"])

  def test_excel_types(self):
    parsed_file = import_xls.parse_file(*_get_fixture('test_excel_types.xlsx'))
    sheet = parsed_file[1][0]
    self._check_col(sheet, 0, "int1", "Numeric", [-1234123, None, None])
    self._check_col(sheet, 1, "int2", "Numeric", [5, None, None])
    self._check_col(sheet, 2, "textint", "Any", ["12345678902345689", '', ''])
    self._check_col(sheet, 3, "bigint", "Any", ["320150170634561830", '', ''])
    self._check_col(sheet, 4, "num2", "Numeric", [123456789.123456, None, None])
    self._check_col(sheet, 5, "bignum", "Numeric", [math.exp(200), None, None])
    self._check_col(sheet, 6, "date1", "DateTime",
             [calendar.timegm(datetime.datetime(2015, 12, 22, 11, 59, 00).timetuple()), None, None])
    self._check_col(sheet, 7, "date2", "Date",
             [calendar.timegm(datetime.datetime(2015, 12, 20, 0, 0, 0).timetuple()), None, None])
    self._check_col(sheet, 8, "datetext", "Any", ['12/22/2015', '', ''])
    self._check_col(sheet, 9, "datetimetext", "Any",
                    [u'12/22/2015', u'12/22/2015 1:15pm', u'2018-02-27 16:08:39 +0000'])

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
                    [1,2,3,4,5,None,6,7,8,9,10,10.25,11,12,13,14,15,16,17,18])
    self._check_col(sheet, 2, "int_not_bool", "Any",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 2, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 3, "float_not_bool", "Any",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 0.5, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 4, "text_as_bool", "Any",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 5, "int_as_bool", "Numeric",
                    [0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])
    self._check_col(sheet, 6, "float_not_date", "Any",
                    [4.0, 6.0, 4.0, 4.0, 6.0, 4.0, '--', 6.0, 4.0, 4.0, 4.0, 4.0, 4.0, 6.0, 6.0,
                     4.0, 6.0, '3-4', 4.0, 6.5])
    self._check_col(sheet, 7, "float_not_text", "Numeric",
                    [-10.25, -8.00, -5.75, -3.50, "n/a", '  1.  ', "   ???   ", 5.50, None, "-",
                     12.25, 0.00, None, 0.00, "--", 23.50, "NA", 28.00, 30.25, 32.50])

  def test_excel_numeric_gs(self):
    # openpyxl sometimes sees floats for int values when those values come from Google Sheets (if
    # saved via Excel, they'll look like ints). Check that they don't get imported with ".0" suffix.
    parsed_file = import_xls.parse_file(*_get_fixture('test_excel_numeric_gs.xlsx'))
    sheet = parsed_file[1][0]
    self._check_col(sheet, 0, "TagId", "Numeric", [10, 20, 30, 40.5])
    self._check_col(sheet, 1, "TagName", "Any", ["foo", "300", "bar", "300.1"])

  def test_excel_single_merged_cell(self):
    # An older version had a bug where a single cell marked as 'merged' would cause an exception.
    parsed_file = import_xls.parse_file(*_get_fixture('test_single_merged_cell.xlsx'))
    tables = parsed_file[1]
    self.assertEqual(tables, [{
      'table_name': u'Transaction Report',
      'column_metadata': [
        {'type': 'Any', 'id': u''},
        {'type': 'Numeric', 'id': u'Start'},
        {'type': 'Numeric', 'id': u''},
        {'type': 'Numeric', 'id': u''},
        {'type': 'Any', 'id': u'Seek no easy ways'},
      ],
      'table_data': [
        [u'SINGLE MERGED', u'The End'],
        [1637384.52, None],
        [2444344.06, None],
        [2444344.06, None],
        [u'', u''],
      ],
    }])

  def test_excel_strange_dates(self):
    # Check that we don't fail when encountering unusual dates and times (e.g. 0 or 38:00:00).
    parsed_file = import_xls.parse_file(*_get_fixture('strange_dates.xlsx'))
    tables = parsed_file[1]
    # We test non-failure, but the result is not really what we want. E.g. "1:10" and "100:20:30"
    # would be best left as text.
    self.assertEqual(tables, [{
      'table_name': u'Sheet1',
      'column_metadata': [
        {'id': 'a', 'type': 'Any'},
        {'id': 'b', 'type': 'Date'},
        {'id': 'c', 'type': 'Any'},
        {'id': 'd', 'type': 'Any'},
        {'id': 'e', 'type': 'DateTime'},
        {'id': 'f', 'type': 'Date'},
        {'id': 'g', 'type': 'Any'},
        {'id': 'h', 'type': 'Date'},
        {'id': 'i', 'type': 'Any'},
        {'id': 'j', 'type': 'Numeric'},
      ],
      'table_data': [
        [u'21:14:00'],
        [1568851200.0],
        [u'01:10:00'],
        [u'10:20:30'],
        [-2208713970.0],
        [-2207347200.0],
        [u'7/4/1776'],
        [205286400.0],
        ['00:00:00'],
        [6281228502068],
      ],
    }])

  def test_empty_rows(self):
    # Check that empty rows aren't imported,
    # and that files with lots of empty rows are imported quickly.
    # The fixture file is mostly empty but has data in the last row,
    # with over a million empty rows in between.
    parsed_file = import_xls.parse_file(*_get_fixture('test_empty_rows.xlsx'))
    tables = parsed_file[1]
    self.assertEqual(tables, [{
      'table_name': u'Sheet1',
      'column_metadata': [
        {'id': 'a', 'type': 'Numeric'},
        {'id': 'b', 'type': 'Numeric'},
      ],
      'table_data': [
        [0, None, 1],
        [u'', 0, 2],
      ],
    }])

  def test_invalid_dimensions(self):
    # Check that files with invalid dimensions (typically a result of software
    # incorrectly writing the xlsx file) are imported correctly. Previously, Grist
    # would fail to import any rows from such files due to how openpyxl parses them.
    parsed_file = import_xls.parse_file(*_get_fixture('test_invalid_dimensions.xlsx'))
    tables = parsed_file[1]
    self.assertEqual(tables, [{
      'table_name': 'Sheet1',
      'column_metadata': [
        {'id': u'A', 'type': 'Numeric'},
        {'id': u'B', 'type': 'Numeric'},
        {'id': u'C', 'type': 'Numeric'},
      ],
      'table_data': [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
    }])

  def test_falsy_cells(self):
    # Falsy cells should be parsed as Numeric, not Date.
    parsed_file = import_xls.parse_file(*_get_fixture('test_falsy_cells.xlsx'))
    tables = parsed_file[1]
    self.assertEqual(tables, [{
      'table_name': 'Sheet1',
      'column_metadata': [
        {'id': u'A', 'type': 'Bool'},
        {'id': u'B', 'type': 'Numeric'},
      ],
      'table_data': [
        [False, False],
        [0, 0],
      ],
    }])

  def test_boolean(self):
    parsed_file = import_xls.parse_file(*_get_fixture('test_boolean.xlsx'))
    tables = parsed_file[1]
    self.assertEqual(tables, [{
      'table_name': 'Sheet1',
      'column_metadata': [
        {'id': u'A', 'type': 'Bool'},
        {'id': u'B', 'type': 'Bool'},
        {'id': u'C', 'type': 'Any'},
      ],
      'table_data': [
        [True, False],
        [False, False],
        ['true', 'False'],
      ],
    }])

  def test_header_with_none_cell(self):
    parsed_file = import_xls.parse_file(*_get_fixture('test_headers_with_none_cell.xlsx'))
    tables = parsed_file[1]
    self.assertEqual(tables, [{
      'table_name': 'Sheet1',
      'column_metadata': [
        {'id': u'header1', 'type': 'Any'},
        {'id': u'header2', 'type': 'Any'},
        {'id': u'header3', 'type': 'Any'},
        {'id': u'header4', 'type': 'Any'},
      ],
      'table_data': [
        ['foo1', 'foo2'],
        ['bar1', 'bar2'],
        ['baz1', 'baz2'],
        ['boz1', 'boz2'],
      ],
    }])


if __name__ == '__main__':
  unittest.main()
