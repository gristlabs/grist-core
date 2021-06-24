# -*- coding: UTF-8 -*-

import datetime
import numbers
import re

import dateutil.parser
import six
from six import unichr
from six.moves import xrange

from usertypes import AltText  # pylint: disable=import-error
from .unimplemented import unimplemented


def CHAR(table_number):
  """
  Convert a number into a character according to the current Unicode table.
  Same as `unichr(number)`.

  >>> CHAR(65)
  u'A'
  >>> CHAR(33)
  u'!'
  """
  return unichr(table_number)


# See http://stackoverflow.com/a/93029/328565
_control_chars = ''.join(map(unichr, list(xrange(0,32)) + list(xrange(127,160))))
_control_char_re = re.compile('[%s]' % re.escape(_control_chars))

def CLEAN(text):
  """
  Returns the text with the non-printable characters removed.

  This removes both characters with values 0 through 31, and other Unicode characters in the
  "control characters" category.

  >>> CLEAN(CHAR(9) + "Monthly report" + CHAR(10))
  u'Monthly report'
  """
  return _control_char_re.sub('', text)


def CODE(string):
  """
  Returns the numeric Unicode map value of the first character in the string provided.
  Same as `ord(string[0])`.

  >>> CODE("A")
  65
  >>> CODE("!")
  33
  >>> CODE("!A")
  33
  """
  return ord(string[0])


def CONCATENATE(string, *more_strings):
  u"""
  Joins together any number of text strings into one string. Also available under the name
  `CONCAT`. Similar to the Python expression `"".join(array_of_strings)`.

  >>> CONCATENATE("Stream population for ", "trout", " ", "species", " is ", 32, "/mile.")
  u'Stream population for trout species is 32/mile.'
  >>> CONCATENATE("In ", 4, " days it is ", datetime.date(2016,1,1))
  u'In 4 days it is 2016-01-01'
  >>> CONCATENATE("abc")
  u'abc'
  >>> CONCATENATE(0, "abc")
  u'0abc'
  >>> assert CONCATENATE(2, u" crème ", u"brûlée") == u'2 crème brûlée'
  >>> assert CONCATENATE(2,  " crème ", u"brûlée") == u'2 crème brûlée'
  >>> assert CONCATENATE(2,  " crème ",  "brûlée") == u'2 crème brûlée'
  """
  return u''.join(
    val.decode('utf8') if isinstance(val, six.binary_type) else
    six.text_type(val)
    for val in (string,) + more_strings
  )


def CONCAT(string, *more_strings):
  """
  Joins together any number of text strings into one string. Also available under the name
  `CONCATENATE`. Similar to the Python expression `"".join(array_of_strings)`.

  >>> CONCAT("Stream population for ", "trout", " ", "species", " is ", 32, "/mile.")
  u'Stream population for trout species is 32/mile.'
  >>> CONCAT("In ", 4, " days it is ", datetime.date(2016,1,1))
  u'In 4 days it is 2016-01-01'
  >>> CONCAT("abc")
  u'abc'
  >>> CONCAT(0, "abc")
  u'0abc'
  >>> assert CONCAT(2, u" crème ", u"brûlée") == u'2 crème brûlée'
  """
  return CONCATENATE(string, *more_strings)


def DOLLAR(number, decimals=2):
  """
  Formats a number into a formatted dollar amount, with decimals rounded to the specified place (.
  If decimals value is omitted, it defaults to 2.

  >>> DOLLAR(1234.567)
  '$1,234.57'
  >>> DOLLAR(1234.567, -2)
  '$1,200'
  >>> DOLLAR(-1234.567, -2)
  '($1,200)'
  >>> DOLLAR(-0.123, 4)
  '($0.1230)'
  >>> DOLLAR(99.888)
  '$99.89'
  >>> DOLLAR(0)
  '$0.00'
  >>> DOLLAR(10, 0)
  '$10'
  """
  formatted = "${:,.{}f}".format(round(abs(number), decimals), max(0, decimals))
  return formatted if number >= 0 else "(" + formatted + ")"


