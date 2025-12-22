import { assert } from 'chai';
import { delay } from 'app/common/delay';
import { DocPrefs } from 'app/common/Prefs';
import { EDITOR, OWNER, Role, VIEWER } from 'app/common/roles';
import { PermissionData, PermissionDelta } from 'app/common/UserAPI';
import { Deps as CachesDeps, HomeDBCaches } from 'app/gen-server/lib/homedb/Caches';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { QueryResult } from 'app/gen-server/lib/homedb/Interfaces';
import { User } from 'app/gen-server/entity/User';
import { createPubSubManager } from 'app/server/lib/PubSubManager';
import { createInitialDb, removeConnection } from 'test/gen-server/seed';
import { TestServer } from 'test/server/lib/helpers/TestServer';
import * as testUtils from 'test/server/testUtils';
import { setupCleanup } from 'test/server/testCleanup';
import { waitForIt } from 'test/server/wait';
import * as path from 'path';
import * as sinon from 'sinon';

/**
 * Tests homedb/Caches.ts, that caches work, expire appropriately, and are invalidated by correct
 * actions, including changes to parent resources, etc.
 */
describe('HomeDBCaches', function() {
  this.timeout(10_000);
  testUtils.setTmpLogLevel('error');
  const cleanup = setupCleanup();

  let homeDb: HomeDBManager;
  let caches: HomeDBCaches;
  let entities: Awaited<ReturnType<typeof createTestFixture>>;
  let oldEnv: testUtils.EnvironmentSnapshot;
  const sandboxAll = sinon.createSandbox();
  const sandbox = sinon.createSandbox();

  before(async function() {
    if (!process.env.TEST_REDIS_URL) { this.skip(); }

    oldEnv = new testUtils.EnvironmentSnapshot();

    // If running with default DB type (SQLite), TestServer() will use :memory:. Let's keep a copy
    // instead, so that it can be examined if a test fails.
    if (!process.env.TYPEORM_DATABASE) {
      const tmpDir = await testUtils.createTestDir('HomeDBCaches');
      process.env.TYPEORM_DATABASE = path.join(tmpDir, 'landing.db');
    }
    process.env.TEST_CLEAN_DATABASE = 'true';

    // For this test, set cache TTL to a low value, just high enough not to trigger unexpectedly.
    sandboxAll.stub(CachesDeps, 'DocAccessCacheTTL').value(1000);
    sandboxAll.stub(CachesDeps, 'DocPrefsCacheTTL').value(1000);

    const pubSubManager = createPubSubManager(process.env.TEST_REDIS_URL);
    cleanup.addAfterAll(() => pubSubManager.close());

    // Set up a homeDB with a few users, and some nested resources: org/workspaces/docs.
    homeDb = new HomeDBManager(undefined, undefined, pubSubManager);
    await createInitialDb(homeDb.connection, 'migrateOnly');
    await homeDb.connect();
    await homeDb.initializeSpecialIds();
    entities = await createTestFixture(homeDb);
    caches = homeDb.caches!;
  });

  after(async function() {
    await removeConnection();
    oldEnv.restore();
    sandboxAll.restore();
  });

  afterEach(function() {
    homeDb.clearCaches();   // Clear caches to avoid test case affecting one another.
    sandbox.restore();
  });

  // Turn a full PermissionData into a simple {Name: Access} map, for shorter asserts.
  function shortDocAccessResult(result: QueryResult<PermissionData>) {
    const { maxInheritedRole, users } = homeDb.unwrapQueryResult(result);
    assert.strictEqual(maxInheritedRole, null);     // Because we expect flattened results.
    return Object.fromEntries(users.map(u => [u.name, u.access]));
  }

  it('should cache and expire docAccess values', async function() {
    const rawCallSpy = sandbox.spy(HomeDBManager.prototype, 'getDocAccess');

    const expect1 = { Alice: OWNER, Bob: OWNER, Carol: EDITOR } as const;
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)), expect1);
    assert.deepEqual(rawCallSpy.callCount, 1);

    // A second call returns the same result, but does not cause another underlying call.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)), expect1);
    assert.deepEqual(rawCallSpy.callCount, 1);

    // Call for another doc.
    const expect2 = { Bob: OWNER, Carol: EDITOR } as const;
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)), expect2);
    assert.deepEqual(rawCallSpy.callCount, 2);

    // The two calls we have are for the two different docs.
    assert.deepEqual(rawCallSpy.args.map(args => args[0].urlId), [
      entities.docDesignSpec.id,
      entities.docManual.id,
    ]);

    // Further calls skip underlying calls.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)), expect2);
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)), expect2);
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)), expect1);
    assert.deepEqual(rawCallSpy.callCount, 2);

    // After expiration, the underlying calls are made again.
    await delay(CachesDeps.DocAccessCacheTTL);

    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)), expect2);
    assert.deepEqual(rawCallSpy.callCount, 3);
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)), expect1);
    assert.deepEqual(rawCallSpy.callCount, 4);
    assert.deepEqual(rawCallSpy.args.map(args => args[0].urlId), [
      entities.docDesignSpec.id,
      entities.docManual.id,
      entities.docManual.id,
      entities.docDesignSpec.id,
    ]);

    // And then cached values are again used for a while.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)), expect1);
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)), expect2);
    assert.deepEqual(rawCallSpy.callCount, 4);
  });

  it('should cache invalidate docAccess values on access changes', async function() {
    const rawCallSpy = sandbox.spy(HomeDBManager.prototype, 'getDocAccess');
    const alice = entities.users.Alice;

    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR });
    assert.deepEqual(rawCallSpy.callCount, 1);

    // Check also another doc (which doesn't inherit from org or wsEng); this lets us confirm that
    // invalidations don't affect unrelated docs.
    const expect2 = { Bob: OWNER, Carol: EDITOR } as const;
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)), expect2);
    assert.deepEqual(rawCallSpy.callCount, 2);

    // Change org sharing. The result of getDocAccess() should get affected immediately in the local homeDb.
    await homeDb.updateOrgPermissions({ userId: alice.id }, entities.org.id, { users: { 'dave@example.com': VIEWER } });
    // Prepare an undo after this test case.
    cleanup.addAfterEach(async () => {
      await homeDb.updateOrgPermissions({ userId: alice.id }, entities.org.id, { users: { 'dave@example.com': null } });
    });

    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR, Dave: VIEWER });     // Have Dave now.
    assert.deepEqual(rawCallSpy.callCount, 3);                      // One more underlying call

    // Change workspace sharing
    await homeDb.updateWorkspacePermissions({ userId: alice.id }, entities.wsEng.id, { maxInheritedRole: null });
    // Prepare an undo after this test case.
    cleanup.addAfterEach(async () => {
      await homeDb.updateWorkspacePermissions({ userId: alice.id }, entities.wsEng.id, { maxInheritedRole: OWNER });
    });

    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER });                              // No more Bob
    assert.deepEqual(rawCallSpy.callCount, 4);      // One more underlying call

    // Change doc sharing, share it with Carol now.
    await homeDb.updateDocPermissions({ userId: alice.id, urlId: entities.docDesignSpec.id },
      { users: { 'carol@example.com': VIEWER } });
    // Prepare an undo after this test case.
    cleanup.addAfterEach(async () => {
      await homeDb.updateDocPermissions({ userId: alice.id, urlId: entities.docDesignSpec.id },
        { users: { 'carol@example.com': null } });
    });

    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Carol: VIEWER });               // No more bob, but we got Carol as VIEWER
    assert.deepEqual(rawCallSpy.callCount, 5);      // One more underlying call

    // Check that none of these invalidations caused the other doc's cache to get recalculated.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)), expect2);
    assert.deepEqual(rawCallSpy.callCount, 5);      // No extra underlying calls here.
  });

  it('should invalidate docAccess values when doc is moved', async function() {
    const rawCallSpy = sandbox.spy(HomeDBManager.prototype, 'getDocAccess');
    const alice = entities.users.Alice;
    const bob = entities.users.Bob;

    // Check initial sharing for 'docManual'.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)),
      { Bob: OWNER, Carol: EDITOR });
    assert.deepEqual(rawCallSpy.callCount, 1);

    // Check initial sharing for 'docDesignSpec', already in our destination workspace (wsHr).
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR });
    assert.deepEqual(rawCallSpy.callCount, 2);

    // Bob should be able to move 'docManual' from 'wsHr' workspace to 'wsEng'.
    homeDb.unwrapQueryResult(
      await homeDb.moveDoc({ userId: bob.id, urlId: entities.docManual.id }, entities.wsEng.id),
    );
    // Prepare an undo after this test case.
    cleanup.addAfterEach(async () => {
      await homeDb.moveDoc({ userId: bob.id, urlId: entities.docManual.id }, entities.wsHr.id);
    });

    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR });   // Newly shared with Alice after the move
    assert.deepEqual(rawCallSpy.callCount, 3);      // One more underlying call.

    // Just as another test of caching, make sure that without invalidations, calling
    // getDocAccess() does not cause more underlying calls.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR });
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR });
    assert.deepEqual(rawCallSpy.callCount, 3);      // No new underlying calls.

    // Since wsEng inherits from the org, making a change to the org should affect both docs.
    await homeDb.updateOrgPermissions({ userId: alice.id }, entities.org.id, { users: { 'dave@example.com': VIEWER } });
    // Prepare an undo after this test case.
    cleanup.addAfterEach(async () => {
      await homeDb.updateOrgPermissions({ userId: alice.id }, entities.org.id, { users: { 'dave@example.com': null } });
    });
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR, Dave: VIEWER });
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR, Dave: VIEWER });
    assert.deepEqual(rawCallSpy.callCount, 5);      // Two more underlying call.

    // Also, making a change to wsEng should affect 2 docs.
    await homeDb.updateWorkspacePermissions({ userId: alice.id }, entities.wsEng.id, { maxInheritedRole: null });
    // Prepare an undo after this test case.
    cleanup.addAfterEach(async () => {
      await homeDb.updateWorkspacePermissions({ userId: alice.id }, entities.wsEng.id, { maxInheritedRole: OWNER });
    });
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER });
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)),
      { Alice: OWNER, Bob: OWNER });                // Bob remains as the explicitly added original creator.
    assert.deepEqual(rawCallSpy.callCount, 7);    // Two more underlying call.
  });

  it('happens not to invalidate on user name changes', async function() {
    // Here's an example of a change that does not invalidate: if a user changes their name, we
    // don't (currently) invalidate all docs that belong to them. This test would be fine to change
    // or remove if we change the behavior, it's mainly here to confirm that this missed
    // invalidation is known and considered acceptable (because name changes are very rare).
    const rawCallSpy = sandbox.spy(HomeDBManager.prototype, 'getDocAccess');
    const bob = entities.users.Bob;

    // Check initial sharing for 'docDesignSpec'.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR });
    assert.deepEqual(rawCallSpy.callCount, 1);

    bob.name = 'Robert';
    await bob.save();
    // Prepare an undo after this test case.
    cleanup.addAfterEach(async () => { bob.name = 'Bob'; await bob.save(); });

    // No invalidation: same result, no new underlying call.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Bob: OWNER, Carol: EDITOR });
    assert.deepEqual(rawCallSpy.callCount, 1);

    // After expiration, we should notice the change.
    await delay(CachesDeps.DocAccessCacheTTL);
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docDesignSpec.id)),
      { Alice: OWNER, Robert: OWNER, Carol: EDITOR });
    assert.deepEqual(rawCallSpy.callCount, 2);
  });

  function samplePrefs(num: number): DocPrefs {
    return { foo: { num } } as DocPrefs;
  }

  it('should cache docPrefs and refetch when invalidated or expired', async function() {
    const rawCallSpy = sandbox.spy(HomeDBManager.prototype, 'getDocPrefsForUsers');
    const bob = entities.users.Bob;

    assert.deepEqual(Array.from(await caches.getDocPrefs(entities.docDesignSpec.id)), []);
    assert.equal(rawCallSpy.callCount, 1);

    // The value stays cached.
    assert.deepEqual(Array.from(await caches.getDocPrefs(entities.docDesignSpec.id)), []);
    assert.equal(rawCallSpy.callCount, 1);

    // A new pref gets noticed immediately.
    await homeDb.setDocPrefs({ userId: bob.id, urlId: entities.docDesignSpec.id }, { currentUser: samplePrefs(1) });
    assert.deepEqual(Array.from(await caches.getDocPrefs(entities.docDesignSpec.id)), [[bob.id, samplePrefs(1)]]);
    assert.equal(rawCallSpy.callCount, 2);

    // A changed pref gets noticed immediately.
    await homeDb.setDocPrefs({ userId: bob.id, urlId: entities.docDesignSpec.id }, { currentUser: samplePrefs(2) });
    assert.deepEqual(Array.from(await caches.getDocPrefs(entities.docDesignSpec.id)), [[bob.id, samplePrefs(2)]]);
    assert.equal(rawCallSpy.callCount, 3);

    // It stays cached until expiration
    assert.deepEqual(Array.from(await caches.getDocPrefs(entities.docDesignSpec.id)), [[bob.id, samplePrefs(2)]]);
    assert.equal(rawCallSpy.callCount, 3);

    await delay(CachesDeps.DocAccessCacheTTL);

    // After expiration, it gets refetched.
    assert.deepEqual(Array.from(await caches.getDocPrefs(entities.docDesignSpec.id)), [[bob.id, samplePrefs(2)]]);
    assert.equal(rawCallSpy.callCount, 4);    // New underlying call.

    // Removing a pref also gets noticed immediately.
    await homeDb.setDocPrefs({ userId: bob.id, urlId: entities.docDesignSpec.id },
      { currentUser: { foo: undefined } as any });
    assert.deepEqual(Array.from(await caches.getDocPrefs(entities.docDesignSpec.id)), [[bob.id, {}]]);
  });

  it('should invalidate across servers', async function() {
    // The Redis operation is mainly tested in PubSubCache and PubSubManager. This is a small but
    // more comprehensive check that multiple instances of HomeDBManager notice invalidations from
    // one another.

    // This test case only makes sense for postgres.
    if (process.env.TYPEORM_TYPE !== 'postgres') { this.skip(); }

    // Start a server in a separate process pointing to the same DB. Make sure this step does not wipe the DB.
    const tempEnv = new testUtils.EnvironmentSnapshot();
    delete process.env.TEST_CLEAN_DATABASE;
    cleanup.addAfterEach(() => tempEnv.restore());

    const testDir = await testUtils.createTestDir("HomeDBCaches");
    const server = await TestServer.startServer('home', testDir, 'home');
    cleanup.addAfterEach(() => server.stop());

    // Check what our local instance of HomeDBManager sees initially.
    assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)),
      { Bob: OWNER, Carol: EDITOR });

    // Remove Carol from wsHr sharing using the OTHER server.
    const bob = entities.users.Bob;
    const changedAt = Date.now();
    const api = server.makeUserApi(entities.org.domain, 'bob');
    await api.updateWorkspacePermissions(entities.wsHr.id, { users: { 'carol@example.com': null } });

    // Prepare an undo for after this test case.
    cleanup.addAfterEach(async () => {
      await homeDb.updateWorkspacePermissions({ userId: bob.id }, entities.wsHr.id,
        { users: { 'carol@example.com': EDITOR } });
    });

    // We may not notice immediately, but should notice fairly quickly.
    await waitForIt(async () => {
      assert.deepEqual(shortDocAccessResult(await caches.getDocAccess(entities.docManual.id)),
        { Bob: OWNER });
    }, 250, 50);

    // Make sure we actually got this *before* expiration.
    assert.isBelow(Date.now(), changedAt + CachesDeps.DocAccessCacheTTL);
  });
});

