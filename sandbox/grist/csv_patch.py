import re
import csv
from functools import reduce

# Monkey-patch csv.Sniffer class, in which the quote/delimiter detection has silly bugs in the
# regexp that it uses. It also seems poorly-implemented in other ways. We can probably do better
# by not using csv.Sniffer at all.
# The method below is a modified copy of the same-named method in the standard csv.Sniffer class.
def _guess_quote_and_delimiter(_self, data, delimiters):
  """
  Looks for text enclosed between two identical quotes
  (the probable quotechar) which are preceded and followed
  by the same character (the probable delimiter).
  For example:
           ,'some text',
  The quote with the most wins, same with the delimiter.
  If there is no quotechar the delimiter can't be determined
  this way.
  """

  regexp = re.compile(
    r"""
    (?:(?P<delim>[^\w\n"\'])|^|\n)  # delimiter or start-of-line
    (?P<space>\ ?)           # optional initial space
    (?P<quote>["\']).*?(?P=quote)   # quote-surrounded field
    (?:(?P=delim)|$|\r?\n)      # delimiter or end-of-line
    """, re.VERBOSE | re.DOTALL | re.MULTILINE)
  matches = regexp.findall(data)

  if not matches:
    # (quotechar, doublequote, delimiter, skipinitialspace)
    return ('', False, None, 0)
  quotes = {}
  delims = {}
  spaces = 0
  for m in matches:
    n = regexp.groupindex['quote'] - 1
    key = m[n]
    if key:
      quotes[key] = quotes.get(key, 0) + 1
    try:
      n = regexp.groupindex['delim'] - 1
      key = m[n]
    except KeyError:
      continue
    if key and (delimiters is None or key in delimiters):
      delims[key] = delims.get(key, 0) + 1
    try:
      n = regexp.groupindex['space'] - 1
    except KeyError:
      continue
    if m[n]:
      spaces += 1

  quotechar = reduce(lambda a, b, _quotes = quotes:
             (_quotes[a] > _quotes[b]) and a or b, quotes.keys())

  if delims:
    delim = reduce(lambda a, b, _delims = delims:
             (_delims[a] > _delims[b]) and a or b, delims.keys())
    skipinitialspace = delims[delim] == spaces
    if delim == '\n': # most likely a file with a single column
      delim = ''
  else:
    # there is *no* delimiter, it's a single column of quoted data
    delim = ''
    skipinitialspace = 0

  # if we see an extra quote between delimiters, we've got a
  # double quoted format
  dq_regexp = re.compile(
               (r"((%(delim)s)|^)\W*%(quote)s[^%(delim)s\n]*%(quote)" +
                r"s[^%(delim)s\n]*%(quote)s\W*((%(delim)s)|$)") % \
               {'delim':re.escape(delim), 'quote':quotechar}, re.MULTILINE)



  if dq_regexp.search(data):
    doublequote = True
  else:
    doublequote = False

  return (quotechar, doublequote, delim, skipinitialspace)

csv.Sniffer._guess_quote_and_delimiter = _guess_quote_and_delimiter
