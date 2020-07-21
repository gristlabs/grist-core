import {nativeValues} from "app/gen-server/lib/values";
import {MigrationInterface, QueryRunner, TableColumn, TableIndex} from "typeorm";

export class DocRemovedAt1592261300044 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    for (const table of ['docs', 'workspaces']) {
      await queryRunner.addColumn(table, new TableColumn({
        name: 'removed_at',
        type: nativeValues.dateTimeType,
        isNullable: true
      }));
      await queryRunner.createIndex(table, new TableIndex({
        name: `${table}__removed_at`,
        columnNames: ['removed_at']
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    for (const table of ['docs', 'workspaces']) {
      await queryRunner.dropIndex(table, `${table}__removed_at`);
      await queryRunner.dropColumn(table, 'removed_at');
    }
  }
}
