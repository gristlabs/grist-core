# pylint:disable=too-many-lines
import json
import logging
import re
from collections import defaultdict

import six
from six.moves import xrange

import actions
import identifiers
import schema
import summary
import table_data_set
from column import is_visible_column

log = logging.getLogger(__name__)

# PHILOSOPHY OF MIGRATIONS.
#
# We should probably never remove, modify, or rename metadata tables or columns.
# Instead, we should only add.
#
# We can mark old columns/tables as deprecated, which should be ignored except to prevent us from
# adding same-named entities in the future.
#
# If we change the meaning of a column, we have to create a new column with a new name.
#
# This should make it at least barely possible to share documents by people who are not all on the
# same Grist version (even so, it will require more work). It should also make it somewhat safe to
# upgrade and then open the document with a previous version.
#
# After each migration you probably should run these commands:
# ./test/upgradeDocument public_samples/*.grist
# UPDATE_REGRESSION_DATA=1 GREP_TESTS=DocRegressionTests ./test/testrun.sh server
# ./test/upgradeDocument core/test/fixtures/docs/Hello.grist

all_migrations = {}

def noop_migration(_all_tables):
  return []

# Each migration function includes a .need_all_tables attribute. See migration() decorator.
noop_migration.need_all_tables = False


def create_migrations(all_tables, metadata_only=False):
  """
  Creates and returns a list of DocActions needed to bring this document to
  schema.SCHEMA_VERSION.
    all_tables: all tables or just the metadata tables (those named with _grist_ prefix) as a
      dictionary mapping table name to TableData.
    metadata_only: should be set if only metadata tables are passed in. If ALL tables are
      required to process migrations, this method will raise a "need all tables..." exception.
  """
  try:
    doc_version = all_tables['_grist_DocInfo'].columns["schemaVersion"][0]
  except Exception:
    doc_version = 0

  # We create a TableDataSet, and populate it with the subset of the current schema that matches
  # all_tables. For missing items, we make up tables and incomplete columns, which should be OK
  # since we would not be adding new records to deprecated columns.
  # Note that this approach makes it NOT OK to change column types.
  tdset = table_data_set.TableDataSet()

  # For each table in the provided metadata tables, create an AddTable action.
  user_schema = schema.build_schema(all_tables['_grist_Tables'],
                                    all_tables['_grist_Tables_column'],
                                    include_builtin=False)
  for t in six.itervalues(user_schema):
    tdset.apply_doc_action(actions.AddTable(t.tableId, schema.cols_to_dict_list(t.columns)))

  # For each old table/column, construct an AddTable action using the current schema.
  new_schema = {a.table_id: a for a in schema.schema_create_actions()}
  for table_id, data in sorted(six.iteritems(all_tables)):
    # User tables should already be in tdset; the rest must be metadata tables.
    # (If metadata_only is true, there is simply nothing to skip here.)
    if table_id not in tdset.all_tables:
      new_col_info = {}
      if table_id in new_schema:
        new_col_info = {c['id']: c for c in new_schema[table_id].columns}
      # Use an incomplete default for unknown (i.e. deprecated) columns; some uses of the column
      # would be invalid, such as adding a new record with missing values.
      col_info = sorted([new_col_info.get(col_id, {'id': col_id}) for col_id in data.columns],
                        key=lambda c: list(six.iteritems(c)))
      tdset.apply_doc_action(actions.AddTable(table_id, col_info))

    # And load in the original data, interpreting the TableData object as BulkAddRecord action.
    tdset.apply_doc_action(actions.BulkAddRecord(*data))

  migration_actions = []
  for version in xrange(doc_version + 1, schema.SCHEMA_VERSION + 1):
    migration_func = all_migrations.get(version, noop_migration)
    if migration_func.need_all_tables and metadata_only:
      raise Exception("need all tables for migration to %s" % version)
    migration_actions.extend(all_migrations.get(version, noop_migration)(tdset))

  # Note that if we are downgrading versions (i.e. doc_version is higher), then the following is
  # the only action we include into the migration.
  migration_actions.append(actions.UpdateRecord('_grist_DocInfo', 1, {
    'schemaVersion': schema.SCHEMA_VERSION
  }))
  return migration_actions

def get_last_migration_version():
  """
  Returns the last schema version number for which we have a migration defined.
  """
  return max(all_migrations)

def migration(schema_version, need_all_tables=False):
  """
  Decorator for migrations that associates the decorated migration function with the given
  schema_version. This decorated function will be run to migrate forward to schema_version.

  Migrations are first attempted with only metadata tables, but if any required migration function
  is marked with need_all_tables=True, then the migration will be retried with all tables.

  NOTE: new migrations should NOT set need_all_tables=True; it would require more work to process
  very large documents safely (including those containing on-demand tables).
  """
  def add_migration(migration_func):
    migration_func.need_all_tables = need_all_tables
    all_migrations[schema_version] = migration_func
    return migration_func
  return add_migration

# A little shorthand to make AddColumn actions more concise.
def add_column(table_id, col_id, col_type, *args, **kwargs):
  return actions.AddColumn(table_id, col_id,
                           schema.make_column(col_id, col_type, *args, **kwargs))

# Another shorthand to only add a column if it isn't already there.
def maybe_add_column(tdset, table_id, col_id, col_type, *args, **kwargs):
  if col_id not in tdset.all_tables[table_id].columns:
    return add_column(table_id, col_id, col_type, *args, **kwargs)
  return None

# Returns the next unused row id for the records of the table given by table_id.
def next_id(tdset, table_id):
  row_ids = tdset.all_tables[table_id].row_ids
  return max(row_ids) + 1 if row_ids else 1

# Parses a json string, but returns an empty object for invalid json.
def safe_parse(json_str):
  try:
    return json.loads(json_str)
  except ValueError:
    return {}

