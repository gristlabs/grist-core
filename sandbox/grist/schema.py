"""
schema.py defines the schema of the tables describing Grist's own data structures. While users can
create tables, add and remove columns, etc, Grist stores various document metadata (about the
users' tables, views, etc.) also in tables.

Before changing this file, please review:
  /documentation/migrations.md

"""

import itertools
from collections import OrderedDict, namedtuple

import six

import actions

SCHEMA_VERSION = 41

def make_column(col_id, col_type, formula='', isFormula=False):
  return {
    "id": col_id,
    "type": col_type,
    "isFormula": isFormula,
    "formula": formula
  }

def schema_create_actions():
  return [
    # The document-wide metadata. It's all contained in a single record with id=1.
    actions.AddTable("_grist_DocInfo", [
      make_column("docId",        "Text"), # DEPRECATED: docId is now stored in _gristsys_FileInfo
      make_column("peers",        "Text"), # DEPRECATED: now _grist_ACLPrincipals is used for this

      # Basket id of the document for online storage, if a Basket has been created for it.
      make_column("basketId",     "Text"),

      # Version number of the document. It tells us how to migrate it to reach SCHEMA_VERSION.
      make_column("schemaVersion", "Int"),

      # Document timezone.
      make_column("timezone", "Text"),

      # Document settings (excluding timezone).
      make_column("documentSettings", "Text"), # JSON string describing document settings
    ]),

    # The names of the user tables. This does NOT include built-in tables.
    actions.AddTable("_grist_Tables", [
      make_column("tableId",      "Text"),
      make_column("primaryViewId","Ref:_grist_Views"),

      # For a summary table, this points to the corresponding source table.
      make_column("summarySourceTable", "Ref:_grist_Tables"),

      # A table may be marked as "onDemand", which will keep its data out of the data engine, and
      # only available to the frontend when requested.
      make_column("onDemand",     "Bool"),

      make_column("rawViewSectionRef", "Ref:_grist_Views_section"),
      make_column("recordCardViewSectionRef", "Ref:_grist_Views_section"),
    ]),

    # All columns in all user tables.
    actions.AddTable("_grist_Tables_column", [
      make_column("parentId",     "Ref:_grist_Tables"),
      make_column("parentPos",    "PositionNumber"),
      make_column("colId",        "Text"),
      make_column("type",         "Text"),
      make_column("widgetOptions","Text"), # JSON extending column's widgetOptions
      make_column("isFormula",    "Bool"),
      make_column("formula",      "Text"),
      make_column("label",        "Text"),
      make_column("description",  "Text"),

      # Normally a change to label changes colId as well, unless untieColIdFromLabel is True.
      # (We intentionally pick a variable whose default value is false.)
      make_column("untieColIdFromLabel", "Bool"),

      # For a group-by column in a summary table, this points to the corresponding source column.
      make_column("summarySourceCol", "Ref:_grist_Tables_column"),
      # Points to a display column, if it exists, for this column.
      make_column("displayCol",       "Ref:_grist_Tables_column"),
      # For Ref cols only, points to the column in the pointed-to table, which is to be displayed.
      # E.g. Foo.person may have a visibleCol pointing to People.Name, with the displayCol
      # pointing to Foo._gristHelper_DisplayX column with the formula "$person.Name".
      make_column("visibleCol",       "Ref:_grist_Tables_column"),
      # Points to formula columns that hold conditional formatting rules.
      make_column("rules",       "RefList:_grist_Tables_column"),

      # Instructions when to recalculate the formula on a column with isFormula=False (previously
      # known as a "default formula"). Values are RecalcWhen constants defined below.
      make_column("recalcWhen",       "Int"),

      # List of fields that should trigger a calculation of a formula in a data column. Only
      # applies when recalcWhen is RecalcWhen.DEFAULT, and defaults to the empty list.
      make_column("recalcDeps",       "RefList:_grist_Tables_column"),
    ]),

    # DEPRECATED: Previously used to keep import options, and allow the user to change them.
    actions.AddTable("_grist_Imports", [
      make_column("tableRef",     "Ref:_grist_Tables"),
      make_column("origFileName", "Text"),
      make_column("parseFormula", "Text", isFormula=True,
                  formula="grist.parseImport(rec, table._engine)"),

      # The following translate directly to csv module options. We can use csv.Sniffer to guess
      # them based on a sample of the data (it also guesses hasHeaders option).
      make_column("delimiter",    "Text",     formula="','"),
      make_column("doublequote",  "Bool",     formula="True"),
      make_column("escapechar",   "Text"),
      make_column("quotechar",    "Text",     formula="'\"'"),
      make_column("skipinitialspace", "Bool"),

      # Other parameters Grist understands.
      make_column("encoding",     "Text",     formula="'utf8'"),
      make_column("hasHeaders",   "Bool"),
    ]),

    # DEPRECATED: Previously - All external database credentials attached to the document
    actions.AddTable("_grist_External_database", [
      make_column("host",         "Text"),
      make_column("port",         "Int"),
      make_column("username",     "Text"),
      make_column("dialect",      "Text"),
      make_column("database",     "Text"),
      make_column("storage",      "Text"),
    ]),

    # DEPRECATED: Previously - Reference to a table from an external database
    actions.AddTable("_grist_External_table", [
      make_column("tableRef",     "Ref:_grist_Tables"),
      make_column("databaseRef",  "Ref:_grist_External_database"),
      make_column("tableName",    "Text"),
    ]),

    # DEPRECATED: Document tabs that represent a cross-reference between Tables and Views
    actions.AddTable("_grist_TableViews", [
      make_column("tableRef",     "Ref:_grist_Tables"),
      make_column("viewRef",      "Ref:_grist_Views"),
    ]),

    # DEPRECATED: Previously used to cross-reference between Tables and Views
    actions.AddTable("_grist_TabItems", [
      make_column("tableRef",     "Ref:_grist_Tables"),
      make_column("viewRef",      "Ref:_grist_Views"),
    ]),

    actions.AddTable("_grist_TabBar", [
      make_column("viewRef",      "Ref:_grist_Views"),
      make_column("tabPos",        "PositionNumber"),
    ]),

    # Table for storing the tree of pages. 'pagePos' and 'indentation' columns gives how a page is
    # shown in the panel: 'pagePos' determines the page overall position when no pages are collapsed
    # (ie: all pages are visible) and 'indentation' gives the level of nesting (depth). Note that
    # the parent-child relationships between pages have to be inferred from the variation of
    # `indentation` between consecutive pages. For instance a difference of +1 between two
    # consecutive pages means that the second page is the child of the first page. A difference of 0
    # means that both are siblings and a difference of -1 means that the second page is a sibling to
    # the first page parent.
    actions.AddTable("_grist_Pages", [
      make_column("viewRef", "Ref:_grist_Views"),
      make_column("indentation", "Int"),
      make_column("pagePos", "PositionNumber"),
      make_column("shareRef", "Ref:_grist_Shares"),
    ]),

    # All user views.
    actions.AddTable("_grist_Views", [
      make_column("name",         "Text"),
      make_column("type",         "Text"),    # TODO: Should this be removed?
      make_column("layoutSpec",   "Text"),    # JSON string describing the view layout
    ]),

    # The sections of user views (e.g. a view may contain a list section and a detail section).
    # Different sections may need different parameters, so this table includes columns for all
    # possible parameters, and any given section will use some subset, depending on its type.
    actions.AddTable("_grist_Views_section", [
      make_column("tableRef",           "Ref:_grist_Tables"),
      make_column("parentId",           "Ref:_grist_Views"),
      # parentKey is the type of view section, such as 'list', 'detail', or 'single'.
      # TODO: rename this (e.g. to "sectionType").
      make_column("parentKey",          "Text"),
      make_column("title",              "Text"),
      make_column("description",        "Text"),
      make_column("defaultWidth",       "Int", formula="100"),
      make_column("borderWidth",        "Int", formula="1"),
      make_column("theme",              "Text"),
      make_column("options",            "Text"),
      make_column("chartType",          "Text"),
      make_column("layoutSpec",         "Text"), # JSON string describing the record layout
      # filterSpec is deprecated as of version 15. Do not remove or reuse.
      make_column("filterSpec",         "Text"),
      make_column("sortColRefs",        "Text"),
      make_column("linkSrcSectionRef",  "Ref:_grist_Views_section"),
      make_column("linkSrcColRef",      "Ref:_grist_Tables_column"),
      make_column("linkTargetColRef",   "Ref:_grist_Tables_column"),
      # embedId is deprecated as of version 12. Do not remove or reuse.
      make_column("embedId",            "Text"),
      # Points to formula columns that hold conditional formatting rules for this view section.
      make_column("rules",              "RefList:_grist_Tables_column"),
      make_column("shareOptions",       "Text"),
    ]),
    # The fields of a view section.
    actions.AddTable("_grist_Views_section_field", [
      make_column("parentId",     "Ref:_grist_Views_section"),
      make_column("parentPos",    "PositionNumber"),
      make_column("colRef",       "Ref:_grist_Tables_column"),
      make_column("width",        "Int"),
      make_column("widgetOptions","Text"), # JSON extending field's widgetOptions
      # Points to a display column, if it exists, for this field.
      make_column("displayCol",   "Ref:_grist_Tables_column"),
      # For Ref cols only, may override the column to be displayed fromin the pointed-to table.
      make_column("visibleCol",   "Ref:_grist_Tables_column"),
      # DEPRECATED: replaced with _grist_Filters in version 25. Do not remove or reuse.
      make_column("filter",       "Text"),
      # Points to formula columns that hold conditional formatting rules for this field.
      make_column("rules",       "RefList:_grist_Tables_column"),
    ]),

    # The code for all of the validation rules available to a Grist document
    actions.AddTable("_grist_Validations", [
      make_column("formula",      "Text"),
      make_column("name",         "Text"),
      make_column("tableRef",     "Int")
    ]),

    # The input code and output text and compilation/runtime errors for usercode
    actions.AddTable("_grist_REPL_Hist", [
      make_column("code",         "Text"),
      make_column("outputText",   "Text"),
      make_column("errorText",    "Text")
    ]),

    # All of the attachments attached to this document.
    actions.AddTable("_grist_Attachments", [
      make_column("fileIdent",    "Text"), # Checksum of the file contents. It identifies the file
                                           # data in the _gristsys_Files table.
      make_column("fileName",     "Text"), # User defined file name
      make_column("fileType",     "Text"), # A string indicating the MIME type of the data
      make_column("fileSize",     "Int"),  # The size in bytes
      # The file extension, including the "." prefix.
      # Prior to April 2023, this column did not exist, so attachments created before then have a
      # blank fileExt. The extension may still be present in fileName, so a migration can backfill
      # some older attachments if the need arises.
      make_column("fileExt",      "Text"),
      make_column("imageHeight",  "Int"),  # height in pixels
      make_column("imageWidth",   "Int"),  # width in pixels
      make_column("timeDeleted",  "DateTime"),
      make_column("timeUploaded", "DateTime")
    ]),


    # Triggers subscribing to changes in tables
    actions.AddTable("_grist_Triggers", [
      make_column("tableRef", "Ref:_grist_Tables"),
      make_column("eventTypes", "ChoiceList"),
      make_column("isReadyColRef", "Ref:_grist_Tables_column"),
      make_column("actions", "Text"),  # JSON
      make_column("label", "Text"),
      make_column("memo", "Text"),
      make_column("enabled", "Bool"),
    ]),

    # All of the ACL rules.
    actions.AddTable('_grist_ACLRules', [
      make_column('resource',     'Ref:_grist_ACLResources'),
      make_column('permissions',  'Int'),     # DEPRECATED: permissionsText is used instead.
      make_column('principals',   'Text'),    # DEPRECATED

      # Text of match formula, in restricted Python syntax; "" for default rule.
      make_column('aclFormula',   'Text'),

      make_column('aclColumn',    'Ref:_grist_Tables_column'),  # DEPRECATED

      # JSON representation of the parse tree of matchFunc; "" for default rule.
      make_column('aclFormulaParsed', 'Text'),

      # Permissions in the form '[+<bits>][-<bits>]' where <bits> is a string of
      # C,R,U,D,S characters, each appearing at most once. Or the special values
      # 'all' or 'none'. The empty string does not affect permissions.
      make_column('permissionsText', 'Text'),

      # Rules for one resource are ordered by increasing rulePos. The default rule
      # should be at the end (later rules would have no effect).
      make_column('rulePos',      'PositionNumber'),

      # If non-empty, this rule adds extra user attributes. It should contain JSON
      # of the form {name, tableId, lookupColId, charId}, and should be tied to the
      # resource *:*. It acts by looking up user[charId] in the given tableId on the
      # given lookupColId, and adds the full looked-up record as user[name], which
      # becomes available to matchFunc. These rules are processed in order of rulePos,
      # which should list them before regular rules.
      make_column('userAttributes', 'Text'),

      # Text of memo associated with this rule, if any. Prior to version 35, this was
      # stored within aclFormula.
      make_column('memo',           'Text'),
    ]),

    # Note that the special resource with tableId of '' and colIds of '' should be ignored. It is
    # present to satisfy older versions of Grist (before Nov 2020).
    actions.AddTable('_grist_ACLResources', [
      make_column('tableId',      'Text'),    # Name of the table this rule applies to, or '*'
      make_column('colIds',       'Text'),    # Comma-separated list of colIds, or '*'
    ]),

    # DEPRECATED: All of the principals used by ACL rules, including users, groups, and instances.
    actions.AddTable('_grist_ACLPrincipals', [
      make_column('type',         'Text'),    # 'user', 'group', or 'instance'
      make_column('userEmail',    'Text'),    # For 'user' principals
      make_column('userName',     'Text'),    # For 'user' principals
      make_column('groupName',    'Text'),    # For 'group' principals
      make_column('instanceId',   'Text'),    # For 'instance' principals

      # docmodel.py defines further `name` and `allInstances`, and members intended as helpers
      # only: `memberships`, `children`, and `descendants`.
    ]),

    # DEPRECATED: Table for containment relationships between Principals, e.g. user contains
    # multiple instances, group contains multiple users, and groups may contain other groups.
    actions.AddTable('_grist_ACLMemberships', [
      make_column('parent', 'Ref:_grist_ACLPrincipals'),
      make_column('child',  'Ref:_grist_ACLPrincipals'),
    ]),

    actions.AddTable('_grist_Filters', [
      make_column("viewSectionRef", "Ref:_grist_Views_section"),
      make_column("colRef",         "Ref:_grist_Tables_column"),
      # JSON string describing the default filter as map from either an `included` or an
      # `excluded` string to an array of column values:
      # Ex1: { included: ['foo', 'bar'] }
      # Ex2: { excluded: ['apple', 'orange'] }
      make_column("filter",         "Text"),
      # Filters can be pinned to the filter bar, which causes a button to be displayed
      # that opens the filter menu when clicked.
      make_column("pinned",         "Bool"),
    ]),

    # Additional metadata for cells
    actions.AddTable('_grist_Cells', [
      make_column("tableRef",       "Ref:_grist_Tables"),
      make_column("colRef",         "Ref:_grist_Tables_column"),
      make_column("rowId",          "Int"),
      # Cell metadata is stored as in hierarchical structure.
      make_column("root",           "Bool"),
      make_column("parentId",       "Ref:_grist_Cells"),
      # Type of information, currently we have only one type Comments (with value 1).
      make_column("type",           "Int"),
      # JSON representation of the metadata.
      make_column("content",        "Text"),
      make_column("userRef",        "Text"),
    ]),

    actions.AddTable('_grist_Shares', [
      make_column('linkId',         'Text'),   # Used to match records in home db without
                                               # necessarily trusting the document much.
      make_column('options',        'Text'),
      make_column('label',          'Text'),
      make_column('description',    'Text'),
    ]),
  ]


