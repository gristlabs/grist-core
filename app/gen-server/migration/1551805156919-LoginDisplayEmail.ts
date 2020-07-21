import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class LoginDisplayEmail1551805156919 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn('logins', new TableColumn({
      name: 'display_email',
      type: 'varchar',
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('logins', 'display_email');
  }
}
