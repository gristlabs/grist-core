# -*- coding: UTF-8 -*-
# pylint: disable=unused-argument

from __future__ import absolute_import
import datetime
import hashlib
import json as json_module
import math
import numbers
import re

import chardet
import six
from six.moves import urllib_parse

import column
import docmodel
from functions import date      # pylint: disable=import-error
from functions.unimplemented import unimplemented
from objtypes import CellError
from usertypes import AltText   # pylint: disable=import-error
from records import Record, RecordSet

@unimplemented
def ISBLANK(value):
  """
  Returns whether a value refers to an empty cell. It isn't implemented in Grist. To check for an
  empty string, use `value == ""`.
  """
  raise NotImplementedError()


def ISERR(value):
  """
  Checks whether a value is an error. In other words, it returns true
  if using `value` directly would raise an exception.

  NOTE: Grist implements this by automatically wrapping the argument to use lazy evaluation.

  A more Pythonic approach to checking for errors is:
  ```
  try:
    ... value ...
  except Exception, err:
    ... do something about the error ...
  ```

  For example:

  >>> ISERR("Hello")
  False

  More tests:
  >>> ISERR(lambda: (1/0.1))
  False
  >>> ISERR(lambda: (1/0.0))
  True
  >>> ISERR(lambda: "test".bar())
  True
  >>> ISERR(lambda: "test".upper())
  False
  >>> ISERR(lambda: AltText("A"))
  False
  >>> ISERR(lambda: float('nan'))
  False
  >>> ISERR(lambda: None)
  False
  """
  return lazy_value_or_error(value) is _error_sentinel


def ISERROR(value):
  """
  Checks whether a value is an error or an invalid value. It is similar to `ISERR`, but also
  returns true for an invalid value such as NaN or a text value in a Numeric column.

  NOTE: Grist implements this by automatically wrapping the argument to use lazy evaluation.

  >>> ISERROR("Hello")
  False
  >>> ISERROR(AltText("fail"))
  True
  >>> ISERROR(float('nan'))
  True

  More tests:
  >>> ISERROR(AltText(""))
  True
  >>> [ISERROR(v) for v in [0, None, "", "Test", 17.0]]
  [False, False, False, False, False]
  >>> ISERROR(lambda: (1/0.1))
  False
  >>> ISERROR(lambda: (1/0.0))
  True
  >>> ISERROR(lambda: "test".bar())
  True
  >>> ISERROR(lambda: "test".upper())
  False
  >>> ISERROR(lambda: AltText("A"))
  True
  >>> ISERROR(lambda: float('nan'))
  True
  >>> ISERROR(lambda: None)
  False
  """
  return is_error(lazy_value_or_error(value))


def ISLOGICAL(value):
  """
  Checks whether a value is `True` or `False`.

  >>> ISLOGICAL(True)
  True
  >>> ISLOGICAL(False)
  True
  >>> ISLOGICAL(0)
  False
  >>> ISLOGICAL(None)
  False
  >>> ISLOGICAL("Test")
  False
  """
  return isinstance(value, bool)


def ISNA(value):
  """
  Checks whether a value is the error `#N/A`.

  >>> ISNA(float('nan'))
  True
  >>> ISNA(0.0)
  False
  >>> ISNA('text')
  False
  >>> ISNA(float('-inf'))
  False
  """
  return isinstance(value, float) and math.isnan(value)


def ISNONTEXT(value):
  """
  Checks whether a value is non-textual.

  >>> ISNONTEXT("asdf")
  False
  >>> ISNONTEXT("")
  False
  >>> ISNONTEXT(AltText("text"))
  False
  >>> ISNONTEXT(17.0)
  True
  >>> ISNONTEXT(None)
  True
  >>> ISNONTEXT(datetime.date(2011, 1, 1))
  True
  """
  return not ISTEXT(value)


def ISNUMBER(value):
  """
  Checks whether a value is a number.

  >>> ISNUMBER(17)
  True
  >>> ISNUMBER(-123.123423)
  True
  >>> ISNUMBER(False)
  True
  >>> ISNUMBER(float('nan'))
  True
  >>> ISNUMBER(float('inf'))
  True
  >>> ISNUMBER('17')
  False
  >>> ISNUMBER(None)
  False
  >>> ISNUMBER(datetime.date(2011, 1, 1))
  False

  More tests:
  >>> ISNUMBER(AltText("text"))
  False
  >>> ISNUMBER('')
  False
  """
  return isinstance(value, numbers.Number)


