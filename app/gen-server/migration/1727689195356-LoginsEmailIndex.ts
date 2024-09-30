import {MigrationInterface, QueryRunner, TableIndex} from "typeorm";

export class LoginsEmailsIndex1727689195356 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.createIndex("logins", new TableIndex({
      name: "logins__email",
      columnNames: ["email"]
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropIndex("logins", "logins__email");
  }
}

