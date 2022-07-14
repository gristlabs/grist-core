import * as sqlUtils from "app/gen-server/sqlUtils";
import {MigrationInterface, QueryRunner, Table} from "typeorm";


export class Initial1536634251710 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    // TypeORM doesn't currently help with types of created tables:
    //   https://github.com/typeorm/typeorm/issues/305
    // so we need to do a little smoothing over postgres and sqlite.
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);

    await queryRunner.createTable(new Table({
      name: "users",
      columns: [
        {
          name: "id",
          type: "integer",
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: "name",
          type: "varchar",
        },
        {
          name: "api_key",
          type: "varchar",
          isNullable: true,
          isUnique: true
        }
      ]
    }), false);

    await queryRunner.createTable(new Table({
      name: "orgs",
      columns: [
        {
          name: "id",
          type: "integer",
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: "name",
          type: "varchar",
        },
        {
          name: "domain",
          type: "varchar",
          isNullable: true,
        },
        {
          name: "created_at",
          type: datetime,
          default: now
        },
        {
          name: "updated_at",
          type: datetime,
          default: now
        },
        {
          name: "owner_id",
          type: "integer",
          isNullable: true,
          isUnique: true
        }
      ],
      foreignKeys: [
        {
          columnNames: ["owner_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "users"
        }
      ]
    }), false);

    await queryRunner.createTable(new Table({
      name: "workspaces",
      columns: [
        {
          name: "id",
          type: "integer",
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: "name",
          type: "varchar",
        },
        {
          name: "created_at",
          type: datetime,
          default: now
        },
        {
          name: "updated_at",
          type: datetime,
          default: now
        },
        {
          name: "org_id",
          type: "integer",
          isNullable: true
        }
      ],
      foreignKeys: [
        {
          columnNames: ["org_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "orgs"
        }
      ]
    }), false);

    await queryRunner.createTable(new Table({
      name: "docs",
      columns: [
        {
          name: "id",
          type: "varchar",
          isPrimary: true
        },
        {
          name: "name",
          type: "varchar",
        },
        {
          name: "created_at",
          type: datetime,
          default: now
        },
        {
          name: "updated_at",
          type: datetime,
          default: now
        },
        {
          name: "workspace_id",
          type: "integer",
          isNullable: true
        }
      ],
      foreignKeys: [
        {
          columnNames: ["workspace_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "workspaces"
        }
      ]
    }), false);

    await queryRunner.createTable(new Table({
      name: "groups",
      columns: [
        {
          name: "id",
          type: "integer",
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: "name",
          type: "varchar",
        }
      ]
    }), false);

    await queryRunner.createTable(new Table({
      name: "acl_rules",
      columns: [
        {
          name: "id",
          type: "integer",
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: "permissions",
          type: "integer"
        },
        {
          name: "type",
          type: "varchar"
        },
        {
          name: "workspace_id",
          type: "integer",
          isNullable: true
        },
        {
          name: "org_id",
          type: "integer",
          isNullable: true
        },
        {
          name: "doc_id",
          type: "varchar",
          isNullable: true
        },
        {
          name: "group_id",
          type: "integer",
          isNullable: true
        }
      ],
      foreignKeys: [
        {
          columnNames: ["workspace_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "workspaces"
        },
        {
          columnNames: ["org_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "orgs"
        },
        {
          columnNames: ["doc_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "docs"
        },
        {
          columnNames: ["group_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "groups"
        }
      ]
    }), false);

    await queryRunner.createTable(new Table({
      name: "group_users",
      columns: [
        {
          name: "group_id",
          type: "integer",
          isPrimary: true
        },
        {
          name: "user_id",
          type: "integer",
          isPrimary: true
        },
      ],
      foreignKeys: [
        {
          columnNames: ["group_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "groups"
        },
        {
          columnNames: ["user_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "users"
        }
      ]
    }), false);

    await queryRunner.createTable(new Table({
      name: "group_groups",
      columns: [
        {
          name: "group_id",
          type: "integer",
          isPrimary: true
        },
        {
          name: "subgroup_id",
          type: "integer",
          isPrimary: true
        },
      ],
      foreignKeys: [
        {
          columnNames: ["group_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "groups"
        },
        {
          columnNames: ["subgroup_id"],
          referencedColumnNames: ["id"],
          referencedTableName: "groups"
        }
      ]
    }), false);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query(`DROP TABLE "group_groups"`);
    await queryRunner.query(`DROP TABLE "group_users"`);
    await queryRunner.query(`DROP TABLE "acl_rules"`);
    await queryRunner.query(`DROP TABLE "groups"`);
    await queryRunner.query(`DROP TABLE "docs"`);
    await queryRunner.query(`DROP TABLE "workspaces"`);
    await queryRunner.query(`DROP TABLE "orgs"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
