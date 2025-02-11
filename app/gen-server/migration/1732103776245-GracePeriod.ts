import {nativeValues} from 'app/gen-server/lib/values';
import {MigrationInterface, QueryRunner, TableColumn} from 'typeorm';

export class GracePeriod1732103776245 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn("activations", new TableColumn({
      name: "grace_period_start",
      type: nativeValues.dateTimeType,
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("activations", "grace_period_start");
  }
}
