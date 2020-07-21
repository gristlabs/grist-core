import {MigrationInterface, QueryRunner, TableIndex} from "typeorm";

export class Indexes1553016106336 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
     await queryRunner.createIndex("acl_rules", new TableIndex({
       name: "acl_rules__org_id",
       columnNames: ["org_id"]
     }));
     await queryRunner.createIndex("acl_rules", new TableIndex({
       name: "acl_rules__workspace_id",
       columnNames: ["workspace_id"]
     }));
     await queryRunner.createIndex("acl_rules", new TableIndex({
       name: "acl_rules__doc_id",
       columnNames: ["doc_id"]
     }));

     await queryRunner.createIndex("group_groups", new TableIndex({
       name: "group_groups__group_id",
       columnNames: ["group_id"]
     }));
     await queryRunner.createIndex("group_groups", new TableIndex({
       name: "group_groups__subgroup_id",
       columnNames: ["subgroup_id"]
     }));

     await queryRunner.createIndex("group_users", new TableIndex({
       name: "group_users__group_id",
       columnNames: ["group_id"]
     }));
     await queryRunner.createIndex("group_users", new TableIndex({
       name: "group_users__user_id",
       columnNames: ["user_id"]
     }));

     await queryRunner.createIndex("workspaces", new TableIndex({
       name: "workspaces__org_id",
       columnNames: ["org_id"]
     }));

     await queryRunner.createIndex("docs", new TableIndex({
       name: "docs__workspace_id",
       columnNames: ["workspace_id"]
     }));

     await queryRunner.createIndex("logins", new TableIndex({
       name: "logins__user_id",
       columnNames: ["user_id"]
     }));
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
     await queryRunner.dropIndex("acl_rules", "acl_rules__org_id");
     await queryRunner.dropIndex("acl_rules", "acl_rules__workspace_id");
     await queryRunner.dropIndex("acl_rules", "acl_rules__doc_id");
     await queryRunner.dropIndex("group_groups", "group_groups__group_id");
     await queryRunner.dropIndex("group_groups", "group_groups__subgroup_id");
     await queryRunner.dropIndex("group_users", "group_users__group_id");
     await queryRunner.dropIndex("group_users", "group_users__user_id");
     await queryRunner.dropIndex("workspaces", "workspaces__org_id");
     await queryRunner.dropIndex("docs", "docs__workspace_id");
     await queryRunner.dropIndex("logins", "logins__user_id");
   }

}
