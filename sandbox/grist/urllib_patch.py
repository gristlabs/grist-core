import urllib
import urllib.parse

original_quote = urllib.parse.quote

def patched_quote(s, safe='/'):
  if isinstance(s, str):
    s = s.encode('utf8')
  result = original_quote(s, safe=safe)
  if isinstance(result, bytes):
    result = result.decode('utf8')
  return result

urllib.quote = patched_quote
