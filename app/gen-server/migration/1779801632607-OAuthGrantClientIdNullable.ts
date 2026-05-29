import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Makes `oauth_grants.oauth_client_id` nullable.
 *
 * NULL means the grant was issued to a CIMD (Client ID Metadata Document) client,
 * which has no row in `oauth_clients`. CIMD clients are identified by the URL of
 * their published metadata document (controlled by the client itself, e.g. Anthropic
 * for Claude Code) and resolved on each authorization request by `oidc-provider`.
 * There is no Grist-side "registering user" to own such a client, so we do not
 * persist a client row for them. The grant carries the user link directly.
 */
export class OAuthGrantClientIdNullable1779801632607 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = (await queryRunner.getTable("oauth_grants"))!;
    const clientId = table.findColumnByName("oauth_client_id")!;
    const clientIdNullable = clientId.clone();
    clientIdNullable.isNullable = true;
    await queryRunner.changeColumn("oauth_grants", clientId, clientIdNullable);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = (await queryRunner.getTable("oauth_grants"))!;
    const clientId = table.findColumnByName("oauth_client_id")!;
    const clientIdNonNull = clientId.clone();
    clientIdNonNull.isNullable = false;
    await queryRunner.changeColumn("oauth_grants", clientId, clientIdNonNull);
  }
}
