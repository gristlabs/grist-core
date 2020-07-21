import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";
import {nativeValues} from 'app/gen-server/lib/values';

export class FirstTimeUser1569946508569 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.addColumn("users", new TableColumn({
      name: "is_first_time_user",
      type: nativeValues.booleanType,
      default: nativeValues.falseValue,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn("users", "is_first_time_user");
  }

}
