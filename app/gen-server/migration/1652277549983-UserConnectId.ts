import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from "typeorm";

export class UserConnectId1652277549983 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn("users", new TableColumn({
      name: "connect_id",
      type: 'varchar',
      isNullable: true,
      isUnique: true,
    }));
    await queryRunner.createIndex("users", new TableIndex({
      name: "users_connect_id",
      columnNames: ["connect_id"],
      isUnique: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropIndex("users", "users_connect_id");
    await queryRunner.dropColumn("users", "connect_id");
  }
}
