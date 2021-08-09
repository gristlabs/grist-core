"""
Plugin for importing CSV files
"""
import os
import logging

import chardet
import messytables
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

  with open(file_path, "rb") as f:
    parsing_options, export_list = _parse_open_file(f, parse_options=parse_options)
    return parsing_options, export_list


def _parse_open_file(file_obj, parse_options=None):
  options = {}
  csv_keys = ['delimiter', 'quotechar', 'lineterminator', 'doublequote', 'skipinitialspace']
  csv_options = {k: parse_options.get(k) for k in csv_keys}
  if six.PY2:
    csv_options = {k: v.encode('utf8') if isinstance(v, six.text_type) else v
                   for k, v in csv_options.items()}

  table_set = messytables.CSVTableSet(file_obj,
                                      delimiter=csv_options['delimiter'],
                                      quotechar=csv_options['quotechar'],
                                      lineterminator=csv_options['lineterminator'],
                                      doublequote=csv_options['doublequote'],
                                      skipinitialspace=csv_options['skipinitialspace'])

  num_rows = parse_options.get('NUM_ROWS', 0)

  # Messytable's encoding detection uses too small a sample, so we override it here.
  sample = file_obj.read(100000)
  table_set.encoding = chardet.detect(sample)['encoding']
  # In addition, always prefer UTF8 over ASCII.
  if table_set.encoding == 'ascii':
    table_set.encoding = 'utf8'

  export_list = []
  # A table set is a collection of tables:
  for row_set in table_set.tables:
    table_name = None
    sample_rows = list(row_set.sample)
    # Messytables doesn't guess whether headers are present, so we need to step in.
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

    row_set.register_processor(messytables.offset_processor(data_offset))

    table_data_with_types = parse_data.get_table_data(row_set, len(headers), num_rows)

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

    guessed = row_set._dialect
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

    log.info("Output table %r with %d columns", table_name, len(column_metadata))
    for c in column_metadata:
      log.debug("Output column %s", c)
    export_list.append({
      "table_name": table_name,
      "column_metadata": column_metadata,
      "table_data": table_data
    })

  return options, export_list

def get_version():
  """ Return name and version of plug-in"""
  pass
