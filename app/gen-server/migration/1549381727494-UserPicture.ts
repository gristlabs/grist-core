import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class UserPicture1549381727494 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.addColumn("users", new TableColumn({
        name: "picture",
        type: "varchar",
        isNullable: true,
      }));
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.dropColumn("users", "picture");
    }
}
