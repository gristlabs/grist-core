import unittest

import six

import actions
import schema
import table_data_set
import migrations

class TestMigrations(unittest.TestCase):
  def test_migrations(self):
    tdset = table_data_set.TableDataSet()
    tdset.apply_doc_actions(schema_version0())
    migration_actions = migrations.create_migrations(tdset.all_tables)
    tdset.apply_doc_actions(migration_actions)

    # Compare schema derived from migrations to the current schema.
    migrated_schema = tdset.get_schema()
    current_schema = {a.table_id: {c['id']: c for c in a.columns}
                      for a in schema.schema_create_actions()}
    # pylint: disable=too-many-nested-blocks
    if migrated_schema != current_schema:
      # Figure out the version of new migration to suggest, and whether to update SCHEMA_VERSION.
      new_version = max(schema.SCHEMA_VERSION, migrations.get_last_migration_version() + 1)

      # Figure out the missing actions.
      doc_actions = []
      for table_id in sorted(six.viewkeys(current_schema) | six.viewkeys(migrated_schema)):
        if table_id not in migrated_schema:
          doc_actions.append(actions.AddTable(table_id, current_schema[table_id].values()))
        elif table_id not in current_schema:
          doc_actions.append(actions.RemoveTable(table_id))
        else:
          current_cols = current_schema[table_id]
          migrated_cols = migrated_schema[table_id]
          for col_id in sorted(six.viewkeys(current_cols) | six.viewkeys(migrated_cols)):
            if col_id not in migrated_cols:
              doc_actions.append(actions.AddColumn(table_id, col_id, current_cols[col_id]))
            elif col_id not in current_cols:
              doc_actions.append(actions.RemoveColumn(table_id, col_id))
            else:
              current_info = current_cols[col_id]
              migrated_info = migrated_cols[col_id]
              delta = {k: v for k, v in six.iteritems(current_info) if v != migrated_info.get(k)}
              if delta:
                doc_actions.append(actions.ModifyColumn(table_id, col_id, delta))

      suggested_migration = (
        "----------------------------------------------------------------------\n" +
        "*** migrations.py ***\n" +
        "----------------------------------------------------------------------\n" +
        "@migration(schema_version=%s)\n" % new_version +
        "def migration%s(tdset):\n" % new_version +
        "  return tdset.apply_doc_actions([\n" +
        "".join(stringify(a) + ",\n" for a in doc_actions) +
        "  ])\n"
      )

      if new_version != schema.SCHEMA_VERSION:
        suggested_schema_update = (
          "----------------------------------------------------------------------\n" +
          "*** schema.py ***\n" +
          "----------------------------------------------------------------------\n" +
          "SCHEMA_VERSION = %s\n" % new_version
        )
      else:
        suggested_schema_update = ""

      self.fail("Migrations are incomplete. Suggested migration to add:\n" +
                suggested_schema_update + suggested_migration)

def stringify(doc_action):
  if isinstance(doc_action, actions.AddColumn):
    return '    add_column(%r, %s)' % (doc_action.table_id, col_info_args(doc_action.col_info))
  elif isinstance(doc_action, actions.AddTable):
    return ('    actions.AddTable(%r, [\n' % doc_action.table_id +
            ''.join('      schema.make_column(%s),\n' % col_info_args(c)
                    for c in doc_action.columns) +
            '    ])')
  else:
    return "    actions.%s(%s)" % (doc_action.__class__.__name__, ", ".join(map(repr, doc_action)))

def col_info_args(col_info):
  extra = ""
  for k in ("formula", "isFormula"):
    v = col_info.get(k)
    if v:
      extra += ", %s=%r" % (k, v)
  return "%r, %r%s" % (col_info['id'], col_info['type'], extra)


