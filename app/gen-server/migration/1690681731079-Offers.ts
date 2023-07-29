import { nativeValues } from 'app/gen-server/lib/values';
import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class Offers1690681731079 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(new Table({
      name: 'offers',
      columns: [
        {
          name: 'id',
          type: 'integer',
          isGenerated: true,
          generationStrategy: 'increment',
          isPrimary: true
        },
        {
          name: 'doc_id',
          type: "varchar",
          isUnique: true,
        },
        {
          name: 'offer',
          type: nativeValues.jsonType,
        }
      ],
      foreignKeys: [
        {
          columnNames: ['doc_id'],
          referencedColumnNames: ['id'],
          referencedTableName: 'docs',
          onDelete: 'CASCADE', // delete offer if linked to a deleted doc
        }
      ],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('offers');
  }
}
