import { UserAPI } from "app/common/UserAPI";
import { AclRuleOrg } from "app/gen-server/entity/AclRule";
import { Group } from "app/gen-server/entity/Group";
import { User } from "app/gen-server/entity/User";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { TestServer } from "test/gen-server/apiUtils";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

/**
 * Tests getOrgBillableMemberCount, which counts in the database rather than by loading
 * members. The count decides billing, whether another member may be added, and whether a
 * site is over its limit, so the cases it has to get right are worth pinning down.
 */
describe("orgMemberCount", function() {
  let home: TestServer;
  let dbManager: HomeDBManager;
  let nasaApi: UserAPI;
  let kiwiId: number;
  let nasaId: number;

  testUtils.setTmpLogLevel("error");
  this.timeout("10s");

  before(async function() {
    home = new TestServer(this);
    await home.start(["home"]);
    dbManager = home.dbManager;
    nasaApi = await home.createHomeApi("Chimpy", "nasa");
    kiwiId = await dbManager.testGetId("Kiwi") as number;
    nasaId = await dbManager.testGetId("NASA") as number;
  });

  after(async function() {
    await home.stop();
  });

  function count() {
    return dbManager.getOrgBillableMemberCount("nasa");
  }

  async function setKiwiOptions(options: object | null) {
    await dbManager.connection.manager.update(User, { id: kiwiId }, { options: options as any });
  }

  it("counts members, but not guests", async function() {
    // Chimpy is an owner of NASA. Charon has access to a document there, and so is a guest
    // of the org rather than a member.
    assert.equal(await count(), 1);
  });

  it("follows membership", async function() {
    await nasaApi.updateOrgPermissions("current", { users: { "kiwi@getgrist.com": "editors" } });
    assert.equal(await count(), 2);

    await nasaApi.updateOrgPermissions("current", { users: { "kiwi@getgrist.com": null } });
    assert.equal(await count(), 1);
  });

  describe("with kiwi as a member", function() {
    before(async function() {
      await nasaApi.updateOrgPermissions("current", { users: { "kiwi@getgrist.com": "editors" } });
    });

    after(async function() {
      await setKiwiOptions(null);
      await nasaApi.updateOrgPermissions("current", { users: { "kiwi@getgrist.com": null } });
    });

    it("does not count consultants", async function() {
      await setKiwiOptions({ isConsultant: true });
      assert.equal(await count(), 1);
      // getOrgMemberCount asks a different question, and still counts them. Seat counts
      // sent to Stripe are built from it, so the two must not be conflated.
      assert.equal(await dbManager.getOrgMemberCount("nasa"), 2);
    });

    it("counts a member whose consultant flag is false", async function() {
      await setKiwiOptions({ isConsultant: false });
      assert.equal(await count(), 2);
    });

    // The next two are the cases that a null-unaware predicate gets wrong: comparing a
    // missing value returns null rather than false, and negating that drops the member from
    // the count entirely.
    it("counts a member with no consultant flag", async function() {
      await setKiwiOptions({ locale: "en" });
      assert.equal(await count(), 2);
    });

    it("counts a member with no options at all", async function() {
      await setKiwiOptions(null);
      assert.equal(await count(), 2);
    });
  });

  it("does not count special users", async function() {
    // Special users are not added to orgs through the API, so put one in a group directly.
    const group = await dbManager.connection.manager.createQueryBuilder()
      .select("groups")
      .from(Group, "groups")
      .innerJoin(AclRuleOrg, "acl_rule", "acl_rule.group_id = groups.id")
      .where("acl_rule.org_id = :nasaId", { nasaId })
      .andWhere("groups.name = 'editors'")
      .getOne();
    const relation = dbManager.connection.manager.createQueryBuilder()
      .relation(Group, "memberUsers").of(group!.id);

    for (const specialUserId of [dbManager.getSupportUserId(), dbManager.getEveryoneUserId()]) {
      await relation.add(specialUserId);
      assert.equal(await count(), 1, "special users should not be billable");
      // As with consultants, the plain member count does count them.
      assert.equal(await dbManager.getOrgMemberCount("nasa"), 2);
      await relation.remove(specialUserId);
    }
    assert.equal(await count(), 1);
  });

  it("counts zero for an org whose only members are not billable", async function() {
    // Chimpy is the only member of NASA; as a consultant, nothing billable is left.
    const chimpyId = await dbManager.testGetId("Chimpy") as number;
    await dbManager.connection.manager.update(User, { id: chimpyId }, { options: { isConsultant: true } as any });
    try {
      assert.equal(await count(), 0);
    } finally {
      await dbManager.connection.manager.update(User, { id: chimpyId }, { options: null as any });
    }
  });

  it("notices a member being deleted, not just removed", async function() {
    // Deleting a user takes them out of the org without going through updateOrgPermissions,
    // so the cached count has to be invalidated there too.
    await nasaApi.updateOrgPermissions("current", { users: { "deleteme@getgrist.com": "editors" } });
    const doomed = await dbManager.getExistingUserByLogin("deleteme@getgrist.com");
    assert.equal(await dbManager.getCachedOrgBillableMemberCount(nasaId), 2);

    await dbManager.deleteUser({ userId: doomed!.id }, doomed!.id);
    assert.equal(await dbManager.getCachedOrgBillableMemberCount(nasaId), 1);
  });

  it("reports a missing org rather than counting zero", async function() {
    await assert.isRejected(dbManager.getOrgBillableMemberCount("no-such-org"), /org not found/);
    await assert.isRejected(dbManager.getOrgMemberCount("no-such-org"), /org not found/);
  });
});
