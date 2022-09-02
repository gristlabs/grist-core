"""
Helper to run Python unittests in the sandbox. They can be run directly as follows:

  ./sandbox/nacl/bin/run -E PYTHONPATH=/thirdparty python -m unittest discover -v -s /grist

This modules makes this a bit easier, and adds support for --xunit option, needed for running
tests under 'arc unit' and under Jenkins.

  ./sandbox/nacl/bin/run python /grist/runtests.py [--xunit]
"""
import codecs
import logging
import os
import sys
import unittest
sys.path.append('/thirdparty')

import six

def main():
  # Change to the directory of this file (/grist in sandbox), to discover everything under it.
  os.chdir(os.path.dirname(__file__))

  argv = sys.argv[:]
  test_runner = None
  if "--xunit" in argv:
    import xmlrunner
    argv.remove("--xunit")
    utf8_stdout = sys.stdout
    if six.PY2:
      utf8_stdout = codecs.getwriter('utf8')(utf8_stdout)
    test_runner = xmlrunner.XMLTestRunner(stream=utf8_stdout)

  if "-v" in argv or "--verbose" in argv:
    logging.basicConfig(level=logging.DEBUG)

  if all(arg.startswith("-") for arg in argv[1:]):
    argv.insert(1, "discover")

  unittest.main(module=None, argv=argv, testRunner=test_runner)

if __name__ == '__main__':
  main()