def ISREF(value):
  """
  Checks whether a value is a table record.

  For example, if a column `person` is of type Reference to the `People` table,
  then `ISREF($person)` is `True`.
  Similarly, `ISREF(People.lookupOne(name=$name))` is `True`. For any other type of value,
  `ISREF()` would evaluate to `False`.

  >>> ISREF(17)
  False
  >>> ISREF("Roger")
  False

  """
  return isinstance(value, Record)


def ISREFLIST(value):
  """
  Checks whether a value is a [`RecordSet`](#recordset),
  the type of values in Reference List columns.

  For example, if a column `people` is of type Reference List to the `People` table,
  then `ISREFLIST($people)` is `True`.
  Similarly, `ISREFLIST(People.lookupRecords(name=$name))` is `True`. For any other type of value,
  `ISREFLIST()` would evaluate to `False`.

  >>> ISREFLIST(17)
  False
  >>> ISREFLIST("Roger")
  False

  """
  return isinstance(value, RecordSet)


def ISTEXT(value):
  """
  Checks whether a value is text.

  >>> ISTEXT("asdf")
  True
  >>> ISTEXT("")
  True
  >>> ISTEXT(AltText("text"))
  True
  >>> ISTEXT(17.0)
  False
  >>> ISTEXT(None)
  False
  >>> ISTEXT(datetime.date(2011, 1, 1))
  False
  """
  return isinstance(value, (six.string_types, AltText))


# Regexp for matching email. See ISEMAIL for justification.
_email_regexp = re.compile(
  r"""
  ^\w                             # Start with an alphanumeric character
  [\w%+/='-]*  (\.[\w%+/='-]+)*   # Elsewhere allow also a few other special characters
                                  # But no two consecutive periods
  @
  ([A-Za-z0-9]                    # Each part of hostname must start with alphanumeric
    ([A-Za-z0-9-]*[A-Za-z0-9])?\. # May have dashes inside, but end in alphanumeric
  )+
  [A-Za-z]{2,24}$                 # Restrict top-level domain to length {2,24} (theoretically,
                                  # the max length is 63 bytes as per RFC 1034). Google seems
                                  # to use a whitelist for TLDs longer than 2 characters.
  """, re.UNICODE | re.VERBOSE)


# Regexp for matching hostname part of URLs (see also ISURL). Duplicates part of _email_regexp.
_hostname_regexp = re.compile(
  r"""^
  ([A-Za-z0-9]                    # Each part of hostname must start with alphanumeric
    ([A-Za-z0-9-]*[A-Za-z0-9])?\. # May have dashes inside, but end in alphanumeric
  )+
  [A-Za-z]{2,6}$                  # Restrict top-level domain to length {2,6}. Google seems
  """, re.VERBOSE)


