# Inspired from https://github.com/benjaminp/six/blob/4a765bffe847d65f918c70de1d7240f8b7a00767/six.py#L944
# Delivered under MIT licence

import warnings

original_formatwarning = warnings.formatwarning


def formatwarning(*args, **kwargs):
  """
  Fixes an error on Jenkins where byte strings (instead of unicode)
  were being written to stderr due to a warning from an internal library.
  """
  s = original_formatwarning(*args, **kwargs)

  if isinstance(s, bytes):
    return s.decode()
  elif isinstance(s, str):
    return s
  else:
    raise TypeError("not expecting type '%s'" % type(s))

warnings.formatwarning = formatwarning
