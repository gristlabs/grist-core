"""
This file provides convenient access to document metadata that is internal to the sandbox.
Specifically, it has handles to the metadata tables, and adds helpful formula columns to tables
which exist only in the sandbox and are not communicated to the client.

It is similar in purpose to DocModel.js on the client side.
"""
import itertools

import six

import functions
import records
import usertypes
import relabeling
import table
import moment
from schema import RecalcWhen

# pylint:disable=redefined-outer-name

def _record_set(table_id, group_by, sort_by=None):
  @usertypes.formulaType(usertypes.ReferenceList(table_id))
  def func(rec, table):
    lookup_table = table.docmodel.get_table(table_id)
    return lookup_table.lookupRecords(sort_by=sort_by, **{group_by: rec.id})
  return func


def _record_ref_list_set(table_id, group_by, sort_by=None):
  @usertypes.formulaType(usertypes.ReferenceList(table_id))
  def func(rec, table):
    lookup_table = table.docmodel.get_table(table_id)
    return lookup_table.lookupRecords(sort_by=sort_by, **{group_by: functions.CONTAINS(rec.id)})
  return func


def _record_inverse(table_id, ref_col):
  @usertypes.formulaType(usertypes.Reference(table_id))
  def func(rec, table):
    lookup_table = table.docmodel.get_table(table_id)
    return lookup_table.lookupOne(**{ref_col: rec.id})
  return func


class MetaTableExtras(object):
  """
  Container class for enhancements to metadata table models. The members (formula methods) defined
  for a nested class here will automatically be added as members to same-named metadata table.
  """
  # pylint: disable=no-self-argument,no-member,unused-argument,not-an-iterable
  class _grist_DocInfo(object):
    @usertypes.formulaType(usertypes.Any())
    def tzinfo(rec, table):
      # pylint: disable=no-self-use
      try:
        return moment.tzinfo(rec.timezone)
      except KeyError:
        return moment.TZ_UTC

  class _grist_Tables(object):
    columns = _record_set('_grist_Tables_column', 'parentId', sort_by='parentPos')
    viewSections = _record_set('_grist_Views_section', 'tableRef')
    summaryTables = _record_set('_grist_Tables', 'summarySourceTable')

    def summaryKey(rec, table):
      """
      Returns the tuple of sorted colRefs for summary columns. This uniquely identifies a summary
      table among other summary tables for the same source table.
      """
      # pylint: disable=not-an-iterable
      return (tuple(sorted(int(c.summarySourceCol) for c in rec.columns if c.summarySourceCol))
              if rec.summarySourceTable else None)

    def setAutoRemove(rec, table):
      """
      Marks the table for removal if it's a summary table with no more (non-raw) view sections.
      """
      is_summary_table = rec.summarySourceTable
      view_sections_table = table.docmodel.get_table('_grist_Views_section')
      has_view_sections = view_sections_table.lookupOne(isRaw=False, tableRef=rec.id)
      table.docmodel.setAutoRemove(rec, is_summary_table and not has_view_sections)


  class _grist_Tables_column(object):
    viewFields = _record_set('_grist_Views_section_field', 'colRef')
    summaryGroupByColumns = _record_set('_grist_Tables_column', 'summarySourceCol')
    usedByCols = _record_set('_grist_Tables_column', 'displayCol')
    usedByFields = _record_set('_grist_Views_section_field', 'displayCol')
    ruleUsedByCols = _record_ref_list_set('_grist_Tables_column', 'rules')
    ruleUsedByFields = _record_ref_list_set('_grist_Views_section_field', 'rules')
    ruleUsedByTables = _record_ref_list_set('_grist_Views_section', 'rules')

    def tableId(rec, table):
      return rec.parentId.tableId

    def numDisplayColUsers(rec, table):
      """
      Returns the number of cols and fields using this col as a display col
      """
      return len(rec.usedByCols) + len(rec.usedByFields)

    def numRuleColUsers(rec, table):
      """
      Returns the number of cols and fields using this col as a rule
      """
      return len(rec.ruleUsedByCols) + len(rec.ruleUsedByFields)

    def numRuleTableUsers(rec, table):
      """
      Returns the number of tables using this col as a rule
      """
      return len(rec.ruleUsedByTables)

    def recalcOnChangesToSelf(rec, table):
      """
      Whether the column is a trigger-formula column that depends on itself, used for
      data-cleaning. (A manual change to it will trigger its own recalculation.)
      """
      return rec.recalcWhen == RecalcWhen.DEFAULT and rec.id in rec.recalcDeps

    def setAutoRemove(rec, table):
      """Marks the col for removal if it's a display/rule helper col with no more users."""
      as_display = rec.colId.startswith('gristHelper_Display') and rec.numDisplayColUsers == 0
      as_col_rule = rec.colId.startswith('gristHelper_ConditionalRule') and rec.numRuleColUsers == 0
      as_row_rule = (
        rec.colId.startswith('gristHelper_RowConditionalRule') and rec.numRuleTableUsers == 0
      )
      table.docmodel.setAutoRemove(rec, as_display or as_col_rule or as_row_rule)


  class _grist_Views(object):
    viewSections = _record_set('_grist_Views_section', 'parentId')
    tabBarItems = _record_set('_grist_TabBar', 'viewRef')
    primaryViewTable = _record_inverse('_grist_Tables', 'primaryViewId')
    pageItems = _record_set('_grist_Pages', 'viewRef')

  class _grist_Views_section(object):
    fields = _record_set('_grist_Views_section_field', 'parentId', sort_by='parentPos')

    def isRaw(rec, table):
      return rec.tableRef.rawViewSectionRef == rec

    def isRecordCard(rec, table):
      return rec.tableRef.recordCardViewSectionRef == rec

  class _grist_Filters(object):
    def setAutoRemove(rec, table):
      """Marks the filter for removal if its column no longer exists."""
      table.docmodel.setAutoRemove(rec, not rec.colRef)


  class _grist_Cells(object):
    def setAutoRemove(rec, table):
      if rec.type == 1: # Cell info of type 1 == Comments
        # Remove if discussion is removed.
        noParent = not rec.root and not rec.parentId
        if rec.tableRef and rec.rowId:
          tableRef = table.docmodel.get_table(rec.tableRef.tableId)
          row = tableRef.lookupOne(id=rec.rowId)
        else:
          row = False
        # Remove if row is removed, column is removed, table is removed or all comments are removed.
        no_cell = not rec.colRef or not rec.tableRef or not row
        table.docmodel.setAutoRemove(rec, noParent or no_cell)


