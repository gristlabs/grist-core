import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class UserDisabledReason1786377549593 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn("users", new TableColumn({
      name: "disabled_reason",
      type: "varchar",
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("users", "disabled_reason");
  }
}
