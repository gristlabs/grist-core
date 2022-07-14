import * as sqlUtils from "app/gen-server/sqlUtils";
import {MigrationInterface, QueryRunner, Table} from 'typeorm';

export class Activations1652273656610 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    // created_at and updated_at code is based on *-Initial.ts
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);
    await queryRunner.createTable(new Table({
      name: 'activations',
      columns: [
        {
          name: "id",
          type: "varchar",
          isPrimary: true,
        },
        {
          name: "key",
          type: "varchar",
          isNullable: true,
        },
        {
          name: "created_at",
          type: datetime,
          default: now
        },
        {
          name: "updated_at",
          type: datetime,
          default: now
        },
      ]}));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropTable('activations');
  }
}