class RecalcWhen(object):
  """
  Constants for column's recalcWhen field, which determine when a formula associated with a data
  column would get calculated.
  """
  DEFAULT = 0         # Calculate on new records or when any field in recalcDeps changes. If
                      # recalcDeps includes this column itself, it's a "data-cleaning" formula.
  NEVER = 1           # Don't calculate automatically (but user can trigger manually)
  MANUAL_UPDATES = 2  # Calculate on new records and on manual updates to any data field.


# These are little structs to represent the document schema that's used in code generation.
# Schema itself (as stored by Engine) is an OrderedDict(tableId -> SchemaTable), with
# SchemaTable.columns being an OrderedDict(colId -> SchemaColumn).
SchemaTable = namedtuple('SchemaTable', ('tableId', 'columns'))
SchemaColumn = namedtuple('SchemaColumn', ('colId', 'type', 'isFormula', 'formula'))

# Helpers to convert between schema structures and dicts used in schema actions.
def dict_to_col(col, col_id=None):
  """Convert dict as used in AddColumn/AddTable actions to a SchemaColumn object."""
  return SchemaColumn(col_id or col["id"], col["type"], bool(col["isFormula"]), col["formula"])

def col_to_dict(col, include_id=True):
  """Convert SchemaColumn to dict to use in AddColumn/AddTable actions."""
  ret = {"type": col.type, "isFormula": col.isFormula, "formula": col.formula}
  if include_id:
    ret["id"] = col.colId
  return ret

