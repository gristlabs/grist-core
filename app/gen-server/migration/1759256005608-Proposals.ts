import { nativeValues } from 'app/gen-server/lib/values';
import * as sqlUtils from 'app/gen-server/sqlUtils';
import { MigrationInterface, QueryRunner, Table, TableIndex, TableUnique } from 'typeorm';

export class Proposals1759256005608 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbType = queryRunner.connection.driver.options.type;
    const datetime = sqlUtils.datetime(dbType);
    const now = sqlUtils.now(dbType);
    await queryRunner.createTable(new Table({
      name: 'proposals',
      columns: [
        {
          name: 'short_id',
          type: 'integer',
        },
        {
          name: 'src_doc_id',
          type: "varchar",
          isPrimary: true,
        },
        {
          name: 'dest_doc_id',
          type: "varchar",
          isPrimary: true,
        },
        {
          name: 'comparison',
          type: nativeValues.jsonType,
        },
        {
          name: 'status',
          type: nativeValues.jsonType,
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
          name: "applied_at",
          type: datetime,
          isNullable: true
        },
      ],
      foreignKeys: [
        {
          columnNames: ['src_doc_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'docs',
          onDelete: 'CASCADE',
        },
        {
          columnNames: ['dest_doc_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'docs',
          onDelete: 'CASCADE',
        },
      ],
    }));
    await queryRunner.createIndex('proposals', new TableIndex({
      name: 'proposals__dest_doc_id__short_id',
      columnNames: ['dest_doc_id', 'short_id'],
      isUnique: true,
    }));
    await queryRunner.createUniqueConstraint(
      'proposals',
      new TableUnique({
        name: 'proposals__dest_doc_id__src_doc_id',
        columnNames: ['dest_doc_id', 'src_doc_id'],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('proposals');
  }
}
