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
    self.undo     = []
    self.retValues = []
    self.summary = ActionSummary()

  def flush_calc_changes(self):
    """
    Merge the changes from self.summary into self.stored and self.undo, and clear the summary.
    """
    self.summary.convert_deltas_to_actions(self.stored, self.undo)
    self.summary = ActionSummary()

  def flush_calc_changes_for_column(self, table_id, col_id):
    """
    Merge the changes for the given column from self.summary into self.stored and self.undo, and
    remove that column from the summary.
    """
    self.summary.pop_column_delta_as_actions(table_id, col_id, self.stored, self.undo)

  def get_repr(self):
    return {
      "calc":     map(actions.get_action_repr, self.calc),
      "stored":   map(actions.get_action_repr, self.stored),
      "undo":     map(actions.get_action_repr, self.undo),
      "retValues": self.retValues
    }

  @classmethod
  def from_json_obj(cls, data):
    ag = ActionGroup()
    ag.calc   = map(actions.action_from_repr, data.get('calc', []))
    ag.stored = map(actions.action_from_repr, data.get('stored', []))
    ag.undo   = map(actions.action_from_repr, data.get('undo', []))
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
    self.calc = []            # Pairs of (envIndex, docAction)
    self.undo = []            # Pairs of (envIndex, docAction)
    self.retValues = []
    self.rules = set()        # RowIds of ACLRule records used to construct this ActionBundle.

  def to_json_obj(self):
    return {
      "envelopes": [e.to_json_obj() for e in self.envelopes],
      "stored":    [(env, actions.get_action_repr(a)) for (env, a) in self.stored],
      "calc":      [(env, actions.get_action_repr(a)) for (env, a) in self.calc],
      "undo":      [(env, actions.get_action_repr(a)) for (env, a) in self.undo],
      "retValues": self.retValues,
      "rules":     sorted(self.rules)
    }
