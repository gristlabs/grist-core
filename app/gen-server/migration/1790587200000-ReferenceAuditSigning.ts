import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class ReferenceAuditSigning1790587200000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    await runner.createTable(new Table({ name: "reference_audit_keys", columns: [
      { name: "id", type: "integer", isPrimary: true },
      { name: "secret", type: "varchar" },
    ] }));
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable("reference_audit_keys");
  }
}
