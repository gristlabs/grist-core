import doctest
import os
import random
import re
import unittest

import six

import functions
import moment

_old_date_get_global_tz = None

def date_setUp(doc_test):
  # pylint: disable=unused-argument
  global _old_date_get_global_tz # pylint: disable=global-statement
  _old_date_get_global_tz = functions.date._get_global_tz
  functions.date._get_global_tz = lambda: moment.tzinfo('America/New_York')

def date_tearDown(doc_test):
  # pylint: disable=unused-argument
  functions.date._get_global_tz = _old_date_get_global_tz

class Py23DocChecker(doctest.OutputChecker):
  def check_output(self, want, got, optionflags):
    if six.PY3:
      want = re.sub(r"^u'(.*?)'$", r"'\1'", want)
      want = re.sub(r'^u"(.*?)"$', r'"\1"', want)
    return doctest.OutputChecker.check_output(self, want, got, optionflags)

# This works with the unittest module to turn all the doctests in the functions' doc-comments into
# unittest test cases.
def load_tests(loader, tests, ignore):
  # Set DOC_URL for SELF_HYPERLINK()
  os.environ['DOC_URL'] = 'https://docs.getgrist.com/sbaltsirg/Example'
  tests.addTests(doctest.DocTestSuite(functions.date, setUp = date_setUp, tearDown = date_tearDown))
  tests.addTests(doctest.DocTestSuite(functions.info, setUp = date_setUp, tearDown = date_tearDown))
  tests.addTests(doctest.DocTestSuite(functions.logical))
  tests.addTests(doctest.DocTestSuite(functions.math))
  tests.addTests(doctest.DocTestSuite(functions.stats))
  tests.addTests(doctest.DocTestSuite(functions.text, checker=Py23DocChecker()))
  tests.addTests(doctest.DocTestSuite(functions.schedule,
                                      setUp = date_setUp, tearDown = date_tearDown))
  tests.addTests(doctest.DocTestSuite(functions.lookup, checker=Py23DocChecker()))
  return tests


class TestUuid(unittest.TestCase):
  def check_uuids(self, expected_unique):
    uuids = set()
    for _ in range(100):
      random.seed(0)  # should make only 'fallback' UUIDs all the same
      uuids.add(functions.UUID())

    self.assertEqual(len(uuids), expected_unique)
    for uid in uuids:
      match = re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', uid)
      self.assertIsNotNone(match, uid)

  def test_standard_uuid(self):
    # Test that uuid.uuid4() is used correctly.
    # uuid.uuid4() shouldn't be affected by random.seed().
    # Depending on the test environment, uuid.uuid4() may or may not actually be available.
    try:
      os.urandom(1)
    except NotImplementedError:
      expected_unique = 1
    else:
      expected_unique = 100

    self.check_uuids(expected_unique)

  def test_fallback_uuid(self):
    # Test that our custom implementation with the `random` module works
    # and is used when uuid.uuid4() is not available.
    import uuid
    v4 = uuid.uuid4
    del uuid.uuid4
    try:
      self.check_uuids(1)  # because of the `random.seed(0)` in `check_uuids()`
    finally:
      uuid.uuid4 = v4


class TestChain(unittest.TestCase):
  def test_chain_type_error(self):
    with self.assertRaises(TypeError):
      functions.SUM(x / "2" for x in [1, 2, 3])
