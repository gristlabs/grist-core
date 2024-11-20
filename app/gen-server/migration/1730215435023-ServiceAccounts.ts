import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from "typeorm";
import * as sqlUtils from "app/gen-server/sqlUtils";

export class ServiceAccounts1730215435023 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);

    await queryRunner.addColumn('users', new TableColumn({
      name: 'type',
      type: 'varchar',
      isNullable: false,
      default: "'login'",
    }));
    await queryRunner.createTable(
      new Table({
        name: 'service_accounts',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
          },
          {
            name: 'description',
            type: 'varchar'
          },
          {
            name: 'endOfLife',
            type: datetime,
            isNullable: false,
          },
        ],
      })
    );
    await queryRunner.createTable(
      new Table({
        name: 'service_account_user',
        columns: [
          {
            name: 'service_account_id',
            type: 'int',
          },
          {
            name: 'user_id',
            type: 'int'
          },
        ],
      })
    );
    await queryRunner.createForeignKey(
      'service_account_user',
      new TableForeignKey({
        columnNames: ['service_account_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'service_accounts',
        onDelete: 'CASCADE',
      })
    );
    await queryRunner.createForeignKey(
      'service_account_user',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      })
    );
    await queryRunner.createIndex(
      'service_account_user',
      new TableIndex({
        name: 'service_account__user',
        columnNames: ['service_account_id', 'user_id'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('users', 'type');
    await queryRunner.dropTable('service_accounts');
    await queryRunner.dropTable('service_account_user');
  }
}
