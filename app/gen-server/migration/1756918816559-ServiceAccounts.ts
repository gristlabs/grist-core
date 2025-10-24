import { MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex } from "typeorm";
import * as sqlUtils from "app/gen-server/sqlUtils";

export class ServiceAccounts1756918816559 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);

    await queryRunner.addColumns('users', [
      new TableColumn({
        name: 'type',
        type: 'varchar',
        isNullable: false,
        default: "'login'",
      }),
    ]);
    await queryRunner.createTable(
      new Table({
        name: 'service_accounts',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isGenerated: true,
            generationStrategy: 'increment',
            isPrimary: true,
          },
          {
            name: 'owner_id',
            type: 'integer',
          },
          {
            name: 'service_user_id',
            type: 'integer',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'label',
            type: 'varchar',
            isNullable: false,
            default: "''",
          },
          {
            name: 'description',
            type: 'varchar',
            isNullable: false,
            default: "''",
          },
          {
            name: 'expires_at',
            type: datetime,
            isNullable: false,
          },
        ],
      })
    );
    await queryRunner.createForeignKey(
      'service_accounts',
      new TableForeignKey({
        columnNames: ['service_user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      })
    );
    await queryRunner.createForeignKey(
      'service_accounts',
      new TableForeignKey({
        columnNames: ['owner_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      })
    );
    await queryRunner.createIndex(
      'service_accounts',
      new TableIndex({
        name: 'service_account__service_user_id',
        columnNames: ['service_user_id'],
      })
    );
    await queryRunner.createIndex(
      'service_accounts',
      new TableIndex({
        name: 'service_account__owner_id',
        columnNames: ['owner_id'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('users', 'type');
    await queryRunner.dropTable('service_accounts');
  }
}
