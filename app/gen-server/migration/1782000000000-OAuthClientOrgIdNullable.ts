import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Makes `oauth_clients.org_id` nullable.
 *
 * NULL means the client is a DCR (Dynamic Client Registration) client with no owner org.
 * Such clients are created programmatically (e.g. via Dynamic Client Registration)
 * and are not tied to any user's personal or team org.
 */
export class OAuthClientOrgIdNullable1782000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = (await queryRunner.getTable("oauth_clients"))!;
    const orgId = table.findColumnByName("org_id")!;
    const orgIdNullable = orgId.clone();
    orgIdNullable.isNullable = true;
    await queryRunner.changeColumn("oauth_clients", orgId, orgIdNullable);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = (await queryRunner.getTable("oauth_clients"))!;
    const orgId = table.findColumnByName("org_id")!;
    const orgIdNonNull = orgId.clone();
    orgIdNonNull.isNullable = false;
    await queryRunner.changeColumn("oauth_clients", orgId, orgIdNonNull);
  }
}
