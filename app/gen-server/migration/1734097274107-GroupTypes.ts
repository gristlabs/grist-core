import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";
import { Group } from "app/gen-server/entity/Group";

export class GroupTypes1734097274107 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const newColumn = new TableColumn({
      name: 'type',
      type: 'varchar',
      enum: [Group.ROLE_TYPE, Group.RESOURCE_USERS_TYPE],
      comment: `If the type is ${Group.ROLE_TYPE}, the group is meant to assign a role to ` +
        'users for a resource (document, workspace or org).' +
        '\n\n' +
        `If the type is "${Group.RESOURCE_USERS_TYPE}", the group is meant to gather users together ` +
        'so they can be granted the same role to some resources (hence this name).',
      isNullable: true, // Make it not nullable after setting the roles for existing groups
    });

    await queryRunner.addColumn('groups', newColumn);

    await queryRunner.manager
      .query('UPDATE groups SET type = $1', [Group.ROLE_TYPE]);

    const newColumnNonNull = newColumn.clone();
    newColumnNonNull.isNullable = false;

    await queryRunner.changeColumn('groups', newColumn, newColumnNonNull);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn('groups', 'type');
  }
}

