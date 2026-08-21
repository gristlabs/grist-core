"""
This module defines ActionGroup, ActionEnvelope, and ActionBundle -- classes that together
represent the result of applying a UserAction to a document.

In general, UserActions refer to logical actions performed by the user. DocActions are the
individual steps to which UserActions translate.

A list of UserActions applied together translates to multiple DocActions, packaged into an
ActionGroup. In a separate step, this ActionGroup is split up according to ACL rules into and
ActionBundle consisting of ActionEnvelopes, each containing a smaller set of actions associated
with the set of recipients who should receive them.
"""
import actions
from action_summary import ActionSummary

class ActionGroup(object):
  """
  ActionGroup packages different types of doc actions for returning them to the instance.

  The ActionGroup stores actions produced by the engine in the course of processing one or more
  UserActions, plus an array of return values, one for each UserAction.
  """
  def __init__(self):
    self.calc     = []
    self.stored   = []
    self.direct   = []
    self.undo     = []
    self.retValues = []
    self.summary = ActionSummary()
    self.requests = {}

    # Maps id(undo_action) to the index in self.stored of the doc action whose application
    # produced that undo action. This is the correspondence the engine knows directly, used on
    # the server to chunk a bundle without re-inferring it (see app/common/ActionLayout.ts
    # chunkByOwners). Keyed by object identity so it survives undo entries being reordered (the
    # ModifyColumn pop/re-append) or front-inserted. An undo action absent from this map (notably
    # the front calc-flush restores of a removed column/table/row) has no single owning stored
    # action; the server attributes those to their removal just as the lattice chunker does.
    self.undo_owner = {}

  def flush_calc_changes(self):
    """
    Merge the changes from self.summary into self.stored and self.undo, and clear the summary.
    """
    length_before = len(self.stored)
    self.summary.convert_deltas_to_actions(self.stored, self.undo, self.undo_owner)
    count = len(self.stored) - length_before
    self.direct += [False] * count
    self.summary = ActionSummary()

  def flush_calc_changes_for_column(self, table_id, col_id):
    """
    Merge the changes for the given column from self.summary into self.stored and self.undo, and
    remove that column from the summary.
    """
    length_before = len(self.stored)
    self.summary.pop_column_delta_as_actions(table_id, col_id, self.stored, self.undo,
                                             self.undo_owner)
    count = len(self.stored) - length_before
    self.direct += [False] * count

  def check_sanity(self):
    if len(self.stored) != len(self.direct):
      raise AssertionError("failed to track origin of actions")

  def get_repr(self):
    return {
      "calc":     [actions.get_action_repr(a) for a in self.calc],
      "stored":   [actions.get_action_repr(a) for a in self.stored],
      "undo":     [actions.get_action_repr(a) for a in self.undo],
      "direct": self.direct,
      "retValues": self.retValues
    }

  @classmethod
  def from_json_obj(cls, data):
    ag = ActionGroup()
    ag.calc   = [actions.action_from_repr(a) for a in data.get('calc', [])]
    ag.stored = [actions.action_from_repr(a) for a in data.get('stored', [])]
    ag.undo   = [actions.action_from_repr(a) for a in data.get('undo', [])]
    ag.retValues = data.get('retValues', [])
    return ag


class Envelope(object):
  """
  Envelope contains information about recipients as a set (or frozenset) of instanceIds.
  """
  def __init__(self, recipient_set):
    self.recipients = recipient_set

  def to_json_obj(self):
    return {"recipients": sorted(self.recipients)}

class ActionBundle(object):
  """
  ActionBundle contains actions arranged into envelopes, i.e. split up by sets of recipients.
  Note that different Envelopes contain different sets of recipients (which may overlap however).
  """
  def __init__(self):
    self.envelopes = []
    self.stored = []          # Pairs of (envIndex, docAction)
    self.direct = []          # Pairs of (envIndex, boolean)
    self.calc = []            # Pairs of (envIndex, docAction)
    self.undo = []            # Pairs of (envIndex, docAction)
    self.undo_owner = []      # Pairs of (envIndex, owner), parallel to self.undo: the stored-action
                              # index that produced each undo action, or None for a front
                              # calc-flush restore (see ActionGroup.undo_owner).
    self.retValues = []
    self.rules = set()        # RowIds of ACLRule records used to construct this ActionBundle.

  def to_json_obj(self):
    return {
      "envelopes": [e.to_json_obj() for e in self.envelopes],
      "stored":    [(env, actions.get_action_repr(a)) for (env, a) in self.stored],
      "direct":    self.direct,
      "calc":      [(env, actions.get_action_repr(a)) for (env, a) in self.calc],
      "undo":      [(env, actions.get_action_repr(a)) for (env, a) in self.undo],
      "undoOwner": self.undo_owner,
      "retValues": self.retValues,
      "rules":     sorted(self.rules)
    }