def EXACT(string1, string2):
  """
  Tests whether two strings are identical. Same as `string2 == string2`.

  >>> EXACT("word", "word")
  True
  >>> EXACT("Word", "word")
  False
  >>> EXACT("w ord", "word")
  False
  """
  return string1 == string2


def FIND(find_text, within_text, start_num=1):
  """
  Returns the position at which a string is first found within text.

  Find is case-sensitive. The returned position is 1 if within_text starts with find_text.
  Start_num specifies the character at which to start the search, defaulting to 1 (the first
  character of within_text).

  If find_text is not found, or start_num is invalid, raises ValueError.

  >>> FIND("M", "Miriam McGovern")
  1
  >>> FIND("m", "Miriam McGovern")
  6
  >>> FIND("M", "Miriam McGovern", 3)
  8
  >>> FIND(" #", "Hello world # Test")
  12
  >>> FIND("gle", "Google", 1)
  4
  >>> FIND("GLE", "Google", 1)
  Traceback (most recent call last):
  ...
  ValueError: substring not found
  >>> FIND("page", "homepage")
  5
  >>> FIND("page", "homepage", 6)
  Traceback (most recent call last):
  ...
  ValueError: substring not found
  """
  return within_text.index(find_text, start_num - 1) + 1


def FIXED(number, decimals=2, no_commas=False):
  """
  Formats a number with a fixed number of decimal places (2 by default), and commas.
  If no_commas is True, then omits the commas.

  >>> FIXED(1234.567, 1)
  '1,234.6'
  >>> FIXED(1234.567, -1)
  '1,230'
  >>> FIXED(-1234.567, -1, True)
  '-1230'
  >>> FIXED(44.332)
  '44.33'
  >>> FIXED(3521.478, 2, False)
  '3,521.48'
  >>> FIXED(-3521.478, 1, True)
  '-3521.5'
  >>> FIXED(3521.478, 0, True)
  '3521'
  >>> FIXED(3521.478, -2, True)
  '3500'
  """
  comma_flag = '' if no_commas else ','
  return "{:{}.{}f}".format(round(number, decimals), comma_flag, max(0, decimals))


def LEFT(string, num_chars=1):
  """
  Returns a substring of length num_chars from the beginning of the given string. If num_chars is
  omitted, it is assumed to be 1. Same as `string[:num_chars]`.

  >>> LEFT("Sale Price", 4)
  'Sale'
  >>> LEFT('Swededn')
  'S'
  >>> LEFT('Text', -1)
  Traceback (most recent call last):
  ...
  ValueError: num_chars invalid
  """
  if num_chars < 0:
    raise ValueError("num_chars invalid")
  return string[:num_chars]


def LEN(text):
  """
  Returns the number of characters in a text string. Same as `len(text)`.

  >>> LEN("Phoenix, AZ")
  11
  >>> LEN("")
  0
  >>> LEN("     One   ")
  11
  """
  return len(text)


def LOWER(text):
  """
  Converts a specified string to lowercase. Same as `text.lower()`.

  >>> LOWER("E. E. Cummings")
  'e. e. cummings'
  >>> LOWER("Apt. 2B")
  'apt. 2b'
  """
  return text.lower()


def MID(text, start_num, num_chars):
  """
  Returns a segment of a string, starting at start_num. The first character in text has
  start_num 1.

  >>> MID("Fluid Flow", 1, 5)
  'Fluid'
  >>> MID("Fluid Flow", 7, 20)
  'Flow'
  >>> MID("Fluid Flow", 20, 5)
  ''
  >>> MID("Fluid Flow", 0, 5)
  Traceback (most recent call last):
  ...
  ValueError: start_num invalid
  """
  if start_num < 1:
    raise ValueError("start_num invalid")
  return text[start_num - 1 : start_num - 1 + num_chars]


