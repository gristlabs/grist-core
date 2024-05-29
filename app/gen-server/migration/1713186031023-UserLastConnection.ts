import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class UserLastConnection1713186031023 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn('users', new TableColumn({
      name: 'last_connection_at',
      type: "date",
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('users', 'last_connection_at');
  }
}