def ISEMAIL(value):
  u"""
  Returns whether a value is a valid email address.

  Note that checking email validity is not an exact science. The technical standard considers many
  email addresses valid that are not used in practice, and would not be considered valid by most
  users. Instead, we follow Google Sheets implementation, with some differences, noted below.

  >>> ISEMAIL("Abc.123@example.com")
  True
  >>> ISEMAIL("Bob_O-Reilly+tag@example.com")
  True
  >>> ISEMAIL("John Doe")
  False
  >>> ISEMAIL("john@aol...com")
  False

  More tests:                                             Google Sheets   Grist
                                                          -------------   -----
  >>> ISEMAIL("Abc@example.com")                              # True,     True
  True
  >>> ISEMAIL("Abc.123@example.com")                          # True,     True
  True
  >>> ISEMAIL("foo@bar.com")                                  # True,     True
  True
  >>> ISEMAIL("asdf@com.zt")                                  # True,     True
  True
  >>> ISEMAIL("Bob_O-Reilly+tag@example.com")                 # True,     True
  True
  >>> ISEMAIL("john@server.department.company.com")           # True,     True
  True
  >>> ISEMAIL("asdf@mail.ru")                                 # True,     True
  True
  >>> ISEMAIL("fabio@foo.qwer.COM")                           # True,     True
  True
  >>> ISEMAIL("user+mailbox/department=shipping@example.com") # False,    True
  True
  >>> ISEMAIL(u"user+mailbox/department=shipping@example.com") # False,    True
  True
  >>> ISEMAIL("customer/department=shipping@example.com")     # False,    True
  True
  >>> ISEMAIL("Bob_O'Reilly+tag@example.com")                 # False,    True
  True
  >>> ISEMAIL("marie@isola.corsica")                          # False,    True
  True
  >>> ISEMAIL("fabio@disapproved.solutions")                  # False,    True
  True
  >>> ISEMAIL(u"фыва@mail.ru")                                # False,    True
  True
  >>> ISEMAIL("my@baddash.-.com")                             # True,     False
  False
  >>> ISEMAIL("my@baddash.-a.com")                            # True,     False
  False
  >>> ISEMAIL("my@baddash.b-.com")                            # True,     False
  False
  >>> ISEMAIL("john@-.com")                                   # True,     False
  False
  >>> ISEMAIL("!def!xyz%abc@example.com")                     # False,    False
  False
  >>> ISEMAIL("!#$%&'*+-/=?^_`.{|}~@example.com")             # False,    False
  False
  >>> ISEMAIL(u"伊昭傑@郵件.商務")                             # False,    False
  False
  >>> ISEMAIL(u"राम@मोहन.ईन्फो")                                    # False,    Fale
  False
  >>> ISEMAIL(u"юзер@екзампл.ком")                             # False,    False
  False
  >>> ISEMAIL(u"θσερ@εχαμπλε.ψομ")                             # False,    False
  False
  >>> ISEMAIL(u"葉士豪@臺網中心.tw")                           # False,    False
  False
  >>> ISEMAIL(u"jeff@臺網中心.tw")                             # False,    False
  False
  >>> ISEMAIL(u"葉士豪@臺網中心.台灣")                         # False,    False
  False
  >>> ISEMAIL(u"jeff葉@臺網中心.tw")                           # False,    False
  False
  >>> ISEMAIL("my．name@domain.com")                          # False,    False
  False
  >>> ISEMAIL("my.name@domain．com")                          # False,    False
  False
  >>> ISEMAIL("my@.leadingdot.com")                           # False,    False
  False
  >>> ISEMAIL("my@．．leadingfwdot.com")                      # False,    False
  False
  >>> ISEMAIL("my@..twodots.com")                             # False,    False
  False
  >>> ISEMAIL("my@twodots..com")                              # False,    False
  False
  >>> ISEMAIL(".leadingdot@domain.com")                       # False,    False
  False
  >>> ISEMAIL("..twodots@domain.com")                         # False,    False
  False
  >>> ISEMAIL("twodots..here@domain.com")                     # False,    False
  False
  >>> ISEMAIL("me@⒈wouldbeinvalid.com")                       # False,    False
  False
  >>> ISEMAIL("Foo Bar <a+2asdf@qwer.bar.com>")               # False,    False
  False
  >>> ISEMAIL("Abc\\@def@example.com")                        # False,    False
  False
  >>> ISEMAIL("foo@bar@google.com")                           # False,    False
  False
  >>> ISEMAIL("john@aol...com")                               # False,    False
  False
  >>> ISEMAIL("x@ทีเอชนิค.ไทย")                                 # False,    False
  False
  >>> ISEMAIL("asdf@mail")                                    # False,    False
  False
  >>> ISEMAIL("example@良好Mail.中国")                        # False,    False
  False
  """
  return bool(_email_regexp.match(value))


_url_regexp = re.compile(
  r"""^
  ((ftp|http|https|gopher|mailto|news|telnet|aim)://)?
  (\w+@)?                         # Allow 'user@' part, esp. useful for mailto: URLs.
  ([A-Za-z0-9]                    # Each part of hostname must start with alphanumeric
    ([A-Za-z0-9-]*[A-Za-z0-9])?\. # May have dashes inside, but end in alphanumeric
  )+
  [A-Za-z]{2,24}                  # Restrict top-level domain to length {2,24} (theoretically,
                                  # the max length is 63 bytes as per RFC 1034). Google seems
                                  # to use a whitelist for TLDs longer than 2 characters.
  ([/?][-\w!#$%&'()*+,./:;=?@~]*)?$ # Notably, this excludes <, >, and ".
  """, re.VERBOSE)