/**
 * Creates a Home DB fixture, and returns its entities, structured as follows:
 * {
 *   users: User objects for 'Alice', 'Bob', 'Carol', 'Dave'.
 *   org: Alice OWNER/creator, Bob OWNER, Carol EDITOR, Dave not a member.
 *   - wsEng: inherits org permissions.
 *     - docDesignSpec: inherits ws permissions; Alice OWNER/creator
 *     - docBudget: no inherit; Bob OWNER/creator, Carol Editor, Dave VIEWER
 *   - wsHr: no inherit; Bob OWNER/creator, Carol EDITOR.
 *     - docManual: inherits ws permissions; Bob OWNER/creator
 *      -docPayroll: no inherit; Bob OWNER/creator, Alice EDITOR.
 * };
 */
async function createTestFixture(homeDb: HomeDBManager) {
  const email = (u: string) => `${u.toLowerCase()}@example.com`;
  const addUser = (name: string) => homeDb.getUserByLogin(email(name), { profile: { name, email: email(name) } });

  // Create or fetch users, returns map { alice: dbUser, ... }
  const users = {
    Alice: await addUser('Alice'),
    Bob: await addUser('Bob'),
    Carol: await addUser('Carol'),
    Dave: await addUser('Dave'),
  };
  type UserName = keyof typeof users;

  // Give Bob an API key like other test utils use, for use with API.
  users.Bob.apiKey = "api_key_for_bob";
  await users.Bob.save();

  // Helper: permission object (users) for delta
  const perms = (entries: [UserName, Role][]) =>
    ({ users: Object.fromEntries(entries.map(([u, role]) => [email(u), role])) }) as PermissionDelta;

  // Helper to add workspace and set its permissions.
  const addWs = async (creator: User, orgId: number, name: string, permDelta: PermissionDelta) => {
    const ws = (await homeDb.addWorkspace({ userId: creator.id }, orgId, { name })).data!;
    await homeDb.updateWorkspacePermissions({ userId: creator.id }, ws.id, permDelta);
    return ws;
  };

  // Helper to add doc and set its permissions.
  const addDoc = async (creator: User, wsId: number, name: string, permDelta: PermissionDelta) => {
    const doc = (await homeDb.addDocument({ userId: creator.id }, wsId, { name })).data!;
    await homeDb.updateDocPermissions({ userId: creator.id, urlId: doc.id }, permDelta);
    return doc;
  };

  const orgCreator = users.Alice;
  const org = (await homeDb.addOrg(orgCreator, { name: 'ACME', domain: 'acme' },
    { setUserAsOwner: false, useNewPlan: true })).data!;
  await homeDb.updateOrgPermissions({ userId: orgCreator.id }, org.id, perms([['Bob', OWNER], ['Carol', EDITOR]]));

  // Workspaces
  const wsEng = await addWs(users.Alice, org.id, 'Engineering', { maxInheritedRole: OWNER });
  const wsHr  = await addWs(users.Bob, org.id, 'HR', { maxInheritedRole: null, ...perms([['Carol', EDITOR]]) });

  // Docs
  const docDesignSpec   = await addDoc(users.Alice, wsEng.id, 'DesignSpec', { maxInheritedRole: OWNER });
  const docBudget       = await addDoc(users.Bob,   wsEng.id, 'Budget',
    { maxInheritedRole: null, ...perms([['Carol', EDITOR], ['Dave', VIEWER]]) });
  const docManual       = await addDoc(users.Bob, wsHr.id, 'Manual', { maxInheritedRole: OWNER });
  const docPayroll      = await addDoc(users.Bob, wsHr.id, 'Payroll',
    { maxInheritedRole: null, ...perms([['Alice', EDITOR]]) });

  return {
    users,
    org,
    wsEng, wsHr,
    docDesignSpec, docBudget, docManual, docPayroll,
  };
}
