import {MigrationInterface, QueryRunner} from "typeorm";

export class OrgDomainUnique1557157922339 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<any> {
    const logins = (await queryRunner.getTable('orgs'))!;
    const domain = logins.findColumnByName('domain')!;
    const domainUnique = domain.clone();
    domainUnique.isUnique = true;
    await queryRunner.changeColumn('orgs', domain, domainUnique);

    // On postgres, all of the above amounts to:
    //   ALTER TABLE "orgs" ADD CONSTRAINT "..." UNIQUE ("domain")
    // On sqlite, the table gets regenerated.
  }

  public async down(queryRunner: QueryRunner): Promise<any> {
    const logins = (await queryRunner.getTable('orgs'))!;
    const domain = logins.findColumnByName('domain')!;
    const domainNonUnique = domain.clone();
    domainNonUnique.isUnique = false;
    await queryRunner.changeColumn('orgs', domain, domainNonUnique);

    // On postgres, all of the above amount to:
    //   ALTER TABLE "orgs" DROP CONSTRAINT "..."
  }
}
