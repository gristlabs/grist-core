import { nativeValues } from 'app/gen-server/lib/values';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class DocOptions1626369037484 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn('docs', new TableColumn({
      name: 'options',
      type: nativeValues.jsonType,
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('docs', 'options');
  }
}
