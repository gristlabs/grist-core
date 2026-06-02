import { nativeValues } from "app/gen-server/lib/values";

import { MigrationInterface, QueryRunner, Table, TableForeignKey } from "typeorm";

export class DocPref1746246433628 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: "doc_prefs",
      columns: [
        { name: "doc_id", type: "varchar" },
        { name: "user_id", type: "integer", isNullable: true },
        { name: "prefs", type: nativeValues.jsonType },
      ],
      foreignKeys: [
        new TableForeignKey({
          columnNames: ["doc_id"],
          referencedTableName: "docs",
          referencedColumnNames: ["id"],
          onDelete: "CASCADE",    // delete pref if the linked-to doc is deleted
        }),
        new TableForeignKey({
          columnNames: ["user_id"],
          referencedTableName: "users",
          referencedColumnNames: ["id"],
          onDelete: "CASCADE",    // delete pref if the linked-to user is deleted
        }),
      ],
    }));

    // To create an index on expression (used here to ensure a unique (doc_id, NULL) combination),
    // can't use TypeORM, so use direct SQL (identical for Sqlite and Postgres).
    await queryRunner.query(
      'CREATE UNIQUE INDEX "doc_prefs__doc_id__user_id" ON "doc_prefs" ' +
      "(doc_id, COALESCE(user_id, 0))",
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("doc_prefs");
  }
}
