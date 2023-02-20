import {MigrationInterface, QueryRunner, TableColumn, TableForeignKey} from "typeorm";

export class Forks1673051005072 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns("docs", [
      new TableColumn({
        name: "created_by",
        type: "integer",
        isNullable: true,
      }),
      new TableColumn({
        name: "trunk_id",
        type: "text",
        isNullable: true,
      }),
      new TableColumn({
        name: "type",
        type: "text",
        isNullable: true,
      }),
    ]);

    await queryRunner.createForeignKeys("docs", [
      new TableForeignKey({
        columnNames: ["created_by"],
        referencedTableName: "users",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      }),
      new TableForeignKey({
        columnNames: ["trunk_id"],
        referencedTableName: "docs",
        referencedColumnNames: ["id"],
        onDelete: "CASCADE",
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns("docs", ["created_by", "trunk_id", "type"]);
  }
}
