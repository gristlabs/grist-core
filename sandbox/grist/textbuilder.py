"""
This module allows building text with transformations. It is used specifically for transforming
code, such as replacing "$foo" with "rec.foo" in formulas, and composing formulas into a full
usercode module.

The importance of this module is in allowing to map back replacements (or patches) to output code,
such as those generated to rename column references, into patches to the original inputs. It
allows us to deal with the complete valid usercode module text when searching for renames.
"""
import bisect
import re
from collections import namedtuple

import six

Patch = namedtuple('Patch', ('start', 'end', 'old_text', 'new_text'))

line_start_re = re.compile(r'^', re.M)


def make_patch(full_text, start, end, new_text):
  """
  Returns a patch to `full_text` to replace `full_text[start:end]` with `new_text`.
  """
  return Patch(start, end, full_text[start:end], new_text)


def make_regexp_patches(full_text, regexp, repl):
  """
  Returns a list of patches to `full_text` to replace each occurrence of `regexp` with `repl`. If
  repl is a function, will replace with `repl(match_object)`. If repl is a string, it is used
  verbatim, without interpreting any special characters.
  """
  repl_func = repl if callable(repl) else (lambda m: repl)
  return [make_patch(full_text, m.start(0), m.end(0), repl_func(m))
          for m in regexp.finditer(full_text)]


def validate_patch(text, patch):
  """
  Ensures that the given patch fits the given text, raising ValueError if not.
  """
  found = text[patch.start : patch.end]
  if found != patch.old_text:
    before = text[patch.start - 10 : patch.start]
    after = text[patch.end : patch.end + 10]
    raise ValueError("Invalid patch to '%s[%s]%s' at %s; expected '%s'" % (
      before, found, after, patch.start, patch.old_text))


class Builder(object):
  """
  The base for classes that produce text and can map back a text patch to some useful value. A
  series of Builders transforms text, and when we know what to change in the result, we use
  map_back_patch() to get the source of the original `Text` object.
  """
  def map_back_patch(self, patch):
    """
    See Text.map_back_patch.
    """
    raise NotImplementedError()

  def get_text(self):
    """
    Returns the output text of this Builder.
    """
    raise NotImplementedError()


class Text(Builder):
  """
  The lowest Builder that holds a simple string with an optional associated arbitrary value (e.g.
  which column a formula came from). When we map back a patch of transformed text, we get a tuple
  (text, value, patch) with text and value from the constructor, and patch that applies to text.
  """
  def __init__(self, text, value=None):
    self._text = text
    self._value = value

  def map_back_patch(self, patch):
    """
    Returns the tuple (text, value, patch) with text and value from the constructor, and patch
    that applies to text.
    """
    assert self._text[patch.start:patch.end] == patch.old_text
    return (self._text, self._value, patch)

  def get_text(self):
    return self._text


class Replacer(Builder):
  """
  Builder that transforms an input Builder with some patches to produce output. It remembers
  positions of replacements, so it can map patches of its output back to its input.
  """
  def __init__(self, in_builder, patches):
    self._in_builder = in_builder

    # Two parallel lists of input and output offsets, with corresponding offsets at the same index
    # in the two lists. Each list is ordered by offset.
    self._input_offsets = [0]
    self._output_offsets = [0]

    out_parts = []
    in_pos = 0
    out_pos = 0
    text = self._in_builder.get_text()
    # Note that we have to go through patches in sorted order.
    for in_patch in sorted(patches):
      validate_patch(text, in_patch)
      out_parts.append(text[in_pos:in_patch.start])
      out_parts.append(in_patch.new_text)
      out_pos += (in_patch.start - in_pos) + len(in_patch.new_text)
      in_pos = in_patch.end
      # If the replacement text is shorter or longer than the original, insert a new pair of
      # offsets corresponding to the patch's end position in the input and output text.
      if len(in_patch.new_text) != in_patch.end - in_patch.start:
        self._input_offsets.append(in_pos)
        self._output_offsets.append(out_pos)

    out_parts.append(text[in_pos:])
    self._output_text = ''.join(out_parts)

  def get_text(self):
    return self._output_text

  def map_back_patch(self, patch):
    validate_patch(self._output_text, patch)
    in_start = self.get_input_pos(patch.start)
    in_end = self.get_input_pos(patch.end)
    in_patch = make_patch(self._in_builder.get_text(), in_start, in_end, patch.new_text)
    return self._in_builder.map_back_patch(in_patch)

  def get_input_pos(self, out_pos):
    """Returns the position in the input text corresponding to the given position in output."""
    index = bisect.bisect_right(self._output_offsets, out_pos) - 1
    offset = out_pos - self._output_offsets[index]
    return self._input_offsets[index] + offset

  def map_back_offset(self, out_pos):
    """
    Returns the position corresponding to out_pos in the original input, in case it was
    processed by a series of Replacers.
    """
    input_pos = self.get_input_pos(out_pos)
    if isinstance(self._in_builder, Replacer):
      return self._in_builder.map_back_offset(input_pos)
    return input_pos


class Combiner(Builder):
  """
  Combiner allows building output text from a sequence of other Builders. When a patch is mapped
  back, it gets passed to the Builder it came from, and must not span more than one input Builder.
  """
  def __init__(self, parts):
    self._parts = parts
    self._offsets = []
    text_parts = [
      (p if isinstance(p, six.text_type) else
       p.decode('utf8') if isinstance(p, six.binary_type) else
       p.get_text())
      for p in self._parts]
    self._text = ''.join(text_parts)

    offset = 0
    self._offsets = []
    for t in text_parts:
      self._offsets.append(offset)
      offset += len(t)

  def get_text(self):
    return self._text

  def map_back_patch(self, patch):
    validate_patch(self._text, patch)
    start_index = bisect.bisect_right(self._offsets, patch.start)
    end_index = bisect.bisect_right(self._offsets, patch.end - 1)
    if start_index <= 0 or end_index <= 0 or start_index != end_index:
      raise ValueError("Invalid patch to Combiner: %s" % (patch,))
    offset = self._offsets[start_index - 1]
    part = self._parts[start_index - 1]
    in_patch = Patch(patch.start - offset, patch.end - offset, patch.old_text, patch.new_text)
    return None if isinstance(part, six.string_types) else part.map_back_patch(in_patch)
