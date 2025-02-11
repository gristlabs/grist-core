import {UserProfile} from 'app/common/LoginSessionAPI';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {FREE_PLAN, STUB_PLAN, TEAM_PLAN} from 'app/common/Features';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';
import {v4 as uuidv4} from 'uuid';
import omit = require('lodash/omit');

const charonProfile = {email: 'charon@getgrist.com', name: 'Charon'};
const chimpyProfile = {email: 'chimpy@getgrist.com', name: 'Chimpy'};
const kiwiProfile = {email: 'kiwi@getgrist.com', name: 'Kiwi'};

const teamOptions = {
  setUserAsOwner: false, useNewPlan: true, product: TEAM_PLAN
};

describe('HomeDBManager', function() {

  let server: TestServer;
  let home: HomeDBManager;
  testUtils.setTmpLogLevel('error');

  before(async function() {
    server = new TestServer(this);
    await server.start();
    home = server.dbManager;
  });

  after(async function() {
    await server.stop();
  });

  it('can find existing user by email', async function() {
    const user = await home.getUserByLogin('chimpy@getgrist.com');
    assert.equal(user.name, 'Chimpy');
  });

  it('can create new user by email, with personal org', async function() {
    const profile = {email: 'unseen@getgrist.com', name: 'Unseen'};
    const user = await home.getUserByLogin('unseen@getgrist.com', {profile});
    assert.equal(user.name, 'Unseen');
    const orgs = await home.getOrgs(user.id, null);
    assert.isAtLeast(orgs.data!.length, 1);
    assert.equal(orgs.data![0].name, 'Personal');
    assert.equal(orgs.data![0].owner.name, 'Unseen');
  });

  it('parallel requests resulting in user creation give consistent results', async function() {
    const profile = {
      email: uuidv4() + "@getgrist.com",
      name: "Testy McTestyTest"
    };
    const queries = [];
    for (let i = 0; i < 100; i++) {
      queries.push(home.getUserByLoginWithRetry(profile.email, {profile}));
    }
    const result = await Promise.all(queries);
    const refUser = result[0];
    assert(refUser && refUser.personalOrg && refUser.id && refUser.personalOrg.id);
    result.forEach((user) => assert.deepEqual(refUser, user));
  });

  it('can accumulate profile information', async function() {
    // log in without a name
    let user = await home.getUserByLogin('unseen2@getgrist.com');
    // name is blank
    assert.equal(user.name, '');
    // log in with a name
    const profile: UserProfile = {email: 'unseen2@getgrist.com', name: 'Unseen2'};
    user = await home.getUserByLogin('unseen2@getgrist.com', {profile});
    // name is now set
    assert.equal(user.name, 'Unseen2');
    // log in without a name
    user = await home.getUserByLogin('unseen2@getgrist.com');
    // name is still set
    assert.equal(user.name, 'Unseen2');
    // no picture yet
    assert.equal(user.picture, null);
    // log in with picture link
    profile.picture = 'http://picture.pic';
    user = await home.getUserByLogin('unseen2@getgrist.com', {profile});
    // now should have a picture link
    assert.equal(user.picture, 'http://picture.pic');
    // log in without picture
    user = await home.getUserByLogin('unseen2@getgrist.com');
    // should still have picture link
    assert.equal(user.picture, 'http://picture.pic');
  });

  it('can add an org', async function() {
    const user = await home.getUserByLogin('chimpy@getgrist.com');
    const orgId = (await home.addOrg(user, {name: 'NewOrg', domain: 'novel-org'}, teamOptions)).data!.id;
    const org = await home.getOrg({userId: user.id}, orgId);
    assert.equal(org.data!.name, 'NewOrg');
    assert.equal(org.data!.domain, 'novel-org');
    assert.equal(org.data!.billingAccount.product.name, TEAM_PLAN);
    await home.deleteOrg({userId: user.id}, orgId);
  });

  it('creates default plan if defined', async function() {
    const user = await home.getUserByLogin('chimpy@getgrist.com');
    const oldEnv = new testUtils.EnvironmentSnapshot();
    try {
      // Set the default product to be the free plan.
      process.env.GRIST_DEFAULT_PRODUCT = FREE_PLAN;
      let orgId = (await home.addOrg(user, {name: 'NewOrg', domain: 'novel-org'}, {
        setUserAsOwner: false,
        useNewPlan: true,
        // omit plan, to use a default one (teamInitial)
        // it will either be 'stub' or anything set in GRIST_DEFAULT_PRODUCT
      })).data!.id;
      let org = await home.getOrg({userId: user.id}, orgId);
      assert.equal(org.data!.name, 'NewOrg');
      assert.equal(org.data!.domain, 'novel-org');
      assert.equal(org.data!.billingAccount.product.name, FREE_PLAN);
      await home.deleteOrg({userId: user.id}, orgId);

      // Now remove the default product, and check that the default plan is used.
      delete process.env.GRIST_DEFAULT_PRODUCT;
      orgId = (await home.addOrg(user, {name: 'NewOrg', domain: 'novel-org'}, {
        setUserAsOwner: false,
        useNewPlan: true,
      })).data!.id;

      org = await home.getOrg({userId: user.id}, orgId);
      assert.equal(org.data!.billingAccount.product.name, STUB_PLAN);
      await home.deleteOrg({userId: user.id}, orgId);
    } finally {
      oldEnv.restore();
    }
  });

  it('cannot duplicate a domain', async function() {
    const user = await home.getUserByLogin('chimpy@getgrist.com');
    const domain = 'repeated-domain';
    const result = await home.addOrg(user, {name: `${domain}!`, domain}, teamOptions);
    const orgId = result.data!.id;
    assert.equal(result.status, 200);
    await assert.isRejected(home.addOrg(user, {name: `${domain}!`, domain}, teamOptions),
                            /Domain already in use/);
    await home.deleteOrg({userId: user.id}, orgId);
  });

  it('cannot add an org with a (blacklisted) dodgy domain', async function() {
    const user = await home.getUserByLogin('chimpy@getgrist.com');
    const userId = user.id;
    const misses = [
      'thing!', ' thing', 'ww', 'docs-999', 'o-99', '_domainkey', 'www', 'api',
      'thissubdomainiswaytoolongmyfriendyoushouldrethinkitoratleastsummarizeit',
      'google', 'login', 'doc-worker-1-1-1-1', 'a', 'bb', 'x_y', '1ogin'
    ];
    const hits = [
      'thing', 'jpl', 'xyz', 'appel', '123', '1google'
    ];
    for (const domain of misses) {
      const result = await home.addOrg(user, {name: `${domain}!`, domain}, teamOptions);
      assert.equal(result.status, 400);
      const org = await home.getOrg({userId}, domain);
      assert.equal(org.status, 404);
    }
    for (const domain of hits) {
      const result = await home.addOrg(user, {name: `${domain}!`, domain}, teamOptions);
      assert.equal(result.status, 200);
      const org = await home.getOrg({userId}, domain);
      assert.equal(org.status, 200);
      await home.deleteOrg({userId}, org.data!.id);
    }
  });

  it('should allow setting doc metadata', async function() {
    const beforeRun = new Date();
    const setDateISO1 = new Date(Date.UTC(1993, 3, 2)).toISOString();
    const setDateISO2 = new Date(Date.UTC(2004, 6, 18)).toISOString();
    const setUsage1 = {rowCount: {total: 123}, dataSizeBytes: 456, attachmentsSizeBytes: 789};
    const setUsage2 = {rowCount: {total: 0}, attachmentsSizeBytes: 0};

    // Set the doc updatedAt time on Bananas.
    const primatelyOrgId = await home.testGetId('Primately') as number;
    const fishOrgId = await home.testGetId('Fish') as number;
    const applesDocId = await home.testGetId('Apples') as string;
    const bananasDocId = await home.testGetId('Bananas') as string;
    const sharkDocId = await home.testGetId('Shark') as string;
    await home.setDocsMetadata({
      [applesDocId]: {usage: setUsage1},
      [bananasDocId]: {updatedAt: setDateISO1},
      [sharkDocId]: {updatedAt: setDateISO2, usage: setUsage2},
    });

    // Fetch the doc and check that the updatedAt value is as expected.
    const kiwi = await home.getUserByLogin('kiwi@getgrist.com');
    const resp1 = await home.getOrgWorkspaces({userId: kiwi.id}, primatelyOrgId);
    assert.equal(resp1.status, 200);

    // Check that the apples metadata is as expected. updatedAt should have been set
    // when the db was initialized before the update run - it should not have been updated
    // to 1993. usage should be set.
    const apples = resp1.data![0].docs.find((doc: any) => doc.name === 'Apples');
    const applesUpdate = new Date(apples!.updatedAt);
    assert.isTrue(applesUpdate < beforeRun);
    assert.isTrue(applesUpdate > new Date('2000-1-1'));
    assert.deepEqual(apples!.usage, setUsage1);

    // Check that the bananas metadata is as expected. updatedAt should have been set
    // to 1993. usage should be null.
    const bananas = resp1.data![0].docs.find((doc: any) => doc.name === 'Bananas');
    assert.equal(bananas!.updatedAt.toISOString(), setDateISO1);
    assert.equal(bananas!.usage, null);

    // Check that the shark metadata is as expected. updatedAt should have been set
    // to 2004. usage should be set.
    const resp2 = await home.getOrgWorkspaces({userId: kiwi.id}, fishOrgId);
    assert.equal(resp2.status, 200);
    const shark = resp2.data![0].docs.find((doc: any) => doc.name === 'Shark');
    assert.equal(shark!.updatedAt.toISOString(), setDateISO2);
    assert.deepEqual(shark!.usage, setUsage2);
  });

  it("can pool orgs for two users", async function() {
    const charonOrgs = (await home.getOrgs([charonProfile], null)).data!;
    const kiwiOrgs = (await home.getOrgs([kiwiProfile], null)).data!;
    const pooledOrgs = (await home.getOrgs([charonProfile, kiwiProfile], null)).data!;
    // test there is some overlap
    assert.isAbove(pooledOrgs.length, charonOrgs.length);
    assert.isAbove(pooledOrgs.length, kiwiOrgs.length);
    assert.isBelow(pooledOrgs.length, charonOrgs.length + kiwiOrgs.length);
    // check specific orgs returned
    assert.sameDeepMembers(charonOrgs.map(org => org.name),
      ['Abyss', 'Fish', 'NASA', 'Charonland', 'Chimpyland']);
    assert.sameDeepMembers(kiwiOrgs.map(org => org.name),
      ['Fish', 'Flightless', 'Kiwiland', 'Primately']);
    assert.sameDeepMembers(pooledOrgs.map(org => org.name),
      ['Abyss', 'Fish', 'Flightless', 'NASA', 'Primately', 'Charonland', 'Chimpyland', 'Kiwiland']);

    // make sure if there are no profiles that we get no orgs
    const emptyOrgs = (await home.getOrgs([], null)).data!;
    assert.lengthOf(emptyOrgs, 0);
  });

  it("can pool orgs for three users", async function() {
    const pooledOrgs = (await home.getOrgs([charonProfile, chimpyProfile, kiwiProfile], null)).data!;
    assert.sameDeepMembers(pooledOrgs.map(org => org.name), [
      'Abyss',
      'EmptyOrg',
      'EmptyWsOrg',
      'Fish',
      'Flightless',
      'FreeTeam',
      'NASA',
      'Primately',
      'TestAuditLogs',
      'TestDailyApiLimit',
      'TestMaxNewUserInvites',
      'Charonland',
      'Chimpyland',
      'Kiwiland',
    ]);
  });

  it("can pool orgs for multiple users with non-normalized emails", async function() {
    const refOrgs = (await home.getOrgs([charonProfile, kiwiProfile], null)).data!;
    // Profiles in sessions can have email addresses with arbitrary capitalization.
    const oddCharonProfile = {email: 'CharON@getgrist.COM', name: 'charON'};
    const oddKiwiProfile = {email: 'KIWI@getgrist.COM', name: 'KIwi'};
    const orgs = (await home.getOrgs([oddCharonProfile, kiwiProfile, oddKiwiProfile], null)).data!;
    assert.deepEqual(refOrgs, orgs);
  });

  it('can get best user for accessing org', async function() {
    let suggestion = await home.getBestUserForOrg([charonProfile, kiwiProfile],
                                                  await home.testGetId('Fish') as number);
    assert.deepEqual(suggestion, {
      id: await home.testGetId('Kiwi') as number,
      email: kiwiProfile.email,
      name: kiwiProfile.name,
      access: 'editors',
      perms: 15
    });
    suggestion = await home.getBestUserForOrg([charonProfile, kiwiProfile],
                                              await home.testGetId('Abyss') as number);
    assert.equal(suggestion!.email, charonProfile.email);
    suggestion = await home.getBestUserForOrg([charonProfile, kiwiProfile],
                                              await home.testGetId('EmptyOrg') as number);
    assert.equal(suggestion, null);
  });

  it('skips picking a user for merged personal org', async function() {
    // There isn't any particular way to favor one user over another when accessing
    // the merged personal org.
    assert.equal(await home.getBestUserForOrg([charonProfile, kiwiProfile], 0), null);
  });

  it('can access billingAccount for org', async function() {
    await server.addBillingManager('Chimpy', 'nasa');
    const chimpyScope = {userId: await home.testGetId('Chimpy') as number};
    const charonScope = {userId: await home.testGetId('Charon') as number};

    // billing account without orgs+managers
    let billingAccount = await home.getBillingAccount(chimpyScope, 'nasa', false);
    assert.hasAllKeys(billingAccount,
                      ['id', 'individual', 'inGoodStanding', 'status', 'stripeCustomerId',
                       'stripeSubscriptionId', 'stripePlanId', 'product', 'paid', 'isManager',
                       'externalId', 'externalOptions', 'features', 'paymentLink']);

    // billing account with orgs+managers
    billingAccount = await home.getBillingAccount(chimpyScope, 'nasa', true);
    assert.hasAllKeys(billingAccount,
                      ['id', 'individual', 'inGoodStanding', 'status', 'stripeCustomerId',
                       'stripeSubscriptionId', 'stripePlanId', 'product', 'orgs', 'managers', /* <-- here */
                       'paid', 'externalId', 'externalOptions', 'features', 'paymentLink']);

    await assert.isRejected(home.getBillingAccount(charonScope, 'nasa', true),
                            /User does not have access to billing account/);
  });

  // TypeORM does not handle parameter name reuse well, so we monkey-patch to detect it.
  it('will fail on parameter collision', async function() {
    // Check collision in a simple query.
    // Note: it is query construction that fails, not query execution.
    assert.throws(() => home.connection.createQueryBuilder().from('orgs', 'orgs')
                  .where('id = :id', {id: 1}).andWhere('id = :id', {id: 2}),
                  /parameter collision/);

    // Check collision between subqueries.
    assert.throws(
      () => home.connection.createQueryBuilder().from('orgs', 'orgs')
        .select(q => q.subQuery().from('orgs', 'orgs').where('x IN :x', {x: ['five']}))
        .addSelect(q => q.subQuery().from('orgs', 'orgs').where('x IN :x', {x: ['six']})),
        /parameter collision/);
  });

  it('can get the product associated with a docId', async function() {
    const urlId = 'sampledocid_6';
    const userId = await home.testGetId('Chimpy') as number;
    const scope = {userId, urlId};
    const doc = await home.getDoc(scope);
    const product = (await home.getDocProduct(urlId))!;
    assert.equal(doc.workspace.org.billingAccount.product.id, product.id);
    const features = await home.getDocFeatures(urlId);
    assert.deepEqual(features, {
      workspaces: true,
      vanityDomain: true,
    });
  });

  it('can fork docs', async function() {
    const user1 = await home.getUserByLogin('kiwi@getgrist.com');
    const user1Id = user1.id;
    const orgId = await home.testGetId('Fish') as number;
    const doc1Id = await home.testGetId('Shark') as string;
    const scope = {userId: user1Id, urlId: doc1Id};
    const doc1 = await home.getDoc(scope);

    // Document "Shark" should initially have no forks.
    const resp1 = await home.getOrgWorkspaces({userId: user1Id}, orgId);
    const resp1Doc = resp1.data![0].docs.find((d: any) => d.name === 'Shark');
    assert.deepEqual(resp1Doc!.forks, []);

    // Fork "Shark" as Kiwi and check that their fork is listed.
    const fork1Id = `${doc1Id}_fork_1`;
    await home.forkDoc(user1Id, doc1, fork1Id);
    const resp2 = await home.getOrgWorkspaces({userId: user1Id}, orgId);
    const resp2Doc = resp2.data![0].docs.find((d: any) => d.name === 'Shark');
    assert.deepEqual(
      resp2Doc!.forks.map((fork: any) => omit(fork, 'updatedAt')),
      [
        {
          id: fork1Id,
          trunkId: doc1Id,
          createdBy: user1Id,
          options: null,
        },
      ]
    );

    // Fork "Shark" again and check that Kiwi can see both forks.
    const fork2Id = `${doc1Id}_fork_2`;
    await home.forkDoc(user1Id, doc1, fork2Id);
    const resp3 = await home.getOrgWorkspaces({userId: user1Id}, orgId);
    const resp3Doc = resp3.data![0].docs.find((d: any) => d.name === 'Shark');
    assert.sameDeepMembers(
      resp3Doc!.forks.map((fork: any) => omit(fork, 'updatedAt')),
      [
        {
          id: fork1Id,
          trunkId: doc1Id,
          createdBy: user1Id,
          options: null,
        },
        {
          id: fork2Id,
          trunkId: doc1Id,
          createdBy: user1Id,
          options: null,
        },
      ]
    );

    // Now fork "Shark" as Chimpy, and check that Kiwi's forks aren't listed.
    const user2 = await home.getUserByLogin('chimpy@getgrist.com');
    const user2Id = user2.id;
    const resp4 = await home.getOrgWorkspaces({userId: user2Id}, orgId);
    const resp4Doc = resp4.data![0].docs.find((d: any) => d.name === 'Shark');
    assert.deepEqual(resp4Doc!.forks, []);

    const fork3Id = `${doc1Id}_fork_3`;
    await home.forkDoc(user2Id, doc1, fork3Id);
    const resp5 = await home.getOrgWorkspaces({userId: user2Id}, orgId);
    const resp5Doc = resp5.data![0].docs.find((d: any) => d.name === 'Shark');
    assert.deepEqual(
      resp5Doc!.forks.map((fork: any) => omit(fork, 'updatedAt')),
      [
        {
          id: fork3Id,
          trunkId: doc1Id,
          createdBy: user2Id,
          options: null,
        },
      ]
    );
  });
});
