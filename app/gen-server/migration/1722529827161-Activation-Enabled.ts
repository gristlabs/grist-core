import * as sqlUtils from "app/gen-server/sqlUtils";
import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class ActivationEnabled1722529827161 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    await queryRunner.addColumn('activations', new TableColumn({
      name: 'enabled_at',
      type: datetime,
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('activations', 'enabled_at');
  }
}