def PROPER(text):
  """
  Capitalizes each word in a specified string. It converts the first letter of each word to
  uppercase, and all other letters to lowercase. Same as `text.title()`.

  >>> PROPER('this is a TITLE')
  'This Is A Title'
  >>> PROPER('2-way street')
  '2-Way Street'
  >>> PROPER('76BudGet')
  '76Budget'
  """
  return text.title()


def REGEXEXTRACT(text, regular_expression):
  """
  Extracts the first part of text that matches regular_expression.

  >>> REGEXEXTRACT("Google Doc 101", "[0-9]+")
  '101'
  >>> REGEXEXTRACT("The price today is $826.25", "[0-9]*\\.[0-9]+[0-9]+")
  '826.25'

  If there is a parenthesized expression, it is returned instead of the whole match.
  >>> REGEXEXTRACT("(Content) between brackets", "\\(([A-Za-z]+)\\)")
  'Content'
  >>> REGEXEXTRACT("Foo", "Bar")
  Traceback (most recent call last):
  ...
  ValueError: REGEXEXTRACT text does not match
  """
  m = re.search(regular_expression, text)
  if not m:
    raise ValueError("REGEXEXTRACT text does not match")
  return m.group(1) if m.lastindex else m.group(0)


def REGEXMATCH(text, regular_expression):
  """
  Returns whether a piece of text matches a regular expression.

  >>> REGEXMATCH("Google Doc 101", "[0-9]+")
  True
  >>> REGEXMATCH("Google Doc", "[0-9]+")
  False
  >>> REGEXMATCH("The price today is $826.25", "[0-9]*\\.[0-9]+[0-9]+")
  True
  >>> REGEXMATCH("(Content) between brackets", "\\(([A-Za-z]+)\\)")
  True
  >>> REGEXMATCH("Foo", "Bar")
  False
  """
  return bool(re.search(regular_expression, text))


def REGEXREPLACE(text, regular_expression, replacement):
  """
  Replaces all parts of text matching the given regular expression with replacement text.

  >>> REGEXREPLACE("Google Doc 101", "[0-9]+", "777")
  'Google Doc 777'
  >>> REGEXREPLACE("Google Doc", "[0-9]+", "777")
  'Google Doc'
  >>> REGEXREPLACE("The price is $826.25", "[0-9]*\\.[0-9]+[0-9]+", "315.75")
  'The price is $315.75'
  >>> REGEXREPLACE("(Content) between brackets", "\\(([A-Za-z]+)\\)", "Word")
  'Word between brackets'
  >>> REGEXREPLACE("Foo", "Bar", "Baz")
  'Foo'
  """
  return re.sub(regular_expression, replacement, text)


def REPLACE(old_text, start_num, num_chars, new_text):
  """
  Replaces part of a text string with a different text string. Start_num is counted from 1.

  >>> REPLACE("abcdefghijk", 6, 5, "*")
  'abcde*k'
  >>> REPLACE("2009", 3, 2, "10")
  '2010'
  >>> REPLACE('123456', 1, 3, '@')
  '@456'
  >>> REPLACE('foo', 1, 0, 'bar')
  'barfoo'
  >>> REPLACE('foo', 0, 1, 'bar')
  Traceback (most recent call last):
  ...
  ValueError: start_num invalid
  """
  if start_num < 1:
    raise ValueError("start_num invalid")
  return old_text[:start_num - 1] + new_text + old_text[start_num - 1 + num_chars:]


