import {MigrationInterface, QueryRunner, TableIndex} from "typeorm";

export class CustomerIndex1573569442552 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.createIndex("billing_accounts", new TableIndex({
      name: "billing_accounts__stripe_customer_id",
      columnNames: ["stripe_customer_id"]
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropIndex("billing_accounts", "billing_accounts__stripe_customer_id");
  }
}
