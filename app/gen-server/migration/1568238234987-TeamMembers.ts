import {MigrationInterface, QueryRunner} from "typeorm";
import * as roles from "app/common/roles";
import {AclRuleOrg} from "app/gen-server/entity/AclRule";
import {Group} from "app/gen-server/entity/Group";
import {Organization} from "app/gen-server/entity/Organization";
import {Permissions} from "app/gen-server/lib/Permissions";
import { getDatabaseType } from "app/server/lib/dbUtils";

export class TeamMembers1568238234987 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    // Get all orgs and add a team member ACL (with group) to each.
    const orgs = await queryRunner.manager.createQueryBuilder()
      .select("orgs.id")
      .from(Organization, "orgs")
      .getMany();
    for (const org of orgs) {
      // Don't use `manager.insert().into()` as the Group Entity contains properties that references columns
      // that don't exist yet and `insert()` would like to set their values as well.
      const groupInsertRes = await queryRunner.manager
        .query("INSERT into groups(name) values($1) RETURNING id", [ roles.MEMBER ]);
      const groupId = getDatabaseType(queryRunner.connection) === 'postgres' ?
        groupInsertRes[0].id :
        groupInsertRes;

      await queryRunner.manager.createQueryBuilder()
        .insert()
        .into(AclRuleOrg)
        .values([{
          permissions: Permissions.VIEW,
          organization: {id: org.id},
          group: groupId
        }])
        .execute();
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    // Remove all team member groups and corresponding ACLs.
    const groups = await queryRunner.manager.createQueryBuilder()
      .select("groups")
      .from(Group, "groups")
      .where('name = :name', {name: roles.MEMBER})
      .getMany();
    for (const group of groups) {
      await queryRunner.manager.createQueryBuilder()
        .delete()
        .from(AclRuleOrg)
        .where("group_id = :id", {id: group.id})
        .execute();
    }
    await queryRunner.manager.createQueryBuilder()
      .delete()
      .from(Group)
      .where("name = :name", {name: roles.MEMBER})
      .execute();
  }

}
