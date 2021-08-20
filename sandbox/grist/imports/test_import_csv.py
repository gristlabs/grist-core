# This Python file uses the following encoding: utf-8
import os
import textwrap
import unittest
from six import BytesIO, text_type
import csv
import calendar
import datetime

from imports import import_csv


def _get_fixture(filename):
  return os.path.join(os.path.dirname(__file__), "fixtures", filename)


def bytes_io_from_str(string):
  if isinstance(string, text_type):
    string = string.encode("utf8")
  return BytesIO(string)


class TestImportCSV(unittest.TestCase):

  def _check_col(self, sheet, index, name, typename, values):
    self.assertEqual(sheet["column_metadata"][index]["id"], name)
    self.assertEqual(sheet["column_metadata"][index]["type"], typename)
    self.assertEqual(sheet["table_data"][index], values)

  def _check_num_cols(self, sheet, exp_cols):
    self.assertEqual(len(sheet["column_metadata"]), exp_cols)
    self.assertEqual(len(sheet["table_data"]), exp_cols)


  def test_csv_types(self):
    parsed_file = import_csv.parse_file(_get_fixture('test_excel_types.csv'), parse_options='')
    sheet = parsed_file[1][0]

    self._check_col(sheet, 0, "int1", "Int", [-1234123, '', ''])
    self._check_col(sheet, 1, "int2", "Int", [5, '', ''])
    self._check_col(sheet, 2, "textint", "Text", ["12345678902345689", '', ''])
    self._check_col(sheet, 3, "bigint", "Text", ["320150170634561830", '', ''])
    self._check_col(sheet, 4, "num2", "Numeric", [123456789.123456, '', ''])
    self._check_col(sheet, 5, "bignum", "Numeric", [7.22597e+86, '', ''])
    self._check_col(sheet, 6, "date1", "DateTime",
                    [calendar.timegm(datetime.datetime(2015, 12, 22, 11, 59, 00).timetuple()), None, None])
    self._check_col(sheet, 7, "date2", "Date",
                    [calendar.timegm(datetime.datetime(2015, 12, 20, 0, 0, 0).timetuple()), None, None])
    self._check_col(sheet, 8, "datetext", "Date",
                    [calendar.timegm(datetime.date(2015, 12, 22).timetuple()), None, None])
    self._check_col(sheet, 9, "datetimetext", "DateTime",
                    [calendar.timegm(datetime.datetime(2015, 12, 22, 0, 0, 0).timetuple()),
                     calendar.timegm(datetime.datetime(2015, 12, 22, 13, 15, 0).timetuple()),
                     calendar.timegm(datetime.datetime(2018, 2, 27, 16, 8, 39).timetuple())])


  def test_user_parse_options(self):
    options = {u'parse_options': {"escapechar": None, "include_col_names_as_headers": True,
                                 "lineterminator": "\n", "skipinitialspace": False,
                                 "limit_rows": False, "quoting": 0, "start_with_row": 1,
                                 "delimiter": ",", "NUM_ROWS":10,
                                 "quotechar": "\"", "doublequote":True}}
    parsed_file = import_csv.parse_file(_get_fixture('test_import_csv.csv'),
                                        **options)[1][0]
    self._check_num_cols(parsed_file, 5)
    self._check_col(parsed_file, 0, "FIRST_NAME", "Text", ['John', 'Tim', 'Jenny', 'Lily'])
    self._check_col(parsed_file, 1, "LAST_NAME", "Text", ['Moor', 'Kale', 'Jo', 'Smit'])
    self._check_col(parsed_file, 2, "PHONE", "Text", ['201-343-3434', '201.343.3434',
                                                      '2013433434', '(201)343-3434'])
    self._check_col(parsed_file, 3, "VALUE", "Int", [45, 4545, 0, 4])
    self._check_col(parsed_file, 4, "DATE", "DateTime", [1519747719.0, 1519744119.0, 1519751319.0, None])

  def test_wrong_cols1(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      name1, name2, name3
      a1,b1,c1
      a2,b2
      a3
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "name2", "Text", ["b1", "b2", ""])
    self._check_col(parsed_file, 2, "name3", "Text", ["c1", "", ""])

  def test_wrong_cols2(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      name1
      a1,b1
      a2,b2,c2
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2"])
    self._check_col(parsed_file, 1, "", "Text", ["b1", "b2"])
    self._check_col(parsed_file, 2, "", "Text", ["", "c2"])

  def test_offset(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      ,,,,,,,
      name1,name2,name3
      a1,b1,c1
      a2,b2,c2
      a3,b3,c3,d4
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 4)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "name2", "Text", ["b1", "b2", "b3"])
    self._check_col(parsed_file, 2, "name3", "Text", ["c1", "c2", "c3"])
    self._check_col(parsed_file, 3, "", "Text", ["", "", "d4"])

  def test_offset_no_header(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      4,b1,c1
      4,b2,c2
      4,b3,c3
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "", "Int", [4, 4, 4])
    self._check_col(parsed_file, 1, "", "Text", ["b1", "b2", "b3"])
    self._check_col(parsed_file, 2, "", "Text", ["c1", "c2", "c3"])

  def test_empty_headers(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      ,,-,-
      b,a,a,a,a
      b,a,a,a,a
      b,a,a,a,a
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 5)
    self._check_col(parsed_file, 0, "", "Text", ["b", "b", "b"])
    self._check_col(parsed_file, 1, "", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 2, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 3, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 4, "", "Text", ["a", "a", "a"])

    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      -,-,-,-,-,-
      b,a,a,a,a
      b,a,a,a,a
      b,a,a,a,a
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 6)
    self._check_col(parsed_file, 0, "-", "Text", ["b", "b", "b"])
    self._check_col(parsed_file, 1, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 2, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 3, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 4, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 5, "-", "Text", ["", "", ""])

  def test_guess_missing_user_option(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      name1,;name2,;name3
      a1,;b1,;c1
      a2,;b2,;c2
      a3,;b3,;c3
      """))
    parse_options = {"delimiter": ';',
                     "escapechar": None,
                     "lineterminator": '\r\n',
                     "quotechar": '"',
                     "quoting": csv.QUOTE_MINIMAL}

    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1,", "Text", ["a1,", "a2,", "a3,"])
    self._check_col(parsed_file, 1, "name2,", "Text", ["b1,", "b2,", "b3,"])
    self._check_col(parsed_file, 2, "name3", "Text", ["c1", "c2", "c3"])

    # Sniffer detects delimiters in order [',', '\t', ';', ' ', ':'],
    # so for this file_obj it will be ','
    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2", "a3"])
    self._check_col(parsed_file, 1, ";name2", "Text", [";b1", ";b2", ";b3"])
    self._check_col(parsed_file, 2, ";name3", "Text", [";c1", ";c2", ";c3"])

  def test_one_line_file_no_header(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      2,name2,name3
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "", "Int", [2])
    self._check_col(parsed_file, 1, "", "Text", ["name2"])
    self._check_col(parsed_file, 2, "", "Text", ["name3"])

  def test_one_line_file_with_header(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      name1,name2,name3
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", [])
    self._check_col(parsed_file, 1, "name2", "Text", [])
    self._check_col(parsed_file, 2, "name3", "Text", [])

  def test_empty_file(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self.assertEqual(parsed_file, ({}, []))

  def test_option_num_rows(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      name1,name2,name3
      a1,b1,c1
      a2,b2,c2
      a3,b3,c3
      """))

    parse_options = {}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ['a1', 'a2', 'a3'])
    self._check_col(parsed_file, 1, "name2", "Text", ['b1', 'b2', 'b3'])
    self._check_col(parsed_file, 2, "name3", "Text", ['c1', 'c2', 'c3'])

    parse_options = {"NUM_ROWS": 2}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2"])
    self._check_col(parsed_file, 1, "name2", "Text", ["b1", "b2"])
    self._check_col(parsed_file, 2, "name3", "Text", ["c1", "c2"])

    parse_options = {"NUM_ROWS": 10}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ['a1', 'a2', 'a3'])
    self._check_col(parsed_file, 1, "name2", "Text", ['b1', 'b2', 'b3'])
    self._check_col(parsed_file, 2, "name3", "Text", ['c1', 'c2', 'c3'])

  def test_option_num_rows_no_header(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      ,,
      ,,
      a1,1,c1
      a2,2,c2
      a3,3,c3
      """))

    parse_options = {}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "", "Text", ['a1', 'a2', 'a3'])
    self._check_col(parsed_file, 1, "", "Int", [1, 2, 3])
    self._check_col(parsed_file, 2, "", "Text", ['c1', 'c2', 'c3'])

    parse_options = {"NUM_ROWS": 2}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "", "Text", ['a1', 'a2'])
    self._check_col(parsed_file, 1, "", "Int", [1, 2])
    self._check_col(parsed_file, 2, "", "Text", ['c1', 'c2'])

  def test_option_use_col_name_as_header(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      name1,name2,name3
      a1,1,c1
      a2,2,c2
      a3,3,c3
      """))

    parse_options = {"include_col_names_as_headers": False}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "", "Text", ["name1", "a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "", "Text", ["name2", "1", "2", "3"])
    self._check_col(parsed_file, 2, "", "Text", ["name3", "c1", "c2", "c3"])

    parse_options = {"include_col_names_as_headers": True}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "name2", "Int", [1, 2, 3])
    self._check_col(parsed_file, 2, "name3", "Text", ["c1", "c2", "c3"])

  def test_option_use_col_name_as_header_no_headers(self):
    file_obj = bytes_io_from_str(textwrap.dedent(
      """\
      ,,,
      ,,,
      n1,2,n3
      a1,1,c1,d1
      a2,4,c2
      a3,5,c3
      """))

    parse_options = {"include_col_names_as_headers": False}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 4)
    self._check_col(parsed_file, 0, "", "Text", ["n1", "a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "", "Int", [2, 1, 4, 5])
    self._check_col(parsed_file, 2, "", "Text", ["n3", "c1", "c2", "c3"])
    self._check_col(parsed_file, 3, "", "Text", ["", "d1", "", ""])

    parse_options = {"include_col_names_as_headers": True}
    parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)[1][0]
    self._check_num_cols(parsed_file, 4)
    self._check_col(parsed_file, 0, "n1", "Text", ["a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "2", "Int", [1, 4, 5])
    self._check_col(parsed_file, 2, "n3", "Text", ["c1", "c2", "c3"])
    self._check_col(parsed_file, 3, "", "Text", [ "d1", "", ""])

  def test_csv_with_very_long_cell(self):
    parsed_file = import_csv.parse_file(_get_fixture('test_long_cell.csv'), parse_options='')
    sheet = parsed_file[1][0]
    long_cell = sheet["table_data"][1][0]
    self.assertEqual(len(long_cell), 8058)
    self._check_col(sheet, 0, "ID", "Int", [17])
    self._check_col(sheet, 1, "LongText", "Text", [long_cell])


if __name__ == '__main__':
  unittest.main()
