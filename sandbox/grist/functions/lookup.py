# pylint: disable=redefined-builtin, line-too-long
from collections import OrderedDict, namedtuple
import os

import six
from six.moves import urllib_parse
from .unimplemented import unimplemented

@unimplemented
def ADDRESS(row, column, absolute_relative_mode, use_a1_notation, sheet):
  """Returns a cell reference as a string."""
  raise NotImplementedError()

@unimplemented
def CHOOSE(index, choice1, choice2):
  """Returns an element from a list of choices based on index."""
  raise NotImplementedError()

@unimplemented
def COLUMN(cell_reference=None):
  """Returns the column number of a specified cell, with `A=1`."""
  raise NotImplementedError()

@unimplemented
def COLUMNS(range):
  """Returns the number of columns in a specified array or range."""
  raise NotImplementedError()

@unimplemented
def GETPIVOTDATA(value_name, any_pivot_table_cell, original_column_1, pivot_item_1=None, *args):
  """Extracts an aggregated value from a pivot table that corresponds to the specified row and column headings."""
  raise NotImplementedError()

@unimplemented
def HLOOKUP(search_key, range, index, is_sorted):
  """Horizontal lookup. Searches across the first row of a range for a key and returns the value of a specified cell in the column found."""
  raise NotImplementedError()

@unimplemented
def HYPERLINK(url, link_label):
  """Creates a hyperlink inside a cell."""
  raise NotImplementedError()

@unimplemented
def INDEX(reference, row, column):
  """Returns the content of a cell, specified by row and column offset."""
  raise NotImplementedError()

@unimplemented
def INDIRECT(cell_reference_as_string):
  """Returns a cell reference specified by a string."""
  raise NotImplementedError()

@unimplemented
def LOOKUP(search_key, search_range_or_search_result_array, result_range=None):
  """Looks through a row or column for a key and returns the value of the cell in a result range located in the same position as the search row or column."""
  raise NotImplementedError()

@unimplemented
def MATCH(search_key, range, search_type):
  """Returns the relative position of an item in a range that matches a specified value."""
  raise NotImplementedError()

@unimplemented
def OFFSET(cell_reference, offset_rows, offset_columns, height, width):
  """Returns a range reference shifted a specified number of rows and columns from a starting cell reference."""
  raise NotImplementedError()

@unimplemented
def ROW(cell_reference):
  """Returns the row number of a specified cell."""
  raise NotImplementedError()

@unimplemented
def ROWS(range):
  """Returns the number of rows in a specified array or range."""
  raise NotImplementedError()

def SELF_HYPERLINK(label=None, page=None, **kwargs):
  """
  Creates a link to the current document.  All parameters are optional.

  The returned string is in URL format, optionally preceded by a label and a space
  (the format expected for Grist Text columns with the HyperLink option enabled).

  A numeric page number can be supplied, which will create a link to the
  specified page.  To find the numeric page number you need, visit a page
  and examine its URL for a `/p/NN` part.

  Any number of arguments of the form `LinkKey_NAME` may be provided, to set
  `user.LinkKey.NAME` values that will be available in access rules.  For example,
  if a rule allows users to view rows when `user.LinkKey.Code == rec.Code`,
  we might want to create links with `SELF_HYPERLINK(LinkKey_Code=$Code)`.

  >>> SELF_HYPERLINK()
  u'https://docs.getgrist.com/sbaltsirg/Example'
  >>> SELF_HYPERLINK(label='doc')
  u'doc https://docs.getgrist.com/sbaltsirg/Example'
  >>> SELF_HYPERLINK(page=2)
  u'https://docs.getgrist.com/sbaltsirg/Example/p/2'
  >>> SELF_HYPERLINK(LinkKey_Code='X1234')
  u'https://docs.getgrist.com/sbaltsirg/Example?Code_=X1234'
  >>> SELF_HYPERLINK(label='order', page=3, LinkKey_Code='X1234', LinkKey_Name='Bi Ngo')
  u'order https://docs.getgrist.com/sbaltsirg/Example/p/3?Code_=X1234&Name_=Bi+Ngo'
  >>> SELF_HYPERLINK(Linky_Link='Link')
  Traceback (most recent call last):
  ...
  TypeError: unexpected keyword argument 'Linky_Link' (not of form LinkKey_NAME)
  """
  txt = os.environ.get('DOC_URL')
  if not txt:
    return None
  txt = six.text_type(txt)
  if page:
    txt += "/p/{}".format(page)
  if kwargs:
    parts = list(urllib_parse.urlparse(txt))
    query = OrderedDict(urllib_parse.parse_qsl(parts[4]))
    for [key, value] in sorted(six.iteritems(kwargs)):
      key_parts = key.split('LinkKey_')
      if len(key_parts) == 2 and key_parts[0] == '':
        query[key_parts[1] + '_'] = value
      else:
        raise TypeError("unexpected keyword argument '{}' (not of form LinkKey_NAME)".format(key))
    parts[4] = urllib_parse.urlencode(query)
    txt = urllib_parse.urlunparse(parts)
  if label:
    txt = u"{} {}".format(label, txt)
  return txt

