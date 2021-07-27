"""
This module reads a file path that is passed in using ActiveDoc.importFile()
and returns a object formatted so that it can be used by grist for a bulk add records action
"""
import os
import csv
import itertools
import logging

import chardet
import messytables
import six
from six.moves import zip

import parse_data
import import_utils


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
