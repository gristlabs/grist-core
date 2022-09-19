"""
Plugin for importing CSV files
"""
import codecs
import csv
import logging

import chardet
import six
from six.moves import zip

import parse_data
from imports import import_utils


log = logging.getLogger(__name__)

SCHEMA = [
          {
            'name': 'lineterminator',
            'label': 'Line terminator',
            'type': 'string',
            'visible': True,
          },
          {
            'name': 'include_col_names_as_headers',
            'label': 'First row contains headers',
            'type': 'boolean',
            'visible': True,
          },
          {
            'name': 'delimiter',
            'label': 'Field separator',
            'type': 'string',
            'visible': True,
          },
          {
            'name': 'skipinitialspace',
            'label': 'Skip leading whitespace',
            'type': 'boolean',
            'visible': True,
          },
          {
            'name': 'quotechar',
            'label': 'Quote character',
            'type': 'string',
            'visible': True,
          },
          {
            'name': 'doublequote',
            'label': 'Quotes in fields are doubled',
            'type': 'boolean',
            'visible': True,
          },

          {
            'name': 'quoting',
            'label': 'Convert quoted fields',
            'type': 'number',
            'visible': False,       # Not supported by messytables
          },
          {
            'name': 'escapechar',
            'label': 'Escape character',
            'type': 'string',
            'visible': False,       # Not supported by messytables
          },
          {
            'name': 'start_with_row',
            'label': 'Start with row',
            'type': 'number',
            'visible': False,       # Not yet implemented
          },
          {
            'name': 'NUM_ROWS',
            'label': 'Number of rows',
            'type': 'number',
            'visible': False,
          }]

def parse_file_source(file_source, options):
  parsing_options, export_list = parse_file(import_utils.get_path(file_source["path"]), options)
  return {"parseOptions": parsing_options, "tables": export_list}

def parse_file(file_path, parse_options=None):
  """
  Reads a file path and parse options that are passed in using ActiveDoc.importFile()
  and returns a tuple with parsing options (users' or guessed) and an object formatted so that
  it can be used by grist for a bulk add records action.
  """
  parse_options = parse_options or {}

  with codecs.open(file_path, "rb") as f:
    sample = f.read(100000)
  encoding = chardet.detect(sample)['encoding'] or "utf8"
  # In addition, always prefer UTF8 over ASCII.
  if encoding == 'ascii':
    encoding = 'utf8'
  log.info("Using encoding %s" % encoding)

  with codecs.open(file_path, mode="r", encoding=encoding) as f:
    parsing_options, export_list = _parse_open_file(f, parse_options=parse_options)
    return parsing_options, export_list


def _guess_dialect(file_obj):
  try:
    # Restrict allowed delimiters to prevent guessing other char than this list.
    dialect = csv.Sniffer().sniff(file_obj.read(100000), delimiters=['\t', ',', ';', '|'])
    log.info("Guessed dialect %s" % dict(dialect.__dict__))
    return dialect
  except csv.Error:
    log.info("Cannot guess dialect using Excel as fallback.")
    return csv.excel
  finally:
    file_obj.seek(0)

def _parse_open_file(file_obj, parse_options=None):
  csv_keys = ['delimiter', 'quotechar', 'lineterminator', 'doublequote', 'skipinitialspace']
  options = {}
  dialect = _guess_dialect(file_obj)

  csv_options = {}
  for key in csv_keys:
    value = parse_options.get(key, getattr(dialect, key, None))
    if value is not None:
      csv_options[key] = value

  reader = csv.reader(file_obj, **csv_options)

  rows = list(reader)
  sample_len = 100
  sample_rows = rows[:sample_len]
  data_offset, headers = import_utils.headers_guess(sample_rows)

  # Make sure all header values are strings.
  for i, header in enumerate(headers):
    if not isinstance(header, six.string_types):
      headers[i] = six.text_type(header)

  log.info("Guessed data_offset as %s", data_offset)
  log.info("Guessed headers as: %s", headers)

  have_guessed_headers = any(headers)
  include_col_names_as_headers = parse_options.get('include_col_names_as_headers',
                                                   have_guessed_headers)

  if include_col_names_as_headers and not have_guessed_headers:
    # use first line as headers
    data_offset, first_row = import_utils.find_first_non_empty_row(sample_rows)
    headers = import_utils.expand_headers(first_row, data_offset, sample_rows)

  elif not include_col_names_as_headers and have_guessed_headers:
    # move guessed headers to data
    data_offset -= 1
    headers = [''] * len(headers)

  rows = rows[data_offset:]
  num_rows = parse_options.get('NUM_ROWS', 0)
  table_data_with_types = parse_data.get_table_data(rows, len(headers), num_rows)

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
    log.info("No data found. Aborting CSV import.")
    # Don't add tables with no columns.
    return {}, []

  guessed = reader.dialect
  quoting = parse_options.get('quoting')
  options = {"delimiter": parse_options.get('delimiter', guessed.delimiter),
             "doublequote": parse_options.get('doublequote', guessed.doublequote),
             "lineterminator": parse_options.get('lineterminator', guessed.lineterminator),
             "quotechar": parse_options.get('quotechar', guessed.quotechar),
             "skipinitialspace": parse_options.get('skipinitialspace', guessed.skipinitialspace),
             "include_col_names_as_headers": include_col_names_as_headers,
             "start_with_row": 1,
             "NUM_ROWS": num_rows,
             "SCHEMA": SCHEMA
             }

  log.info("Output table with %d columns", len(column_metadata))
  for c in column_metadata:
    log.debug("Output column %s", c)

  export_list = [{
    "table_name": None,
    "column_metadata": column_metadata,
    "table_data": table_data
  }]

  return options, export_list

def get_version():
  """ Return name and version of plug-in"""
  pass
