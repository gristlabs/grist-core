"""
Replay binary data sent from JS to reproduce behaviour in the sandbox.

This isn't really a test and it doesn't run under normal circumstances,
but it's convenient to run it alongside other tests to measure total coverage.

This is a tool to directly run some python code of interest to make it easier to do things like:

- Use a debugger within Python
- Measure Python code coverage from JS tests
- Rapidly iterate on Python code without having to repeatedly run the same JS
    or write a Python test from scratch.

To use this, first set the environment variable RECORD_SANDBOX_BUFFERS_DIR to a directory path,
then run some JS code. For example you could run some tests,
or run `npm start` and then manually interact with a document in a way that triggers
desired behaviour in the sandbox.

This will store files like $RECORD_SANDBOX_BUFFERS_DIR/<subdirectory>/(input|output)
Each subdirectory corresponds to a single sandbox process so that replays are isolated.
JS tests can start many instances of the sandbox and thus create many subdirectories.
`input` contains the binary data sent from JS to Python, `output` contains the data sent back.
Currently, the name of each subdirectory is the time it was created.

Now run this test with the same value of RECORD_SANDBOX_BUFFERS_DIR. For each subdirectory,
it will read in `input` just as it would read the pipe from JS, and send output to a file
`new_output` in the same subdirectory. Then it will compare the data in `output` and `new_output`.
The outputs will usually match but there are many reasons they might differ:

- Functions registered in JS tests (e.g. via plugins) but not in the python unit tests.
- File paths in tracebacks.
- Slight differences between standard and NaCl interpreters.
- Functions involving randomness or time.

In any case the point is usually not whether or not the outputs match, but to directly run
just the python code of interest.
"""

from __future__ import print_function

import marshal
import os
import unittest

from main import run
from sandbox import Sandbox
import six

def marshal_load_all(path):
  result = []
  with open(path, "rb") as f:
    while True:
      try:
        result.append(marshal.load(f))
      except EOFError:
        break

  return result


class TestReplay(unittest.TestCase):
  maxDiff = None

  def test_replay(self):
    root = os.environ.get("RECORD_SANDBOX_BUFFERS_DIR")
    if not root:
      self.skipTest("RECORD_SANDBOX_BUFFERS_DIR not set")

    for dirpath, dirnames, filenames in os.walk(root):
      if "input" not in filenames:
        continue

      print("Checking " + dirpath)

      input_path = os.path.join(dirpath, "input")
      output_path = os.path.join(dirpath, "output")
      new_output_path = os.path.join(dirpath, "new_output")
      with open(input_path, "rb") as external_input:
        with open(new_output_path, "wb") as external_output:
          if six.PY3:
            import tracemalloc          # pylint: disable=import-error
            tracemalloc.reset_peak()

          sandbox = Sandbox(external_input, external_output)
          run(sandbox)

          # Run with env PYTHONTRACEMALLOC=1 to trace and print peak memory (runs much slower).
          if six.PY3 and tracemalloc.is_tracing():
            mem_size, mem_peak = tracemalloc.get_traced_memory()
            print("mem_size {}, mem_peak {}".format(mem_size, mem_peak))

      original_output = marshal_load_all(output_path)

      # _send_to_js does two layers of marshalling,
      # and NSandbox._onSandboxData parses one of those layers before writing,
      # hence original_output is 'more parsed' than marshal_load_all(new_output_path)
      new_output = [marshal.loads(b) for b in marshal_load_all(new_output_path)]

      # It's usually not worth asserting a match, see comments at the top of the file
      print("Match:", original_output == new_output)
      # self.assertEqual(original_output, new_output)