def schema_version0():
  # This is the initial version of the schema before the very first migration. It's a historical
  # snapshot, and thus should not be edited. The test verifies that starting with this v0,
  # migrations bring the schema to the current version.
  def make_column(col_id, col_type, formula='', isFormula=False):
    return { "id": col_id, "type": col_type, "isFormula": isFormula, "formula": formula }

  return [
    actions.AddTable("_grist_DocInfo", [
      make_column("docId",        "Text"),
      make_column("peers",        "Text"),
      make_column("schemaVersion", "Int"),
    ]),
    actions.AddTable("_grist_Tables", [
      make_column("tableId",      "Text"),
    ]),
    actions.AddTable("_grist_Tables_column", [
      make_column("parentId",     "Ref:_grist_Tables"),
      make_column("parentPos",    "PositionNumber"),
      make_column("colId",        "Text"),
      make_column("type",         "Text"),
      make_column("widgetOptions","Text"),
      make_column("isFormula",    "Bool"),
      make_column("formula",      "Text"),
      make_column("label",        "Text")
    ]),
    actions.AddTable("_grist_Imports", [
      make_column("tableRef",     "Ref:_grist_Tables"),
      make_column("origFileName", "Text"),
      make_column("parseFormula", "Text", isFormula=True,
                  formula="grist.parseImport(rec, table._engine)"),
      make_column("delimiter",    "Text",     formula="','"),
      make_column("doublequote",  "Bool",     formula="True"),
      make_column("escapechar",   "Text"),
      make_column("quotechar",    "Text",     formula="'\"'"),
      make_column("skipinitialspace", "Bool"),
      make_column("encoding",     "Text",     formula="'utf8'"),
      make_column("hasHeaders",   "Bool"),
    ]),
    actions.AddTable("_grist_External_database", [
      make_column("host",         "Text"),
      make_column("port",         "Int"),
      make_column("username",     "Text"),
      make_column("dialect",      "Text"),
      make_column("database",     "Text"),
      make_column("storage",      "Text"),
    ]),
    actions.AddTable("_grist_External_table", [
      make_column("tableRef",     "Ref:_grist_Tables"),
      make_column("databaseRef",  "Ref:_grist_External_database"),
      make_column("tableName",    "Text"),
    ]),
    actions.AddTable("_grist_TabItems", [
      make_column("tableRef",     "Ref:_grist_Tables"),
      make_column("viewRef",      "Ref:_grist_Views"),
    ]),
    actions.AddTable("_grist_Views", [
      make_column("name",         "Text"),
      make_column("type",         "Text"),
      make_column("layoutSpec",   "Text"),
    ]),
    actions.AddTable("_grist_Views_section", [
      make_column("tableRef",           "Ref:_grist_Tables"),
      make_column("parentId",           "Ref:_grist_Views"),
      make_column("parentKey",          "Text"),
      make_column("title",              "Text"),
      make_column("defaultWidth",       "Int", formula="100"),
      make_column("borderWidth",        "Int", formula="1"),
      make_column("theme",              "Text"),
      make_column("chartType",          "Text"),
      make_column("layoutSpec",         "Text"),
      make_column("filterSpec",         "Text"),
      make_column("sortColRefs",        "Text"),
      make_column("linkSrcSectionRef",  "Ref:_grist_Views_section"),
      make_column("linkSrcColRef",      "Ref:_grist_Tables_column"),
      make_column("linkTargetColRef",   "Ref:_grist_Tables_column"),
    ]),
    actions.AddTable("_grist_Views_section_field", [
      make_column("parentId",     "Ref:_grist_Views_section"),
      make_column("parentPos",    "PositionNumber"),
      make_column("colRef",       "Ref:_grist_Tables_column"),
      make_column("width",        "Int"),
      make_column("widgetOptions","Text"),
    ]),
    actions.AddTable("_grist_Validations", [
      make_column("formula",      "Text"),
      make_column("name",         "Text"),
      make_column("tableRef",     "Int")
    ]),
    actions.AddTable("_grist_REPL_Hist", [
      make_column("code",         "Text"),
      make_column("outputText",   "Text"),
      make_column("errorText",    "Text")
    ]),
    actions.AddTable("_grist_Attachments", [
      make_column("fileIdent",    "Text"),
      make_column("fileName",     "Text"),
      make_column("fileType",     "Text"),
      make_column("fileSize",     "Int"),
      make_column("timeUploaded", "DateTime")
    ]),
    actions.AddRecord("_grist_DocInfo", 1, {})
  ]

if __name__ == "__main__":
  unittest.main()
