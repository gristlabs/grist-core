import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class ReferenceManagement1790580000000 implements MigrationInterface {
  public async up(runner: QueryRunner): Promise<void> {
    await runner.addColumn("reference_connection_links", new TableColumn({
      name: "settings_version", type: "integer", default: 1,
    }));
    await runner.addColumn("reference_subscriptions", new TableColumn({
      name: "accepted_contract", type: "text", isNullable: true,
    }));
    // Never invent historical contracts when a destination has not accepted the current version.
    await runner.query(`UPDATE reference_subscriptions SET accepted_contract = (
      SELECT spec FROM reference_publications p WHERE p.id = publication_id
        AND p.contract_version = accepted_contract_version)`);
  }

  public async down(runner: QueryRunner): Promise<void> {
    await runner.dropColumn("reference_subscriptions", "accepted_contract");
    await runner.dropColumn("reference_connection_links", "settings_version");
  }
}
