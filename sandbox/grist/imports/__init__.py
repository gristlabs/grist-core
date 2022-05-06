import warnings

import six

original_formatwarning = warnings.formatwarning


def formatwarning(*args, **kwargs):
  """
  Fixes an error on Jenkins where byte strings (instead of unicode)
  were being written to stderr due to a warning from an internal library.
  """
  return six.ensure_text(original_formatwarning(*args, **kwargs))


warnings.formatwarning = formatwarning
