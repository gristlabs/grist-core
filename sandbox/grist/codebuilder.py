import ast
import contextlib
import itertools
import linecache
import logging
import re
import textwrap

import astroid
import asttokens
import six

import friendly_errors
import textbuilder
log = logging.getLogger(__name__)


DOLLAR_REGEX = re.compile(r'\$(?=[a-zA-Z_][a-zA-Z_0-9]*)')

# For functions needing lazy evaluation, the slice for which arguments to wrap in a lambda.
LAZY_ARG_FUNCTIONS = {
  'IF': slice(1, 3),
  'ISERR': slice(0, 1),
  'ISERROR': slice(0, 1),
  'IFERROR': slice(0, 1),
  'PEEK': slice(0, 1),
}


class GristSyntaxError(SyntaxError):
  """
  Indicates a formula is invalid in a Grist-specific way.
  """


def make_formula_body(formula, default_value, assoc_value=None):
  """
  Given a formula, returns a textbuilder.Builder object suitable to be the body of a function,
  with the formula transformed to replace `$foo` with `rec.foo`, and to insert `return` if
  appropriate. Assoc_value is associated with textbuilder.Text() to be returned by map_back_patch.
  """
  if isinstance(formula, six.binary_type):
    formula = formula.decode('utf8')

  # Remove any common leading whitespace. In python, extra indent should not be an error, but
  # it is in Grist because we parse the formula body before it gets inserted into a function (i.e.
  # as if at module level).
  formula = textwrap.dedent(formula)

  if not formula.strip():
    return textbuilder.Text('return ' + repr(default_value), assoc_value)

  formula_builder_text = textbuilder.Text(formula, assoc_value)

  # Start with a temporary builder, since we need to translate "$" before we can parse the code at
  # all (namely, we turn '$foo' into 'DOLLARfoo' first). Once we can parse the code, we'll create
  # a proper set of patches. Note that we initially translate into 'DOLLARfoo' rather than
  # 'rec.foo', so that the translated entity is a single token: this makes for more precisely
  # reported errors if there are any.
  tmp_patches = textbuilder.make_regexp_patches(formula, DOLLAR_REGEX, 'DOLLAR')
  tmp_formula = textbuilder.Replacer(formula_builder_text, tmp_patches)

  atok = asttokens.ASTText(tmp_formula.get_text(), filename=code_filename)
  # Parse the formula into an abstract syntax tree (AST), catching syntax errors.
  # Constructing ASTText doesn't parse the code, but the .tree property does.
  try:
    tree = atok.tree
  except SyntaxError as e:
    return textbuilder.Text(_create_syntax_error_code(tmp_formula, formula, e))

  # Once we have a tree, go through it and create a subset of the dollar patches that are actually
  # relevant. E.g. this is where we'll skip the "$foo" patches that appear in strings or comments.
  patches = []
  for node in ast.walk(tree):
    if isinstance(node, ast.Name) and node.id.startswith('DOLLAR'):
      startpos = atok.get_text_range(node)[0]
      input_pos = tmp_formula.map_back_offset(startpos)
      m = DOLLAR_REGEX.match(formula, input_pos)
      # If there is no match, then we must have had a "DOLLARblah" identifier that didn't come
      # from translating a "$" prefix.
      if m:
        patches.append(textbuilder.make_patch(formula, m.start(0), m.end(0), 'rec.'))

    # Wrap arguments to the top-level "IF()" function into lambdas, for lazy evaluation. This is
    # to ensure it's not affected by an exception in the unused value, to match Excel behavior.
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
      lazy_args_slice = LAZY_ARG_FUNCTIONS.get(node.func.id)
      if lazy_args_slice:
        for arg in node.args[lazy_args_slice]:
          start, end = map(tmp_formula.map_back_offset, atok.get_text_range(arg))
          patches.append(textbuilder.make_patch(formula, start, start, 'lambda: ('))
          patches.append(textbuilder.make_patch(formula, end, end, ')'))

  # If the last statement is an expression that has its result unused (an ast.Expr node),
  # then insert a "return" keyword.
  last_statement = tree.body[-1] if tree.body else None
  if isinstance(last_statement, ast.Expr):
    startpos = atok.get_text_range(last_statement)[0]
    input_pos = tmp_formula.map_back_offset(startpos)
    patches.append(textbuilder.make_patch(formula, input_pos, input_pos, "return "))
  elif last_statement is None:
    # If we have an empty body (e.g. just a comment), add a 'pass' at the end.
    patches.append(textbuilder.make_patch(formula, len(formula), len(formula), '\npass'))
  elif not any(
      # Raise an error if the user forgot to return anything. For performance:
      # - Use type() instead of isinstance()
      # - Check last_statement first to try avoiding walking the tree
      type(node) == ast.Return  # pylint: disable=unidiomatic-typecheck
      for node in itertools.chain([last_statement], ast.walk(tree))
  ):
    message = "No `return` statement, and the last line isn't an expression."
    if isinstance(last_statement, ast.Assign):
      message += " If you want to check for equality, use `==` instead of `=`."
    error = GristSyntaxError(message, ('<string>', 1, 1, ""))
    return textbuilder.Text(_create_syntax_error_code(tmp_formula, formula, error))

  # Apply the new set of patches to the original formula to get the real output.
  final_formula = textbuilder.Replacer(formula_builder_text, patches)

  # Try parsing again before returning it just in case we have new syntax errors. These are
  # possible in cases when a single token ('DOLLARfoo') is valid but an expression ('rec.foo') is
  # not, e.g. `foo($bar=1)` or `def $foo()`.
  # Also check for common mistakes: assigning to `rec` or its attributes (e.g. `$foo = 1`).
  with use_inferences(InferRecAssignment, InferRecAttrAssignment):
    try:
      astroid.parse(final_formula.get_text())
    except (astroid.AstroidSyntaxError, SyntaxError) as e:
      error = getattr(e, "error", e)  # extract SyntaxError from AstroidSyntaxError
      return textbuilder.Text(_create_syntax_error_code(final_formula, formula, error))

  # We return the text-builder object whose .get_text() is the final formula.
  return final_formula


