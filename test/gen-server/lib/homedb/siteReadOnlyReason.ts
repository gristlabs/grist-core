import { Features, SUSPENDED_PLAN } from "app/common/Features";
import { BillingAccount } from "app/gen-server/entity/BillingAccount";
import { Organization } from "app/gen-server/entity/Organization";
import { Product } from "app/gen-server/entity/Product";
import { Deps, HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { TestServer } from "test/gen-server/apiUtils";
import { setPlan } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import * as sinon from "sinon";

/**
 * Tests getSiteReadOnlyReason, the one place that decides whether a site's documents are held
 * read-only and why. Everything that clamps a site goes through it, and so does everything
 * that tells a user about it, so the causes and the order they are checked in are worth
 * pinning down: the order is what keeps the member count off the cheap paths.
 */
describe("siteReadOnlyReason", function() {
  let home: TestServer;
  let dbManager: HomeDBManager;
  let chimpyId: number;
  let nasa: Organization;
  let planName: string;
  let originalFeatures: Features;
  const sandbox = sinon.createSandbox();

  testUtils.setTmpLogLevel("error");
  this.timeout("10s");

  before(async function() {
    home = new TestServer(this);
    await home.start(["home"]);
    dbManager = home.dbManager;
    chimpyId = await dbManager.testGetId("Chimpy") as number;
    nasa = await getOrg();
    planName = nasa.billingAccount.product.name;
    originalFeatures = nasa.billingAccount.product.features;
  });

  after(async function() {
    await setFeatures(originalFeatures);
    await home.stop();
  });

  afterEach(async function() {
    sandbox.restore();
    await setPlan(dbManager, nasa, planName);
    await setFeatures(originalFeatures);
    await setGoodStanding(true);
  });

  async function getOrg() {
    const result = await dbManager.getOrg({ userId: chimpyId }, "nasa");
    return dbManager.unwrapQueryResult(result);
  }

  // The reason is read from a freshly fetched org, since these tests change the very rows
  // that it is read from.
  async function reason() {
    return dbManager.getSiteReadOnlyReason(await getOrg());
  }

  async function setFeatures(features: Features) {
    const manager = dbManager.connection.manager;
    const product = await manager.findOneOrFail(Product, { where: { name: planName } });
    product.features = features;
    await manager.save(product);
  }

  async function setGoodStanding(inGoodStanding: boolean) {
    await dbManager.connection.createQueryBuilder()
      .update(BillingAccount)
      .set({ inGoodStanding })
      .where("id = :id", { id: nasa.billingAccount.id })
      .execute();
  }

  // Chimpy is the only member of NASA, so a limit of one puts it at its limit, and zero over.
  async function setUserLimit(maxUsersPerOrg: number | undefined) {
    await setFeatures({ ...originalFeatures, maxUsersPerOrg });
  }

  it("says nothing about a site that is fine", async function() {
    assert.isUndefined(await reason());
  });

  it("reports a subscription that is not in good standing", async function() {
    await setGoodStanding(false);
    assert.equal(await reason(), "billing");
  });

  it("reports a plan that holds documents read-only", async function() {
    await setFeatures({ ...originalFeatures, readOnlyDocs: true });
    assert.equal(await reason(), "plan");
  });

  it("reports a suspended site as suspended rather than as a plan", async function() {
    // The suspended plan is how a cancelled subscription comes to hold documents read-only,
    // and it says something more useful than the feature that does the holding.
    await setPlan(dbManager, nasa, SUSPENDED_PLAN);
    assert.equal(await reason(), "suspended");
  });

  it("reports a site over its member limit, once the clamp is on", async function() {
    await setUserLimit(0);
    assert.isUndefined(await reason());

    sandbox.stub(Deps, "readOnlyOverUserLimit").value(true);
    assert.equal(await reason(), "users");

    // A site at its limit is left alone.
    await setUserLimit(1);
    assert.isUndefined(await reason());
  });

  it("counts members only when nothing cheaper has already answered", async function() {
    sandbox.stub(Deps, "readOnlyOverUserLimit").value(true);
    await setUserLimit(0);
    const counted = sandbox.spy(dbManager, "getCachedOrgBillableMemberCount");

    // The count is what makes this the last cause checked, so a site that is read-only for a
    // cheaper reason should never pay for it.
    await setGoodStanding(false);
    assert.equal(await reason(), "billing");
    assert.isFalse(counted.called);

    await setGoodStanding(true);
    assert.equal(await reason(), "users");
    assert.isTrue(counted.called);
  });

  it("prefers the cause with the most to say when several apply", async function() {
    sandbox.stub(Deps, "readOnlyOverUserLimit").value(true);
    await setUserLimit(0);
    await setGoodStanding(false);
    await setPlan(dbManager, nasa, SUSPENDED_PLAN);
    assert.equal(await reason(), "suspended");
  });
});