def ISURL(value):
  """
  Checks whether a value is a valid URL. It does not need to be fully qualified, or to include
  "http://" and "www". It does not follow a standard, but attempts to work similarly to ISURL in
  Google Sheets, and to return True for text that is likely a URL.

  Valid protocols include ftp, http, https, gopher, mailto, news, telnet, and aim.

  >>> ISURL("http://www.getgrist.com")
  True
  >>> ISURL("https://foo.com/test_(wikipedia)#cite-1")
  True
  >>> ISURL("mailto://user@example.com")
  True
  >>> ISURL("http:///a")
  False

  More tests:
  >>> ISURL("http://www.google.com")
  True
  >>> ISURL("www.google.com/")
  True
  >>> ISURL("google.com")
  True
  >>> ISURL("http://a.b-c.de")
  True
  >>> ISURL("a.b-c.de")
  True
  >>> ISURL("http://j.mp/---")
  True
  >>> ISURL("ftp://foo.bar/baz")
  True
  >>> ISURL("https://foo.com/blah_(wikipedia)#cite-1")
  True
  >>> ISURL("mailto://user@google.com")
  True
  >>> ISURL("http://user@www.google.com")
  True
  >>> ISURL("http://foo.com/!#$%25&'()*+,-./=?@_~")
  True
  >>> ISURL("http://collectivite.isla.corsica")
  True
  >>> ISURL("http://../")
  False
  >>> ISURL("http://??/")
  False
  >>> ISURL("a.-b.cd")
  False
  >>> ISURL("http://foo.bar?q=Spaces should be encoded ")
  False
  >>> ISURL("//")
  False
  >>> ISURL("///a")
  False
  >>> ISURL("http:///a")
  False
  >>> ISURL("bar://www.google.com")
  False
  >>> ISURL("http:// shouldfail.com")
  False
  >>> ISURL("ftps://foo.bar/")
  False
  >>> ISURL("http://-error-.invalid/")
  False
  >>> ISURL("http://0.0.0.0")
  False
  >>> ISURL("http://.www.foo.bar/")
  False
  >>> ISURL("http://.www.foo.bar./")
  False
  >>> ISURL("example.com/file[/].html")
  False
  >>> ISURL("http://example.com/file[/].html")
  False
  >>> ISURL("http://mw1.google.com/kml-samples/gp/seattle/gigapxl/$[level]/r$[y]_c$[x].jpg")
  False
  >>> ISURL("http://foo.com/>")
  False
  """
  value = value.strip()
  if ' ' in value:        # Disallow spaces inside value.
    return False
  return bool(_url_regexp.match(value))


def N(value):
  """
  Returns the value converted to a number. True/False are converted to 1/0. A date is converted to
  Excel-style serial number of the date. Anything else is converted to 0.

  >>> N(7)
  7
  >>> N(7.1)
  7.1
  >>> N("Even")
  0
  >>> N("7")
  0
  >>> N(True)
  1
  >>> N(datetime.datetime(2011, 4, 17))
  40650.0
  """
  if ISNUMBER(value):
    return value
  if isinstance(value, datetime.date):
    return date.DATE_TO_XL(value)
  return 0


def NA():
  """
  Returns the "value not available" error, `#N/A`.

  >>> math.isnan(NA())
  True
  """
  return float('nan')


@unimplemented
def TYPE(value):
  """
  Returns a number associated with the type of data passed into the function. This is not
  implemented in Grist. Use `isinstance(value, type)` or `type(value)`.
  """
  raise NotImplementedError()

@unimplemented
def CELL(info_type, reference):
  """
  Returns the requested information about the specified cell. This is not implemented in Grist
  """
  raise NotImplementedError()


def PEEK(func):
  """
  Evaluates the given expression without creating dependencies
  or requiring that referenced values are up to date, using whatever value it finds in a cell.
  This is useful for preventing circular reference errors, particularly in trigger formulas.

  For example, if the formula for `A` depends on `$B` and the formula for `B` depends on `$A`,
  then normally this would raise a circular reference error because each value needs to be
  calculated before the other. But if `A` uses `PEEK($B)` then it will simply get the value
  already stored in `$B` without requiring that `$B` is first calculated to the latest value.
  Therefore `A` will be calculated first, and `B` can use `$A` without problems.
  """
  engine = docmodel.global_docmodel._engine
  engine._peeking = True
  try:
    return func()
  finally:
    engine._peeking = False


