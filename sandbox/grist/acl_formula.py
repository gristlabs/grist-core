import ast
import io
import json
import tokenize
from collections import namedtuple

import asttokens
import six

from codebuilder import replace_dollar_attrs

def parse_acl_formula(acl_formula):
  """
  Parse an ACL formula expression into a parse tree that we can interpret in JS, e.g.
  "rec.office == 'Seattle' and user.email in ['sally@', 'xie@']".

  The idea is to support enough to express ACL rules flexibly, but we don't need to support too
  much, since rules should be reasonably simple.

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
  if isinstance(acl_formula, six.binary_type):
    acl_formula = acl_formula.decode('utf8')
  try:
    acl_formula = replace_dollar_attrs(acl_formula)
    tree = ast.parse(acl_formula, mode='eval')
    result = _TreeConverter().visit(tree)
    for part in tokenize.generate_tokens(io.StringIO(acl_formula).readline):
      if part[0] == tokenize.COMMENT and part[1].startswith('#'):
        result = ['Comment', result, part[1][1:].strip()]
        break
    return result
  except SyntaxError as err:
    # In case of an error, include line and offset.
    raise SyntaxError("%s on line %s col %s" % (err.args[0], err.lineno, err.offset))


def parse_acl_formula_json(acl_formula):
  """
  As parse_acl_formula(), but stringifies the result, and converts empty string to empty string.
  """
  return json.dumps(parse_acl_formula(acl_formula)) if acl_formula else ""


# Entities encountered in ACL formulas, which may get renamed.
#   type : 'recCol'|'userAttr'|'userAttrCol',
#   start_pos: number,        # start position of the token in the code.
#   name: string,             # the name that may be updated by a rename.
#   extra: string|None,       # name of userAttr in case of userAttrCol; otherwise None.
NamedEntity = namedtuple('NamedEntity', ('type', 'start_pos', 'name', 'extra'))

def parse_acl_grist_entities(acl_formula):
  """
  Parse the ACL formula collecting any entities that may be subject to renaming. Returns a
  NamedEntity list.
  """
  try:
    atok = asttokens.ASTTokens(acl_formula, tree=ast.parse(acl_formula, mode='eval'))
    converter = _EntityCollector()
    converter.visit(atok.tree)
    return converter.entities
  except SyntaxError as err:
    return []


named_constants = {
  'True': True,
  'False': False,
  'None': None,
}

class _TreeConverter(ast.NodeVisitor):
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


class _EntityCollector(_TreeConverter):
  def __init__(self):
    self.entities = []    # NamedEntity list

  def visit_Attribute(self, node):
    parent = self.visit(node.value)

    # We recognize a couple of specific patterns for entities that may be affected by renames.
    if parent == ['Name', 'rec'] or parent == ['Name', 'newRec']:
      # rec.COL refers to the column from the table that the rule is on.
      self.entities.append(NamedEntity('recCol', node.last_token.startpos, node.attr, None))
    if parent == ['Name', 'user']:
      # user.ATTR is a user attribute.
      self.entities.append(NamedEntity('userAttr', node.last_token.startpos, node.attr, None))
    elif parent[0] == 'Attr' and parent[1] == ['Name', 'user']:
      # user.ATTR.COL is a column from the lookup table of the UserAttribute ATTR.
      self.entities.append(
          NamedEntity('userAttrCol', node.last_token.startpos, node.attr, parent[2]))

    return ["Attr", parent, node.attr]
