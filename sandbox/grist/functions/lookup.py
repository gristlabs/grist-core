# pylint: disable=redefined-builtin, line-too-long

def ADDRESS(row, column, absolute_relative_mode, use_a1_notation, sheet):
  """Returns a cell reference as a string."""
  raise NotImplementedError()

def CHOOSE(index, choice1, choice2):
  """Returns an element from a list of choices based on index."""
  raise NotImplementedError()

def COLUMN(cell_reference=None):
  """Returns the column number of a specified cell, with `A=1`."""
  raise NotImplementedError()

def COLUMNS(range):
  """Returns the number of columns in a specified array or range."""
  raise NotImplementedError()

def GETPIVOTDATA(value_name, any_pivot_table_cell, original_column_1, pivot_item_1=None, *args):
  """Extracts an aggregated value from a pivot table that corresponds to the specified row and column headings."""
  raise NotImplementedError()

def HLOOKUP(search_key, range, index, is_sorted):
  """Horizontal lookup. Searches across the first row of a range for a key and returns the value of a specified cell in the column found."""
  raise NotImplementedError()

def HYPERLINK(url, link_label):
  """Creates a hyperlink inside a cell."""
  raise NotImplementedError()

def INDEX(reference, row, column):
  """Returns the content of a cell, specified by row and column offset."""
  raise NotImplementedError()

def INDIRECT(cell_reference_as_string):
  """Returns a cell reference specified by a string."""
  raise NotImplementedError()

def LOOKUP(search_key, search_range_or_search_result_array, result_range=None):
  """Looks through a row or column for a key and returns the value of the cell in a result range located in the same position as the search row or column."""
  raise NotImplementedError()

def MATCH(search_key, range, search_type):
  """Returns the relative position of an item in a range that matches a specified value."""
  raise NotImplementedError()

def OFFSET(cell_reference, offset_rows, offset_columns, height, width):
  """Returns a range reference shifted a specified number of rows and columns from a starting cell reference."""
  raise NotImplementedError()

def ROW(cell_reference):
  """Returns the row number of a specified cell."""
  raise NotImplementedError()

def ROWS(range):
  """Returns the number of rows in a specified array or range."""
  raise NotImplementedError()

def VLOOKUP(table, **field_value_pairs):
  """
  Vertical lookup. Searches the given table for a record matching the given `field=value`
  arguments. If multiple records match, returns one of them. If none match, returns the special
  empty record.

  The returned object is a record whose fields are available using `.field` syntax. For example,
  `VLOOKUP(Employees, EmployeeID=$EmpID).Salary`.

  Note that `VLOOKUP` isn't commonly needed in Grist, since [Reference columns](col-refs) are the
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
