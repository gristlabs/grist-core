import { User } from "app/gen-server/entity/User";
import {nativeValues} from "app/gen-server/lib/values";
import { MigrationInterface, QueryRunner, Table, TableColumn } from "typeorm";

export class ServiceAccounts1756918816559 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const userTypeColumnTemp = new TableColumn({
        name: 'type',
        type: 'varchar',
        enum: [User.LOGIN_TYPE, User.SERVICE_TYPE],
        isNullable: true,
    });

    await queryRunner.addColumn('users', userTypeColumnTemp);

    await queryRunner.manager
      .query('UPDATE users SET type = $1', [User.LOGIN_TYPE]);

    const userTypeColumnNonNull = userTypeColumnTemp.clone();
    userTypeColumnNonNull.isNullable = false;

    await queryRunner.changeColumn('users', userTypeColumnTemp, userTypeColumnNonNull);

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
            isNullable: true,
          },
          {
            name: 'description',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'expires_at',
            type: nativeValues.dateTimeType,
            isNullable: false,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['service_user_id'],
            referencedColumnNames: ['id'],
            referencedTableName: 'users',
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['owner_id'],
            referencedColumnNames: ['id'],
            referencedTableName: 'users',
            onDelete: 'CASCADE',
          },
        ],
        indices: [
          {
            name: 'service_account__service_user_id',
            columnNames: ['service_user_id'],
          },
          {
            name: 'service_account__owner_id',
            columnNames: ['owner_id'],
          },
        ],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('users', 'type');
    await queryRunner.dropTable('service_accounts');
  }
}
