"""
This module reads a file path that is passed in using ActiveDoc.importFile()
and returns a object formatted so that it can be used by grist for a bulk add records action
"""
import logging

import openpyxl
from openpyxl.utils.datetime import from_excel
from openpyxl.worksheet import _reader    # pylint:disable=no-name-in-module
import six
from six.moves import zip

import parse_data
from imports import import_utils

log = logging.getLogger(__name__)
log.setLevel(logging.WARNING)


# Some strange Excel files have values that are marked as dates but are invalid as dates.
# Normally, openpyxl converts these to `#VALUE!`, but keeping the original value is better.
# In the case where this was encountered, the original value is a large number:
# the 6281228502068 in test_excel_strange_dates.
# Here we monkeypatch openpyxl to keep the original value.
def new_from_excel(value, *args, **kwargs):
  try:
    return from_excel(value, *args, **kwargs)
  except (ValueError, OverflowError):
    return value
_reader.from_excel = new_from_excel


def import_file(file_source):
  path = import_utils.get_path(file_source["path"])
  parse_options, tables = parse_file(path)
  return {"parseOptions": parse_options, "tables": tables}


def parse_file(file_path):
  with open(file_path, "rb") as f:
    return parse_open_file(f)


def parse_open_file(file_obj):
  workbook = openpyxl.load_workbook(
    file_obj,
    read_only=True,
    keep_vba=False,
    data_only=True,
    keep_links=False,
  )

  skipped_tables = 0
  export_list = []
  # A table set is a collection of tables:
  for sheet in workbook:
    # openpyxl fails to read xlsx files with incorrect dimensions; we reset here as a precaution.
    # See https://openpyxl.readthedocs.io/en/stable/optimized.html#worksheet-dimensions.
    sheet.reset_dimensions()

    table_name = sheet.title
    rows = [
      list(row)
      for row in sheet.iter_rows(values_only=True)
      # Exclude empty rows, i.e. rows with only empty values.
      # `if not any(row)` would be slightly faster, but would count `0` as empty.
      if not set(row) <= {None, ""}
    ]
    # Resetting dimensions via openpyxl causes rows to not be padded. Make sure
    # sample rows are padded; get_table_data will handle padding the rest.
    sample = _with_padding(rows[:1000])
    data_offset, headers = import_utils.headers_guess(sample)
    rows = rows[data_offset:]

    # Make sure all header values are strings.
    for i, header in enumerate(headers):
      if header is None:
        headers[i] = u''
      elif not isinstance(header, six.string_types):
        headers[i] = six.text_type(header)

    log.debug("Guessed data_offset as %s", data_offset)
    log.debug("Guessed headers as: %s", headers)

    table_data_with_types = parse_data.get_table_data(rows, len(headers))

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
      skipped_tables += 1
      continue

    log.info("Output table %r with %d columns", table_name, len(column_metadata))
    for c in column_metadata:
      log.debug("Output column %s", c)
    export_list.append({
      "table_name": table_name,
      "column_metadata": column_metadata,
      "table_data": table_data
    })

  if not export_list:
    if skipped_tables:
      raise Exception("No tables found ({} empty tables skipped)".format(skipped_tables))
    raise Exception("No tables found")

  parse_options = {}
  return parse_options, export_list

def _with_padding(rows):
  if not rows:
    return []
  max_width = max(len(row) for row in rows)
  min_width = min(len(row) for row in rows)
  if min_width == max_width:
    return rows
  for row in rows:
    row.extend([""] * (max_width - len(row)))
  return rows