def replace_dollar_attrs(formula):
  """
  Translates formula "$" expression into rec. expression. This is extracted from the
  make_formula_body function.
  """
  formula_builder_text = textbuilder.Text(formula)
  tmp_patches = textbuilder.make_regexp_patches(formula, DOLLAR_REGEX, 'DOLLAR')
  tmp_formula = textbuilder.Replacer(formula_builder_text, tmp_patches)
  atok = asttokens.ASTText(tmp_formula.get_text())
  patches = []
  for node in ast.walk(atok.tree):
    if isinstance(node, ast.Name) and node.id.startswith('DOLLAR'):
      startpos = atok.get_text_range(node)[0]
      input_pos = tmp_formula.map_back_offset(startpos)
      m = DOLLAR_REGEX.match(formula, input_pos)
      if m:
        patches.append(textbuilder.make_patch(formula, m.start(0), m.end(0), 'rec.'))
  final_formula = textbuilder.Replacer(formula_builder_text, patches)
  return final_formula.get_text()


def _create_syntax_error_code(builder, input_text, err):
  """
  Returns the text for a function that raises the given SyntaxError and includes the offending
  code in a commented-out form. In addition, it translates the error's position from builder's
  output to input_text.
  """
  output_ln = asttokens.LineNumbers(builder.get_text())
  input_ln = asttokens.LineNumbers(input_text)
  # A SyntaxError contains .lineno and .offset (1-based), which we need to translate to offset
  # within the transformed text, so that it can be mapped back to an offset in the original text,
  # and finally translated back into a line number and 1-based position to report to the user. An
  # example is that "$x*" is translated to "return x*", and the syntax error in the transformed
  # python code (line 2 offset 9) needs to be translated to be in line 2 offset 3.
  output_offset = output_ln.line_to_offset(err.lineno, err.offset - 1 if err.offset else 0)
  input_offset = builder.map_back_offset(output_offset)
  line, col = input_ln.offset_to_line(input_offset)
  input_text_line = input_text.splitlines()[line - 1]

  message = err.args[0]
  err_type = type(err)
  if isinstance(err, GristSyntaxError):
    # Just use SyntaxError in the final code
    err_type = SyntaxError
  elif six.PY3:
    # Add explanation from friendly-traceback.
    # Only supported in Python 3.
    # Not helpful for Grist-specific errors.
    # Needs to use the source code, so save it to its source cache.
    save_to_linecache(builder.get_text())
    message += friendly_errors.friendly_message(err)

  return "%s\nraise %s(%r, ('usercode', %r, %r, %r))" % (
    textbuilder.line_start_re.sub('# ', input_text.rstrip()),
    err_type.__name__, message, line, col + 1, input_text_line)

