# Database

First of all, let's explicit two databases that Grist manages:
1. The Home Database;
2. The Document Database (aka the grist document);

The Home database is responsible for things related to the instance, like:
 - the users and the groups registered on the instance;
 - the billing;
 - the organisations (aka sites), the workspaces;
 - the documents metadata (id, name, workspace under which it is located...);
 - the rights (ACL) to access to organisations, workspaces and documents (the access to the content of the document is controlled by the document itself);

A Grist Document is a Sqlite database which contains data like:
 - The tables, pages, views data;
 - The ACL *inside* to access to all or part of tables (rows or columns);

## The Document Database

### Inspecting the Document

A Grist Document (with the `.grist` extension) is actually a sqlite database. You may download a document like [this one](https://api.getgrist.com/o/templates/api/docs/keLK5sVeyfPkxyaXqijz2x/download?template=false&nohistory=false) and inspect its content using the `sqlite3` command:

````
$ sqlite3 Flashcards.grist
sqlite> .tables
Flashcards_Data                   _grist_TabBar
Flashcards_Data_summary_Card_Set  _grist_TabItems
GristDocTour                      _grist_TableViews
_grist_ACLMemberships             _grist_Tables
_grist_ACLPrincipals              _grist_Tables_column
_grist_ACLResources               _grist_Triggers
_grist_ACLRules                   _grist_Validations
_grist_Attachments                _grist_Views
_grist_Cells                      _grist_Views_section
_grist_DocInfo                    _grist_Views_section_field
_grist_External_database          _gristsys_Action
_grist_External_table             _gristsys_ActionHistory
_grist_Filters                    _gristsys_ActionHistoryBranch
_grist_Imports                    _gristsys_Action_step
_grist_Pages                      _gristsys_FileInfo
_grist_REPL_Hist                  _gristsys_Files
_grist_Shares                     _gristsys_PluginData
````

:warning: Be sure to work on a copy of a document if you inspect its content, otherwise you may loose data.

### The migrations

The migrations are handled in the python sandbox in this code:
https://github.com/gristlabs/grist-core/blob/main/sandbox/grist/migrations.py

For more information, please consult [the documentation for migrations](./migrations.md).

## The Home Database

The home database may either be a sqlite or a postgresql database depending on how the Grist instance has been installed. You may check the `TYPEORM_*` env variables in the [README](https://github.com/gristlabs/grist-core/blob/main/README.md).

Unless otherwise configured, the home database is a sqlite file. In docker, it is stored in `/persist/home.sqlite3`.

The schema below is the same (except minor differences in the column types) whatever the database type is.

### The Schema

As of 2024-04-15, the database schema is the following (it may have changed in the meantime):

![Schema of the home database](./images/homedb-schema.svg)

> [!NOTE]
> For simplicity's sake, we have removed tables related to the billing, nor to the migrations.

If you want to generate the above schema by yourself, you may run the following command using [SchemaCrawler](https://www.schemacrawler.com/) ([a docker image is available for a quick run](https://www.schemacrawler.com/docker-image.html)):
````bash
# You may adapt the --database argument to fit with the actual file name
# You may also remove the `--grep-tables` option and all that follows to get the full schema.
$ schemacrawler --server=sqlite --database=landing.db --info-level=standard --portable-names --command=schema --output-format=svg --output-file=/tmp/graph.svg --grep-tables="products|billing_accounts|limits|billing_account_managers|activations|migrations" --invert-match
````

### `orgs` table

Tables whose rows represent organisations (also called "Team sites").

| Column name | Description |
| ------------- | -------------- |
| id | The primary key |
| name | The name as displayed in the UI |
| domain | The part that should be added in the URL |
| owner | The id of the user who owns the org |
| host | ??? |

### `workspaces` table

Tables whose rows represent workspaces

| Column name | Description |
| ------------- | -------------- |
| id | The primary key |
| name | The name as displayed in the UI |
| org_id | The organisation to which the workspace belongs |
| removed_at | If not null, stores the date when the workspaces has been placed in the trash (it will be hard deleted after 30 days) |


### `docs` table

Tables whose rows represent documents

| Column name | Description |
| ------------- | -------------- |
| id | The primary key |
| name | The name as displayed in the UI |
| workspace_id | The workspace to which the document belongs |
| is_pinned | Whether the document has been pinned or not |
| url_id | Short version of the `id`, as displayed in the URL |
| removed_at | If not null, stores the date when the workspaces has been placed in the trash (it will be hard deleted after 30 days) |
| options | Serialized options as described in [DocumentOptions](https://github.com/gristlabs/grist-core/blob/4567fad94787c20f65db68e744c47d5f44b932e4/app/common/UserAPI.ts#L125-L135) |
| grace_period_start | Specific to getgrist.com (TODO describe it) |
| usage | stats about the document (see [DocumentUsage](https://github.com/gristlabs/grist-core/blob/4567fad94787c20f65db68e744c47d5f44b932e4/app/common/DocUsage.ts)) |
| trunk_id | If set, the current document is a fork (as of 2024-04-15, only from a tutorial), and this column references the original document |
| type | If set, the current document is a special one (as specified in [DocumentType](https://github.com/gristlabs/grist-core/blob/4567fad94787c20f65db68e744c47d5f44b932e4/app/common/UserAPI.ts#L123)) |

### `aliases` table

Aliases for documents.

FIXME: What's the difference between `docs.url_id` and `alias.url_id`?

| Column name | Description |
| ------------- | -------------- |
| url_id | The URL alias for the doc_id |
| org_id | The organisation to which the document belong to |
| doc_id | The document id |

### `acl_rules` table

Permissions for to access either a document, workspace or an organisation.

| Column name | Description |
| ------------- | -------------- |
| id | The primary key |
| permissions | The permissions granted to the group. see below. |
| type | Either equals to `ACLRuleOrg`, `ACLRuleWs` or `ACLRuleDoc` |
| org_id | The org id associated to this ACL (if set, workspace_id and doc_id are null) |
| workspace_id | The workspace id associated to this ACL (if set, doc_id and org_id are null) |
| doc_id | The document id associated to this ACL (if set, workspace_id and org_id are null) |
| group_id | The group of users for which the ACL applies |

The permissions are stored as an integer which is read in its binary form which allows to make bitwise operations:

| Name | Value (binary) | Description |
| --------------- | --------------- | --------------- |
| VIEW | +0b00000001 | can view |
| UPDATE | +0b00000010 | can update |
| ADD | +0b00000100 | can add |
| REMOVE | +0b00001000 | can remove |
| SCHEMA_EDIT | +0b00010000 | can change schema of tables |
| ACL_EDIT | +0b00100000 | can edit the ACL (docs) or manage the teams (orgs and workspaces) of the resource |
| (reserved) | +0b01000000 | (reserved bit for the future) |
| PUBLIC | +0b10000000 | virtual bit meaning that the resource is shared publicly  |

You notice that the permissions can be then composed:
 - EDITOR permissions = `VIEW | UPDATE | ADD | REMOVE` = `0b00000001+0b00000010+0b00000100+0b00001000` = `0b00001111` = `15`
 - ADMIN permissions = `EDITOR | SCHEMA_EDIT` = `0b00001111+0b00010000` = `0b00011111` = `31`
 - ...

For more details about that part, please refer [to the code](https://github.com/gristlabs/grist-core/blob/192e2f36ba77ec67069c58035d35205978b9215e/app/gen-server/lib/Permissions.ts).

### `prefs` table

### The migrations

The database migrations are handled by TypeORM ([documentation](https://typeorm.io/migrations)). The migration files are located at `app/gen-server/migration` and are run at startup (so you don't have to worry about running them yourself).

