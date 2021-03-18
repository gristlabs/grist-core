import doctest
import os
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
  tests.addTests(doctest.DocTestSuite(functions.text))
  tests.addTests(doctest.DocTestSuite(functions.schedule,
                                      setUp = date_setUp, tearDown = date_tearDown))
  tests.addTests(doctest.DocTestSuite(functions.lookup))
  return tests
