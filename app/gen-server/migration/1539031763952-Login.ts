import {MigrationInterface, QueryRunner, Table} from "typeorm";

export class Login1539031763952 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.createTable(new Table({
        name: 'logins',
        columns: [
          {
            name: "id",
            type: "integer",
            isGenerated: true,
            generationStrategy: 'increment',
            isPrimary: true
          },
          {
            name: 'user_id',
            type: 'integer'
          },
          {
            name: 'email',
            type: 'varchar',
            isUnique: true
          }
        ],
        foreignKeys: [
          {
            columnNames: ["user_id"],
            referencedColumnNames: ["id"],
            referencedTableName: "users"
          }
        ]
      }));
    }

    public async down(queryRunner: QueryRunner): Promise<any> {
      await queryRunner.query('DROP TABLE logins');
    }
}