def RECORD(record_or_list, dates_as_iso=False, expand_refs=0):
  """
  Returns a Python dictionary with all fields in the given record. If a list of records is given,
  returns a list of corresponding Python dictionaries.

  If dates_as_iso is set, Date and DateTime values are converted to string using ISO 8601 format.

  If expand_refs is set to 1 or higher, Reference values are replaced with a RECORD representation
  of the referenced record, expanding the given number of levels.

  Error values present in cells of the record are replaced with None value, and a special key of
  "_error_" gets added containing the error messages for those cells. For example:
  `{"Ratio": None, "_error_": {"Ratio": "ZeroDivisionError: integer division or modulo by zero"}}`

  Note that care is needed to avoid circular references when using RECORD(), since it creates a
  dependency on every cell in the record. In case of RECORD(rec), the cell containing this call
  will be omitted from the resulting dictionary.

  For example:
  ```
  RECORD($Person)
  RECORD(rec)
  RECORD(People.lookupOne(First_Name="Alice"))
  RECORD(People.lookupRecords(Department="HR"))
  ```
  """
  if isinstance(record_or_list, Record):
    return _prepare_record_dict(record_or_list, dates_as_iso=dates_as_iso, expand_refs=expand_refs)

  try:
    records = list(record_or_list)
    assert all(isinstance(r, Record) for r in records)
  except Exception:
    raise ValueError('RECORD() requires a Record or an iterable of Records')

  return [_prepare_record_dict(r, dates_as_iso=dates_as_iso, expand_refs=expand_refs)
          for r in records]


def _prepare_record_dict(record, dates_as_iso=False, expand_refs=0):
  table_id = record._table.table_id
  docmodel = record._table._engine.docmodel
  columns = docmodel.get_table_rec(table_id).columns
  current_node = record._table._engine._current_node

  result = {'id': int(record)}
  errors = {}
  for col in columns:
    col_id = col.colId
    # Skip helper columns.
    if not column.is_visible_column(col_id):
      continue

    # Avoid trying to access the cell being evaluated, since cycles get detected even if the
    # CircularRef exception is caught. TODO This is hacky, and imperfect. If another column
    # references a column containing the RECORD(rec) call, CircularRefError will still happen.
    if current_node == (table_id, col_id):
      continue

    try:
      val = getattr(record, col_id)
      if dates_as_iso and isinstance(val, datetime.date):
        val = val.isoformat()
      elif expand_refs and isinstance(val, (Record, RecordSet)):
        # Reduce expand_refs levels.
        if val:
          val = RECORD(val, dates_as_iso=dates_as_iso, expand_refs=expand_refs - 1)
        else:
          val = None
      result[col_id] = val
    except Exception as e:
      result[col_id] = None
      while isinstance(e, CellError):
        # The extra information from CellError is redundant here
        e = e.error  # pylint: disable=no-member
      errors[col_id] = "%s: %s" % (type(e).__name__, str(e))

  if errors:
    result["_error_"] = errors
  return result


# Unique sentinel value to represent that a lazy value evaluates with an exception.
_error_sentinel = object()

def lazy_value_or_error(value):
  """
  Evaluates a value like lazy_value(), but returns _error_sentinel on exception.
  """
  try:
    return value() if callable(value) else value
  except Exception:
    return _error_sentinel

def is_error(value):
  """
  Checks whether a value is an invalid value or _error_sentinel.
  """
  return ((value is _error_sentinel)
      or isinstance(value, AltText)
      or (isinstance(value, float) and math.isnan(value)))