def REPT(text, number_times):
  """
  Returns specified text repeated a number of times. Same as `text * number_times`.

  The result of the REPT function cannot be longer than 32767 characters, or it raises a
  ValueError.

  >>> REPT("*-", 3)
  '*-*-*-'
  >>> REPT('-', 10)
  '----------'
  >>> REPT('-', 0)
  ''
  >>> len(REPT('---', 10000))
  30000
  >>> REPT('---', 11000)
  Traceback (most recent call last):
  ...
  ValueError: number_times invalid
  >>> REPT('-', -1)
  Traceback (most recent call last):
  ...
  ValueError: number_times invalid
  """
  if number_times < 0 or len(text) * number_times > 32767:
    raise ValueError("number_times invalid")
  return text * int(number_times)


def RIGHT(string, num_chars=1):
  """
  Returns a substring of length num_chars from the end of a specified string. If num_chars is
  omitted, it is assumed to be 1. Same as `string[-num_chars:]`.

  >>> RIGHT("Sale Price", 5)
  'Price'
  >>> RIGHT('Stock Number')
  'r'
  >>> RIGHT('Text', 100)
  'Text'
  >>> RIGHT('Text', -1)
  Traceback (most recent call last):
  ...
  ValueError: num_chars invalid
  """
  if num_chars < 0:
    raise ValueError("num_chars invalid")
  return string[-num_chars:]


def SEARCH(find_text, within_text, start_num=1):
  """
  Returns the position at which a string is first found within text, ignoring case.

  Find is case-sensitive. The returned position is 1 if within_text starts with find_text.
  Start_num specifies the character at which to start the search, defaulting to 1 (the first
  character of within_text).

  If find_text is not found, or start_num is invalid, raises ValueError.
  >>> SEARCH("e", "Statements", 6)
  7
  >>> SEARCH("margin", "Profit Margin")
  8
  >>> SEARCH(" ", "Profit Margin")
  7
  >>> SEARCH('"', 'The "boss" is here.')
  5
  >>> SEARCH("gle", "Google")
  4
  >>> SEARCH("GLE", "Google")
  4
  """
  # .lower() isn't always correct for unicode. See http://stackoverflow.com/a/29247821/328565
  return within_text.lower().index(find_text.lower(), start_num - 1) + 1


def SUBSTITUTE(text, old_text, new_text, instance_num=None):
  u"""
  Replaces existing text with new text in a string. It is useful when you know the substring of
  text to replace. Use REPLACE when you know the position of text to replace.

  If instance_num is given, it specifies which occurrence of old_text to replace. If omitted, all
  occurrences are replaced.

  Same as `text.replace(old_text, new_text)` when instance_num is omitted.

  >>> SUBSTITUTE("Sales Data", "Sales", "Cost")
  u'Cost Data'
  >>> SUBSTITUTE("Quarter 1, 2008", "1", "2", 1)
  u'Quarter 2, 2008'
  >>> SUBSTITUTE("Quarter 1, 2011", "1", "2", 3)
  u'Quarter 1, 2012'

  More tests:
  >>> SUBSTITUTE("Hello world", "", "-")
  u'Hello world'
  >>> SUBSTITUTE("Hello world", " ", "-")
  u'Hello-world'
  >>> SUBSTITUTE("Hello world", " ", 12.1)
  u'Hello12.1world'
  >>> SUBSTITUTE(u"Hello world", u" ", 12.1)
  u'Hello12.1world'
  >>> SUBSTITUTE("Hello world", "world", "")
  u'Hello '
  >>> SUBSTITUTE("Hello", "world", "")
  u'Hello'

  Overlapping matches are all counted when looking for instance_num.
  >>> SUBSTITUTE('abababab', 'abab', 'xxxx')
  u'xxxxxxxx'
  >>> SUBSTITUTE('abababab', 'abab', 'xxxx', 1)
  u'xxxxabab'
  >>> SUBSTITUTE('abababab', 'abab', 'xxxx', 2)
  u'abxxxxab'
  >>> SUBSTITUTE('abababab', 'abab', 'xxxx', 3)
  u'ababxxxx'
  >>> SUBSTITUTE('abababab', 'abab', 'xxxx', 4)
  u'abababab'
  >>> SUBSTITUTE('abababab', 'abab', 'xxxx', 0)
  Traceback (most recent call last):
  ...
  ValueError: instance_num invalid
  >>> SUBSTITUTE( "crème",  "è", "e")
  u'creme'
  >>> SUBSTITUTE(u"crème", u"è", "e")
  u'creme'
  >>> SUBSTITUTE(u"crème",  "è", "e")
  u'creme'
  >>> SUBSTITUTE( "crème", u"è", "e")
  u'creme'
  """
  text = six.text_type(text)
  old_text = six.text_type(old_text)
  new_text = six.text_type(new_text)

  if not old_text:
    return text

  if instance_num is None:
    return text.replace(old_text, new_text)

  if instance_num <= 0:
    raise ValueError("instance_num invalid")

  # No trivial way to replace nth occurrence.
  i = -1
  for c in xrange(instance_num):
    i = text.find(old_text, i + 1)
    if i < 0:
      return text
  return text[:i] + new_text + text[i + len(old_text):]


