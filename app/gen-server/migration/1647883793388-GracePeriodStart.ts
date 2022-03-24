import {nativeValues} from "app/gen-server/lib/values";
import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class GracePeriodStart1647883793388 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn("docs", new TableColumn({
      name: "grace_period_start",
      type: nativeValues.dateTimeType,
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn("docs", "grace_period_start");
  }

}