#----------------------------------------------------------------------

def infer(node):
  try:
    return next(node.infer(), None)
  except astroid.exceptions.InferenceError as e:
    return "InferenceError on %r: %r" % (node, e)


_lookup_method_names = ('lookupOne', 'lookupRecords')

def _is_table(node):
  """
  Return true if obj is a class defining a user table.
  """
  return (isinstance(node, astroid.nodes.ClassDef) and node.decorators and
          node.decorators.nodes[0].as_string() == 'grist.UserTable')

def _is_local(node):
  """
  Returns true if node is a Name node for an innermost variable.
  """
  return isinstance(node, astroid.nodes.Name) and node.name in node.scope().locals


@contextlib.contextmanager
def use_inferences(*inference_tips):
  transform_args = [(cls.node_class, astroid.inference_tip(cls.infer), cls.filter)
                    for cls in inference_tips]
  for args in transform_args:
    astroid.MANAGER.register_transform(*args)
  yield
  for args in transform_args:
    astroid.MANAGER.unregister_transform(*args)


class InferenceTip(object):
  """
  Base class for inference tips. A derived class can implement the filter() and infer() class
  methods, and then register() will put that inference helper into use.
  """
  node_class = None

  @classmethod
  def filter(cls, node):
    raise NotImplementedError()

  @classmethod
  def infer(cls, node, context):
    raise NotImplementedError()


class InferReferenceColumn(InferenceTip):
  """
  Inference helper to treat the return value of `grist.Reference("Foo")` as an instance of the
  table `Foo`.
  """
  node_class = astroid.nodes.Call

  @classmethod
  def filter(cls, node):
    return (isinstance(node.func, astroid.nodes.Attribute) and
            node.func.as_string() in ('grist.Reference', 'grist.ReferenceList'))

  @classmethod
  def infer(cls, node, context=None):
    table_id = node.args[0].value
    table_class = next(node.root().igetattr(table_id))
    yield astroid.bases.Instance(table_class)


def _get_formula_type(function_node):
  decorators = function_node.decorators.nodes if function_node.decorators else ()
  for dec in decorators:
    if (isinstance(dec, astroid.nodes.Call) and
        dec.func.as_string() == 'grist.formulaType'):
      return dec.args[0]
  return None


class InferReferenceFormula(InferenceTip):
  """
  Inference helper to treat functions decorated with `grist.formulaType(grist.Reference("Foo"))`
  as returning instances of table `Foo`.
  """
  node_class = astroid.nodes.FunctionDef

  @classmethod
  def filter(cls, node):
    # All methods on tables are really used as properties.
    return _is_table(node.parent.frame())

  @classmethod
  def infer(cls, node, context=None):
    ftype = _get_formula_type(node)
    if ftype and InferReferenceColumn.filter(ftype):
      return InferReferenceColumn.infer(ftype, context)
    return node.infer_call_result(node.parent.frame(), context)


class InferLookupReference(InferenceTip):
  """
  Inference helper to treat the return value of `Table.lookupRecords(...)` as returning instances
  of table `Table`.
  """
  node_class = astroid.nodes.Call

  @classmethod
  def filter(cls, node):
    return (isinstance(node.func, astroid.nodes.Attribute) and
            node.func.attrname in _lookup_method_names and
            _is_table(infer(node.func.expr)))

  @classmethod
  def infer(cls, node, context=None):
    yield astroid.bases.Instance(infer(node.func.expr))


class InferAllReference(InferenceTip):
  """
  Inference helper to treat the return value of `Table.all` as returning instances
  of table `Table`.
  """
  node_class = astroid.nodes.Attribute

  @classmethod
  def filter(cls, node):
    return node.attrname == "all" and _is_table(infer(node.expr))

  @classmethod
  def infer(cls, node, context=None):
    yield astroid.bases.Instance(infer(node.expr))


class InferComprehensionBase(InferenceTip):
  node_class = astroid.nodes.AssignName
  reference_inference_class = None

  @classmethod
  def filter(cls, node):
    compr = node.parent
    if not isinstance(compr, astroid.nodes.Comprehension):
      return False
    if isinstance(compr.iter, cls.reference_inference_class.node_class):
      return cls.reference_inference_class.filter(compr.iter)
    return False

  @classmethod
  def infer(cls, node, context=None):
    return cls.reference_inference_class.infer(node.parent.iter)


