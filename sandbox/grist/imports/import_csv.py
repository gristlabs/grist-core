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
log.setLevel(logging.INFO)

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
          },
          {
            'name': 'encoding',
            'label': 'Character encoding. See https://tinyurl.com/py3codecs',
            'type': 'string',
            'visible': True,
          }
          ]

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

  given_encoding = parse_options.get('encoding')
  encoding = given_encoding or detect_encoding(file_path)
  log.info("Using encoding %s (%s)", encoding, "given" if given_encoding else "detected")

  try:
    return _parse_with_encoding(file_path, parse_options, encoding)
  except Exception as e:
    encoding = 'utf-8'
    # For valid encodings, we can do our best and report count of errors. But an invalid encoding
    # or one with a BOM will produce an exception. For those, fall back to utf-8.
    parsing_options, export_list = _parse_with_encoding(file_path, parse_options, encoding)
    parsing_options["WARNING"] = "{}: {}. Falling back to {}.\n{}".format(
        type(e).__name__, e, encoding, parsing_options.get("WARNING", ""))
    return parsing_options, export_list


def _parse_with_encoding(file_path, parse_options, encoding):
  codec_errors = CodecErrorsReplace()
  codecs.register_error('custom', codec_errors)
  with codecs.open(file_path, mode="r", encoding=encoding, errors="custom") as f:
    parsing_options, export_list = _parse_open_file(f, parse_options=parse_options)
    parsing_options["encoding"] = encoding
    if codec_errors.error_count:
      parsing_options["WARNING"] = (
          "Using encoding %s, encountered %s errors. Use Import Options to change" %
          (encoding, codec_errors.error_count))
    return parsing_options, export_list


def _guess_dialect(file_obj):
  try:
    # Restrict allowed delimiters to prevent guessing other char than this list.
    dialect = csv.Sniffer().sniff(file_obj.read(100000), delimiters=['\t', ',', ';', '|'])
    log.info("Guessed dialect %s", dict(dialect.__dict__))
    # Mimic messytables default for now.
    dialect.lineterminator = "\n"
    dialect.doublequote = True
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


class CodecErrorsReplace(object):
  def __init__(self):
    self.error_count = 0
    self.first_error = None

  def __call__(self, error):
    self.error_count += 1
    if not self.first_error:
      self.first_error = error
    return codecs.replace_errors(error)


def detect_encoding(file_path):
  # Use line-by-line detection as suggested in
  # https://chardet.readthedocs.io/en/latest/usage.html#advanced-usage.
  # Using a fixed-sized sample is worse as the sample may end mid-character.
  detector = chardet.UniversalDetector()
  with codecs.open(file_path, "rb") as f:
    for line in f.readlines():
      detector.feed(line)
      if detector.done:
        break
  detector.close()
  encoding = detector.result["encoding"]
  # Default to utf-8, and always prefer it over ASCII as the most common superset.
  if not encoding or encoding == 'ascii':
    encoding = 'utf-8'
  return encoding
