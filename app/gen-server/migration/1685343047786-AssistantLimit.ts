import * as sqlUtils from "app/gen-server/sqlUtils";
import {MigrationInterface, QueryRunner, Table, TableIndex} from 'typeorm';

export class AssistantLimit1685343047786 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);
    await queryRunner.createTable(
      new Table({
        name: 'limits',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          {
            name: 'type',
            type: 'varchar',
          },
          {
            name: 'billing_account_id',
            type: 'integer',
          },
          {
            name: 'limit',
            type: 'integer',
            default: 0,
          },
          {
            name: 'usage',
            type: 'integer',
            default: 0,
          },
          {
            name: "created_at",
            type: datetime,
            default: now
          },
          {
            name: "changed_at", // When the limit was last changed
            type: datetime,
            isNullable: true
          },
          {
            name: "used_at", // When the usage was last increased
            type: datetime,
            isNullable: true
          },
          {
            name: "reset_at", // When the usage was last reset.
            type: datetime,
            isNullable: true
          },
        ],
        foreignKeys: [
          {
            columnNames: ['billing_account_id'],
            referencedTableName: 'billing_accounts',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      })
    );

    await queryRunner.createIndex(
      'limits',
      new TableIndex({
        name: 'limits_billing_account_id',
        columnNames: ['billing_account_id'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('limits');
  }
}