@migration(schema_version=1)
def migration1(tdset):
  """
  Add TabItems table, and populate based on existing sections.
  """
  doc_actions = []

  # The very first migration is extra-lax, and creates some tables that are missing in some test
  # docs. That's only because we did not distinguish schema version before migrations were
  # implemented. Other migrations should not need such conditionals.
  if '_grist_Attachments' not in tdset.all_tables:
    doc_actions.append(actions.AddTable("_grist_Attachments", [
      schema.make_column("fileIdent",    "Text"),
      schema.make_column("fileName",     "Text"),
      schema.make_column("fileType",     "Text"),
      schema.make_column("fileSize",     "Int"),
      schema.make_column("timeUploaded", "DateTime")
    ]))

  if '_grist_TabItems' not in tdset.all_tables:
    doc_actions.append(actions.AddTable("_grist_TabItems", [
      schema.make_column("tableRef",     "Ref:_grist_Tables"),
      schema.make_column("viewRef",      "Ref:_grist_Views"),
    ]))

  if 'schemaVersion' not in tdset.all_tables['_grist_DocInfo'].columns:
    doc_actions.append(add_column('_grist_DocInfo', 'schemaVersion', 'Int'))

  doc_actions.extend([
    add_column('_grist_Attachments', 'imageHeight', 'Int'),
    add_column('_grist_Attachments', 'imageWidth', 'Int'),
  ])

  view_sections = actions.transpose_bulk_action(tdset.all_tables['_grist_Views_section'])
  rows = sorted({(s.tableRef, s.parentId) for s in view_sections})
  if rows:
    values = {'tableRef': [r[0] for r in rows],
              'viewRef':  [r[1] for r in rows]}
    row_ids = list(xrange(1, len(rows) + 1))
    doc_actions.append(actions.ReplaceTableData('_grist_TabItems', row_ids, values))

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=2)
def migration2(tdset):
  """
  Add TableViews table, and populate based on existing sections.
  Add TabBar table, and populate based on existing views.
  Add PrimaryViewId to Tables and populated using relatedViews
  """
  # Maps tableRef to viewRef
  primary_views = {}

  # Associate each view with a single table; this dict includes primary views.
  views_to_table = {}

  # For each table, find a view to serve as the primary view.
  view_sections = actions.transpose_bulk_action(tdset.all_tables['_grist_Views_section'])
  for s in view_sections:
    if s.tableRef not in primary_views and s.parentKey == "record":
      # The view containing this section is a good candidate for primary view.
      primary_views[s.tableRef] = s.parentId

    if s.parentId not in views_to_table:
      # The first time we see a (view, table) combination, associate the view with that table.
      views_to_table[s.parentId] = s.tableRef

  def create_primary_views_action(primary_views):
    row_ids = sorted(primary_views.keys())
    values = {'primaryViewId': [primary_views[r] for r in row_ids]}
    return actions.BulkUpdateRecord('_grist_Tables', row_ids, values)

  def create_tab_bar_action(views_to_table):
    row_ids = list(xrange(1, len(views_to_table) + 1))
    return actions.ReplaceTableData('_grist_TabBar', row_ids, {
      'viewRef': sorted(views_to_table.keys())
    })

  def create_table_views_action(views_to_table, primary_views):
    related_views = sorted(set(views_to_table.keys()) - set(primary_views.values()))
    row_ids = list(xrange(1, len(related_views) + 1))
    return actions.ReplaceTableData('_grist_TableViews', row_ids, {
      'tableRef': [views_to_table[v] for v in related_views],
      'viewRef':  related_views,
    })

  return tdset.apply_doc_actions([
    actions.AddTable('_grist_TabBar', [
      schema.make_column('viewRef', 'Ref:_grist_Views'),
    ]),
    actions.AddTable('_grist_TableViews', [
      schema.make_column('tableRef', 'Ref:_grist_Tables'),
      schema.make_column('viewRef', 'Ref:_grist_Views'),
    ]),
    add_column('_grist_Tables', 'primaryViewId', 'Ref:_grist_Views'),
    create_primary_views_action(primary_views),
    create_tab_bar_action(views_to_table),
    create_table_views_action(views_to_table, primary_views)
  ])

@migration(schema_version=3)
def migration3(tdset):
  """
  There is no longer a "Derived" type for columns, and summary tables use the type suitable for
  the column being summarized. For old documents, convert "Derived" type to "Any", and adjust the
  usage of "lookupOrAddDerived()" function.
  """
  # Note that this is a complicated migration, and mainly acceptable because it is before our very
  # first release. For a released product, a change like this should be done in a backwards
  # compatible way: keep but deprecate 'Derived'; introduce a lookupOrAddDerived2() to use for new
  # summary tables, but keep the old interface as well for existing ones. The reason is that such
  # migrations are error-prone and may mess up customers' data.
  doc_actions = []
  tables = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables']))
  tables_map = {t.id: t for t in tables}
  columns = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables_column']))

  # Convert columns from type 'Derived' to type 'Any'
  affected_cols = [c for c in columns if c.type == 'Derived']
  if affected_cols:
    doc_actions.extend(
      actions.ModifyColumn(tables_map[c.parentId].tableId, c.colId, {'type': 'Any'})
      for c in affected_cols
    )
    doc_actions.append(actions.BulkUpdateRecord(
      '_grist_Tables_column',
      [c.id for c in affected_cols],
      {'type': ['Any' for c in affected_cols]}
    ))

  # Convert formulas of the form '.lookupOrAddDerived($x,$y)' to '.lookupOrAddDerived(x=$x,y=$y)'
  formula_re = re.compile(r'(\w+).lookupOrAddDerived\((.*?)\)')
  arg_re = re.compile(r'^\$(\w+)$')
  def replace(match):
    args = ", ".join(arg_re.sub(r'\1=$\1', arg.strip()) for arg in match.group(2).split(","))
    return '%s.lookupOrAddDerived(%s)' % (match.group(1), args)

  formula_updates = []
  for c in columns:
    new_formula = c.formula and formula_re.sub(replace, c.formula)
    if new_formula != c.formula:
      formula_updates.append((c, new_formula))

  if formula_updates:
    doc_actions.extend(
      actions.ModifyColumn(tables_map[c.parentId].tableId, c.colId, {'formula': f})
      for c, f in formula_updates
    )
    doc_actions.append(actions.BulkUpdateRecord(
      '_grist_Tables_column',
      [c.id for c, f in formula_updates],
      {'formula': [f for c, f in formula_updates]}
    ))
  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=4)
