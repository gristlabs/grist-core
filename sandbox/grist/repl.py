"""
This module implements an interpreter for a  REPL. It subclasses Python's
code.InteractiveInterpreter class, implementing most of its methods, but with
slight changes in order to be convenient for Grist's purposes
"""

import code
import sys
from collections import namedtuple

import six

SUCCESS    = 0
INCOMPLETE = 1
ERROR      = 2

EvalTuple = namedtuple("EvalTuple", ("output", "error", "status"))

#pylint: disable=exec-used, bare-except
class REPLInterpreter(code.InteractiveInterpreter):

  def __init__(self):
    code.InteractiveInterpreter.__init__(self)
    self.error_text = ""

  def runsource(self, source, filename="<input>", symbol="single"):
    """
    Compiles and executes source. Returns an EvalTuple with a status
    INCOMPLETE if the code is incomplete,
    ERROR if it encountered a compilation or run-time error,
    SUCCESS otherwise.

    an output, which gives all of the output of the user's program
    (with stderr piped to stdout, essentially, though mock-file objects are used)

    an error, which reports a syntax error at compilation or a runtime error with a
    Traceback.
    """
    old_stdout = sys.stdout
    old_stderr = sys.stderr

    user_output = six.StringIO()

    self.error_text = ""
    try:
      code = self.compile(source, filename, symbol)
    except (OverflowError, SyntaxError, ValueError):
      self.showsyntaxerror(filename)
      status = ERROR
    else:
      status = INCOMPLETE if code is None else SUCCESS

    if status == SUCCESS:

      try:
        # We use temproray variables to access stdio/stdout
        # to make sure the client can't do funky things
        # like get/set attr and have that hurt us
        sys.stdout = user_output
        sys.stderr = user_output
        exec(code, self.locals)
      except:
        # bare except to catch absolutely all things the user can throw
        self.showtraceback()
        status = ERROR
      finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    program_output = user_output.getvalue()
    try:
      user_output.close()
    except:
      pass

    return EvalTuple(program_output, self.error_text, status)

  def write(self, txt):
    """
    Used by showsyntaxerror and showtraceback
    """
    self.error_text += txt

  def runcode(self, code):
    """
    This would normally do the part of runsource after compiling the code, but doesn't quite
    make sense as its own function for our purposes because it couldn't support an INCOMPLETE
    return value, etc. We explicitly hide it here to make sure the base class's version isn't
    called by accident.
    """
    raise NotImplementedError("REPLInterpreter.runcode not implemented, use runsource instead")
