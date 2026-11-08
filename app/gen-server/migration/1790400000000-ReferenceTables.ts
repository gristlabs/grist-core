import { MigrationInterface, QueryRunner, Table } from "typeorm";
export class ReferenceTables1790400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({ name: "reference_registry_lock",
      columns: [{ name: "id", type: "integer", isPrimary: true }],
    }));
    await queryRunner.query("INSERT INTO reference_registry_lock(id) VALUES (1)");
    await queryRunner.createTable(new Table({
      name: "reference_publications",
      columns: [
        { name: "id", type: "varchar", isPrimary: true },
        { name: "source_doc_id", type: "varchar" },
        { name: "source_org_id", type: "integer" },
        { name: "spec", type: "text" },
        { name: "identities", type: "text" },
        { name: "columnEpochs", type: "text" },
        { name: "generation", type: "varchar" },
        { name: "paused", type: "boolean", default: false },
      ],
      indices: [{ name: "reference_publications_source", columnNames: ["source_doc_id"] }],
    }));
    await queryRunner.createTable(new Table({
      name: "reference_subscriptions",
      columns: [
        { name: "id", type: "varchar", isPrimary: true },
        { name: "publication_id", type: "varchar" },
        { name: "destination_doc_id", type: "varchar" },
        { name: "destination_org_id", type: "integer" },
        { name: "status", type: "varchar" },
        { name: "aliases", type: "text" },
        { name: "revoked", type: "boolean", default: false },
        { name: "applied_at", type: "varchar", default: "''" },
        { name: "error", type: "varchar", default: "''" },
      ],
      indices: [
        { name: "reference_subscription_destination", columnNames: ["publication_id", "destination_doc_id"],
          isUnique: true },
        { name: "reference_subscriptions_doc", columnNames: ["destination_doc_id"] },
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("reference_subscriptions");
    await queryRunner.dropTable("reference_publications");
    await queryRunner.dropTable("reference_registry_lock");
  }
}