def migration4(tdset):
  """
  Add TabPos column to TabBar table
  """
  doc_actions = []
  row_ids = tdset.all_tables['_grist_TabBar'].row_ids
  doc_actions.append(add_column('_grist_TabBar', 'tabPos', 'PositionNumber'))
  doc_actions.append(actions.BulkUpdateRecord('_grist_TabBar', row_ids, {'tabPos': row_ids}))

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=5)
def migration5(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Views', 'primaryViewTable', 'Ref:_grist_Tables',
               formula='_grist_Tables.lookupOne(primaryViewId=$id)', isFormula=True),
  ])

@migration(schema_version=6)
def migration6(tdset):
  # This undoes the previous migration, since primaryViewTable is now a formula private to the
  # sandbox rather than part of the document schema.
  return tdset.apply_doc_actions([
    actions.RemoveColumn('_grist_Views', 'primaryViewTable'),
  ])

@migration(schema_version=7)
def migration7(tdset):
  """
  Add summarySourceTable/summarySourceCol fields to metadata, and adjust existing summary tables
  to correspond to the new style.
  """
  # Note: this migration has some faults.
  # - It doesn't delete viewSectionFields for columns it removes (if a user added some special
  #   columns manually.
  # - It doesn't fix types of Reference columns that refer to old-style summary tables
  #   (if the user created some such columns manually).

  doc_actions = [action for action in [
    maybe_add_column(tdset, '_grist_Tables', 'summarySourceTable', 'Ref:_grist_Tables'),
    maybe_add_column(tdset, '_grist_Tables_column', 'summarySourceCol', 'Ref:_grist_Tables_column')
  ] if action]

  # Maps tableRef to Table object.
  tables_map = {t.id: t for t in actions.transpose_bulk_action(tdset.all_tables['_grist_Tables'])}

  # Maps tableName to tableRef
  table_name_to_ref = {t.tableId: t.id for t in six.itervalues(tables_map)}

  # List of Column objects
  columns = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables_column']))

  # Maps columnRef to Column object.
  columns_map_by_ref = {c.id: c for c in columns}

  # Maps (tableRef, colName) to Column object.
  columns_map_by_table_colid = {(c.parentId, c.colId): c for c in columns}

  # Set of all tableNames.
  table_name_set = set(table_name_to_ref.keys())

  remove_cols = []        # List of columns to remove
  formula_updates = []    # List of (column, new_table_name, new_formula) pairs
  table_renames = []      # List of (table, new_name) pairs
  source_tables = []      # List of (table, summarySourceTable) pairs
  source_cols = []        # List of (column, summarySourceColumn) pairs

  # Summary tables used to be named as "Summary_<SourceName>_<ColRef1>_<ColRef2>". This regular
  # expression parses that.
  summary_re = re.compile(r'^Summary_(\w+?)((?:_\d+)*)$')
  for t in six.itervalues(tables_map):
    m = summary_re.match(t.tableId)
    if not m or m.group(1) not in table_name_to_ref:
      continue
    # We have a valid summary table.
    source_table_name = m.group(1)
    source_table_ref = table_name_to_ref[source_table_name]
    groupby_colrefs = [int(x) for x in m.group(2).strip("_").split("_")]
    # Prepare a new-style name for the summary table. Be sure not to conflict with existing tables
    # or with each other (i.e. don't rename multiple tables to the same name).
    groupby_col_ids = [columns_map_by_ref[c].colId for c in groupby_colrefs]
    new_name = summary.encode_summary_table_name(source_table_name, groupby_col_ids)
    new_name = identifiers.pick_table_ident(new_name, avoid=table_name_set)
    table_name_set.add(new_name)
    log.warning("Upgrading summary table %s for %s(%s) to %s",
      t.tableId, source_table_name, groupby_colrefs, new_name)

    # Remove the "lookupOrAddDerived" column from the source table (which is named using the
    # summary table name for its colId).
    remove_cols.extend(c for c in columns
                       if c.parentId == source_table_ref and c.colId == t.tableId)

    # Upgrade the "group" formula in the summary table.
    expected_group_formula = "%s.lookupRecords(%s=$id)" % (source_table_name, t.tableId)
    new_formula = "table.getSummarySourceGroup(rec)"
    formula_updates.extend((c, new_name, new_formula) for c in columns
                           if (c.parentId == t.id and c.colId == "group" and
                               c.formula == expected_group_formula))

    # Schedule a rename of the summary table.
    table_renames.append((t, new_name))

    # Set summarySourceTable fields on the metadata.
    source_tables.append((t, source_table_ref))

    # Set summarySourceCol fields in the metadata. We need to find the right summary column.
    groupby_cols = set()
    for col_ref in groupby_colrefs:
      src_col = columns_map_by_ref.get(col_ref)
      sum_col = columns_map_by_table_colid.get((t.id, src_col.colId)) if src_col else None
      if sum_col:
        groupby_cols.add(sum_col)
        source_cols.append((sum_col, src_col.id))
      else:
        log.warning("Upgrading summary table %s: couldn't find column %s", t.tableId, col_ref)

    # Finally, we have to remove all non-formula columns that are not groupby-columns (e.g.
    # 'manualSort'), because the new approach assumes ALL non-formula columns are for groupby.
    remove_cols.extend(c for c in columns
                       if c.parentId == t.id and c not in groupby_cols and not c.isFormula)

  # Create all the doc actions from the arrays we prepared.

  # Process remove_cols
  doc_actions.extend(
    actions.RemoveColumn(tables_map[c.parentId].tableId, c.colId) for c in remove_cols)
  doc_actions.append(actions.BulkRemoveRecord(
    '_grist_Tables_column', [c.id for c in remove_cols]))

  # Process table_renames
  doc_actions.extend(
    actions.RenameTable(t.tableId, new) for (t, new) in table_renames)
  doc_actions.append(actions.BulkUpdateRecord(
    '_grist_Tables', [t.id for t, new in table_renames],
    {'tableId': [new for t, new in table_renames]}
  ))

  # Process source_tables and source_cols
  doc_actions.append(actions.BulkUpdateRecord(
    '_grist_Tables', [t.id for t, ref in source_tables],
    {'summarySourceTable': [ref for t, ref in source_tables]}
  ))
  doc_actions.append(actions.BulkUpdateRecord(
    '_grist_Tables_column', [t.id for t, ref in source_cols],
    {'summarySourceCol': [ref for t, ref in source_cols]}
  ))

  # Process formula_updates. Do this last since recalculation of these may cause new records added
  # to summary tables, so we should have all the tables correctly set up by this time.
  doc_actions.extend(
    actions.ModifyColumn(table_id, c.colId, {'formula': f})
    for c, table_id, f in formula_updates)
  doc_actions.append(actions.BulkUpdateRecord(
    '_grist_Tables_column', [c.id for c, t, f in formula_updates],
    {'formula': [f for c, t, f in formula_updates]}
  ))

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=8)
def migration8(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Tables_column', 'untieColIdFromLabel', 'Bool'),
  ])

