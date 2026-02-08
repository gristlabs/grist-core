import { nativeValues } from "app/gen-server/lib/values";
import * as sqlUtils from "app/gen-server/sqlUtils";

import { MigrationInterface, QueryRunner, Table, TableUnique } from "typeorm";

export class Proposals1759256005608 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);
    // The primary key for this table is a composite of the
    // dest_doc_id (the document receiving the proposal)
    // and the short_id (this is an id scoped to the
    // destination document, starting at 1 for the first
    // proposal made to that document). Note that short_id
    // is not globally unique, it is only unique within
    // the scope of the document. It exists for github
    // pull request numbering aesthetics.
    await queryRunner.createTable(new Table({
      name: "proposals",
      columns: [
        {
          name: "dest_doc_id",
          type: "varchar",
          isPrimary: true,
        },
        {
          name: "short_id",
          type: "integer",
          isPrimary: true,
        },
        {
          name: "src_doc_id",
          type: "varchar",
        },
        {
          name: "comparison",
          type: nativeValues.jsonType,
        },
        {
          name: "status",
          type: nativeValues.jsonType,
        },
        {
          name: "created_at",
          type: datetime,
          default: now,
        },
        {
          name: "updated_at",
          type: datetime,
          default: now,
        },
        {
          name: "applied_at",
          type: datetime,
          isNullable: true,
        },
      ],
      foreignKeys: [
        {
          columnNames: ["src_doc_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "docs",
          onDelete: "CASCADE",
        },
        {
          columnNames: ["dest_doc_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "docs",
          onDelete: "CASCADE",
        },
      ],
    }));
    // This constraint is currently true, but perhaps
    // could be removed in the future.
    await queryRunner.createUniqueConstraint(
      "proposals",
      new TableUnique({
        name: "proposals__dest_doc_id__src_doc_id",
        columnNames: ["dest_doc_id", "src_doc_id"],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("proposals");
  }
}
