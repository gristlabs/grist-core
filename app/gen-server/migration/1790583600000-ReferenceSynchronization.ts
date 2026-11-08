import { MigrationInterface, QueryRunner, Table, TableColumn } from "typeorm";
export class ReferenceSynchronization1790583600000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    for (const options of [
      { name: "sync_mode", type: "varchar", default: "'live'" },
      { name: "sync_interval_minutes", type: "integer", default: 60 },
      { name: "next_sync_at", type: "varchar", default: "''" },
    ]) { await runner.addColumn("reference_subscriptions", new TableColumn(options)); }
    await runner.createTable(new Table({ name: "reference_audit_events", columns: [
      { name: "id", type: "varchar", isPrimary: true },
      { name: "document_id", type: "varchar" },
      { name: "created_at", type: "varchar" },
      { name: "actor_id", type: "integer", isNullable: true },
      { name: "operation", type: "varchar" },
      { name: "details", type: "text" },
    ], indices: [{ name: "reference_audit_document", columnNames: ["document_id", "created_at", "id"] }] }));
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.dropTable("reference_audit_events");
    for (const name of ["next_sync_at", "sync_interval_minutes", "sync_mode"]) {
      await runner.dropColumn("reference_subscriptions", name);
    }
  }
}