@migration(schema_version=9)
def migration9(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Tables_column', 'displayCol', 'Ref:_grist_Tables_column'),
    add_column('_grist_Views_section_field', 'displayCol', 'Ref:_grist_Tables_column'),
  ])

@migration(schema_version=10)
def migration10(tdset):
  """
  Add displayCol to all reference cols, with formula $<ref_col_id>.<visible_col_id>
  (Note that displayCol field was added in the previous migration.)
  """
  doc_actions = []
  tables = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables']))
  columns = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables_column']))

  # Maps tableRef to tableId.
  tables_map = {t.id: t.tableId for t in tables}

  # Maps tableRef to sets of colIds in the tables. Used to prevent repeated colIds.
  table_col_ids = {t.id: set(tdset.all_tables[t.tableId].columns.keys()) for t in tables}

  # Get the next sequential column row id.
  row_id = next_id(tdset, '_grist_Tables_column')

  for c in columns:
    # If a column is a reference with an unset display column, add a display column.
    if c.type.startswith('Ref:') and not c.displayCol:
      # Get visible_col_id. If not found, row id is used and no display col is necessary.
      visible_col_id = ""
      try:
        visible_col_id = json.loads(c.widgetOptions).get('visibleCol')
        if not visible_col_id:
          continue
      except Exception:
        continue   # If invalid widgetOptions, skip this column.

      # Set formula to use the current visibleCol in widgetOptions.
      formula = ("$%s.%s" % (c.colId, visible_col_id))

      # Get a unique colId for the display column, and add it to the set of used ids.
      used_col_ids = table_col_ids[c.parentId]
      display_col_id = identifiers.pick_col_ident('gristHelper_Display', avoid=used_col_ids)
      used_col_ids.add(display_col_id)

      # Add all actions to the list.
      doc_actions.append(add_column(tables_map[c.parentId], 'gristHelper_Display', 'Any',
        formula=formula, isFormula=True))
      doc_actions.append(actions.AddRecord('_grist_Tables_column', row_id, {
        'parentPos': 1.0,
        'label': 'gristHelper_Display',
        'isFormula': True,
        'parentId': c.parentId,
        'colId': 'gristHelper_Display',
        'formula': formula,
        'widgetOptions': '',
        'type': 'Any'
      }))
      doc_actions.append(actions.UpdateRecord('_grist_Tables_column', c.id, {'displayCol': row_id}))

      # Increment row id to the next unused.
      row_id += 1

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=11)
def migration11(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Views_section', 'embedId', 'Text'),
  ])

@migration(schema_version=12)
def migration12(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Views_section', 'options', 'Text')
  ])

@migration(schema_version=13)
def migration13(tdset):
  # Adds a basketId to the entire document to take advantage of basket functionality.
  # From this version on, embedId is deprecated.
  return tdset.apply_doc_actions([
    add_column('_grist_DocInfo', 'basketId', 'Text')
  ])

@migration(schema_version=14)
def migration14(tdset):
  # Create the ACL table AND also the default ACL groups, default resource, and the default rule.
  # These match the actions applied to new document by 'InitNewDoc' useraction (as of v14).
  return tdset.apply_doc_actions([
    actions.AddTable('_grist_ACLMemberships', [
      schema.make_column('parent', 'Ref:_grist_ACLPrincipals'),
      schema.make_column('child', 'Ref:_grist_ACLPrincipals'),
    ]),
    actions.AddTable('_grist_ACLPrincipals', [
      schema.make_column('userName', 'Text'),
      schema.make_column('groupName', 'Text'),
      schema.make_column('userEmail', 'Text'),
      schema.make_column('instanceId', 'Text'),
      schema.make_column('type', 'Text'),
    ]),
    actions.AddTable('_grist_ACLResources', [
      schema.make_column('colIds', 'Text'),
      schema.make_column('tableId', 'Text'),
    ]),
    actions.AddTable('_grist_ACLRules', [
      schema.make_column('aclFormula', 'Text'),
      schema.make_column('principals', 'Text'),
      schema.make_column('resource', 'Ref:_grist_ACLResources'),
      schema.make_column('aclColumn', 'Ref:_grist_Tables_column'),
      schema.make_column('permissions', 'Int'),
    ]),

    # Set up initial ACL data.
    actions.BulkAddRecord('_grist_ACLPrincipals', [1,2,3,4], {
      'type':       ['group', 'group', 'group', 'group'],
      'groupName':  ['Owners', 'Admins', 'Editors', 'Viewers'],
    }),
    actions.AddRecord('_grist_ACLResources', 1, {
      'tableId': '', 'colIds': ''
    }),
    actions.AddRecord('_grist_ACLRules', 1, {
      'resource': 1, 'permissions': 0x3F, 'principals': '[1]'
    }),
  ])

