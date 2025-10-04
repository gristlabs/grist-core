import {nativeValues} from "app/gen-server/lib/values";
import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from "typeorm";

export class DocDisabledAt1759434763338 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.addColumn("docs", new TableColumn({
        name: "disabled_at",
        type: nativeValues.dateTimeType,
        isNullable: true,
      }));
      await queryRunner.createIndex("docs", new TableIndex({
        name: "docs__disabled_at",
        columnNames: ['disabled_at']
      }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
      await queryRunner.dropColumn("docs", "disabled_at");
    }
}
