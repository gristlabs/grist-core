import {MigrationInterface, QueryRunner} from "typeorm";
import {addRefToUserList} from "../sqlUtils";

export class UserRefUnique1664528376930 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // This is second part of migration 1663851423064-UserUUID, that makes
    // the ref column unique.

    // Update users that don't have unique ref set.
    const userList = await queryRunner.query("SELECT * FROM users WHERE ref is null");
    await addRefToUserList(queryRunner, userList);

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