@migration(schema_version=15)
def migration15(tdset):
  # Adds a filter JSON property to each field.
  # From this version on, filterSpec in _grist_Views_section is deprecated.
  doc_actions = [
    add_column('_grist_Views_section_field', 'filter', 'Text')
  ]

  # Get all section and field data to move section filter data to the fields
  sections = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Views_section']))
  fields = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Views_section_field']))

  specs = {s.id: safe_parse(s.filterSpec) for s in sections}

  # Move filter data from sections to fields
  for f in fields:
    # If the field belongs to the section and the field's colRef is in its filterSpec,
    # pull the filter setting from the section.
    filter_spec = specs.get(f.parentId)
    if filter_spec and str(f.colRef) in filter_spec:
      doc_actions.append(actions.UpdateRecord('_grist_Views_section_field', f.id, {
        'filter': json.dumps(filter_spec[str(f.colRef)])
      }))

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=16)
def migration16(tdset):
  # Add visibleCol to columns and view fields, and set it from columns' and fields' widgetOptions.
  doc_actions = [
    add_column('_grist_Tables_column', 'visibleCol', 'Ref:_grist_Tables_column'),
    add_column('_grist_Views_section_field', 'visibleCol', 'Ref:_grist_Tables_column'),
  ]

  # Maps tableId to table, for looking up target table as listed in "Ref:*" types.
  tables = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables']))
  tables_by_id = {t.tableId: t for t in tables}

  # Allow looking up columns by ref or by (tableRef, colId)
  columns = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables_column']))
  columns_by_ref = {c.id: c for c in columns}
  columns_by_id = {(c.parentId, c.colId): c.id for c in columns}

  # Helper which returns the {'visibleCol', 'widgetOptions'} update visibleCol should be set.
  def convert_visible_col(col, widget_options):
    if not col.type.startswith('Ref:'):
      return None

    # To set visibleCol, we need to know the target table. Skip if we can't find it.
    target_table = tables_by_id.get(col.type[len('Ref:'):])
    if not target_table:
      return None

    try:
      parsed_options = json.loads(widget_options)
    except Exception:
      return None   # If invalid widgetOptions, skip this column.

    visible_col_id = parsed_options.pop('visibleCol', None)
    if not visible_col_id:
      return None

    # Find visible_col_id as the column name in the appropriate table.
    target_col_ref = (0 if visible_col_id == 'id' else
                      columns_by_id.get((target_table.id, visible_col_id), None))
    if target_col_ref is None:
      return None

    # Use compact separators without whitespace, to match how JS encodes JSON.
    return {'visibleCol': target_col_ref,
            'widgetOptions': json.dumps(parsed_options, separators=(',', ':')) }

  for c in columns:
    new_values = convert_visible_col(c, c.widgetOptions)
    if new_values:
      doc_actions.append(actions.UpdateRecord('_grist_Tables_column', c.id, new_values))

  fields = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Views_section_field']))
  for f in fields:
    c = columns_by_ref.get(f.colRef)
    if c:
      new_values = convert_visible_col(c, f.widgetOptions)
      if new_values:
        doc_actions.append(actions.UpdateRecord('_grist_Views_section_field', f.id, new_values))

  return tdset.apply_doc_actions(doc_actions)

# This is actually the only migration that requires all tables because it modifies user data
# (specifically, any columns of the deprecated "Image" type).
@migration(schema_version=17, need_all_tables=True)
def migration17(tdset):
  """
  There is no longer an "Image" type for columns, as "Attachments" now serves as a
  display type for arbitrary files including images. Convert "Image" columns to "Attachments"
  columns.
  """
  doc_actions = []
  tables = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables']))
  tables_map = {t.id: t for t in tables}
  columns = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables_column']))

  # Convert columns from type 'Image' to type 'Attachments'
  affected_cols = [c for c in columns if c.type == 'Image']
  conv = lambda val: [val] if isinstance(val, int) and val > 0 else []
  if affected_cols:
    # Update the types in the data tables
    doc_actions.extend(
      actions.ModifyColumn(tables_map[c.parentId].tableId, c.colId, {'type': 'Attachments'})
      for c in affected_cols
    )
    # Update the types in the metadata tables
    doc_actions.append(actions.BulkUpdateRecord(
      '_grist_Tables_column',
      [c.id for c in affected_cols],
      {'type': ['Attachments' for c in affected_cols]}
    ))
    # Update the values to lists
    for c in affected_cols:
      if c.isFormula:
        # Formula columns don't have data stored in DB, should not have data changes.
        continue
      table_id = tables_map[c.parentId].tableId
      table = tdset.all_tables[table_id]
      doc_actions.append(
        actions.BulkUpdateRecord(table_id, table.row_ids,
          {c.colId: [conv(val) for val in table.columns[c.colId]]})
      )

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=18)
def migration18(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_DocInfo', 'timezone', 'Text'),
    # all documents prior to this migration have been created in New York
    actions.UpdateRecord('_grist_DocInfo', 1, {'timezone': 'America/New_York'})
  ])

@migration(schema_version=19)
def migration19(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Tables', 'onDemand', 'Bool'),
  ])

@migration(schema_version=20)
def migration20(tdset):
  """
  Add _grist_Pages table and populate based on existing TableViews entries, ie: tables are sorted
  alphabetically by their `tableId` and views are gathered within their corresponding table and
  sorted by their id.
  """
  tables = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables']))
  table_map = {t.id: t for t in tables}
  table_views = list(actions.transpose_bulk_action(tdset.all_tables['_grist_TableViews']))
  # Old docs may include "Other views", not associated with any table. Don't include those in
  # table_views_map: they'll get included but not sorted or grouped by tableId.
  table_views_map = {tv.viewRef: table_map[tv.tableRef].tableId
                     for tv in table_views if tv.tableRef in table_map}
  views = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Views']))
  def view_key(view):
    """
    Returns ("Table1", 2) where "Table1" is the view's tableId and 2 the view id. For
    primary view (ie: not referenced in _grist_TableViews) returns ("Table1", -1). Useful
    to get the list of views sorted in the same way as in the Table side pane. We use -1
    for primary view to make sure they come first among all the views of the same table.
    """
    if view.id in table_views_map:
      return (table_views_map[view.id], view.id)
    # the name of primary view's is the same as the tableId
    return (view.name, -1)
  views.sort(key=view_key)
  row_ids = list(xrange(1, len(views) + 1))
  return tdset.apply_doc_actions([
    actions.AddTable('_grist_Pages', [
      schema.make_column('viewRef', 'Ref:_grist_Views'),
      schema.make_column('pagePos', 'PositionNumber'),
      schema.make_column('indentation', 'Int'),
    ]),
    actions.ReplaceTableData('_grist_Pages', row_ids, {
      'viewRef': [v.id for v in views],
      'pagePos': row_ids,
      'indentation': [1 if v.id in table_views_map else 0 for v in views]
    })
  ])

