"""
A Relation represent mapping between rows, and used in determining which rows need to be
recomputed when something changes.

Relations can be determined by a foreign key or another form of lookup, and they may be composed.

  For example, if Person.zip is the formula 'rec.school.address.zip', it involves three Relations:
  ReferenceRelation between Person and School tables, another ReferenceRelation between School and
  Address tables. Together, they form ComposedRelation relation between Person and Address tables.

"""
import depend

class Relation(object):
  """
  Represents a row mapping between two tables. The arguments are table IDs (not actual tables).
  """
  def __init__(self, referring_table, target_table):
    self.referring_table = referring_table
    self.target_table = target_table

    # Maps the relation objects that we wrap to the resulting composed relations.
    self._target_relations = {}

  def get_affected_rows(self, input_rows):
    """
    Given an iterable over input (dependency) rows, returns a `set` of output (dependent) rows.
    """
    raise NotImplementedError()

  def reset_all(self):
    """
    Called when the dependency using this relation is reset, and this relation is no longer used.
    """
    self.reset_rows(depend.ALL_ROWS)

  def reset_rows(self, referring_rows):
    """
    Call when starting to compute a formula to tell a Relation that it can start with a clean
    slate for all row_ids in the passed-in iterable.
    """
    pass

  def compose(self, other_relation):
    r = self._target_relations.get(other_relation)
    if r is None:
      r = self._target_relations[other_relation] = ComposedRelation(self, other_relation)
    return r

class IdentityRelation(Relation):
  """
  The trivial mapping, used to represent the relation between fields of the same record.
  """
  def __init__(self, table_id):
    super(IdentityRelation, self).__init__(table_id, table_id)

  def get_affected_rows(self, input_rows):
    return input_rows

  def __str__(self):
    return "Identity(%s)" % self.referring_table

  # Important: we intentionally do not optimize compose() for an IdentityRelation, since
  # (Identity + Rel) is not the same Rel when it comes to reset_rows() calls. [See test_lookups.py
  # test_dependencies_relations_bug for a detailed description of a bug this can cause.]


class SingleRowsIdentityRelation(IdentityRelation):
  """
  Represents an identity relation, but one which refuses to pass along ALL_ROWS. In other words,
  if a full column changed (i.e. ALL_ROWS), none of the dependent cells will be considered
  changed. But when specific rows are changed, those changes propagate.

  This is used for trigger formulas, to ensure they don't recalculate in full when a dependency
  column is renamed or modified (as opposed to particular records).
  """
  def get_affected_rows(self, input_rows):
    return [] if input_rows == depend.ALL_ROWS else input_rows


class ComposedRelation(Relation):
  """
  Represents a composition of two Relations. E.g. if referring side maps Students to Schools, and
  target_side maps Schools to Addresses, then the composition maps Students to Addresses (so a
  Student records depend on Address records, and changes to Address records affect Students).
  """
  def __init__(self, referring_side, target_side):
    assert referring_side.target_table == target_side.referring_table
    super(ComposedRelation, self).__init__(referring_side.referring_table,
                                           target_side.target_table)
    self.source_relation = referring_side
    self.target_relation = target_side

  def get_affected_rows(self, input_rows):
    return self.source_relation.get_affected_rows(
      self.target_relation.get_affected_rows(input_rows))

  def reset_rows(self, referring_rows):
    # In the example from the doc-string, this says that certain Students are being recomputed, so
    # no longer refer to any Schools. It doesn't say anything about Schools' dependence on
    # Addresses, so there is nothing to reset in self.target_relation.
    self.source_relation.reset_rows(referring_rows)

  def __str__(self):
    return "%s + %s" % (self.source_relation, self.target_relation)


class ReferenceRelation(Relation):
  """
  Base class for Relations between records in two tables.
  """
  def __init__(self, referring_table, target_table, ref_col_id):
    super(ReferenceRelation, self).__init__(referring_table, target_table)
    self.inverse_map = {}     # maps target rows to sets of referring rows
    self._ref_col_id = ref_col_id

  def __str__(self):
    return "ReferenceRelation(%s.%s)" % (self.referring_table, self._ref_col_id)

  def get_affected_rows(self, input_rows):
    # Each input row (target of the reference link) may be pointed to by multiple references,
    # so we need to take the union of all of those sets.
    if input_rows == depend.ALL_ROWS:
      return depend.ALL_ROWS
    affected_rows = set()
    for target_row_id in input_rows:
      affected_rows.update(self.inverse_map.get(target_row_id, ()))
    return affected_rows

  def add_reference(self, referring_row_id, target_row_id):
    self.inverse_map.setdefault(target_row_id, set()).add(referring_row_id)

  def remove_reference(self, referring_row_id, target_row_id):
    self.inverse_map[target_row_id].discard(referring_row_id)

  def clear(self):
    self.inverse_map.clear()
