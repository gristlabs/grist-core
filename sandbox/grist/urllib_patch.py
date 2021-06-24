import urllib

import six
from six.moves import urllib_parse

original_quote = urllib_parse.quote

def patched_quote(s, safe='/'):
  if isinstance(s, six.text_type):
    s = s.encode('utf8')
  result = original_quote(s, safe=safe)
  if isinstance(result, six.binary_type):
    result = result.decode('utf8')
  return result

urllib.quote = patched_quote
