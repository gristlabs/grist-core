import {nativeValues} from "app/gen-server/lib/values";
import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class DocumentUsage1651469582887 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn("docs", new TableColumn({
      name: "usage",
      type: nativeValues.jsonType,
      isNullable: true
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn("docs", "usage");
  }

}
