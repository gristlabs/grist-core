import ast
import io
import json
import tokenize
from collections import namedtuple
import ast
import asttokens
import textbuilder
import six
from codebuilder import get_dollar_replacer

# Entities encountered in predicate formulas, which may get renamed.
#   type : 'recCol'|'userAttr'|'userAttrCol',
#   start_pos: number,        # start position of the token in the code.
#   name: string,             # the name that may be updated by a rename.
#   extra: string|None,       # name of userAttr in case of userAttrCol; otherwise None.
NamedEntity = namedtuple('NamedEntity', ('type', 'start_pos', 'name', 'extra'))

def parse_predicate_formula(formula):
  """
  Parse a predicate formula expression into a parse tree that we can interpret in JS, e.g.
  "rec.office == 'Seattle' and user.email in ['sally@', 'xie@']".

  The idea is to support enough to express ACL rules and dropdown conditions flexibly, but we
  don't need to support too much, since expressions should be reasonably simple.

  The returned tree has the form [NODE_TYPE, arguments...], with these NODE_TYPEs supported:
    And|Or                  ...values
    Add|Sub|Mult|Div|Mod    left, right
    Not                     operand
    Eq|NotEq|Lt|LtE|Gt|GtE  left, right
    Is|IsNot|In|NotIn       left, right
    List                    ...elements
    Const                   value (number, string, bool)
    Name                    name (string)
    Attr                    node, attr_name
    Comment                 node, comment
  """
  if isinstance(formula, six.binary_type):
    formula = formula.decode('utf8')
  try:
    formula = get_dollar_replacer(formula).get_text()
    tree = ast.parse(formula, mode='eval')
    result = TreeConverter().visit(tree)
    for part in tokenize.generate_tokens(io.StringIO(formula).readline):
      if part[0] == tokenize.COMMENT and part[1].startswith('#'):
        result = ['Comment', result, part[1][1:].strip()]
        break
    return result
  except SyntaxError as err:
    # In case of an error, include line and offset.
    raise SyntaxError("%s on line %s col %s" % (err.args[0], err.lineno, err.offset))

def parse_predicate_formula_json(formula):
  """
  As parse_predicate_formula(), but stringifies the result, and converts falsy
  values to empty string.
  """
  return json.dumps(parse_predicate_formula(formula)) if formula else ""

named_constants = {
  'True': True,
  'False': False,
  'None': None,
}


def parse_grist_entities(formula, collector):
  """
  Parse the given predicate formula collecting any entities that may be subject to renaming.
  Returns a NamedEntity list.
  """
  try:
    atok = asttokens.ASTTokens(formula, tree=ast.parse(formula, mode='eval'))
    collector.visit(atok.tree)
    return collector.entities
  except SyntaxError as err:
    return []


def process_renames(formula, collector, renamer):

  dollar_replacer = get_dollar_replacer(formula)

  patches = []
  for subject in parse_grist_entities(dollar_replacer.get_text(), collector):
    new_name = renamer(subject)
    if new_name is not None:
      patches.append(textbuilder.make_patch(
        dollar_replacer.get_text(), subject.start_pos, subject.start_pos + len(subject.name), new_name))

  # Replace the column reference with the new name.
  new_dc_formula = textbuilder.Replacer(dollar_replacer, patches)
  new_dc_formula_text = new_dc_formula.get_text()

  # Find all "rec." in the processed formula.
  rec_occurrences = []
  cursor = 0
  while True:
    next_occurrence = new_dc_formula_text.find("rec.", cursor)
    if next_occurrence == -1:
      break
    cursor = next_occurrence + 4 # "rec." has 4 characters
    rec_occurrences.append(next_occurrence)

  patches = []
  # Map all "rec." back to the original formula to check if it was a "$".
  for rec_occurrence in rec_occurrences:
    oldpos = new_dc_formula.map_back_offset(rec_occurrence)
    if formula[oldpos] == "$":
      # Replace the "rec." back to "$".
      patches.append(textbuilder.make_patch(new_dc_formula_text, rec_occurrence, rec_occurrence+4, "$"))

  return textbuilder.Replacer(textbuilder.Text(new_dc_formula_text), patches).get_text()


class TreeConverter(ast.NodeVisitor):
  # AST nodes are documented here: https://docs.python.org/2/library/ast.html#abstract-grammar
  # pylint:disable=no-self-use

  def visit_Expression(self, node):
    return self.visit(node.body)

  def visit_BoolOp(self, node):
    return [node.op.__class__.__name__] + [self.visit(v) for v in node.values]

  def visit_BinOp(self, node):
    if not isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Mod)):
      return self.generic_visit(node)
    return [node.op.__class__.__name__, self.visit(node.left), self.visit(node.right)]

  def visit_UnaryOp(self, node):
    if not isinstance(node.op, (ast.Not)):
      return self.generic_visit(node)
    return [node.op.__class__.__name__, self.visit(node.operand)]

  def visit_Compare(self, node):
    # We don't try to support chained comparisons like "1 < 2 < 3" (though it wouldn't be hard).
    if len(node.ops) != 1 or len(node.comparators) != 1:
      raise ValueError("Can't use chained comparisons")
    return [node.ops[0].__class__.__name__, self.visit(node.left), self.visit(node.comparators[0])]

  def visit_Name(self, node):
    if node.id in named_constants:
      return ["Const", named_constants[node.id]]
    return ["Name", node.id]

  def visit_Constant(self, node):
    return ["Const", node.value]

  visit_NameConstant = visit_Constant

  def visit_Attribute(self, node):
    return ["Attr", self.visit(node.value), node.attr]

  def visit_Num(self, node):
    return ["Const", node.n]

  def visit_Str(self, node):
    return ["Const", node.s]

  def visit_List(self, node):
    return ["List"] + [self.visit(e) for e in node.elts]

  def visit_Tuple(self, node):
    return self.visit_List(node)    # We don't distinguish tuples and lists

  def generic_visit(self, node):
    raise ValueError("Unsupported syntax at %s:%s" % (node.lineno, node.col_offset + 1))