def _replicate_requests_body_args(data=None, json=None):
  """
  Replicate some of the behaviour of requests.post, specifically the data and 
  json args.

  Returns a tuple of (body, extra_headers)
  """
  if data is None and json is None:
      return None, {}

  elif data is not None and json is None:
    if isinstance(data, str):
      body = data
      extra_headers = {}
    else:
      body = urllib_parse.urlencode(data)
      extra_headers = {
        "Content-Type": "application/x-www-form-urlencoded",
      }
    return body, extra_headers

  elif json is not None and data is None:
    if isinstance(json, str):
      body = json
    else:
      body = json_module.dumps(json)
    extra_headers = {
      "Content-Type": "application/json",
    }
    return body, extra_headers

  elif data is not None and json is not None:
    # From testing manually with requests 2.28.2, data overrides json if both
    # supplied. However, this is probably a mistake on behalf of the caller, so
    # we choose to throw an error instead
    raise ValueError("`data` and `json` cannot be supplied to REQUEST at the same time")


@unimplemented
# ^ This excludes this function from autocomplete while in beta
# and marks it as unimplemented in the docs.
# It also makes grist-help expect to see the string 'raise NotImplemented' in the function source,
# which it does now, because of this comment. Removing this comment will currently break the docs.
def REQUEST(url, params=None, headers=None, method="GET", data=None, json=None):
  # Makes an HTTP request with an API similar to `requests.request`.
  # Actually jumps through hoops internally to make the request asynchronously (usually)
  # while feeling synchronous to the formula writer.

  # When making a POST or PUT request, REQUEST supports `data` and `json` args, from `requests.request`:
  #   - `args` as str: Used as the request body
  #   - `args` as other types: Form encoded and used as the request body. The correct header is also set.
  #   - `json` as str: Used as the request body. The correct header is also set.
  #   - `json` as other types: JSON encoded and set as the request body. The correct header is also set.
  body, _headers = _replicate_requests_body_args(data=data, json=json)

  # Extra headers that make us consistent with requests.post must not override
  # user-supplied headers.
  _headers.update(headers or {})

  # Requests are identified by a string key in various places.
  # The same arguments should produce the same key so the request is only made once.
  args = dict(url=url, params=params, headers=_headers, method=method, body=body)

  args_json = json_module.dumps(args, sort_keys=True)
  key = hashlib.sha256(args_json.encode()).hexdigest()

  # This may either return the raw response data or it may raise a special exception
  # to delegate the request and reevaluate the formula later.
  response_dict = docmodel.global_docmodel._engine._requesting(key, args)

  if "error" in response_dict:
    # Indicates a complete failure to make the request, such as a connection problem.
    # An unsuccessful status code like 404 or 500 doesn't raise this error.
    raise HTTPError(response_dict["error"])

  return Response(**response_dict)


class HTTPError(Exception):
  pass


class Response(object):
  """
  Similar to the Response class from the `requests` library.
  """
  def __init__(self, content, status, statusText, headers, encoding=None):
    self.content = content  # raw bytes
    self.status_code = status  # e.g. 404
    self.reason = statusText  # e.g. "Not Found"
    self.headers = CaseInsensitiveDict(headers)
    self.encoding = encoding or self.apparent_encoding or "utf-8"

  @property
  def text(self):
    return self.content.decode(self.encoding)

  def json(self, **kwargs):
    return json_module.loads(self.text, **kwargs)

  @property
  def ok(self):
    return self.status_code < 400

  def raise_for_status(self):
    if not self.ok:
      raise HTTPError("Request failed with status %s" % self.status_code)

  @property
  def apparent_encoding(self):
    return chardet.detect(self.content)["encoding"]

  def close(self):
    pass  # nothing to do


class CaseInsensitiveDict(dict):
  """
  Similar to dict but treats all keys (which must be strings) case-insensitively,
  e.g. `d["foo"]` and `d["FOO"]` are equivalent.
  """
  def __init__(self, *args, **kwargs):
    dict.__init__(self, *args, **kwargs)
    for k in list(self):
      # Convert key to lowercase
      self[k] = dict.pop(self, k)

  def update(self, E=None, **F):
    dict.update(self.__class__(E or {}))
    dict.update(self.__class__(**F))


def _forward_dict_method(name):
  # Replace method 'name' where the first argument is a key with a version that lowercases the key
  def method(self, key, *args, **kwargs):
    return getattr(dict, name)(self, key.lower(), *args, **kwargs)
  return method

for _name in "__getitem__ __setitem__ __delitem__ __contains__ get setdefault pop has_key".split():
  setattr(CaseInsensitiveDict, _name, _forward_dict_method(_name))
