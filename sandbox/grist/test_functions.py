import doctest
import os
import re

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
