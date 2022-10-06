import {User} from 'app/gen-server/entity/User';
import {makeId} from 'app/server/lib/idUtils';
import {MigrationInterface, QueryRunner} from "typeorm";

export class UserRefUnique1664528376930 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // This is second part of migration 1663851423064-UserUUID, that makes
    // the ref column unique.

    // Update users that don't have unique ref set.
    const userList = await queryRunner.manager.createQueryBuilder()
      .select("users")
      .from(User, "users")
      .where("ref is null")
      .getMany();
    userList.forEach(u => u.ref = makeId());
    await queryRunner.manager.save(userList, {chunk: 300});

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
