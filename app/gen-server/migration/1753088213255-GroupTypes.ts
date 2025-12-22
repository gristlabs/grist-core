import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from "typeorm";
import { Group } from "app/gen-server/entity/Group";

export class GroupTypes1753088213255 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const newColumn = new TableColumn({
      name: 'type',
      type: 'varchar',
      enum: [Group.ROLE_TYPE, Group.TEAM_TYPE],
      comment: `If the type is ${Group.ROLE_TYPE}, the group is meant to assign a role to ` +
        'users for a resource (document, workspace or org).' +
        '\n\n' +
        `If the type is "${Group.TEAM_TYPE}", the group is meant to gather users together ` +
        'so they can be granted the same access (through a role) to some resources.',
      isNullable: true, // Make it not nullable after setting the roles for existing groups
    });

    await queryRunner.addColumn('groups', newColumn);

    await queryRunner.manager
      .query('UPDATE groups SET type = $1', [Group.ROLE_TYPE]);

    const newColumnNonNull = newColumn.clone();
    newColumnNonNull.isNullable = false;

    await queryRunner.changeColumn('groups', newColumn, newColumnNonNull);

    // Add a unique index on name to ensure that a team name is unique
    await queryRunner.createIndex('groups', new TableIndex({
      name: 'team_name_unique',
      columnNames: ['name'],
      isUnique: true,
      where: `groups.type = '${Group.TEAM_TYPE}'`,
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropIndex('groups', 'team_name_unique');
    await queryRunner.dropColumn('groups', 'type');
  }
}
