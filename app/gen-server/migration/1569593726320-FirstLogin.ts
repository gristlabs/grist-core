import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class FirstLogin1569593726320 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const sqlite = queryRunner.connection.driver.options.type === 'sqlite';
    const datetime = sqlite ? "datetime" : "timestamp with time zone";
    await queryRunner.addColumn('users', new TableColumn({
      name: 'first_login_at',
      type: datetime,
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('users', 'first_login_at');
  }
}
