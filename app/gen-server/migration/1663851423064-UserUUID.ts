import {User} from 'app/gen-server/entity/User';
import {makeId} from 'app/server/lib/idUtils';
import {MigrationInterface, QueryRunner, TableColumn} from "typeorm";

export class UserUUID1663851423064 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<any> {
    // Add ref column, for now make it nullable and not unique, we
    // first need to put a value in it for all existing users.
    await queryRunner.addColumn("users", new TableColumn({
      name: "ref",
      type: 'varchar',
      isNullable: true,
      isUnique: false,
    }));

    // Updating so many rows in a multiple queries is not ideal. We will send updates in chunks.
    // 300 seems to be a good number, for 24k rows we have 80 queries.
    const userList = await queryRunner.manager.createQueryBuilder()
      .select("users")
      .from(User, "users")
      .getMany();
    userList.forEach(u => u.ref = makeId());
    await queryRunner.manager.save(userList, { chunk: 300 });

    // We are not making this column unique yet, because it can fail
    // if there are some old workers still running, and any new user
    // is created. We will make it unique in a later migration.
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.dropColumn("users", "ref");
  }
}
