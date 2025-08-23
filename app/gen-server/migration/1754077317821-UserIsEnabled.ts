import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from "typeorm";
import {nativeValues} from "app/gen-server/lib/values";

export class UserIsEnabled1754077317821 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.addColumn("users", new TableColumn({
        name: "is_enabled",
        type: nativeValues.booleanType,
        default: true,
        isNullable: false,
      }));

      await queryRunner.createIndex("users", new TableIndex({
        name: "users__is_enabled",
        columnNames: ["is_enabled"],
      }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.dropColumn("users", "is_enabled");
    }
}