@migration(schema_version=21)
def migration21(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_ACLRules', 'aclFormulaParsed', 'Text'),
    add_column('_grist_ACLRules', 'permissionsText', 'Text'),
    add_column('_grist_ACLRules', 'rulePos', 'PositionNumber'),
    add_column('_grist_ACLRules', 'userAttributes', 'Text'),
  ])


@migration(schema_version=22)
def migration22(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Tables_column', 'recalcWhen', 'Int'),
    add_column('_grist_Tables_column', 'recalcDeps', 'RefList:_grist_Tables_column'),
  ])

@migration(schema_version=23)
def migration23(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_DocInfo', 'documentSettings', 'Text'),
    actions.UpdateRecord('_grist_DocInfo', 1, {'documentSettings': '{"locale":"en-US"}'})
  ])


@migration(schema_version=24)
def migration24(tdset):
  return tdset.apply_doc_actions([
    actions.AddTable('_grist_Triggers', [
      schema.make_column("tableRef", "Ref:_grist_Tables"),
      schema.make_column("eventTypes", "ChoiceList"),
      schema.make_column("isReadyColRef", "Ref:_grist_Tables_column"),
      schema.make_column("actions", "Text"),  # JSON
    ]),
  ])

@migration(schema_version=25)
def migration25(tdset):
  """
  Add _grist_Filters table and populate based on existing filters stored
  in _grist_Views_section_field.

  From this version on, filter in _grist_Views_section_field is deprecated.
  """
  doc_actions = [
    actions.AddTable('_grist_Filters', [
      schema.make_column("viewSectionRef", "Ref:_grist_Views_section"),
      schema.make_column("colRef", "Ref:_grist_Tables_column"),
      schema.make_column("filter", "Text"),
    ])
  ]

  # Move existing field filters to _grist_Filters.
  fields = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Views_section_field']))
  col_info = { 'filter': [], 'colRef': [], 'viewSectionRef': [] }
  for f in fields:
    if not f.filter:
      continue

    col_info['filter'].append(f.filter)
    col_info['colRef'].append(f.colRef)
    col_info['viewSectionRef'].append(f.parentId)

  num_filters = len(col_info['filter'])
  if num_filters > 0:
    doc_actions.append(actions.BulkAddRecord('_grist_Filters', [None] * num_filters, col_info))

  return tdset.apply_doc_actions(doc_actions)


@migration(schema_version=26)
def migration26(tdset):
  """
  Add rawViewSectionRef column to _grist_Tables
  and new raw view sections for each 'normal' table.
  """
  doc_actions = [add_column('_grist_Tables', 'rawViewSectionRef', 'Ref:_grist_Views_section')]

  tables = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables"]))
  columns = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables_column"]))
  views = {view.id: view
           for view in actions.transpose_bulk_action(tdset.all_tables["_grist_Views"])}

  new_view_section_id = next_id(tdset, "_grist_Views_section")

  for table in sorted(tables, key=lambda t: t.tableId):
    old_view = views.get(table.primaryViewId)
    if not (table.primaryViewId and old_view):
      continue

    table_columns = [
      col for col in columns
      if table.id == col.parentId and is_visible_column(col.colId)
    ]
    table_columns.sort(key=lambda c: c.parentPos)
    fields = {
      "parentId": [new_view_section_id] * len(table_columns),
      "colRef": [col.id for col in table_columns],
      "parentPos": [col.parentPos for col in table_columns],
    }
    field_ids = [None] * len(table_columns)

    doc_actions += [
      actions.AddRecord(
        "_grist_Views_section", new_view_section_id, {
          "tableRef": table.id,
          "parentId": 0,
          "parentKey": "record",
          "title": old_view.name,
          "defaultWidth": 100,
          "borderWidth": 1,
        }),
      actions.UpdateRecord(
        "_grist_Tables", table.id, {
          "rawViewSectionRef": new_view_section_id,
        }),
      actions.BulkAddRecord(
        "_grist_Views_section_field", field_ids, fields
      ),
    ]

    new_view_section_id += 1

  return tdset.apply_doc_actions(doc_actions)


@migration(schema_version=27)
def migration27(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Tables_column', 'rules', 'RefList:_grist_Tables_column'),
    add_column('_grist_Views_section_field', 'rules', 'RefList:_grist_Tables_column'),
  ])


@migration(schema_version=28)
def migration28(tdset):
  doc_actions = [add_column('_grist_Attachments', 'timeDeleted', 'DateTime')]

  tables = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables"]))
  columns = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables_column"]))

  for table in tables:
    for col in columns:
      if table.id == col.parentId and col.type == "Attachments":
        # This looks like it doesn't change anything,
        # but it makes DocStorage realise that the sqlType has changed
        # so it converts marshalled blobs to JSON
        doc_actions.append(actions.ModifyColumn(table.tableId, col.colId, {"type": "Attachments"}))

  return tdset.apply_doc_actions(doc_actions)