def dict_list_to_cols(dict_list):
  """Convert list of column dicts to an OrderedDict of SchemaColumns."""
  return OrderedDict((c["id"], dict_to_col(c)) for c in dict_list)

def cols_to_dict_list(cols):
  """Convert OrderedDict of SchemaColumns to an array of column dicts."""
  return [col_to_dict(c) for c in cols.values()]

def clone_schema(schema):
  return OrderedDict((t, SchemaTable(s.tableId, s.columns.copy()))
                     for (t, s) in six.iteritems(schema))

def build_schema(meta_tables, meta_columns, include_builtin=True):
  """
  Arguments are TableData objects for the _grist_Tables and _grist_Tables_column tables.
  Returns the schema object for engine.py, used in particular in gencode.py.
  """
  assert meta_tables.table_id == '_grist_Tables'
  assert meta_columns.table_id == '_grist_Tables_column'

  # Schema is an OrderedDict.
  schema = OrderedDict()
  if include_builtin:
    for t in schema_create_actions():
      schema[t.table_id] = SchemaTable(t.table_id, dict_list_to_cols(t.columns))

  # Construct a list of columns sorted by table and position.
  collist = sorted(actions.transpose_bulk_action(meta_columns),
                   key=lambda c: (c.parentId, c.parentPos))
  coldict = {t: list(cols) for t, cols in itertools.groupby(collist, lambda r: r.parentId)}

  for t in actions.transpose_bulk_action(meta_tables):
    columns = OrderedDict((c.colId, SchemaColumn(c.colId, c.type, bool(c.isFormula), c.formula))
                          for c in coldict[t.id])
    schema[t.tableId] = SchemaTable(t.tableId, columns)
  return schema
