import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

/**
 * Adds an unsubscribe_key column to the users table. Used to create and verity links' signatures in emails.
 */
export class UserUnsubscribeKey1756799894986 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn("users", new TableColumn({
      name: "unsubscribe_key",
      type: "varchar",
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("users", "unsubscribe_key");
  }
}
