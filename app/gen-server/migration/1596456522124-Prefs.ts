import {nativeValues} from 'app/gen-server/lib/values';
import {MigrationInterface, QueryRunner, Table} from 'typeorm';

export class Prefs1596456522124 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.createTable(new Table({
      name: 'prefs',
      columns: [
        {
          name: 'org_id',
          type: 'integer',
          isNullable: true,
        },
        {
          name: 'user_id',
          type: 'integer',
          isNullable: true,
        },
        {
          name: 'prefs',
          type: nativeValues.jsonType
        }
      ],
      foreignKeys: [
        {
          columnNames: ['org_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'orgs',
          onDelete: 'CASCADE'  // delete pref if linked to org that is deleted
        },
        {
          columnNames: ['user_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'users',
          onDelete: 'CASCADE'  // delete pref if linked to user that is deleted
        },
      ],
      indices: [
        { columnNames: ['org_id', 'user_id'] },
        { columnNames: ['user_id'] },
      ],
      checks: [
        // Make sure pref refers to something, either a user or an org or both
        {
          columnNames: ['user_id', 'org_id'],
          expression: 'COALESCE(user_id, org_id) IS NOT NULL'
        },
      ]
    }));
    // Having trouble convincing TypeORM to create an index on expressions.
    // Luckily, the SQL is identical for Sqlite and Postgres:
    await queryRunner.manager.query(
      'CREATE UNIQUE INDEX "prefs__user_id__org_id" ON "prefs" ' +
        '(COALESCE(user_id,0), COALESCE(org_id,0))'
    );
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropTable('prefs');
  }
}
