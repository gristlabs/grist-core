import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class OrgHost1591755411755 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn('orgs', new TableColumn({
      name: 'host',
      type: 'varchar',
      isNullable: true,
      isUnique: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('orgs', 'host');
  }
}