@migration(schema_version=29)
def migration29(tdset):
  # This migration is fixing an error on summary tables with conditional rules.
  # On summary tables all formula columns with the same name were updated together,
  # which caused a situation where some summary columns have rules from diffrent tables.
  # This migration is removing those rules in such columns.

  tables = {table.id: table
          for table in actions.transpose_bulk_action(tdset.all_tables["_grist_Tables"])}
  columns = {col.id: col
          for col in actions.transpose_bulk_action(tdset.all_tables["_grist_Tables_column"])}
  doc_actions = []

  def is_valid_rule(parentId, rule_id):
    # Valid rule should be an existing column,
    rule_col = columns.get(rule_id)
    # in the same table.
    return rule_col and rule_col.parentId == parentId

  for col in columns.values():
    if col.rules:
      # Parse rules (they are a json encoded array like '[15]')
      rules = safe_parse(col.rules)
      # Remove all conditional styles if anything about rules is invalid.
      if not (
        isinstance(rules, list) and
        all(is_valid_rule(col.parentId, ruleId) for ruleId in rules)
      ):
        doc_actions.append(actions.UpdateRecord('_grist_Tables_column', col.id, {
          "rules": None,
          "widgetOptions": summary._copy_widget_options(col.widgetOptions)
        }))

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=30)
def migration30(tdset):
  """
  Add raw view sections for each summary table. This is similar to migration 26, but for
  summary tables instead of user tables.
  """
  doc_actions = []

  tables = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables"]))
  columns = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables_column"]))

  new_view_section_id = next_id(tdset, "_grist_Views_section")

  for table in sorted(tables, key=lambda t: t.tableId):
    if not table.summarySourceTable:
      continue

    table_columns = [
      col for col in columns
      if table.id == col.parentId and is_visible_column(col.colId)
    ]
    table_columns.sort(key=lambda c: c.parentPos)
    fields = {
      "parentId": [new_view_section_id] * len(table_columns),
      "colRef": [col.id for col in table_columns],
      "parentPos": [col.parentPos for col in table_columns],
    }
    field_ids = [None] * len(table_columns)

    doc_actions += [
      actions.AddRecord(
        "_grist_Views_section", new_view_section_id, {
          "tableRef": table.id,
          "parentId": 0,
          "parentKey": "record",
          "title": "",
          "defaultWidth": 100,
          "borderWidth": 1,
        }
      ),
      actions.UpdateRecord(
        "_grist_Tables", table.id, {
          "rawViewSectionRef": new_view_section_id,
        })
      ,
      actions.BulkAddRecord(
        "_grist_Views_section_field", field_ids, fields
      ),
    ]

    new_view_section_id += 1

  return tdset.apply_doc_actions(doc_actions)


@migration(schema_version=31)
def migration31(tdset):
  columns = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables_column']))
  tables = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables']))
  acl_resources = list(actions.transpose_bulk_action(tdset.all_tables['_grist_ACLResources']))

  tables_by_ref = {t.id: t for t in tables}
  columns_by_table_ref = defaultdict(list)
  for col in columns:
    columns_by_table_ref[col.parentId].append(col)

  table_name_set = {t.tableId for t in tables}

  table_renames = []      # List of (table, new_name) pairs

  for t in six.itervalues(tables_by_ref):
    if not t.summarySourceTable:
      continue
    source_table = tables_by_ref[t.summarySourceTable]
    # Prepare a new-style name for the summary table. Be sure not to conflict with existing tables
    # or with each other (i.e. don't rename multiple tables to the same name).
    groupby_col_ids = [c.colId for c in columns_by_table_ref[t.id] if c.summarySourceCol]
    new_name = summary.encode_summary_table_name(source_table.tableId, groupby_col_ids)
    if new_name == t.tableId:
      continue
    new_name = identifiers.pick_table_ident(new_name, avoid=table_name_set)
    table_name_set.add(new_name)
    log.warning("Upgrading summary table %s for %s(%s) to %s",
      t.tableId, source_table.tableId, groupby_col_ids, new_name)

    # Schedule a rename of the summary table.
    table_renames.append((t, new_name))

  doc_actions = [
    actions.RenameTable(t.tableId, new)
    for (t, new) in table_renames
  ]
  if table_renames:
    doc_actions.append(
      actions.BulkUpdateRecord(
        '_grist_Tables', [t.id for t, new in table_renames],
        {'tableId': [new for t, new in table_renames]}
      )
    )

  # Update formulas in all columns containing old-style names like 'GristSummary_'
  for col in columns:
    if 'GristSummary_' not in col.formula:
      continue
    formula = col.formula
    for table, new_name in table_renames:
      # Use regex to only match whole words
      formula = re.sub(r'\b%s\b' % table.tableId, new_name, formula)
    doc_actions.append(actions.UpdateRecord('_grist_Tables_column', col.id, {'formula': formula}))

  table_renames_dict = {t.tableId: new for t, new in table_renames}
  for resource in acl_resources:
    new_name = table_renames_dict.get(resource.tableId)
    if new_name:
      doc_actions.append(
        actions.UpdateRecord('_grist_ACLResources', resource.id, {'tableId': new_name})
      )
  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=32)
def migration32(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Views_section', 'rules', 'RefList:_grist_Tables_column'),
  ])