def T(value):
  """
  Returns value if value is text, or the empty string when value is not text.

  >>> T('Text')
  u'Text'
  >>> T(826)
  u''
  >>> T('826')
  u'826'
  >>> T(False)
  u''
  >>> T('100 points')
  u'100 points'
  >>> T(AltText('Text'))
  u'Text'
  >>> T(float('nan'))
  u''
  """
  return (value.decode('utf8') if isinstance(value, six.binary_type) else
          value if isinstance(value, six.text_type) else
          six.text_type(value) if isinstance(value, AltText) else u"")


@unimplemented
def TEXT(number, format_type):
  """
  Converts a number into text according to a specified format. It is not yet implemented in
  Grist.
  """
  raise NotImplementedError()


_trim_re = re.compile(r'  +')

def TRIM(text):
  """
  Removes all spaces from text except for single spaces between words. Note that TRIM does not
  remove other whitespace such as tab or newline characters.

  >>> TRIM(" First Quarter\\n    Earnings     ")
  'First Quarter\\n Earnings'
  >>> TRIM("")
  ''
  """
  return _trim_re.sub(' ', text.strip())


def UPPER(text):
  """
  Converts a specified string to uppercase. Same as `text.lower()`.

  >>> UPPER("e. e. cummings")
  'E. E. CUMMINGS'
  >>> UPPER("Apt. 2B")
  'APT. 2B'
  """
  return text.upper()


def VALUE(text):
  """
  Converts a string in accepted date, time or number formats into a number or date.

  >>> VALUE("$1,000")
  1000
  >>> assert VALUE("16:48:00") - VALUE("12:00:00") == datetime.timedelta(0, 17280)
  >>> VALUE("01/01/2012")
  datetime.datetime(2012, 1, 1, 0, 0)
  >>> VALUE("")
  0
  >>> VALUE(0)
  0
  >>> VALUE("826")
  826
  >>> VALUE("-826.123123123")
  -826.123123123
  >>> VALUE(float('nan'))
  nan
  >>> VALUE("Invalid")
  Traceback (most recent call last):
  ...
  ValueError: text cannot be parsed to a number
  >>> VALUE("13/13/13")
  Traceback (most recent call last):
  ...
  ValueError: text cannot be parsed to a number
  """
  # This is not particularly robust, but makes an attempt to handle a number of cases: numbers,
  # including optional comma separators, dates/times, leading dollar-sign.
  if isinstance(text, (numbers.Number, datetime.date)):
    return text
  text = text.strip().lstrip('$')
  nocommas = text.replace(',', '')
  if nocommas == "":
    return 0

  try:
    return int(nocommas)
  except ValueError:
    pass

  try:
    return float(nocommas)
  except ValueError:
    pass

  try:
    return dateutil.parser.parse(text)
  except ValueError:
    pass

  raise ValueError('text cannot be parsed to a number')