def enhance_model(model_class):
  """
  Given a metadata model class, add all members (formula methods) to it from the same-named inner
  class of MetaTableExtras. The added members are marked as private; the resulting Column objects
  will have col.is_private() as true.
  """
  extras_class = getattr(MetaTableExtras, model_class.__name__, None)
  if not extras_class:
    return
  for name, member in six.iteritems(extras_class.__dict__):
    if not name.startswith("__"):
      member.__name__ = name
      member.is_private = True
      setattr(model_class, name, member)

# There is a single instance of DocModel per sandbox process and
# global_docmodel is a reference to it
global_docmodel = None

class DocModel(object):
  """
  This class defines more convenient handles to all metadata tables. In addition, it sets
  table.docmodel member for each of these tables to itself. Note that it deals with
  table.UserTable objects (rather than the lower-level table.Table objects).
  """
  def __init__(self, engine):
    self._engine = engine
    global global_docmodel # pylint: disable=global-statement
    global_docmodel = self

    # Set of records scheduled for automatic removal.
    self._auto_remove_set = set()

  def update_tables(self):
    """
    Update the table handles we maintain to correspond to the current Engine tables.
    """
    self.doc_info                = self._prep_table("_grist_DocInfo")
    self.tables                  = self._prep_table("_grist_Tables")
    self.columns                 = self._prep_table("_grist_Tables_column")
    self.tab_bar                 = self._prep_table("_grist_TabBar")
    self.views                   = self._prep_table("_grist_Views")
    self.view_sections           = self._prep_table("_grist_Views_section")
    self.view_fields             = self._prep_table("_grist_Views_section_field")
    self.validations             = self._prep_table("_grist_Validations")
    self.repl_hist               = self._prep_table("_grist_REPL_Hist")
    self.attachments             = self._prep_table("_grist_Attachments")
    self.pages                   = self._prep_table("_grist_Pages")
    self.aclResources            = self._prep_table("_grist_ACLResources")
    self.aclRules                = self._prep_table("_grist_ACLRules")
    self.filters                 = self._prep_table("_grist_Filters")
    self.cells                   = self._prep_table("_grist_Cells")

  def _prep_table(self, name):
    """
    Helper that gets the table with the given name, and sets its .doc attribute to DocModel.
    """
    user_table = self._engine.tables[name].user_table
    user_table.docmodel = self
    return user_table

  def get_table(self, table_id):
    return self._engine.tables[table_id].user_table


  def get_table_rec(self, table_id):
    """Returns the table record for the given table name, or raises ValueError."""
    table_rec = self.tables.lookupOne(tableId=table_id)
    if not table_rec:
      raise ValueError("No such table: %s" % table_id)
    return table_rec

  def get_column_rec(self, table_id, col_id):
    """Returns the column record for the given table and column names, or raises ValueError."""
    col_rec = self.columns.lookupOne(tableId=table_id, colId=col_id)
    if not col_rec:
      raise ValueError("No such column: %s.%s" % (table_id, col_id))
    return col_rec


  def setAutoRemove(self, record, yes_or_no):
    """
    Marks a record for automatic removal. To use, create a formula in your table, e.g.
    'setAutoRemove', which calls `table.docmodel.setAutoRemove(boolean_value)`. Whenever it gets
    reevaluated and the boolean_value is true, the record will be automatically removed.
    It's mostly used for metadata tables. It's also used for summary table rows with empty groups,
    which requires a bit of extra care.
    """
    if yes_or_no:
      self._auto_remove_set.add(record)
    else:
      self._auto_remove_set.discard(record)

  def apply_auto_removes(self):
    """
    Remove the records marked for removal.
    """
    # Sort to make sure removals are done in deterministic order.
    gone_records = sorted(
      self._auto_remove_set,
      # Remove tables last to prevent errors trying to remove rows or columns from deleted tables.
      key=lambda r: (r._table.table_id == "_grist_Tables", r)
    )
    self._auto_remove_set.clear()
    # setAutoRemove is called by formulas, notably summary tables, and shouldn't be blocked by ACL.
    with self._engine.user_actions.indirect_actions():
      self.remove(gone_records)
    return bool(gone_records)

  def remove(self, records):
    """
    Removes all records in the given iterable of Records.
    """
    for table_id, group in itertools.groupby(records, lambda r: r._table.table_id):
      self._engine.user_actions.BulkRemoveRecord(table_id, [int(r) for r in group])

  def update(self, records, **col_values):
    """
    Updates all records in the given list of Records or a RecordSet; col_values maps column ids to
    values. The values may either be a list of the length len(records), or a non-list value that
    will be used for all records.
    """
    record_list = list(records)
    if not record_list:
      return
    table_id = record_list[0]._table.table_id
    # Make sure these are all records from the same table.
    assert all(r._table.table_id == table_id for r in record_list)
    row_ids = [int(r) for r in record_list]
    values = _unify_col_values(col_values, len(record_list))
    self._engine.user_actions.BulkUpdateRecord(table_id, row_ids, values)

  def add(self, record_set_or_table, **col_values):
    """
    Add new records for the given table; col_values maps column ids to values. Values may either
    be lists (all of the same length), or non-list values that will be used for all added records.
    Either a UserTable or a RecordSet may used as the first argument. If it is a RecordSet created
    with lookupRecords, it may set additional col_values.
    Returns a list of inserted records.
    """
    assert isinstance(record_set_or_table, (records.RecordSet, table.UserTable))
    count = _get_col_values_count(col_values)
    values = _unify_col_values(col_values, count)

    if isinstance(record_set_or_table, records.RecordSet):
      table_obj = record_set_or_table._table
      group_by = record_set_or_table._group_by
      if group_by:
        values.update((k, [v] * count) for k, v in six.iteritems(group_by) if k not in values)
    else:
      table_obj = record_set_or_table.table

    row_ids = self._engine.user_actions.BulkAddRecord(table_obj.table_id, [None] * count, values)
    return [table_obj.Record(r, None) for r in row_ids]

  def insert(self, record_set, position, **col_values):
    """
    Add new records using col_values, inserting them into record_set according to position.
    This may only be used when record_set is sorted by a field of type PositionNumber; in
    particular it must be the result of lookupRecords() with 'sort_by' parameter.
    Position may be numeric (to compare to other sort_by values), or None to insert at the end.
    Returns a list of inserted records.
    """
    assert isinstance(record_set, records.RecordSet), \
        "docmodel.insert() may only be used on a RecordSet, not %s" % type(record_set)
    sort_by = getattr(record_set, '_sort_by', None)
    assert sort_by, \
        "docmodel.insert() may only be used on a sorted RecordSet"
    column = record_set._table.get_column(sort_by)
    assert isinstance(column.type_obj, usertypes.PositionNumber), \
        "docmodel.insert() may only be used on a RecordSet sorted by PositionNumber type column"

    col_values[sort_by] = float('inf') if position is None else position
    return self.add(record_set, **col_values)

  def insert_after(self, record_set, position, **col_values):
    """
    Same as insert, but when position is equal to the position of an existing record, inserts
    after that record; and when position is None, inserts at the beginning.
    """
    # We can reuse insert() by just using the next float for position. As long as positions of
    # existing records are different, that would necessarily place the new records correctly.
    pos = float('-inf') if position is None else relabeling.nextfloat(position)
    return self.insert(record_set, pos, **col_values)


def _unify_col_values(col_values, count):
  """
  Helper that converts a dict mapping keys to values or lists of values to all lists. Non-list
  values get turned into lists by repeating them count times.
  """
  assert all(len(v) == count for v in six.itervalues(col_values) if isinstance(v, list))
  return {k: (v if isinstance(v, list) else [v] * count)
          for k, v in six.iteritems(col_values)}

def _get_col_values_count(col_values):
  """
  Helper that returns the length of the first list in among the values of col_values. If none of
  the values is a list, returns 1.
  """
  first_list = next((v for v in six.itervalues(col_values) if isinstance(v, list)), None)
  return len(first_list) if first_list is not None else 1
