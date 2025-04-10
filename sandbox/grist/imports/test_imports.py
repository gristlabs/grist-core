"""
Imports only run in Python 3 sandboxes, so the tests here only run in Python 3.
The test files in this directory have been renamed to look like 'import_xls_test.py' instead
of 'test_import_xls.py' so that they're not discovered automatically by default.
`load_tests` below then discovers that pattern directly, but only in Python 3.
This allows the tests to be skipped without having to specify a pattern when discovering tests.
The downside is that if you *do* want to specify a pattern, that probably won't work.
The reason for skipping entire files from being discovered instead of skipping TestCase classes
is that just importing the test file will fail with an error, both because we manually raise
an exception and because dependencies are missing.
"""

import os


def load_tests(loader, standard_tests, _pattern):

  this_dir = os.path.join(os.path.dirname(__file__))
  package_tests = list(loader.discover(start_dir=this_dir, pattern='*_test.py'))
  if len(package_tests) < 3:
    raise Exception("Expected more import tests to be discovered")
  standard_tests.addTests(package_tests)
  return standard_tests
