import { nativeValues } from 'app/gen-server/lib/values';
import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class ExternalBilling1623871765992 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn('billing_accounts', new TableColumn({
      name: 'external_id',
      type: 'varchar',
      isNullable: true,
      isUnique: true,
    }));
    await queryRunner.addColumn('billing_accounts', new TableColumn({
      name: 'external_options',
      type: nativeValues.jsonType,
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('billing_accounts', 'external_id');
    await queryRunner.dropColumn('billing_accounts', 'external_options');
  }
}
