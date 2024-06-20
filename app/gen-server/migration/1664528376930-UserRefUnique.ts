import {makeId} from 'app/server/lib/idUtils';
import {chunk} from 'lodash';
import {MigrationInterface, QueryRunner} from "typeorm";

export class UserRefUnique1664528376930 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // This is second part of migration 1663851423064-UserUUID, that makes
    // the ref column unique.

    // Update users that don't have unique ref set.
    const userList = await queryRunner.manager.createQueryBuilder()
    .select(["users.id", "users.ref"])
    .from("users", "users")
    .where("users.ref is null")
    .getMany();
    userList.forEach(u => u.ref = makeId());

    const userChunks = chunk(userList, 300);
    for (const users of userChunks) {
      await queryRunner.connection.transaction(async manager => {
        const queries = users.map((user: any, _index: number, _array: any[]) => {
          return queryRunner.manager.update("users", user.id, user);
        });
        await Promise.all(queries);
      });
    }

    // Mark column as unique and non-nullable.
    const users = (await queryRunner.getTable('users'))!;
    const oldRef = users.findColumnByName('ref')!;
    const newRef = oldRef.clone();
    newRef.isUnique = true;
    newRef.isNullable = false;
    await queryRunner.changeColumn('users', oldRef, newRef);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Mark column as non unique and nullable.
    const users = (await queryRunner.getTable('users'))!;
    const oldRef = users.findColumnByName('ref')!;
    const newRef = oldRef.clone();
    newRef.isUnique = false;
    newRef.isNullable = true;
    await queryRunner.changeColumn('users', oldRef, newRef);
  }
}
