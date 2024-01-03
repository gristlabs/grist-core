import { nativeValues } from 'app/gen-server/lib/values';
import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableUnique } from 'typeorm';

export class Shares1701557445716 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'shares',
      columns: [
        {
          name: 'id',
          type: 'integer',
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: 'key',
          type: 'varchar',
          isUnique: true,
        },
        {
          name: 'doc_id',
          type: 'varchar',
        },
        {
          name: 'link_id',
          type: 'varchar',
        },
        {
          name: 'options',
          type: nativeValues.jsonType,
        },
      ]
    }));
    await queryRunner.createForeignKeys('shares', [
      new TableForeignKey({
        columnNames: ['doc_id'],
        referencedTableName: 'docs',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE', // delete share if doc goes away
      }),
    ]);
    await queryRunner.createUniqueConstraints('shares', [
      new TableUnique({
        columnNames: ['doc_id', 'link_id'],
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('shares');
  }
}
