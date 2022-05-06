"""
This module reads a file path that is passed in using ActiveDoc.importFile()
and returns a object formatted so that it can be used by grist for a bulk add records action
"""
import logging

import messytables
import openpyxl
import six
from six.moves import zip

import parse_data
from imports import import_utils

log = logging.getLogger(__name__)


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
    table_name = sheet.title
    rows = [
      row
      for row in sheet.iter_rows(values_only=True)
      # Exclude empty rows, i.e. rows with only empty values.
      # `if not any(row)` would be slightly faster, but would count `0` as empty.
      if not set(row) <= {None, ""}
    ]
    sample = [
      # Create messytables.Cells for the sake of messytables.headers_guess
      [messytables.Cell(cell) for cell in row]
      for row in rows[:1000]
    ]
    offset, headers = messytables.headers_guess(sample)
    data_offset = offset + 1  # Add the header line
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
