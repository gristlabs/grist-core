import { MigrationInterface, QueryRunner, Table, TableColumn } from "typeorm";

export class ReferenceConnectionLinks1790486400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({ name: "reference_connection_links", columns: [
      { name: "id", type: "varchar", isPrimary: true },
      { name: "publication_id", type: "varchar" },
      { name: "name", type: "varchar" },
      { name: "secret_hash", type: "varchar" },
      { name: "created_at", type: "varchar" },
      { name: "created_by", type: "integer" },
      { name: "expires_at", type: "varchar", default: "''" },
      { name: "disabled", type: "boolean", default: false },
      { name: "allowed_org_ids", type: "text" },
      { name: "max_admissions", type: "integer", default: 0 },
      { name: "admissions", type: "integer", default: 0 },
    ], indices: [{ name: "reference_connection_links_publication", columnNames: ["publication_id"] }] }));
    for (const name of ["connection_link_id", "connected_at", "checked_at"]) {
      await queryRunner.addColumn("reference_subscriptions", new TableColumn({
        name, type: "varchar", default: "''",
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ["checked_at", "connected_at", "connection_link_id"]) {
      await queryRunner.dropColumn("reference_subscriptions", name);
    }
    await queryRunner.dropTable("reference_connection_links");
  }
}
