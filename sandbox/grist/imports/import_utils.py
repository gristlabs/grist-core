"""
Helper functions for import plugins
"""
import itertools
import logging
import os
from collections import defaultdict

import six
from six.moves import zip

if six.PY2:
  raise RuntimeError("Imports should use a Python 3 environment")


log = logging.getLogger(__name__)

def column_count_modal(rows):
  """ Return the modal value of columns in the row_set's
  sample. This can be assumed to be the number of columns
  of the table. """
  counts = defaultdict(int)
  for row in rows:
    length = len([c for c in row if not empty(c)])
    if length > 1:
      counts[length] += 1
  if not counts:
    return 0
  return max(list(counts.items()), key=lambda k_v: k_v[1])[0]



def empty(value):
  """ Stringify the value and check that it has a length. """
  if value is None:
    return True
  if not isinstance(value, six.string_types):
    value = six.text_type(value)
  return not value.strip()

# Get path to an imported file.
def get_path(file_source):
  importdir = os.environ.get('IMPORTDIR') or '/importdir'
  return os.path.join(importdir, file_source)

def capitalize(word):
  """Capitalize the first character in the word (without lowercasing the rest)."""
  return word[0].capitalize() + word[1:]

def _is_numeric(text):
  for t in six.integer_types + (float,):
    try:
      t(text)
      return True
    except (ValueError, OverflowError, TypeError):
      pass
  return False


def _is_header(header, data_rows):
  """
  Returns whether header can be considered a legitimate header for data_rows.
  """
  # See if the row has any non-text values.
  for cell in header:
    if not (isinstance(cell, six.string_types) or cell is None) or _is_numeric(cell):
      return False


  # If it's all text, see if the values in the first row repeat in other rows. That's uncommon for
  # a header.
  for row in data_rows:
    for cell, header_cell in zip(row, header):
      if cell and cell == header_cell:
        return False

  return True

def _count_nonempty(row):
  """
  Returns the count of cells in row, ignoring trailing empty cells.
  """
  count = 0
  for i, c in enumerate(row):
    if not empty(c):
      count = i + 1
  return count


def find_first_non_empty_row(rows):
  """
  Returns (data_offset, header) of the first row with non-empty fields
  or (0, []) if there are no non-empty rows.
  """
  tolerance = 1
  modal = column_count_modal(rows)
  for i, row in enumerate(rows):
    length = _count_nonempty(row)
    if length >= modal - tolerance:
      return i + 1, row
  # No non-empty rows.
  return 0, []


def expand_headers(headers, data_offset, rows):
  """
  Returns expanded header to have enough columns for all rows in the given sample.
  """
  row_length = max(itertools.chain([len(headers)],
                                   (_count_nonempty(r) for r in itertools.islice(rows, data_offset,
                                                                                 None))))
  header_values = [h.strip() if h else '' for h in headers] + [u''] * (row_length - len(headers))
  return header_values


def headers_guess(rows):
  """
  Our own smarter version of messytables.headers_guess, which also guesses as to whether one of
  the first rows is in fact a header. Returns (data_offset, headers) where data_offset is the
  index of the first line of data, and headers is the list of guessed headers (which will contain
  empty strings if the file had no headers).
  """
  # Messytables guesses at the length of data rows, and then assumes that the first row that has
  # close to that many non-empty fields is the header, where by "close" it means 1 less.
  #
  # For Grist, it's better to mistake headers for data than to mistake data for headers. Note that
  # there is csv.Sniffer().has_header(), which tries to be clever, but it's messes up too much.
  #
  # We only consider for the header the first row with non-empty cells. It is a header if
  #   - it has no non-text fields
  #   - none of the fields have a value that repeats in that column of data

  # Find the first row with non-empty fields.
  data_offset, header = find_first_non_empty_row(rows)
  if not header:
    return data_offset, header

  # Let's see if row is really a header.
  if not _is_header(header, itertools.islice(rows, data_offset, None)):
    data_offset -= 1
    header = []

  # Expand header to have enough columns for all rows in the given sample.
  header_values = expand_headers(header, data_offset, rows)

  return data_offset, header_values
