"""
Implements the python side of the data engine sandbox, which allows us to register functions on
the python side and call them from Node.js.

Usage:
  import sandbox
  sandbox.register(func_name, func)
  sandbox.call_external("hello", 1, 2, 3)
  sandbox.run()
"""

import os
import marshal
import sys
import traceback

def log(msg):
  sys.stderr.write(str(msg) + "\n")
  sys.stderr.flush()

class Sandbox(object):
  """
  This class works in conjunction with Sandbox.js to allow function calls
  between the Node process and this sandbox.

  The sandbox provides two pipes (on fds 3 and 4) to send data to and from the sandboxed
  process. Data on these is serialized using `marshal` module. All messages are comprised of a
  msgCode followed immediatedly by msgBody, with the following msgCodes:
    CALL = call to the other side. The data must be an array of [func_name, arguments...]
    DATA = data must be a value to return to a call from the other side
    EXC = data must be an exception to return to a call from the other side
  """

  CALL = None
  DATA = True
  EXC = False

  def __init__(self, external_input, external_output):
    self._functions = {}
    self._external_input = external_input
    self._external_output = external_output

  @classmethod
  def connected_to_js_pipes(cls):
    """
    Send data on two specially-opened side channels.
    """
    external_input = os.fdopen(3, "rb", 64 * 1024)
    external_output = os.fdopen(4, "wb", 64 * 1024)
    return cls(external_input, external_output)

  @classmethod
  def use_common_pipes(cls):
    """
    Send data via stdin/stdout, rather than specially-opened side channels.
    Duplicate stdin/stdout, close, and reopen as binary file objects.
    """
    os.dup2(0, 3)
    os.dup2(1, 4)
    os.close(0)
    os.close(1)
    sys.stdout = sys.stderr
    return Sandbox.connected_to_js_pipes()

  def _send_to_js(self, msgCode, msgBody):
    # (Note that marshal version 2 is the default; we specify it explicitly for clarity. The
    # difference with version 0 is that version 2 uses a faster binary format for floats.)

    # For large data, JS's Unmarshaller is very inefficient parsing it if it gets it piecewise.
    # It's much better to ensure the whole blob is sent as one write. We marshal the resulting
    # buffer again so that the reader can quickly tell how many bytes to expect.
    buf = marshal.dumps((msgCode, msgBody), 2)
    marshal.dump(buf, self._external_output, 2)
    self._external_output.flush()

  def call_external(self, name, *args):
    self._send_to_js(Sandbox.CALL, (name,) + args)
    (msgCode, data) = self.run(break_on_response=True)
    if msgCode == Sandbox.EXC:
      raise Exception(data)
    return data

  def register(self, func_name, func):
    self._functions[func_name] = func

  def run(self, break_on_response=False):
    while True:
      try:
        msgCode = marshal.load(self._external_input)
        data = marshal.load(self._external_input)
      except EOFError:
        break
      if msgCode != Sandbox.CALL:
        if break_on_response:
          return (msgCode, data)
        continue

      if not isinstance(data, list) or len(data) < 1:
        raise ValueError("Bad call " + data)
      try:
        fname = data[0]
        args = data[1:]
        ret = self._functions[fname](*args)
        self._send_to_js(Sandbox.DATA, ret)
      except Exception as e:
        traceback.print_exc()
        self._send_to_js(Sandbox.EXC, "%s %s" % (type(e).__name__, e))
    if break_on_response:
      raise Exception("Sandbox disconnected unexpectedly")

default_sandbox = None

def get_default_sandbox():
  global default_sandbox
  if default_sandbox is None:
    if os.environ.get('PIPE_MODE') == 'minimal':
      default_sandbox = Sandbox.use_common_pipes()
    else:
      default_sandbox = Sandbox.connected_to_js_pipes()
  return default_sandbox

def call_external(name, *args):
  return get_default_sandbox().call_external(name, *args)

def register(func_name, func):
  get_default_sandbox().register(func_name, func)

def run():
  get_default_sandbox().run()
