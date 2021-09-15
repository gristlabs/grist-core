from collections import defaultdict, namedtuple

import six
from six.moves import zip, xrange

import column
import identifiers

import logger
log = logger.Logger(__name__, logger.INFO)

# Prefix for transform columns created during imports.
_import_transform_col_prefix = 'gristHelper_Import_'

def _gen_colids(transform_rule):
  """
  For a transform_rule with colIds = None,
  fills in colIds generated from labels.
  """

  dest_cols = transform_rule["destCols"]

  if any(dc["colId"] for dc in dest_cols):
    raise ValueError("transform_rule already has colIds in _gen_colids")

  col_labels = [dest_col["label"] for dest_col in dest_cols]
  col_ids = identifiers.pick_col_ident_list(col_labels, avoid={'id'})

  for dest_col, col_id in zip(dest_cols, col_ids):
    dest_col["colId"] = col_id


def _strip_prefixes(transform_rule):
  "If transform_rule has prefixed _col_ids, strips prefix"

  dest_cols = transform_rule["destCols"]
  for dest_col in dest_cols:
    colId = dest_col["colId"]
    if colId and colId.startswith(_import_transform_col_prefix):
      dest_col["colId"] = colId[len(_import_transform_col_prefix):]


def _is_blank(value):
  "If value is blank (e.g. None, blank string), returns true."
  if value is None:
    return True
  elif isinstance(value, six.string_types) and value.strip() == '':
    return True
  else:
    return False


def _build_merge_col_map(column_data, merge_cols):
  """
  Returns a dictionary with keys that are comprised of
  the values from column_data for the columns in
  merge_cols. The values are the row ids (index) in
  column_data for that particular key; multiple row ids
  imply that duplicates exist that contain the same values
  for all columns in merge_cols.

  Used for merging into tables where fast, constant-time lookups
  are needed. For example, a source table can pass in its
  column_data into this function to build the map, and the
  destination table can then query the map using its own
  values for the columns in merge_cols to check for any
  matching rows that are candidates for updating.
  """

  merge_col_map = defaultdict(list)

  for row_id, key in enumerate(zip(*[column_data[col] for col in merge_cols])):
    # If any part of the key is blank, don't include it in the map.
    if any(_is_blank(val) for val in key):
      continue

    try:
      merge_col_map[key].append(row_id + 1)
    except TypeError:
      pass # If key isn't hashable, don't include it in the map.

  return merge_col_map

# Dictionary mapping merge strategy types from ActiveDocAPI.ts to functions
# that merge source and destination column values.
#
# NOTE: This dictionary should be kept in sync with the types in that file.
#
# All functions have the same signature: (src, dest) => output,
# where src and dest are column values from a source and destination
# table respectively, and output is either src or destination.
#
# For example, a key of replace-with-nonblank-source will return a merge function
# that returns the src argument if it's not blank. Otherwise it returns the
# dest argument. In the context of incremental imports, this is a function
# that update destination fields when the source field isn't blank, preserving
# existing values in the destination field that aren't replaced.
_merge_funcs = {
  'replace-with-nonblank-source': lambda src, dest: dest if _is_blank(src) else src,
  'replace-all-fields': lambda src, _: src,
  'replace-blank-fields-only': lambda src, dest: src if _is_blank(dest) else dest
}


