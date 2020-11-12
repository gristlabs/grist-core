# This file used to implement (partially) old plans for granular ACLs.
# It now retains only the minimum needed to keep new documents openable by old code,
# and to produce the ActionBundles expected by other code.

import action_obj

class Permissions(object):
  # Permission types and their combination are represented as bits of a single integer.
  VIEW          = 0x1
  UPDATE        = 0x2
  ADD           = 0x4
  REMOVE        = 0x8
  SCHEMA_EDIT   = 0x10
  ACL_EDIT      = 0x20
  EDITOR        = VIEW | UPDATE | ADD | REMOVE
  ADMIN         = EDITOR | SCHEMA_EDIT
  OWNER         = ADMIN | ACL_EDIT


# Special recipients, or instanceIds. ALL is the special recipient for schema actions that
# should be shared with all collaborators of the document.
ALL = '#ALL'
ALL_SET = frozenset([ALL])


def acl_read_split(action_group):
  """
  Returns an ActionBundle containing actions from the given action_group, all in one envelope.
  With the deprecation of old-style ACL rules, envelopes are not used at all, and only kept to
  avoid triggering unrelated code changes.
  """
  bundle = action_obj.ActionBundle()
  bundle.envelopes.append(action_obj.Envelope(ALL_SET))
  bundle.stored.extend((0, da) for da in action_group.stored)
  bundle.calc.extend((0, da) for da in action_group.calc)
  bundle.undo.extend((0, da) for da in action_group.undo)
  bundle.retValues = action_group.retValues
  return bundle
