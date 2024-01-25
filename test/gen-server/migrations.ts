import {QueryRunner} from "typeorm";
import * as roles from "app/common/roles";
import {Organization} from 'app/gen-server/entity/Organization';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {Permissions} from 'app/gen-server/lib/Permissions';
import {assert} from 'chai';
import {addSeedData, createInitialDb, removeConnection, setUpDB} from 'test/gen-server/seed';
import {EnvironmentSnapshot} from 'test/server/testUtils';

import {Initial1536634251710 as Initial} from 'app/gen-server/migration/1536634251710-Initial';
import {Login1539031763952 as Login} from 'app/gen-server/migration/1539031763952-Login';
import {PinDocs1549313797109 as PinDocs} from 'app/gen-server/migration/1549313797109-PinDocs';
import {UserPicture1549381727494 as UserPicture} from 'app/gen-server/migration/1549381727494-UserPicture';
import {LoginDisplayEmail1551805156919 as DisplayEmail} from 'app/gen-server/migration/1551805156919-LoginDisplayEmail';
import {LoginDisplayEmailNonNull1552416614755
        as DisplayEmailNonNull} from 'app/gen-server/migration/1552416614755-LoginDisplayEmailNonNull';
import {Indexes1553016106336 as Indexes} from 'app/gen-server/migration/1553016106336-Indexes';
import {Billing1556726945436 as Billing} from 'app/gen-server/migration/1556726945436-Billing';
import {Aliases1561589211752 as Aliases} from 'app/gen-server/migration/1561589211752-Aliases';
import {TeamMembers1568238234987 as TeamMembers} from 'app/gen-server/migration/1568238234987-TeamMembers';
import {FirstLogin1569593726320 as FirstLogin} from 'app/gen-server/migration/1569593726320-FirstLogin';
import {FirstTimeUser1569946508569 as FirstTimeUser} from 'app/gen-server/migration/1569946508569-FirstTimeUser';
import {CustomerIndex1573569442552 as CustomerIndex} from 'app/gen-server/migration/1573569442552-CustomerIndex';
import {ExtraIndexes1579559983067 as ExtraIndexes} from 'app/gen-server/migration/1579559983067-ExtraIndexes';
import {OrgHost1591755411755 as OrgHost} from 'app/gen-server/migration/1591755411755-OrgHost';
import {DocRemovedAt1592261300044 as DocRemovedAt} from 'app/gen-server/migration/1592261300044-DocRemovedAt';
import {Prefs1596456522124 as Prefs} from 'app/gen-server/migration/1596456522124-Prefs';
import {ExternalBilling1623871765992 as ExternalBilling} from 'app/gen-server/migration/1623871765992-ExternalBilling';
import {DocOptions1626369037484 as DocOptions} from 'app/gen-server/migration/1626369037484-DocOptions';
import {Secret1631286208009 as Secret} from 'app/gen-server/migration/1631286208009-Secret';
import {UserOptions1644363380225 as UserOptions} from 'app/gen-server/migration/1644363380225-UserOptions';
import {GracePeriodStart1647883793388
        as GracePeriodStart} from 'app/gen-server/migration/1647883793388-GracePeriodStart';
import {DocumentUsage1651469582887 as DocumentUsage} from 'app/gen-server/migration/1651469582887-DocumentUsage';
import {Activations1652273656610 as Activations} from 'app/gen-server/migration/1652273656610-Activations';
import {UserConnectId1652277549983 as UserConnectId} from 'app/gen-server/migration/1652277549983-UserConnectId';
import {UserUUID1663851423064 as UserUUID} from 'app/gen-server/migration/1663851423064-UserUUID';
import {UserRefUnique1664528376930 as UserUniqueRefUUID} from 'app/gen-server/migration/1664528376930-UserRefUnique';
import {Forks1673051005072 as Forks} from 'app/gen-server/migration/1673051005072-Forks';
import {ForkIndexes1678737195050 as ForkIndexes} from 'app/gen-server/migration/1678737195050-ForkIndexes';
import {ActivationPrefs1682636695021 as ActivationPrefs} from 'app/gen-server/migration/1682636695021-ActivationPrefs';
import {AssistantLimit1685343047786 as AssistantLimit} from 'app/gen-server/migration/1685343047786-AssistantLimit';
import {Shares1701557445716 as Shares} from 'app/gen-server/migration/1701557445716-Shares';

const home: HomeDBManager = new HomeDBManager();

const migrations = [Initial, Login, PinDocs, UserPicture, DisplayEmail, DisplayEmailNonNull,
                    Indexes, Billing, Aliases, TeamMembers, FirstLogin, FirstTimeUser,
                    CustomerIndex, ExtraIndexes, OrgHost, DocRemovedAt, Prefs,
                    ExternalBilling, DocOptions, Secret, UserOptions, GracePeriodStart,
                    DocumentUsage, Activations, UserConnectId, UserUUID, UserUniqueRefUUID,
                    Forks, ForkIndexes, ActivationPrefs, AssistantLimit, Shares];

