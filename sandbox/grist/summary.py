from collections import namedtuple
import json
import re

import six

from column import is_visible_column
import sort_specs

import logger
log = logger.Logger(__name__, logger.INFO)

ColInfo = namedtuple('ColInfo', ('colId', 'type', 'isFormula', 'formula',
                                 'widgetOptions', 'label'))


def _make_col_info(col=None, **values):
  """Return a ColInfo() with the given fields, optionally copying values from the given column."""
  for key in ColInfo._fields:
    values.setdefault(key, getattr(col, key) if col else None)
  return ColInfo(**values)


def _get_colinfo_dict(col_info, with_id=False):
  """Return a dict suitable to use with AddColumn or AddTable (when with_id=True) actions."""
  col_values = {k: v for k, v in six.iteritems(col_info._asdict())
                     if v is not None and k != 'colId'}
  if with_id:
    col_values['id'] = col_info.colId
  return col_values


def _copy_widget_options(options):
  """Copies widgetOptions for a summary group-by column (omitting conditional formatting rules)"""
  if not options:
    return options
  try:
    options = json.loads(options)
  except ValueError:
    # widgetOptions are not always a valid json value (especially in tests)
    return options
  return json.dumps({k: v for k, v in options.items() if k != "rulesOptions"})

# To generate code, we need to know for each summary table, what its source table is. It would be
# easy if we had access to metadata records, but (at least for now) we generate all code based on
# schema only. So we encode the source table name inside of the summary table name.
#
# The encoding includes the length of the source table name, to avoid the possibility of ambiguity
# between the second summary table for "Foo", and the first summary table for "Foo2".
#
# Note that it means we need to rename summary tables when the source table is renamed.

def encode_summary_table_name(source_table_name):
  """
  Create a summary table name that reliably encodes the source table name. It can be decoded even
  if a suffix is added to the returned name.
  """
  return "GristSummary_%d_%s" % (len(source_table_name), source_table_name)


_summary_re = re.compile(r'GristSummary_(\d+)_')

def decode_summary_table_name(summary_table_name):
  """
  Extract the name of the source table from the summary table name.
  """
  m = _summary_re.match(summary_table_name)
  if m:
    start = m.end(0)
    length = int(m.group(1))
    source_name = summary_table_name[start : start + length]
    if len(source_name) == length:
      return source_name
  return None

def _group_colinfo(source_table):
  """Returns ColInfo() for the 'group' column that must be present in every summary table."""
  return _make_col_info(colId='group', type='RefList:%s' % source_table.tableId,
                        isFormula=True, formula='table.getSummarySourceGroup(rec)')


def _update_sort_spec(sort_spec, old_table, new_table):
  """
  Replace column references in the sort spec (which is a JSON string encoding a list of column
  refs, negated for descending) with references to the new table. Returns the new JSON string,
  or empty string in case of a problem.
  """
  old_cols_map = {c.id: c.colId for c in old_table.columns}
  new_cols_map = {c.colId: c.id for c in new_table.columns}

  # When adjusting, we take a possibly negated old colRef, and produce a new colRef.
  # If anything is gone, we return 0, which will be excluded from the new sort spec.
  def adjust(col_spec):
    old_colref = sort_specs.col_ref(col_spec)
    new_colref = new_cols_map.get(old_cols_map.get(old_colref), 0)
    return sort_specs.swap_col_ref(col_spec, new_colref)

  try:
    old_sort_spec = json.loads(sort_spec)
    new_sort_spec = [adjust(col_spec) for col_spec in old_sort_spec]
    new_sort_spec = [col_spec for col_spec in new_sort_spec if sort_specs.col_ref(col_spec)]
    return json.dumps(new_sort_spec, separators=(',', ':'))
  except Exception:
    log.warn("update_summary_section: can't parse sortColRefs JSON; clearing sortColRefs")
    return ''


def summary_groupby_col_type(source_type):
  """
  Returns the type of a groupby column in a summary table
  given the type of the corresponding column in the source table.
  Most types are returned unchanged.
  When a source table is grouped by a list-type (RefList/ChoiceList) column
  the column is 'flattened' into the corresponding non-list type
  in the summary table.
  """
  if source_type == 'ChoiceList':
    return 'Choice'
  else:
    return source_type.replace('RefList:', 'Ref:')


