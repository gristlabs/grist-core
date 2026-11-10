import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class ReferenceContracts1790576400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn("reference_publications", new TableColumn({
      name: "contract_version", type: "integer", default: 1,
    }));
    for (const name of ["accepted_contract_version", "applied_contract_version"]) {
      await queryRunner.addColumn("reference_subscriptions", new TableColumn({ name, type: "integer", default: 0 }));
    }
    // Existing mirrors keep their existing contract and data; pending grants still require acceptance.
    await queryRunner.query(`UPDATE reference_subscriptions SET accepted_contract_version = 1
      WHERE status <> 'AUTHORIZED' OR applied_at <> ''`);
    await queryRunner.query(`UPDATE reference_subscriptions SET applied_contract_version = 1 WHERE applied_at <> ''`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("reference_subscriptions", "applied_contract_version");
    await queryRunner.dropColumn("reference_subscriptions", "accepted_contract_version");
    await queryRunner.dropColumn("reference_publications", "contract_version");
  }
}
