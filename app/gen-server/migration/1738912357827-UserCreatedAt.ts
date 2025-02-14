import {datetime, now} from 'app/gen-server/sqlUtils';
import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from 'typeorm';

export class UserCreatedAt1738912357827 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    const dbType = queryRunner.connection.driver.options.type;

    await queryRunner.addColumn("users", new TableColumn({
      name: "created_at",
      type: datetime(dbType),
      default: now(dbType),
      isNullable: false,
    }));

    // Backfill created_at in the following order:
    //  1. If a user has a personal org, use its created_at
    //  2. If an activation has been minted, use its created_at
    //
    // If neither option works, leave the default value. (This should be exceedingly rare.)
    const activation = await queryRunner
      .manager
      .createQueryBuilder()
      .select(["activations.created_at"])
      .from("activations", "activations")
      .getRawOne();
    await queryRunner.query(
      `UPDATE users
      SET created_at = COALESCE(orgs.created_at, $1, users.created_at)
      FROM (
        SELECT u.id AS owner_id, o.created_at AS created_at
        FROM users u
        LEFT JOIN orgs o
        ON u.id = o.owner_id
      ) AS orgs
      WHERE users.id = orgs.owner_id;`,
      [activation?.created_at ?? null]
    );

    await queryRunner.createIndex("users", new TableIndex({
      name: "users__created_at",
      columnNames: ["created_at"],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn("users", "created_at");
  }
}