class ImportActions(object):

  def __init__(self, useractions, docmodel, engine):
    self._useractions = useractions
    self._docmodel = docmodel
    self._engine = engine



  ########################
  ##        NOTES
  # transform_rule is an object like this: {
  #   destCols: [ { colId, label, type, formula }, ... ],
  #   ..., # other params unused in sandbox
  # }
  #
  # colId is defined if into_new_table, otherwise is None

  # GenImporterView gets a hidden table with a preview of the import data (~100 rows)
  # It adds formula cols and viewsections to the hidden table for the user to
  # preview and edit import options. GenImporterView can start with a default transform_rule
  # from table columns, or use one that's passed in (for reimporting).

  # client/components/Importer.ts then puts together transform_rule, which
  # specifies destination column formulas, types, labels, and colIds. It only contains colIds
  # if importing into an existing table, and they are sometimes prefixed with
  # _import_transform_col_prefix (if transform_rule comes from client)

  # TransformAndFinishImport gets the full hidden_table (reparsed) and a transform_rule,
  # (or can use a default one if it's not provided). It fills in colIds if necessary and
  # strips colId prefixes. It also skips creating some formula columns
  # (ones with trivial copy formulas) as an optimization.


  def _MakeDefaultTransformRule(self, hidden_table_id, dest_table_id):
    """
    Makes a basic transform_rule.dest_cols copying all the source cols
    hidden_table_id: table with src data
    dest_table_id: table data is going to
      If dst_table is null, copy all src columns
      If dst_table exists, copy all dst columns, and make copy formulas if any names match

    returns transform_rule with only destCols filled in
    """

    tables = self._docmodel.tables
    hidden_table_rec = tables.lookupOne(tableId=hidden_table_id)

    # will use these to set default formulas (if column names match in src and dest table)
    src_cols = {c.colId for c in hidden_table_rec.columns}

    target_table = tables.lookupOne(tableId=dest_table_id) if dest_table_id else hidden_table_rec
    target_cols = target_table.columns
    # makes dest_cols for each column in target_cols (defaults to same columns as hidden_table)


    #loop through visible, non-formula target columns
    dest_cols = []
    for c in target_cols:
      if column.is_visible_column(c.colId) and (not c.isFormula or c.formula == ""):

        dest_cols.append( {
          "label":    c.label,
          "colId":    c.colId if dest_table_id else None, #should be None if into new table
          "type":     c.type,
          "formula":  ("$" + c.colId) if (c.colId in src_cols) else ''
        })

    return {"destCols": dest_cols}
    # doesnt generate other fields of transform_rule, but sandbox only used destCols



  # Returns
  def _MakeImportTransformColumns(self, hidden_table_id, transform_rule, gen_all):
    """
    Makes prefixed columns in the grist hidden import table (hidden_table_id)

    hidden_table_id: id of temporary hidden table in which columns are made
    transform_rule: defines columns to make (colids must be filled in!)

    gen_all: If true, all columns will be generated
      If false, formulas that just copy will be skipped, and blank formulas will be skipped

    returns list of newly created colrefs (rowids into _grist_Tables_column)
    """

    tables = self._docmodel.tables
    hidden_table_rec = tables.lookupOne(tableId=hidden_table_id)
    src_cols = {c.colId for c in hidden_table_rec.columns}
    log.debug("destCols:" + repr(transform_rule['destCols']))

    #wrap dest_cols as namedtuples, to allow access like 'dest_col.param'
    dest_cols = [namedtuple('col', c.keys())(*c.values()) for c in transform_rule['destCols']]

    log.debug("_MakeImportTransformColumns: {}".format("gen_all" if gen_all else "optimize"))

    #create prefixed formula column for each of dest_cols
    #take formula from transform_rule
    new_cols = []
    for c in dest_cols:
      # skip copy and blank columns (unless gen_all)
      formula = c.formula.strip()
      isCopyFormula = (formula.startswith("$") and formula[1:] in src_cols)
      isBlankFormula = not formula

      if gen_all or (not isCopyFormula and not isBlankFormula):
        #if colId specified, use that. Else label is fine
        new_col_id = _import_transform_col_prefix + (c.colId or c.label)
        new_col_spec = {
          "label": c.label,
          "type": c.type,
          "isFormula": True,
          "formula": c.formula}
        result = self._useractions.doAddColumn(hidden_table_id, new_col_id, new_col_spec)
        new_cols.append(result["colRef"])

    return new_cols


  def _MergeColumnData(self, dest_table_id, column_data, merge_options):
    """
    Merges column_data into table dest_table_id, replacing rows that
    match all merge_cols with values from column_data, and adding
    unmatched rows to the end of table dest_table_id.

    dest_table_id: id of destination table
    column_data: column data from source table to merge into destination table
    merge_cols: list of column ids to use as keys for merging
    """

    dest_table = self._engine.tables[dest_table_id]
    merge_cols = merge_options['mergeCols']
    merge_col_map = _build_merge_col_map(column_data, merge_cols)

    updated_row_ids = []
    updated_rows = {}
    new_rows = {}
    matched_src_table_rows = set()

    # Initialize column data for new and updated rows.
    for col_id in six.iterkeys(column_data):
      updated_rows[col_id] = []
      new_rows[col_id] = []

    strategy_type = merge_options['mergeStrategy']['type']
    merge = _merge_funcs[strategy_type]

    # Compute which source table rows should update existing records in destination table.
    dest_cols = [dest_table.get_column(col) for col in merge_cols]
    for dest_row_id in dest_table.row_ids:
      lookup_key = tuple(col.raw_get(dest_row_id) for col in dest_cols)
      try:
        src_row_ids = merge_col_map.get(lookup_key)
      except TypeError:
        # We can arrive here if lookup_key isn't hashable. If that's the case, skip
        # this row since we can't efficiently search for a match in the source table.
        continue

      if src_row_ids:
        matched_src_table_rows.update(src_row_ids)
        updated_row_ids.append(dest_row_id)
        for col_id, col_vals in six.iteritems(column_data):
          src_val = col_vals[src_row_ids[-1] - 1]
          dest_val = dest_table.get_column(col_id).raw_get(dest_row_id)
          updated_rows[col_id].append(merge(src_val, dest_val))

    num_src_rows = len(column_data[merge_cols[0]])

    # Compute which source table rows should be added to destination table as new records.
    for row_id in xrange(1, num_src_rows + 1):
      # If we've matched against the row before, we shouldn't add it.
      if row_id in matched_src_table_rows:
        continue

      for col_id, col_val in six.iteritems(column_data):
        new_rows[col_id].append(col_val[row_id - 1])

    self._useractions.BulkUpdateRecord(dest_table_id, updated_row_ids, updated_rows)
    self._useractions.BulkAddRecord(dest_table_id,
      [None] * (num_src_rows - len(matched_src_table_rows)), new_rows)


  def DoGenImporterView(self, source_table_id, dest_table_id, transform_rule = None):
    """
    Generates viewsections/formula columns for importer

    source_table_id: id of temporary hidden table, data parsed from data source
    dest_table_id: id of table to import to, or None for new table
    transform_rule: transform_rule to reuse (if it still applies), if None will generate new one

    Removes old transform viewSection and columns for source_table_id, and creates new ones that
    match the destination table.
    Returns the rowId of the newly added section or 0 if no source table (source_table_id
    can be None in case of importing empty file).

    Creates formula columns for transforms (match columns in dest table)
    """

    tables = self._docmodel.tables
    src_table_rec = tables.lookupOne(tableId=source_table_id)

    # for new table, dest_table_id is None
    dst_table_rec = tables.lookupOne(tableId=dest_table_id) if dest_table_id else src_table_rec

    # ======== Cleanup old sections/columns

    # Transform sections are created without a parent View, so we delete all such sections here.
    old_sections = [s for s in src_table_rec.viewSections if not s.parentId]
    self._docmodel.remove(old_sections)

    # Transform columns are those that start with a special prefix.
    old_cols = [c for c in src_table_rec.columns
                if c.colId.startswith(_import_transform_col_prefix)]
    self._docmodel.remove(old_cols)

    #======== Prepare/normalize transform_rule, Create new formula columns
    # Defaults to duplicating dest_table columns (or src_table columns for a new table)
    # If transform_rule provided, use that

    if transform_rule is None:
      transform_rule = self._MakeDefaultTransformRule(source_table_id, dest_table_id)

    else: #ensure prefixes, colIds are correct
      _strip_prefixes(transform_rule)

      if not dest_table_id: # into new table: 'colId's are undefined
        _gen_colids(transform_rule)
      else:
        if None in (dc["colId"] for dc in transform_rule["destCols"]):
          errstr = "colIds must be defined in transform_rule for importing into existing table: "
          raise ValueError(errstr + repr(transform_rule))


    new_cols = self._MakeImportTransformColumns(source_table_id, transform_rule, gen_all=True)
    # we want to generate all columns so user can see them and edit

    #=========  Create new transform view section.
    new_section = self._docmodel.add(self._docmodel.view_sections,
                                    tableRef=src_table_rec.id,
                                    parentKey='record',
                                    borderWidth=1, defaultWidth=100,
                                    sortColRefs='[]')[0]
    self._docmodel.add(new_section.fields, colRef=new_cols)

    return new_section.id


  def DoTransformAndFinishImport(self, hidden_table_id, dest_table_id,
                                       into_new_table, transform_rule,
                                       merge_options):
    """
    Finishes import into new or existing table depending on flag 'into_new_table'
    Returns destination table id. (new or existing)
    """

    hidden_table = self._engine.tables[hidden_table_id]
    hidden_table_rec = self._docmodel.tables.lookupOne(tableId=hidden_table_id)

    src_cols = {c.colId for c in hidden_table_rec.columns}

    log.debug("Starting TransformAndFinishImport, dest_cols:\n  "
              + str(transform_rule["destCols"] if transform_rule else "None"))
    log.debug("hidden_table_id:" + hidden_table_id)
    log.debug("hidden table columns: "
              + str([(a.colId, a.label, a.type) for a in hidden_table_rec.columns]))
    log.debug("dest_table_id: "
              + str(dest_table_id) + ('(NEW)' if into_new_table else '(Existing)'))

    # === fill in blank transform rule
    if not transform_rule:
      transform_dest = None if into_new_table else dest_table_id
      transform_rule = self._MakeDefaultTransformRule(hidden_table_id, transform_dest)
    dest_cols = transform_rule["destCols"]


    # === Normalize transform rule (gen colids)

    _strip_prefixes(transform_rule) #when transform_rule from client, colIds will be prefixed

    if into_new_table: # 'colId's are undefined if making new table
      _gen_colids(transform_rule)
    else:
      if None in (dc["colId"] for dc in dest_cols):
        errstr = "colIds must be defined in transform_rule for importing into existing table: "
        raise ValueError(errstr + repr(transform_rule))

    log.debug("Normalized dest_cols:\n  " + str(dest_cols))


    # ======== Make and update formula columns
    # Make columns from transform_rule (now with filled-in colIds colIds),
    # gen_all false skips copy columns (faster)
    new_cols = self._MakeImportTransformColumns(hidden_table_id, transform_rule, gen_all=False)
    self._engine._bring_all_up_to_date()

    # ========= Fetch Data for each col
    # (either copying, blank, or from formula column)

    row_ids = list(hidden_table.row_ids) #fetch row_ids now, before we remove hidden_table
    log.debug("num rows: " + str(len(row_ids)))

    column_data = {} # { col:[values...], ... }
    for curr_col in dest_cols:
      formula = curr_col["formula"].strip()

      if formula:
        if (formula.startswith("$") and formula[1:] in src_cols): #copy formula
          src_col_id = formula[1:]
        else: #normal formula, fetch from prefix column
          src_col_id = _import_transform_col_prefix + curr_col["colId"]
        log.debug("Copying from: " + src_col_id)

        src_col = hidden_table.get_column(src_col_id)
        column_data[curr_col["colId"]] = [src_col.raw_get(r) for r in row_ids]


    # ========= Cleanup, Prepare new table (if needed), insert data

    self._useractions.RemoveTable(hidden_table_id)

    if into_new_table:
      col_specs = [ {'type': curr_col['type'], 'id': curr_col['colId'], 'label': curr_col['label']}
                    for curr_col in dest_cols]

      log.debug("Making new table. Columns:\n  " + str(col_specs))
      new_table = self._useractions.AddTable(dest_table_id, col_specs)
      dest_table_id = new_table['table_id']

    if not merge_options.get('mergeCols'):
      self._useractions.BulkAddRecord(dest_table_id, [None] * len(row_ids), column_data)
    else:
      self._MergeColumnData(dest_table_id, column_data, merge_options)

    log.debug("Finishing TransformAndFinishImport")

    return dest_table_id