// Assert that the "members" acl rule and group exist (or not).
function assertMembersGroup(org: Organization, exists: boolean) {
  const memberAcl = org.aclRules.find(_aclRule => _aclRule.group.name === roles.MEMBER);
  if (!exists) {
    assert.isUndefined(memberAcl);
  } else {
    assert.isDefined(memberAcl);
    assert.equal(memberAcl!.permissions, Permissions.VIEW);
    assert.isDefined(memberAcl!.group);
    assert.equal(memberAcl!.group.name, roles.MEMBER);
  }
}

describe('migrations', function() {
  let oldEnv: EnvironmentSnapshot;

  before(function() {
    oldEnv = new EnvironmentSnapshot();
    // This test is incompatible with TEST_CLEAN_DATABASE.
    delete process.env.TEST_CLEAN_DATABASE;
    setUpDB(this);
  });

  after(function() {
    oldEnv.restore();
  });

  beforeEach(async function() {
    await home.connect();
    // If testing against postgres, remove all tables.
    // If SQLite, we're using a fresh in-memory db each time.
    const sqlite = home.connection.driver.options.type === 'sqlite';
    if (!sqlite) {
      await home.connection.query('DROP SCHEMA public CASCADE');
      await home.connection.query('CREATE SCHEMA public');
    }
    await createInitialDb(home.connection, false);
  });

  afterEach(async function() {
    await removeConnection();
  });

  // a test to exercise the rollback scripts a bit
  it('can migrate, do full rollback, and migrate again', async function() {
    this.timeout(60000);
    const runner = home.connection.createQueryRunner();
    for (const migration of migrations) {
      await (new migration()).up(runner);
    }
    for (const migration of migrations.slice().reverse()) {
      await (new migration()).down(runner);
    }
    for (const migration of migrations) {
      await (new migration()).up(runner);
    }
    await addSeedData(home.connection);
    // if we made it this far without an exception, then the rollback scripts must
    // be doing something.
  });

  it('can correctly switch display_email column to non-null with data', async function() {
    this.timeout(60000);
    const sqlite = home.connection.driver.options.type === 'sqlite';
    // sqlite migrations need foreign keys turned off temporarily
    if (sqlite) { await home.connection.query("PRAGMA foreign_keys = OFF;"); }
    const runner = home.connection.createQueryRunner();
    for (const migration of migrations) {
      await (new migration()).up(runner);
    }
    await addSeedData(home.connection);
    // migrate back until just before display_email column added, so we have no
    // display_emails
    for (const migration of migrations.slice().reverse()) {
      await (new migration()).down(runner);
      if (migration.name === DisplayEmail.name) { break; }
    }
    // now check DisplayEmail and DisplayEmailNonNull succeed with data in the db.
    await (new DisplayEmail()).up(runner);
    await (new DisplayEmailNonNull()).up(runner);
    if (sqlite) { await home.connection.query("PRAGMA foreign_keys = ON;"); }
  });

  // a test to ensure the TeamMember migration works on databases with existing content
  it('can perform TeamMember migration with seed data set', async function() {
    this.timeout(30000);
    const runner = home.connection.createQueryRunner();
    // Perform full up migration and add the seed data.
    for (const migration of migrations) {
      await (new migration()).up(runner);
    }
    await addSeedData(home.connection);
    const initAclCount = await getAclRowCount(runner);
    const initGroupCount = await getGroupRowCount(runner);

    // Assert that members groups are present to start.
    for (const org of (await getAllOrgs(runner))) { assertMembersGroup(org, true); }

    // Perform down TeamMembers migration with seed data and assert members groups are removed.
    await (new TeamMembers()).down(runner);
    const downMigratedOrgs = await getAllOrgs(runner);
    for (const org of downMigratedOrgs) { assertMembersGroup(org, false); }
    // Assert that the correct number of ACLs and groups were removed.
    assert.equal(await getAclRowCount(runner), initAclCount - downMigratedOrgs.length);
    assert.equal(await getGroupRowCount(runner), initGroupCount - downMigratedOrgs.length);

    // Perform up TeamMembers migration with seed data and assert members groups are added.
    await (new TeamMembers()).up(runner);
    for (const org of (await getAllOrgs(runner))) { assertMembersGroup(org, true); }
    // Assert that the correct number of ACLs and groups were re-added.
    assert.equal(await getAclRowCount(runner), initAclCount);
    assert.equal(await getGroupRowCount(runner), initGroupCount);
  });
});

/**
 * Returns all orgs in the database with aclRules and groups joined.
 */
function getAllOrgs(queryRunner: QueryRunner): Promise<Organization[]> {
  const orgQuery = queryRunner.manager.createQueryBuilder()
    .select('orgs')
    .from(Organization, 'orgs')
    .leftJoinAndSelect('orgs.aclRules', 'org_acl_rules')
    .leftJoinAndSelect('org_acl_rules.group', 'org_groups');
  return orgQuery.getMany();
}

async function getAclRowCount(queryRunner: QueryRunner): Promise<number> {
  const rows = await queryRunner.query(`SELECT id FROM acl_rules`);
  return rows.length;
}

async function getGroupRowCount(queryRunner: QueryRunner): Promise<number> {
  const rows = await queryRunner.query(`SELECT id FROM groups`);
  return rows.length;
}
