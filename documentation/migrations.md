# Migrations and schema changes

Grist uses [two types of databases](database.md):
* The home database, which stores data for the entire Grist instance
* Document databases, which each store data for an individual document

In code, these are governed by three database schemas, each responsible for different areas:
* [/app/gen-server](/app/gen-server) - A TypeORM schema for the home database
* [schema.py](/sandbox/grist/schema.py) - A python schema for `_grist` tables in the document database
* [DocStorage.ts](/app/server/lib/DocStorage.ts) - A typescript schema for `_gristsys` tables in the document database

Each of these has their own approach to changes and migrations, detailed below:

## Document database
### `_grist_*` tables

If you change Grist schema, i.e. the schema of the Grist metadata tables (in [`sandbox/grist/schema.py`](../sandbox/grist/schema.py)), you'll have to increment the `SCHEMA_VERSION` (on top of that file) and create a migration. A migration is a set of actions that would get applied to a document at the previous version, to make it satisfy the new schema.

Typescript has its own copy of the schema at [schema.ts](/app/common/schema.ts), which needs updating whenever the python schema changes.
The process for this is described in [schema.ts](/app/common/schema.ts).

To add a migration, add a function to [`sandbox/grist/migrations.py`](/sandbox/grist/migrations.py), of this form (using the new version number):

```python
@migration(schema_version=11)
def migration11(tdset):
  return tdset.apply_doc_actions([
    add_column('_grist_Views_section', 'embedId', 'Text'),
  ])
```

Some migrations need to actually add or modify the data in a document. You can look at other migrations in that file for examples.

If you are doing anything other than adding a column or a table, you must read this document to the end.

### `_gristsys_*` tables

The schema and migrations for `_gristsys_*` tables are defined in [DocStorage.ts](/app/server/lib/DocStorage.ts).

These tables are managed by the Node.js server and not by the data engine.

Migrations are implemented as functions which run raw SQLite queries against the database.

### Philosophy of migrations

Migrations are tricky. Normally, we think about the software we are writing, but migrations work with documents that were created by an older version of the software, which may not have the logic you think our software has, and MAY have logic that the current version knows nothing about.

This is why migrations code uses its own "dumb" implementation for loading and examining data (see [`sandbox/grist/table_data_set.py`](../sandbox/grist/table_data_set.py)), because trying to load an older document using our primary code base will usually fail, since the document will not satisfy our current assumptions.

### Restrictions

The rules below should make it at least barely possible to share documents by people who are not all on the same Grist version (even so, it will require more work). It should also make it somewhat safe to upgrade and then open the document with a previous version.

WARNING: Do not remove, modify, or rename metadata tables or columns.

Mark old columns and tables as deprecated using a comment. We may want to add a feature to mark them in code, to prevent their use in new versions. For now, it's enough to add a comment and remove references to the deprecated entities throughout code. An important goal is to prevent adding same-named entities in the future, or reusing the same column with a different meaning. So please add a comment of the form:

```python
# <columnName> is deprecated as of version XX. Do not remove or reuse.
```

To justify keeping old columns around, consider what would happen if A (at version 10) communicates with B (at version 11). If column "foo" exists in v10, and is deleted in v11, then A may send actions that refer to "foo", and B would consider them invalid, since B's code has no idea what "foo" is. The solution is that B needs to still know about "foo", hence we don't remove old columns.

Similar justification applies to renaming columns, or modifying them (e.g. changing a type).

WARNING: If you change the meaning or type of a column, you have to create a new column with a new name.

You'll also need to write a migration to fill it from the old column, and would mark the old column as deprecated.

## Home database

Home database migrations are handled by TypeORM ([documentation](https://typeorm.io/migrations)). 
The migration files are located at [`app/gen-server/migration`](/app/gen-server/migration) and are run at startup (so you don't have to worry about running them yourself).