class SummaryActions(object):

  def __init__(self, useractions, docmodel):
    self.useractions = useractions
    self.docmodel = docmodel

  def _get_or_add_columns(self, table, all_colinfo):
    """
    Given a table record and a list of ColInfo objects, generates a list of corresponding column
    records in the table, creating appropriate columns if they don't yet exist.
    """
    prior = {c.colId: c for c in table.columns}
    for ci in all_colinfo:
      col = prior.get(ci.colId)
      if col and col.type == ci.type and col.formula == ci.formula:
        yield col
      else:
        result = self.useractions.doAddColumn(table.tableId, ci.colId,
                                              _get_colinfo_dict(ci, with_id=False))
        yield self.docmodel.columns.table.get_record(result['colRef'])


  def _get_or_create_summary(self, source_table, source_groupby_columns, formula_colinfo):
    """
    Finds a summary table or creates a new one, based on source_table, grouped by the columns
    in groupby_colinfo, and containing formulas in formula_colinfo. Source_table should be a
    Record from _grist_Tables, and other arguments should be lists of ColInfo objects.
    Returns the tuple (summary_table, groupby_columns, formula_columns).
    """
    key = tuple(sorted(int(c) for c in source_groupby_columns))

    groupby_colinfo = [
      _make_col_info(
        col=c,
        isFormula=False,
        formula='',
        widgetOptions=_copy_widget_options(c.widgetOptions),
        type=summary_groupby_col_type(c.type)
      )
      for c in source_groupby_columns
    ]
    summary_table = next((t for t in source_table.summaryTables if t.summaryKey == key), None)
    created = False
    if not summary_table:
      result = self.useractions.doAddTable(
        encode_summary_table_name(source_table.tableId),
        [_get_colinfo_dict(ci, with_id=True) for ci in groupby_colinfo + formula_colinfo],
        summarySourceTableRef=source_table.id)
      summary_table = self.docmodel.tables.table.get_record(result['id'])
      created = True
      # Note that in this case, _get_or_add_columns() below should not add any new columns,
      # but only return existing ones. (The table may contain extra columns, e.g. 'manualSort',
      # at least in theory.)

    groupby_columns = list(self._get_or_add_columns(summary_table, groupby_colinfo))
    formula_columns = list(self._get_or_add_columns(summary_table, formula_colinfo))

    if created:
      # Set the summarySourceCol field for all the group-by columns in the table.
      self.docmodel.update(groupby_columns,
                           summarySourceCol=[c.id for c in source_groupby_columns],
                           visibleCol=[c.visibleCol for c in source_groupby_columns])
      for col in groupby_columns:
        self.useractions.maybe_copy_display_formula(col.summarySourceCol, col)
      assert summary_table.summaryKey == key

    return (summary_table, groupby_columns, formula_columns)


  def update_summary_section(self, view_section, source_table, source_groupby_columns):
    source_groupby_colset = set(source_groupby_columns)
    groupby_colids = {c.colId for c in source_groupby_columns}
    prev_fields = list(view_section.fields)

    # Go through fields figuring out which ones we'll keep.
    prev_group_fields, formula_fields, delete_fields = [], [], []
    for field in prev_fields:
      # Records implement __hash__, so we can look them up in sets.
      if field.colRef.summarySourceCol in source_groupby_colset:
        prev_group_fields.append(field)
      elif field.colRef.isFormula and field.colRef.colId not in groupby_colids:
        formula_fields.append(field)
      else:
        delete_fields.append(field)

    # Prepare ColInfo for all columns we want to keep.
    formula_colinfo = [_make_col_info(f.colRef) for f in formula_fields]

    have_group_col = any(f.colRef.colId == 'group' for f in formula_fields)
    if not have_group_col:
      formula_colinfo.append(_group_colinfo(source_table))

    # Get column records for all the columns we should have in our section.
    summary_table, groupby_columns, formula_columns = self._get_or_create_summary(
      source_table, source_groupby_columns, formula_colinfo)

    if not have_group_col:
      # We've added the "group" column; now restore the lists to match what we want in fields.
      formula_colinfo.pop()
      formula_columns.pop()

    # Remember the original table, which we need later to adjust the sort spec (sortColRefs).
    orig_table = view_section.tableRef

    # This line is a bit hard to explain: we unset viewSection.tableRef before updating all the
    # fields, and then set it to the correct value. Note how undo will reverse the operations, and
    # produce the same sequence (unset, update fields, set). Client-side code relies on this to
    # avoid having to deal with inconsistent view sections while fields are being updated.
    self.docmodel.update([view_section], tableRef=0)

    # Delete fields no longer relevant.
    self.docmodel.remove(delete_fields)

    # Update fields for all formula fields and reused group-by fields to point to new columns.
    source_col_map = dict(zip(source_groupby_columns, groupby_columns))
    prev_group_columns = [source_col_map[f.colRef.summarySourceCol] for f in prev_group_fields]
    self.docmodel.update(formula_fields + prev_group_fields,
                         colRef=[c.id for c in formula_columns + prev_group_columns])

    # Finally, we need to create fields for newly-added group-by columns. If there were missing
    # fields for any group-by columns before, they'll be created now.
    new_group_columns = [c for c in groupby_columns if c not in prev_group_columns]

    # Insert these after the last existing group-by field.
    insert_pos = prev_group_fields[-1].parentPos if prev_group_fields else None
    new_group_fields = self.docmodel.insert_after(view_section.fields, insert_pos,
                                                  colRef=[c.id for c in new_group_columns])

    # Reorder the group-by fields if needed, to match the order requested.
    group_col_to_field = {f.colRef: f for f in prev_group_fields + new_group_fields}
    group_fields = [group_col_to_field[c] for c in groupby_columns]
    group_positions = [field.parentPos for field in group_fields]
    sorted_positions = sorted(group_positions)
    if sorted_positions != group_positions:
      self.docmodel.update(group_fields, parentPos=sorted_positions)

    update_args = {}
    if view_section.sortColRefs:
      # Fix the sortSpec to refer to the new columns.
      update_args['sortColRefs'] = _update_sort_spec(
        view_section.sortColRefs, orig_table, summary_table)

    # Finally update the section to point to the new table.
    self.docmodel.update([view_section], tableRef=summary_table.id, **update_args)


  def _find_sister_column(self, source_table, col_id):
    """Returns a summary formula column for source_table with the given col_id, or None."""
    for t in source_table.summaryTables:
      c = self.docmodel.columns.lookupOne(parentId=t.id, colId=col_id, isFormula=True)
      if c:
        return c
    return None


  def _create_summary_colinfo(self, source_table, source_groupby_columns):
    """Come up automatically with a list of columns to include into a summary table."""
    # Column 'group' defines the group of records that map to this summary line.
    all_colinfo = [_group_colinfo(source_table)]

    # For every column in the source data, if there is a same-named formula column in another
    # summary table, use it here; otherwise if it's a numerical column, automatically add a
    # same-named column with the sum of the values in the group.
    groupby_col_ids = {c.colId for c in source_groupby_columns}
    for col in source_table.columns:
      if col.colId in groupby_col_ids or col.colId == 'group' or not is_visible_column(col.colId):
        continue
      c = self._find_sister_column(source_table, col.colId)
      if c:
        all_colinfo.append(_make_col_info(col=c))
      elif col.type in ('Int', 'Numeric'):
        all_colinfo.append(_make_col_info(col=col, isFormula=True,
                                          formula='SUM($group.%s)' % col.colId))

    # Add a default 'count' column for the number of records in the group, unless a different
    # 'count' was already added (which we would then prefer as presumably more useful). We add the
    # default 'count' right after 'group', to make it the first of the visible formula columns.
    if not any(c.colId == 'count' for c in all_colinfo):
      all_colinfo.insert(1, _make_col_info(colId='count', type='Int',
                                           isFormula=True, formula='len($group)'))
    return all_colinfo


  def create_new_summary_section(self, source_table, source_groupby_columns, view, section_type):
    formula_colinfo = list(self._create_summary_colinfo(source_table, source_groupby_columns))
    summary_table, groupby_columns, formula_columns = self._get_or_create_summary(
      source_table, source_groupby_columns, formula_colinfo)

    section = self.docmodel.add(view.viewSections, tableRef=summary_table.id,
                                parentKey=section_type)[0]
    self.docmodel.add(section.fields,
                      colRef=[c.id for c in groupby_columns + formula_columns
                              if c.colId != "group"])
    return section


  def detach_summary_section(self, view_section):
    """
    Create a real table equivalent to the given summary section, and update the section to show
    the new table instead of the summary.
    """
    source_table_id = view_section.tableRef.summarySourceTable.tableId

    # Get a list of columns that we need for the new table.
    fields = view_section.fields
    field_col_recs = [f.colRef for f in fields]

    # Prepare the column info for each column.
    col_info = [_make_col_info(col=c) for c in field_col_recs if c.colId != 'group']

    # Prepare the 'group' column, which is that one column that's different from the original.
    group_args = ', '.join(
      '%s=%s' % (
        c.summarySourceCol.colId,
        'CONTAINS($%s)' % c.colId
        if c.summarySourceCol.type.startswith(('ChoiceList', 'RefList:')) else
        '$%s' % c.colId,
      )
      for c in field_col_recs if c.summarySourceCol
    )
    col_info.append(_make_col_info(colId='group', type='RefList:%s' % source_table_id,
                                   isFormula=True,
                                   formula='%s.lookupRecords(%s)' % (source_table_id, group_args)))

    # Create the new table.
    res = self.useractions.AddTable(None, [_get_colinfo_dict(ci, with_id=True) for ci in col_info])
    new_table = self.docmodel.tables.table.get_record(res["id"])

    # Remember the original table, which we need later e.g. to adjust the sort spec (sortColRefs).
    orig_table = view_section.tableRef

    # Populate the new table.
    old_data = self.useractions._engine.fetch_table(orig_table.tableId, formulas=False)
    self.useractions.ReplaceTableData(new_table.tableId, old_data.row_ids, old_data.columns)

    # Unset viewSection.tableRef before updating the fields, to avoid having inconsistencies. (See
    # longer explanation in update_summary_section().)
    self.docmodel.update([view_section], tableRef=0)

    # Update all fields to point to new columns.
    new_col_dict = {c.colId: c.id for c in new_table.columns}
    self.docmodel.update(fields, colRef=[new_col_dict[c.colId] for c in field_col_recs])

    # If the section is sorted, fix the sortSpec to refer to the new columns.
    update_args = {}
    if view_section.sortColRefs:
      update_args['sortColRefs'] = _update_sort_spec(
        view_section.sortColRefs, orig_table, new_table)

    # Update the section to point to the new table.
    self.docmodel.update([view_section], tableRef=new_table.id, **update_args)
