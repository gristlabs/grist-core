import * as sqlUtils from "app/gen-server/sqlUtils";
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class GroupUsersCreatedAt1749454162428 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);
    await queryRunner.addColumn('group_users', new TableColumn({
      name: 'created_at',
      comment: 'When the user has been added to the associated group. This column is not exposed to the ORM.',
      type: datetime,
      default: now,
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('group_users', 'created_at');
  }
}
