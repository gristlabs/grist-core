import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";
import {nativeValues} from "app/gen-server/lib/values";

export class UserDisabledAt1754077317821 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.addColumn("users", new TableColumn({
        name: "disabled_at",
        type: nativeValues.dateTimeType,
        isNullable: true,
      }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.dropColumn("users", "disabled_at");
    }
}