@migration(schema_version=33)
def migration33(tdset):
  """
  Add _grist_Cells table
  """
  doc_actions = [
    actions.AddTable('_grist_Cells', [
      schema.make_column("tableRef",       "Ref:_grist_Tables"),
      schema.make_column("colRef",         "Ref:_grist_Tables_column"),
      schema.make_column("rowId",          "Int"),
      schema.make_column("root",           "Bool"),
      schema.make_column("parentId",       "Ref:_grist_Cells"),
      schema.make_column("type",           "Int"),
      schema.make_column("content",        "Text"),
      schema.make_column("userRef",        "Text"),
    ]),
  ]

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=34)
def migration34(tdset):
  """
  Add pinned column to _grist_Filters and populate based on existing sections.

  When populating, pinned will be set to true for filters that either belong to
  a section where the filter bar is toggled or a raw view section.

  From this version on, _grist_Views_section.options.filterBar is deprecated.
  """
  doc_actions = [add_column('_grist_Filters', 'pinned', 'Bool')]

  tables = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Tables']))
  sections = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Views_section']))
  filters = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Filters']))
  raw_section_ids = set(t.rawViewSectionRef for t in tables)
  filter_bar_by_section_id = {
    # Pre-migration, raw sections always showed the filter bar in the UI. Since we want
    # existing raw section filters to continue appearing in the filter bar, we'll pretend
    # here that raw sections have a filterBar value of True. Note that after this migration
    # it will be possible for raw sections to have unpinned filters.
    s.id: bool(s.id in raw_section_ids or safe_parse(s.options).get('filterBar', False))
    for s in sections
  }

  # List of (filter_rec, pinned) pairs.
  filter_updates = []
  for filter_rec in filters:
    filter_updates.append((
      filter_rec,
      filter_bar_by_section_id.get(filter_rec.viewSectionRef, False)
    ))

  if filter_updates:
    doc_actions.append(actions.BulkUpdateRecord(
      '_grist_Filters',
      [filter_rec.id for filter_rec, _ in filter_updates],
      {'pinned': [pinned for _, pinned in filter_updates]},
    ))

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=35)
def migration35(tdset):
  """
  Add memo column to _grist_ACLRules and populate with comments stored in
  _grist_ACLRules.aclFormula.

  From this version on, comments in _grist_ACLRules.aclFormula will no longer
  be used as memos.
  """
  doc_actions = [add_column('_grist_ACLRules', 'memo', 'Text')]

  acl_rules = list(actions.transpose_bulk_action(tdset.all_tables['_grist_ACLRules']))

  # List of (acl_rule_rec, memo) pairs.
  acl_rule_updates = []
  for acl_rule_rec in acl_rules:
    acl_formula = safe_parse(acl_rule_rec.aclFormulaParsed)
    if not acl_formula or acl_formula[0] != 'Comment':
      continue

    acl_rule_updates.append((
      acl_rule_rec,
      acl_formula[2]
    ))

  if acl_rule_updates:
    doc_actions.append(actions.BulkUpdateRecord(
      '_grist_ACLRules',
      [acl_rule_rec.id for acl_rule_rec, _ in acl_rule_updates],
      {'memo': [memo for _, memo in acl_rule_updates]},
    ))

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=36)
def migration36(tdset):
  """
  Add description to column
  """
  return tdset.apply_doc_actions([add_column('_grist_Tables_column', 'description', 'Text')])

@migration(schema_version=37)
def migration37(tdset):
  """
  Add fileExt column to _grist_Attachments.
  """
  return tdset.apply_doc_actions([add_column('_grist_Attachments', 'fileExt', 'Text')])

@migration(schema_version=38)
def migration38(tdset):
  """
  Through a mishap, this migration ended up conflicted across two version of Grist.
  In one version, it added webhook related columns. In another it added a description
  to widgets. Sorry if this impacted you. Migration 39 does the best we can to
  smooth over the divergence, and this migration now does nothing (though in the
  past it did one of two possible things).
  """
  return tdset.apply_doc_actions([])

@migration(schema_version=39)
def migration39(tdset):
  """
  Adds memo, label, and enabled flag to triggers (for webhooks).
  Adds a description to widgets.
  """
  doc_actions = []
  if 'memo' not in tdset.all_tables['_grist_Triggers'].columns:
    doc_actions += [add_column('_grist_Triggers', 'memo', 'Text'),
                    add_column('_grist_Triggers', 'label', 'Text'),
                    add_column('_grist_Triggers', 'enabled', 'Bool')]
    triggers = list(actions.transpose_bulk_action(tdset.all_tables['_grist_Triggers']))
    doc_actions.append(actions.BulkUpdateRecord(
      '_grist_Triggers',
      [t.id for t in triggers],
      {'enabled': [True for t in triggers]}
    ))
  if 'description' not in tdset.all_tables['_grist_Views_section'].columns:
    doc_actions.append(add_column('_grist_Views_section', 'description', 'Text'))
  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=40)
def migration40(tdset):
  """
  Adds a recordCardViewSectionRef column to _grist_Tables, populating it
  for each non-summary table in _grist_Tables that has a rawViewSectionRef.
  """
  doc_actions = [
    add_column(
      '_grist_Tables',
      'recordCardViewSectionRef',
      'Ref:_grist_Views_section'
    ),
  ]

  tables = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables"]))
  columns = list(actions.transpose_bulk_action(tdset.all_tables["_grist_Tables_column"]))

  new_view_section_id = next_id(tdset, "_grist_Views_section")

  for table in sorted(tables, key=lambda t: t.tableId):
    if not table.rawViewSectionRef or table.summarySourceTable:
      continue

    table_columns = [
      col for col in columns
      if table.id == col.parentId and is_visible_column(col.colId)
    ]
    table_columns.sort(key=lambda c: c.parentPos)
    fields = {
      "parentId": [new_view_section_id] * len(table_columns),
      "colRef": [col.id for col in table_columns],
      "parentPos": [col.parentPos for col in table_columns],
    }
    field_ids = [None] * len(table_columns)

    doc_actions += [
      actions.AddRecord("_grist_Views_section", new_view_section_id, {
        "tableRef": table.id,
        "parentId": 0,
        "parentKey": "single",
        "title": "",
        "defaultWidth": 100,
        "borderWidth": 1,
      }),
      actions.UpdateRecord("_grist_Tables", table.id, {
        "recordCardViewSectionRef": new_view_section_id,
      }),
      actions.BulkAddRecord("_grist_Views_section_field", field_ids, fields),
    ]

    new_view_section_id += 1

  return tdset.apply_doc_actions(doc_actions)

@migration(schema_version=41)
def migration41(tdset):
  """
  Add a table for tracking special shares.
  """
  doc_actions = [
    actions.AddTable("_grist_Shares", [
      schema.make_column("linkId", "Text"),
      schema.make_column("options", "Text"),
      schema.make_column("label", "Text"),
      schema.make_column("description", "Text"),
    ]),
    add_column('_grist_Pages', 'shareRef', 'Ref:_grist_Shares'),
    add_column('_grist_Views_section', 'shareOptions', 'Text'),
  ]

  return tdset.apply_doc_actions(doc_actions)
