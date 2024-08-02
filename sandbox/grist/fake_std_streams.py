import os
import sys

import six


class FakeStdStreams(object):
  """
  Redirects stdout and stderr to StringIO.
  """
  def __enter__(self):
    self._orig_stdout = sys.stdout
    self._orig_stderr = sys.stderr
    sys.stdout = six.StringIO()
    sys.stderr = six.StringIO()

  def __exit__(self, exc_type, exc_val, exc_tb):
    sys.stdout = self._orig_stdout
    sys.stderr = self._orig_stderr


if os.environ.get('VERBOSE'):
  # Don't disable stdio streams if VERBOSE is on. This is helpful when debugging tests with
  # logging messages or print() calls.
  class DummyFakeStdStreams(object):
    def __enter__(self):
      pass

    def __exit__(self, exc_type, exc_val, exc_tb):
      pass
  FakeStdStreams = DummyFakeStdStreams
