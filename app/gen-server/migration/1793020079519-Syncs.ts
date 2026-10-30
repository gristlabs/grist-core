import { nativeValues } from "app/gen-server/lib/values";

import { MigrationInterface, QueryRunner, Table, TableUnique } from "typeorm";

export class Syncs1793020079519 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: "syncs",
      columns: [
        {
          name: "id",
          type: "integer",
          isGenerated: true,
          generationStrategy: "increment",
          isPrimary: true,
        },
        {
          // Shared with the destination document, and unique only within it: a copy of a
          // document brings the same sync_ids along with it.
          name: "sync_id",
          type: "varchar",
        },
        {
          name: "dest_doc_id",
          type: "varchar",
        },
        {
          name: "source_doc_id",
          type: "varchar",
          isNullable: true,
        },
        {
          name: "owner_id",
          type: "integer",
          isNullable: true,
        },
        {
          name: "options",
          type: nativeValues.jsonType,
          isNullable: true,
        },
        {
          name: "status",
          type: nativeValues.jsonType,
          isNullable: true,
        },
      ],
      foreignKeys: [
        {
          columnNames: ["dest_doc_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "docs",
          // Syncs are owned by the destination document.
          onDelete: "CASCADE",
        },
        {
          columnNames: ["source_doc_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "docs",
          // Retain the record for now to allow for repair opportunities, but this could change later.
          onDelete: "SET NULL",
        },
        {
          columnNames: ["owner_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "users",
          onDelete: "SET NULL",
        },
      ],
    }));
    await queryRunner.createUniqueConstraint(
      "syncs",
      new TableUnique({
        name: "syncs__dest_doc_id__sync_id",
        columnNames: ["dest_doc_id", "sync_id"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("syncs");
  }
}
