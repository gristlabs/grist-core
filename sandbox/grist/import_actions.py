from collections import namedtuple

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
                                       into_new_table, transform_rule):
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

        column_data[curr_col["colId"]] = map(hidden_table.get_column(src_col_id).raw_get, row_ids)


    # ========= Cleanup, Prepare new table (if needed), insert data

    self._useractions.RemoveTable(hidden_table_id)

    if into_new_table:
      col_specs = [ {'type': curr_col['type'], 'id': curr_col['colId'], 'label': curr_col['label']}
                    for curr_col in dest_cols]

      log.debug("Making new table. Columns:\n  " + str(col_specs))
      new_table = self._useractions.AddTable(dest_table_id, col_specs)
      dest_table_id = new_table['table_id']

    self._useractions.BulkAddRecord(dest_table_id, [None] * len(row_ids), column_data)

    log.debug("Finishing TransformAndFinishImport")

    return dest_table_id
