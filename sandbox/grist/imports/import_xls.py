"""
This module reads a file path that is passed in using ActiveDoc.importFile()
and returns a object formatted so that it can be used by grist for a bulk add records action
"""
import csv
import logging
import os

import chardet
import messytables
import messytables.excel
import six
from six.moves import zip

import parse_data
from imports import import_utils

log = logging.getLogger(__name__)


def import_file(file_source, parse_options):
  path = import_utils.get_path(file_source["path"])
  orig_name = file_source["origName"]
  parse_options, tables = parse_file(path, orig_name, parse_options)
  return {"parseOptions": parse_options, "tables": tables}

# messytable is painfully un-extensible, so we have to jump through dumb hoops to override any
# behavior.
orig_dialect = messytables.CSVRowSet._dialect
def override_dialect(self):
  if self.delimiter == '\t':
    return csv.excel_tab
  return orig_dialect.fget(self)
messytables.CSVRowSet._dialect = property(override_dialect)

def parse_file(file_path, orig_name, parse_options=None, table_name_hint=None, num_rows=None):
  # pylint: disable=unused-argument
  with open(file_path, "rb") as f:
    try:
      return parse_open_file(f, orig_name, table_name_hint=table_name_hint)
    except Exception as e:
      # Log the full error, but simplify the thrown error to omit the unhelpful extra args.
      log.info("import_xls parse_file failed: %s", e)
      if six.PY2 and e.args and isinstance(e.args[0], six.string_types):
        raise Exception(e.args[0])
      raise


def parse_open_file(file_obj, orig_name, table_name_hint=None):
  file_root, file_ext = os.path.splitext(orig_name)
  table_set = messytables.any.any_tableset(file_obj, extension=file_ext, auto_detect=False)

  # Messytable's encoding detection uses too small a sample, so we override it here.
  if isinstance(table_set, messytables.CSVTableSet):
    sample = file_obj.read(100000)
    table_set.encoding = chardet.detect(sample)['encoding']
    # In addition, always prefer UTF8 over ASCII.
    if table_set.encoding == 'ascii':
      table_set.encoding = 'utf8'

  export_list = []
  # A table set is a collection of tables:
  for row_set in table_set.tables:
    table_name = row_set.name

    if isinstance(row_set, messytables.CSVRowSet):
      # For csv files, we can do better for table_name by using the filename.
      table_name = import_utils.capitalize(table_name_hint or
                                           os.path.basename(file_root.decode('utf8')))

      # Messytables doesn't guess whether headers are present, so we need to step in.
      data_offset, headers = import_utils.headers_guess(list(row_set.sample))
    else:
      # Let messytables guess header names and the offset of the header.
      offset, headers = messytables.headers_guess(row_set.sample)
      data_offset = offset + 1    # Add the header line

    # Make sure all header values are strings.
    for i, header in enumerate(headers):
      if not isinstance(header, six.string_types):
        headers[i] = six.text_type(header)

    log.debug("Guessed data_offset as %s", data_offset)
    log.debug("Guessed headers as: %s", headers)

    row_set.register_processor(messytables.offset_processor(data_offset))


    table_data_with_types = parse_data.get_table_data(row_set, len(headers))

    # Identify and remove empty columns, and populate separate metadata and data lists.
    column_metadata = []
    table_data = []
    for col_data, header in zip(table_data_with_types, headers):
      if not header and all(val == "" for val in col_data["data"]):
        continue # empty column
      data = col_data.pop("data")
      col_data["id"] = header
      column_metadata.append(col_data)
      table_data.append(data)

    if not table_data:
      # Don't add tables with no columns.
      continue

    log.info("Output table %r with %d columns", table_name, len(column_metadata))
    for c in column_metadata:
      log.debug("Output column %s", c)
    export_list.append({
      "table_name": table_name,
      "column_metadata": column_metadata,
      "table_data": table_data
    })

    parse_options = {}

  return parse_options, export_list


# This change was initially introduced in https://phab.getgrist.com/D2145
# Monkey-patching done in https://phab.getgrist.com/D2965
# to move towards normal dependency management
@staticmethod
def from_xlrdcell(xlrd_cell, sheet, col, row):
  from messytables.excel import (
    XLS_TYPES, StringType, DateType, InvalidDateError, xlrd, time, datetime, XLSCell
  )
  value = xlrd_cell.value
  cell_type = XLS_TYPES.get(xlrd_cell.ctype, StringType())
  if cell_type == DateType(None):
    # Try-catch added by Dmitry, to avoid failing even if we see a date we can't handle.
    try:
      if value == 0:
        raise InvalidDateError
      year, month, day, hour, minute, second = \
        xlrd.xldate_as_tuple(value, sheet.book.datemode)
      if (year, month, day) == (0, 0, 0):
        value = time(hour, minute, second)
      else:
        value = datetime(year, month, day, hour, minute, second)
    except Exception:
      # Keep going, and we'll just interpret the date as a number.
      pass
  messy_cell = XLSCell(value, type=cell_type)
  messy_cell.sheet = sheet
  messy_cell.xlrd_cell = xlrd_cell
  messy_cell.xlrd_pos = (row, col)  # necessary for properties, note not (x,y)
  return messy_cell

messytables.excel.XLSCell.from_xlrdcell = from_xlrdcell
