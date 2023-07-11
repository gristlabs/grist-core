import {nativeValues} from 'app/gen-server/lib/values';
import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class ActivationPrefs1682636695021 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.addColumn('activations', new TableColumn({
        name: 'prefs',
        type: nativeValues.jsonType,
        isNullable: true,
      }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('activations', 'prefs');
  }
}
