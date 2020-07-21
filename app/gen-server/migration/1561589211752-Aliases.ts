import {MigrationInterface, QueryRunner, Table, TableColumn, TableIndex} from 'typeorm';
import {datetime, now} from 'app/gen-server/sqlUtils';

export class Aliases1561589211752 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const dbType = queryRunner.connection.driver.options.type;

    // Make a table for document aliases.
    await queryRunner.createTable(new Table({
      name: 'aliases',
      columns: [
        {
          name: 'url_id',
          type: 'varchar',
          isPrimary: true
        },
        {
          name: 'org_id',
          type: 'integer',
          isPrimary: true
        },
        {
          name: 'doc_id',
          type: 'varchar',
          isNullable: true   // nullable in case in future we make aliases for other resources
        },
        {
          name: "created_at",
          type: datetime(dbType),
          default: now(dbType)
        }
      ],
      foreignKeys: [
        {
          columnNames: ['doc_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'docs',
          onDelete: 'CASCADE'  // delete alias if doc goes away
        },
        {
          columnNames: ['org_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'orgs'
          // no CASCADE set - let deletions be triggered via docs
        }
      ]
    }));

    // Add preferred alias to docs.  Not quite a foreign key (we'd need org as well)
    await queryRunner.addColumn('docs', new TableColumn({
        name: 'url_id',
        type: 'varchar',
        isNullable: true
    }));
    await queryRunner.createIndex("docs", new TableIndex({
      name: "docs__url_id",
      columnNames: ["url_id"]
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropIndex('docs', 'docs__url_id');
    await queryRunner.dropColumn('docs', 'url_id');
    await queryRunner.dropTable('aliases');
  }
}