def VLOOKUP(table, **field_value_pairs):
  """
  Vertical lookup. Searches the given table for a record matching the given `field=value`
  arguments. If multiple records match, returns one of them. If none match, returns the special
  empty record.

  The returned object is a record whose fields are available using `.field` syntax. For example,
  `VLOOKUP(Employees, EmployeeID=$EmpID).Salary`.

  Note that `VLOOKUP` isn't commonly needed in Grist, since [Reference columns](col-refs.md) are the
  best way to link data between tables, and allow simple efficient usage such as `$Person.Age`.

  `VLOOKUP` is exactly quivalent to `table.lookupOne(**field_value_pairs)`. See
  [lookupOne](#lookupone).

  For example:
  ```
  VLOOKUP(People, First_Name="Lewis", Last_Name="Carroll")
  VLOOKUP(People, First_Name="Lewis", Last_Name="Carroll").Age
  ```
  """
  return table.lookupOne(**field_value_pairs)


class _NoMatchEmpty(object):
  """
  Singleton sentinel value for CONTAINS match_empty parameter to indicate no argument was passed
  and no value should match against empty lists in lookups.
  """
  def __repr__(self):
    return "no_match_empty"


class _Contains(namedtuple("_Contains", "value match_empty")):
  """
  Use this marker with [UserTable.lookupRecords](#lookuprecords) to find records
  where a field of a list type (such as `Choice List` or `Reference List`) contains the given value.

  For example:

      MoviesTable.lookupRecords(genre=CONTAINS("Drama"))

  will return records in `MoviesTable` where the column `genre`
  is a list or other container such as `["Comedy", "Drama"]`,
  i.e. `"Drama" in $genre`.

  Note that the column being looked up (e.g. `genre`)
  must have values of a container type such as list, tuple, or set.
  In particular the values mustn't be strings, e.g. `"Comedy-Drama"` won't match
  even though `"Drama" in "Comedy-Drama"` is `True` in Python.
  It also won't match substrings within container elements, e.g. `["Comedy-Drama"]`.

  You can optionally pass a second argument `match_empty` to indicate a value that
  should be matched against empty lists in the looked up column.

  For example, given this formula:

      MoviesTable.lookupRecords(genre=CONTAINS(g, match_empty=''))

  If `g` is `''` (i.e. equal to `match_empty`) then the column `genre` in the returned records
  will either be an empty list (or other container) or a list containing `g` as usual.
  """
  # While users should apply this marker to values in queries, internally
  # the marker is moved to the column ID so that the LookupMapColumn knows how to
  # update its index correctly for that column.
  # The _Contains class is used internally, especially with isinstance()
  # The CONTAINS function is for users
  # Having a function as the interface makes things like docs and autocomplete
  # work more consistently

  no_match_empty = _NoMatchEmpty()


def CONTAINS(value, match_empty=_Contains.no_match_empty):
  try:
    hash(match_empty)
  except TypeError:
    raise TypeError("match_empty must be hashable")

  return _Contains(value, match_empty)

CONTAINS.__doc__ = _Contains.__doc__
