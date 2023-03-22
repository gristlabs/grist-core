import {MigrationInterface, QueryRunner, TableIndex} from "typeorm";

export class ForkIndexes1678737195050 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // HomeDBManager._onFork() references created_by in the ON clause.
    await queryRunner.createIndex("docs", new TableIndex({
      name: "docs__created_by",
      columnNames: ["created_by"]
    }));
    // HomeDBManager.getDocForks() references trunk_id in the WHERE clause.
    await queryRunner.createIndex("docs", new TableIndex({
      name: "docs__trunk_id",
      columnNames: ["trunk_id"]
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex("docs", "docs__created_by");
    await queryRunner.dropIndex("docs", "docs__trunk_id");
  }
}
