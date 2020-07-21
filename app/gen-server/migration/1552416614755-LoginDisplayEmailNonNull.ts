import {MigrationInterface, QueryRunner} from "typeorm";

export class LoginDisplayEmailNonNull1552416614755 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    await queryRunner.query('update logins set display_email = email where display_email is null');
    // if our db will already heavily loaded, it might be better to add a check constraint
    // rather than modifying the column properties.  But for our case, this will be fast.

    // To work correctly with RDS version of postgres, it is important to clone
    // and change typeorm's settings for the column, rather than the settings specified
    // in previous migrations.  Otherwise typeorm will fall back on a brutal method of
    // drop-and-recreate that doesn't work for non-null in any case.
    //
    // The pg command is very simple, just alter table logins alter column display_email set not null
    // but sqlite migration is tedious since table needs to be rebuilt, so still just
    // marginally worthwhile letting typeorm deal with it.
    const logins = (await queryRunner.getTable('logins'))!;
    const displayEmail = logins.findColumnByName('display_email')!;
    const displayEmailNonNull = displayEmail.clone();
    displayEmailNonNull.isNullable = false;
    await queryRunner.changeColumn('logins', displayEmail, displayEmailNonNull);
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    const logins = (await queryRunner.getTable('logins'))!;
    const displayEmail = logins.findColumnByName('display_email')!;
    const displayEmailNonNull = displayEmail.clone();
    displayEmailNonNull.isNullable = true;
    await queryRunner.changeColumn('logins', displayEmail, displayEmailNonNull);
  }
}
