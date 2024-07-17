# pylint: disable=wildcard-import, unused-argument
import six

from .date import *
from .info import *
from .logical import *
from .lookup import *
from .math import *
from .stats import *
from .text import *
from .schedule import *

if six.PY3:
  # These new functions use Python3-specific syntax.
  from .prevnext import *   # pylint: disable=import-error
else:
  # In Python2, only expose them to guide the user to upgrade.
  def PREVIOUS(rec, group_by=None, order_by=None):
    raise NotImplementedError("Update engine to Python3 to use PREVIOUS, NEXT, or RANK")
  def NEXT(rec, group_by=None, order_by=None):
    raise NotImplementedError("Update engine to Python3 to use PREVIOUS, NEXT, or RANK")
  def RANK(rec, group_by=None, order_by=None, order="asc"):
    raise NotImplementedError("Update engine to Python3 to use PREVIOUS, NEXT, or RANK")

# Export all uppercase names, for use with `from functions import *`.
__all__ = [k for k in dir() if not k.startswith('_') and k.isupper()]
