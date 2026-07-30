import { nativeValues } from "app/gen-server/lib/values";

import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class OAuthGrantSettingsAndLastUsedAt1777897588904 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn("oauth_grants", new TableColumn({
      name: "last_used_at",
      type: nativeValues.dateTimeType,
      isNullable: true,
    }));
    await queryRunner.addColumn("oauth_grants", new TableColumn({
      name: "settings",
      type: nativeValues.jsonbType,
      isNullable: true,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("oauth_grants", "settings");
    await queryRunner.dropColumn("oauth_grants", "last_used_at");
  }
}
