def friendly_message(exc):
  """
  Returns a string to append to a standard error message.
  If possible, the string contains a friendly explanation of the error.
  Otherwise, the string is empty.
  """
  try:
    if "has no column" in str(exc):
      # Avoid the standard AttributeError explanation
      return ""

    # Imported locally because it's Python 3 only
    from friendly_traceback.core import FriendlyTraceback

    saved_traceback = exc.__traceback__
    if isinstance(exc, SyntaxError):
      # A SyntaxError already carries what friendly-traceback needs, and the traceback only holds
      # our own parser's frames. Hide it: formatting those frames raises AttributeError on Python
      # 3.13, losing the explanation entirely. Still an issue as of friendly-traceback 0.7.61.
      exc.__traceback__ = None

    try:
      fr = FriendlyTraceback(type(exc), exc, exc.__traceback__)
      fr.assign_generic()
      fr.assign_cause()
    finally:
      exc.__traceback__ = saved_traceback

    generic = fr.info["generic"]  # broad explanation for the exception class
    cause = fr.info.get("cause")  # more specific explanation

    if "https://github.com" in generic:
      # This is a placeholder message when there is no explanation,
      # with a suggestion to report the case on GitHub.
      return ""

    if "All built-in exceptions defined by Python are derived from `Exception`" in generic:
      # Unhelpful explanation for a generic `Exception`
      return ""

    # Add a blank line between the standard message and the friendly message
    result = "\n\n" + generic

    # Check for the placeholder message again in the cause
    if cause and "https://github.com" not in cause:
      result += "\n" + cause

    result = result.rstrip()
    if isinstance(exc, SyntaxError):
      result += "\n\n"

    return result
  except (Exception, SystemExit):
    # This can go wrong in many ways, it's not worth propagating the error.
    # friendly-traceback raises SystemExit when it encounters an internal error.
    # Note that SystemExit is not a subclass of Exception.
    return ""
