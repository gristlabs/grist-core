import {MigrationInterface, QueryRunner, TableIndex} from "typeorm";

export class ExtraIndexes1579559983067 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.createIndex("acl_rules", new TableIndex({
      name: "acl_rules__group_id",
      columnNames: ["group_id"]
    }));
    await queryRunner.createIndex("orgs", new TableIndex({
      name: "orgs__billing_account_id",
      columnNames: ["billing_account_id"]
    }));
    await queryRunner.createIndex("billing_account_managers", new TableIndex({
      name: "billing_account_managers__billing_account_id",
      columnNames: ["billing_account_id"]
    }));
    await queryRunner.createIndex("billing_account_managers", new TableIndex({
      name: "billing_account_managers__user_id",
      columnNames: ["user_id"]
    }));
    await queryRunner.createIndex("billing_accounts", new TableIndex({
      name: "billing_accounts__product_id",
      columnNames: ["product_id"]
    }));
    await queryRunner.createIndex("aliases", new TableIndex({
      name: "aliases__org_id",
      columnNames: ["org_id"]
    }));
    await queryRunner.createIndex("aliases", new TableIndex({
      name: "aliases__doc_id",
      columnNames: ["doc_id"]
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropIndex("acl_rules", "acl_rules__group_id");
    await queryRunner.dropIndex("orgs", "orgs__billing_account_id");
    await queryRunner.dropIndex("billing_account_managers", "billing_account_managers__billing_account_id");
    await queryRunner.dropIndex("billing_account_managers", "billing_account_managers__user_id");
    await queryRunner.dropIndex("billing_accounts", "billing_accounts__product_id");
    await queryRunner.dropIndex("aliases", "aliases__org_id");
    await queryRunner.dropIndex("aliases", "aliases__doc_id");
  }
}
