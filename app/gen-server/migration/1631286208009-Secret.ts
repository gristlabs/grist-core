import {MigrationInterface, QueryRunner, Table} from "typeorm";

export class Secret1631286208009 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.createTable(new Table({
      name: "secrets",
      columns: [
        {
          name: "id",
          type: "varchar",
          isPrimary: true
        },
        {
          name: "value",
          type: "varchar",
        },
        {
          name: "doc_id",
          type: "varchar",
        }
      ],
      foreignKeys: [
        {
          columnNames: ["doc_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "docs",
          onDelete: 'CASCADE'  // delete secret if linked to doc that is deleted
        }
      ]
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropTable('secrets');
  }

}