class InferLookupComprehension(InferComprehensionBase):
  reference_inference_class = InferLookupReference


class InferAllComprehension(InferComprehensionBase):
  reference_inference_class = InferAllReference


class InferRecAssignment(InferenceTip):
  """
  Inference helper to raise exception on assignment to `rec`.
  """
  node_class = astroid.nodes.AssignName

  @classmethod
  def filter(cls, node):
    if node.name == 'rec':
      raise GristSyntaxError('Grist disallows assignment to the special variable "rec"',
          ('<string>', node.lineno, node.col_offset, ""))

  @classmethod
  def infer(cls, node, context):
    raise NotImplementedError()

class InferRecAttrAssignment(InferenceTip):
  """
  Inference helper to raise exception on assignment to `rec`.
  """
  node_class = astroid.nodes.AssignAttr

  @classmethod
  def filter(cls, node):
    if isinstance(node.expr, astroid.nodes.Name) and node.expr.name == 'rec':
      raise GristSyntaxError("You can't assign a value to a column with `=`. "
                             "If you mean to check for equality, use `==` instead.",
          ('<string>', node.lineno, node.col_offset, ""))

  @classmethod
  def infer(cls, node, context):
    raise NotImplementedError()

#----------------------------------------------------------------------

def parse_grist_names(builder):
  """
  Returns a list of tuples (col_info, start_pos, table_id, col_id):
    col_info:   (table_id, col_id) for the formula the name is found in. It is the value passed
                in by gencode.py to codebuilder.make_formula_body().
    start_pos:  Index of the start character of the name in col_info.formula
    table_id:   Parsed name when the tuple is for a table name; the name of the column's table
                when the tuple is for a column name.
    col_id:     None when tuple is for a table name; col_id when the tuple is for a column name.
  """
  code_text = builder.get_text()

  with use_inferences(InferReferenceColumn, InferReferenceFormula, InferLookupReference,
                      InferLookupComprehension, InferAllReference, InferAllComprehension):
    atok = asttokens.ASTText(code_text, tree=astroid.builder.parse(code_text))

  def make_tuple(start, end, table_id, col_id):
    name = col_id or table_id
    assert end - start == len(name)
    patch = textbuilder.Patch(start, end, name, name)
    assert code_text[start:end] == name
    patch_source = builder.map_back_patch(patch)
    if not patch_source:
      return None
    in_text, in_value, in_patch = patch_source
    if in_value:
      return (in_value, in_patch.start, table_id, col_id)
    return None

  parsed_names = []
  for node in asttokens.util.walk(atok.tree, include_joined_str=True):
    if isinstance(node, astroid.nodes.Name):
      obj = infer(node)
      if _is_table(obj) and not _is_local(node):
        start, end = atok.get_text_range(node)
        parsed_names.append(make_tuple(start, end, node.name, None))

    elif isinstance(node, astroid.nodes.Attribute):
      obj = infer(node.expr)
      if isinstance(obj, astroid.bases.Instance):
        cls = obj._proxied
        if _is_table(cls):
          end = atok.get_text_range(node)[1]
          start = end - len(node.attrname)
          if code_text[start:end] == node.attrname:
            parsed_names.append(make_tuple(start, end, cls.name, node.attrname))
    elif isinstance(node, astroid.nodes.Keyword):
      func = node.parent.func
      if isinstance(func, astroid.nodes.Attribute) and func.attrname in _lookup_method_names:
        obj = infer(func.expr)
        if _is_table(obj):
          start = atok.get_text_range(node)[0]
          end = start + len(node.arg)
          if code_text[start:end] == node.arg:
            parsed_names.append(make_tuple(start, end, obj.name, node.arg))

  return [name for name in parsed_names if name]


code_filename = "usercode"


def save_to_linecache(source_code):
  """
  Makes source code available to friendly-traceback and traceback formatting in general.
  """
  if six.PY3:
    import friendly_traceback.source_cache    # pylint: disable=import-error

    friendly_traceback.source_cache.cache.add(code_filename, source_code)
  else:
    linecache.cache[code_filename] = (
      len(source_code),
      None,
      [line + '\n' for line in source_code.splitlines()],
      code_filename,
    )
