import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class PinDocs1549313797109 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const sqlite = queryRunner.connection.driver.options.type === 'sqlite';
    await queryRunner.addColumn('docs', new TableColumn({
      name: 'is_pinned',
      type: 'boolean',
      default: sqlite ? 0 : false
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('docs', 'is_pinned');
  }
}
