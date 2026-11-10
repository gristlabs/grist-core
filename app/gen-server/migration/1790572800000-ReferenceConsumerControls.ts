import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class ReferenceConsumerControls1790572800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of ["source_paused", "destination_paused"]) {
      await queryRunner.addColumn("reference_subscriptions", new TableColumn({
        name, type: "boolean", default: false,
      }));
    }
    await queryRunner.addColumn("reference_subscriptions", new TableColumn({
      name: "authorization_version", type: "integer", default: 0,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ["authorization_version", "destination_paused", "source_paused"]) {
      await queryRunner.dropColumn("reference_subscriptions", name);
    }
  }
}
