import {nativeValues} from 'app/gen-server/lib/values';
import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class Billing1711557445716 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn('billing_accounts', new TableColumn({
      name: 'features',
      type: nativeValues.jsonType,
      isNullable: true,
    }));

    await queryRunner.addColumn('billing_accounts', new TableColumn({
      name: 'payment_link',
      type: nativeValues.jsonType,
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('billing_accounts', 'features');
    await queryRunner.dropColumn('billing_accounts', 'payment_link');
  }
}
