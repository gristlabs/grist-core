# This Python file uses the following encoding: utf-8
# pylint:disable=line-too-long
import csv
import os
import textwrap
import tempfile
import unittest
from six import StringIO, text_type

from imports import import_csv


def _get_fixture(filename):
  return os.path.join(os.path.dirname(__file__), "fixtures", filename)

# For a non-utf8 fixture, there is a problem with 'arc diff' which can't handle files with
# non-utf8 encodings. So create one on the fly.
non_utf8_fixture = None
non_utf8_file = None
def setUpModule():
  global non_utf8_file, non_utf8_fixture    # pylint:disable=global-statement
  with open(_get_fixture('test_encoding_utf8.csv')) as f:
    non_utf8_file = tempfile.NamedTemporaryFile(mode='wb')
    non_utf8_file.write(f.read().encode('iso-8859-7'))
    non_utf8_file.flush()
  non_utf8_fixture = non_utf8_file.name

def tearDownModule():
  non_utf8_file.close()

class TestImportCSV(unittest.TestCase):

  maxDiff = None

  def _check_options(self, computed, **expected):
    """Check the options returned by `parse_file`.

    Pass as kwarg any non default option as expected.
    """
    default = {"delimiter": ",",
               "doublequote": True,
               "lineterminator": "\n",
               "quotechar": '"',
               "skipinitialspace": False,
               "include_col_names_as_headers": True,
               "start_with_row": 1}
    # Don't check those values, which are not real options.
    computed.pop("NUM_ROWS", None)
    computed.pop("SCHEMA", None)
    default.update(expected)
    self.assertEqual(computed, default)

  def _check_col(self, sheet, index, name, _typename, values):
    self.assertEqual(sheet["column_metadata"][index]["id"], name)
    # Previously, strings were parsed and types were guessed in CSV imports.
    # Now all data is kept as strings and the column type is left as Any
    # so that type guessing and parsing can happen elsewhere.
    # To avoid updating 85 calls to _check_col, the typename argument was kept but can be ignored,
    # and all values are converted back to strings for comparison.
    self.assertEqual(sheet["column_metadata"][index]["type"], "Any")
    values = [text_type(v) for v in values]
    self.assertEqual(sheet["table_data"][index], values)

  def _check_num_cols(self, sheet, exp_cols):
    self.assertEqual(len(sheet["column_metadata"]), exp_cols)
    self.assertEqual(len(sheet["table_data"]), exp_cols)


  def test_csv_types(self):
    options, parsed_file = import_csv.parse_file(_get_fixture('test_excel_types.csv'), parse_options='')
    sheet = parsed_file[0]
    self._check_options(options, encoding='utf-8')

    self._check_col(sheet, 0, "int1", "Int", [-1234123, '', ''])
    self._check_col(sheet, 1, "int2", "Int", [5, '', ''])
    self._check_col(sheet, 2, "textint", "Text", ["12345678902345689", '', ''])
    self._check_col(sheet, 3, "bigint", "Text", ["320150170634561830", '', ''])
    self._check_col(sheet, 4, "num2", "Numeric", ['123456789.1234560000', '', ''])
    self._check_col(sheet, 5, "bignum", "Numeric", ['7.22597E+86', '', ''])
    self._check_col(sheet, 6, "date1", "DateTime",
                    [u'12/22/15 11:59 AM', u'', u''])
    self._check_col(sheet, 7, "date2", "Date",
                    [u'December 20, 2015', u'', u''])
    self._check_col(sheet, 8, "datetext", "Date",
                    [u'12/22/2015', u'', u''])
    self._check_col(sheet, 9, "datetimetext", "DateTime",
                    [u'12/22/2015 00:00:00', u'12/22/2015 13:15:00', u'02/27/2018 16:08:39'])


  def test_user_parse_options(self):
    options = {u'parse_options': {"escapechar": None, "include_col_names_as_headers": True,
                                 "lineterminator": "\n", "skipinitialspace": False,
                                 "limit_rows": False, "quoting": 0, "start_with_row": 1,
                                 "delimiter": ",", "NUM_ROWS":10,
                                 "quotechar": "\"", "doublequote":True}}
    parsed_options, parsed_file = import_csv.parse_file(_get_fixture('test_import_csv.csv'),
                                        **options)
    parsed_options.pop("SCHEMA")  # This key was not passed.
    # Those keys are not returned by parse_file, so remove them for now, before comparing.
    options["parse_options"].pop("limit_rows")
    options["parse_options"].pop("quoting")
    options["parse_options"].pop("escapechar")
    options["parse_options"]["encoding"] = "utf-8"   # Expected encoding
    self.assertEqual(options["parse_options"], parsed_options)
    self._check_options(parsed_options, encoding='utf-8')
    parsed_file = parsed_file[0]

    self._check_num_cols(parsed_file, 5)
    self._check_col(parsed_file, 0, "FIRST_NAME", "Text", ['John', 'Tim', 'Jenny', 'Lily'])
    self._check_col(parsed_file, 1, "LAST_NAME", "Text", ['Moor', 'Kale', 'Jo', 'Smit'])
    self._check_col(parsed_file, 2, "PHONE", "Text", ['201-343-3434', '201.343.3434',
                                                      '2013433434', '(201)343-3434'])
    self._check_col(parsed_file, 3, "VALUE", "Int", [45, 4545, 0, 4])
    self._check_col(parsed_file, 4, "DATE", "DateTime",
                    [u'2018-02-27 16:08:39 +0000',
                     u'2018-02-27 16:08:39 +0100',
                     u'2018-02-27 16:08:39 -0100',
                     u''])

  def test_wrong_cols1(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      name1, name2, name3
      a1,b1,c1
      a2,b2
      a3
      """))

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self._check_options(options, lineterminator='\r\n')
    parsed_file = parsed_file[0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "name2", "Text", ["b1", "b2", ""])
    self._check_col(parsed_file, 2, "name3", "Text", ["c1", "", ""])

  def test_wrong_cols2(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      name1
      a1,b1
      a2,b2,c2
      """))

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self._check_options(options, lineterminator='\r\n')
    parsed_file = parsed_file[0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2"])
    self._check_col(parsed_file, 1, "", "Text", ["b1", "b2"])
    self._check_col(parsed_file, 2, "", "Text", ["", "c2"])

  def test_offset(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      ,,,,,,,
      name1,name2,name3
      a1,b1,c1
      a2,b2,c2
      a3,b3,c3,d4
      """))

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self._check_options(options, lineterminator='\r\n')
    parsed_file = parsed_file[0]

    self._check_num_cols(parsed_file, 4)
    self._check_col(parsed_file, 0, "name1", "Text", ["a1", "a2", "a3"])
    self._check_col(parsed_file, 1, "name2", "Text", ["b1", "b2", "b3"])
    self._check_col(parsed_file, 2, "name3", "Text", ["c1", "c2", "c3"])
    self._check_col(parsed_file, 3, "", "Text", ["", "", "d4"])

  def test_offset_no_header(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      4,b1,c1
      4,b2,c2
      4,b3,c3
      """))

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self._check_options(options, include_col_names_as_headers=False)
    parsed_file = parsed_file[0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "", "Int", [4, 4, 4])
    self._check_col(parsed_file, 1, "", "Text", ["b1", "b2", "b3"])
    self._check_col(parsed_file, 2, "", "Text", ["c1", "c2", "c3"])

  def test_empty_headers(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      ,,-,-
      b,a,a,a,a
      b,a,a,a,a
      b,a,a,a,a
      """))

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self._check_options(options, lineterminator='\r\n')
    parsed_file = parsed_file[0]
    self._check_num_cols(parsed_file, 5)
    self._check_col(parsed_file, 0, "", "Text", ["b", "b", "b"])
    self._check_col(parsed_file, 1, "", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 2, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 3, "-", "Text", ["a", "a", "a"])
    self._check_col(parsed_file, 4, "", "Text", ["a", "a", "a"])

    file_obj = StringIO(textwrap.dedent(
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
    file_obj = StringIO(textwrap.dedent(
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

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)
    self._check_options(options, lineterminator='\r\n', delimiter=';')
    parsed_file = parsed_file[0]
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
    file_obj = StringIO(textwrap.dedent(
      """\
      2,name2,name3
      """))

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self._check_options(options, include_col_names_as_headers=False)
    parsed_file = parsed_file[0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "", "Int", [2])
    self._check_col(parsed_file, 1, "", "Text", ["name2"])
    self._check_col(parsed_file, 2, "", "Text", ["name3"])

  def test_one_line_file_with_header(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      name1,name2,name3
      """))

    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self._check_options(options)
    parsed_file = parsed_file[0]
    self._check_num_cols(parsed_file, 3)
    self._check_col(parsed_file, 0, "name1", "Text", [])
    self._check_col(parsed_file, 1, "name2", "Text", [])
    self._check_col(parsed_file, 2, "name3", "Text", [])

  def test_empty_file(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      """))

    parsed_file = import_csv._parse_open_file(file_obj, parse_options={})
    self.assertEqual(parsed_file, ({}, []))

  def test_option_num_rows(self):
    file_obj = StringIO(textwrap.dedent(
      """\
      name1,name2,name3
      a1,b1,c1
      a2,b2,c2
      a3,b3,c3
      """))

    parse_options = {}
    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)
    self._check_options(options)
    parsed_file = parsed_file[0]
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
    file_obj = StringIO(textwrap.dedent(
      """\
      ,,
      ,,
      a1,1,c1
      a2,2,c2
      a3,3,c3
      """))

    parse_options = {}
    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)
    self._check_options(options, include_col_names_as_headers=False)
    parsed_file = parsed_file[0]
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
    file_obj = StringIO(textwrap.dedent(
      """\
      name1,name2,name3
      a1,1,c1
      a2,2,c2
      a3,3,c3
      """))

    parse_options = {"include_col_names_as_headers": False}
    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)
    self._check_options(options, include_col_names_as_headers=False)
    parsed_file = parsed_file[0]
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
    file_obj = StringIO(textwrap.dedent(
      """\
      ,,,
      ,,,
      n1,2,n3
      a1,1,c1,d1
      a2,4,c2
      a3,5,c3
      """))

    parse_options = {"include_col_names_as_headers": False}
    options, parsed_file = import_csv._parse_open_file(file_obj, parse_options=parse_options)
    self._check_options(options, include_col_names_as_headers=False, lineterminator='\r\n')
    parsed_file = parsed_file[0]
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
    options, parsed_file = import_csv.parse_file(_get_fixture('test_long_cell.csv'), parse_options='')
    self._check_options(options, encoding='utf-8')
    sheet = parsed_file[0]
    long_cell = sheet["table_data"][1][0]
    self.assertEqual(len(long_cell), 8058)
    self._check_col(sheet, 0, "ID", "Int", [17])
    self._check_col(sheet, 1, "LongText", "Text", [long_cell])

  def test_csv_with_surprising_isdigit(self):
    options, parsed_file = import_csv.parse_file(_get_fixture('test_isdigit.csv'), parse_options='')
    self._check_options(options, encoding='utf-8')
    sheet = parsed_file[0]
    self._check_num_cols(sheet, 3)
    self._check_col(sheet, 0, "PHONE", "Text", [u'201-¾᠓𑄺꤈꤈꧐꤆'])
    self._check_col(sheet, 1, "VALUE", "Text", [u'¹5'])
    self._check_col(sheet, 2, "DATE", "Text", [u'2018-0²-27 16:08:39 +0000'])

  def test_csv_encoding_detection_utf8(self):
    options, parsed_file = import_csv.parse_file(_get_fixture('test_encoding_utf8.csv'), parse_options='')
    self._check_options(options, encoding='utf-8')
    sheet = parsed_file[0]
    self._check_col(sheet, 0, "Name", "Text", [u'John Smith', u'Μαρία Παπαδοπούλου', u'Δημήτρης Johnson'])
    self._check_col(sheet, 2, "Επάγγελμα", "Text", [u'Γιατρός', u'Engineer', u'Δικηγόρος'])

  def test_csv_encoding_detection_greek(self):
    # ISO-8859-7 is close to CP1253, and this fixure file would be identical in these two.
    options, parsed_file = import_csv.parse_file(non_utf8_fixture, parse_options='')
    self._check_options(options, encoding='ISO-8859-7')
    sheet = parsed_file[0]
    self._check_col(sheet, 0, "Name", "Text", [u'John Smith', u'Μαρία Παπαδοπούλου', u'Δημήτρης Johnson'])
    self._check_col(sheet, 2, "Επάγγελμα", "Text", [u'Γιατρός', u'Engineer', u'Δικηγόρος'])

    # Similar enough encoding that the result is correct.
    options, parsed_file = import_csv.parse_file(non_utf8_fixture, parse_options={"encoding": "cp1253"})
    self._check_options(options, encoding='cp1253')   # The encoding should be respected
    sheet = parsed_file[0]
    self._check_col(sheet, 0, "Name", "Text", [u'John Smith', u'Μαρία Παπαδοπούλου', u'Δημήτρης Johnson'])
    self._check_col(sheet, 2, "Επάγγελμα", "Text", [u'Γιατρός', u'Engineer', u'Δικηγόρος'])

  def test_csv_encoding_errors_are_handled(self):
    # With ascii, we'll get many decoding errors, but parsing should still succeed.
    parse_options = {
      "encoding": "ascii",
      "include_col_names_as_headers": True,
    }
    options, parsed_file = import_csv.parse_file(non_utf8_fixture, parse_options=parse_options)
    self._check_options(options,
        encoding='ascii',
        WARNING='Using encoding ascii, encountered 108 errors. Use Import Options to change')
    sheet = parsed_file[0]
    self._check_col(sheet, 0, "Name", "Text", [u'John Smith', u'����� ������������', u'�������� Johnson'])
    self._check_col(sheet, 2, "���������", "Text", [u'�������', u'Engineer', u'���������'])

  def test_csv_encoding_mismatch(self):
    # Here we use a wrong single-byte encoding, to check that it succeeds even if with nonsense.
    parse_options = {
      "encoding": "cp1254",
      "include_col_names_as_headers": True,
    }
    options, parsed_file = import_csv.parse_file(non_utf8_fixture, parse_options=parse_options)
    self._check_options(options, encoding='cp1254')
    sheet = parsed_file[0]
    self._check_col(sheet, 0, "Name", "Text", [u'John Smith', u'Ìáñßá Ğáğáäïğïıëïõ', u'ÄçìŞôñçò Johnson'])
    self._check_col(sheet, 2, "ÅğÜããåëìá", "Text", [u'Ãéáôñüò', u'Engineer', u'Äéêçãüñïò'])


if __name__ == '__main__':
  unittest.main()
