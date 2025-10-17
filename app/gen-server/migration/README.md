# Migrations

## Generate migrations

To generate new migration using `TypeORM` cli, run the following command in
this directory:

```bash
npx typeorm migration:create MigrationName
```

And then add this migration to test/gen-server/migrations.ts

## Rename Migrations after a rebase

Migrations files are prefixed by a Timestamp.
It is in an `Epoch` Timestamp with milliseconds.
The migration you are working on must always be the latest one.

To obtain current date as Epoch with millisecond,
You can run :

```bash
date +%s%N | cut -b1-13
```
