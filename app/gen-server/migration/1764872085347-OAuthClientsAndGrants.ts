import { nativeValues } from "app/gen-server/lib/values";
import * as sqlUtils from "app/gen-server/sqlUtils";

import { MigrationInterface, QueryRunner, Table } from "typeorm";

export class OAuthClientsAndGrants1764872085347 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);

    await queryRunner.createTable(
      new Table({
        name: "oauth_clients",
        columns: [
          {
            name: "id",
            type: "varchar",
            isPrimary: true,
          },
          // Core client properties.
          //
          // Schema is dynamic and dictated by the `oidc-provider` library.
          // See https://github.com/panva/node-oidc-provider/blob/main/example/my_adapter.js#L41-L42).
          //
          // Use jsonb if the TypeORM driver supports it. It trades INSERT performance
          // and format preservation for better modification performance and stronger
          // validations. For most use cases, it's a better default, and what other
          // `oidc-provider` adapter implementations also use.
          {
            name: "payload",
            type: nativeValues.jsonbType,
          },
          // Clients are currently owned by personal orgs. In the future, we will want to expand
          // this to include other orgs, to support management of clients within a team. Doing so
          // shouldn't require a new migration.
          {
            name: "org_id",
            type: "integer",
          },
          {
            name: "created_at",
            type: datetime,
            default: now,
          },
          {
            name: "updated_at",
            type: datetime,
            default: now,
          },
        ],
        foreignKeys: [
          {
            columnNames: ["org_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "orgs",
            // Delete clients when their orgs are deleted.
            onDelete: "CASCADE",
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: "oauth_grants",
        columns: [
          {
            name: "id",
            type: "varchar",
            isPrimary: true,
          },
          // Core grant properties.
          //
          // Schema is dynamic and dictated by the `oidc-provider` library.
          // See https://github.com/panva/node-oidc-provider/blob/main/example/my_adapter.js#L41-L42).
          {
            name: "payload",
            type: nativeValues.jsonbType,
          },
          // Grants are issued for a particular client.
          {
            name: "oauth_client_id",
            type: "varchar",
          },
          // Grants are issued to a particular user.
          {
            name: "issued_to_user_id",
            type: "integer",
          },
          {
            name: "created_at",
            type: datetime,
            default: now,
          },
          {
            name: "updated_at",
            type: datetime,
            default: now,
          },
        ],
        foreignKeys: [
          {
            columnNames: ["oauth_client_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "oauth_clients",
            // Delete grants when their clients are deleted.
            onDelete: "CASCADE",
          },
          {
            columnNames: ["issued_to_user_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "users",
            // Delete grants when their users are deleted.
            onDelete: "CASCADE",
          },
        ],
        indices: [
          // A particular client-user may only have one grant, which encompasses all
          // scopes granted to the client on behalf of the user.
          { columnNames: ["oauth_client_id", "issued_to_user_id"], isUnique: true },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("oauth_grants");
    await queryRunner.dropTable("oauth_clients");
  }
}
