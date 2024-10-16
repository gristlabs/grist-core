import { nativeValues } from "app/gen-server/lib/values";
import * as sqlUtils from "app/gen-server/sqlUtils";
import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class Configs1727747249153 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);

    await queryRunner.createTable(
      new Table({
        name: "configs",
        columns: [
          {
            name: "id",
            type: "integer",
            isGenerated: true,
            generationStrategy: "increment",
            isPrimary: true,
          },
          {
            name: "org_id",
            type: "integer",
            isNullable: true,
          },
          {
            name: "key",
            type: "varchar",
          },
          {
            name: "value",
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
        ],
        foreignKeys: [
          {
            columnNames: ["org_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "orgs",
            onDelete: "CASCADE",
          },
        ],
      })
    );

    await queryRunner.manager.query(
      'CREATE UNIQUE INDEX "configs__key__org_id" ON "configs" ' +
        "(key, COALESCE(org_id, 0))"
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropTable("configs");
  }
}
