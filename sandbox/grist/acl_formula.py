import ast

import asttokens

from predicate_formula import NamedEntity, parse_predicate_formula_json, TreeConverter

def parse_acl_formulas(col_values):
  """
  Populates `aclFormulaParsed` by parsing `aclFormula` for all `col_values`.
  """
  if 'aclFormula' not in col_values:
    return

  col_values['aclFormulaParsed'] = [parse_predicate_formula_json(v)
                                    for v
                                    in col_values['aclFormula']]

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

class _EntityCollector(TreeConverter):
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
