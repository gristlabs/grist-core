"""
Logging for code running in the sandbox. The output simply goes to stderr (which gets to the
console of the Node process), but the levels allow some configuration.

We don't use the `logging` module because it assumes more about the `time` module than we have.

Usage:
  import logger
  log = logger.Logger(__name__, logger.DEBUG)    # Or logger.WARN; default is logger.INFO.
  log.info("Hello world")
      -> produces "[I] [foo.bar] Hello world"
"""

import sys

# Level definitions
DEBUG = 10
INFO = 20
WARN = 30
ERROR = 40
CRITICAL = 50

# Level strings
level_strings = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
}

def log_stderr(level, name, msg):
  sys.stderr.write("[%s] [%s] %s\n" % (level_strings.get(level, '?'), name, msg))
  sys.stderr.flush()

_log_handler = log_stderr

def set_handler(log_handler):
  """
  Allows overriding the handler for all log messages. The handler should be a function, called as
  log_handler(level, name, message).
  Returns the handler which was set previously.
  """

  global _log_handler # pylint: disable=global-statement
  prev = _log_handler
  _log_handler = log_handler
  return prev


class Logger(object):
  """
  The object that actually provides the logging interface, specifically the methods debug, info,
  warn, error, and critical. The constructor takes an argument for a name that gets included in
  each message, and a minimum level, below which messages get ignored.
  """
  def __init__(self, name, min_level=INFO):
    self._name = name
    self._min_level = min_level

  def _log(self, level, msg):
    if level >= self._min_level:
      _log_handler(level, self._name, msg)

  def debug(self, msg):
    self._log(DEBUG, msg)
  def info(self, msg):
    self._log(INFO, msg)
  def warn(self, msg):
    self._log(WARN, msg)
  def error(self, msg):
    self._log(ERROR, msg)
  def critical(self, msg):
    self._log(CRITICAL, msg)
