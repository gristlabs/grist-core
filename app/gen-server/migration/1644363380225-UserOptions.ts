import {nativeValues} from "app/gen-server/lib/values";
import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class UserOptions1644363380225 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn("users", new TableColumn({
      name: "options",
      type: nativeValues.jsonType,
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn("users", "options");
  }
}
