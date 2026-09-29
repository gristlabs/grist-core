import { Features } from "app/common/Features";
import { Organization } from "app/common/UserAPI";
import { Product } from "app/gen-server/entity/Product";
import { TestServer } from "test/gen-server/apiUtils";
import { createTmpDir } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

/**
 * Tests holding a site read-only when it has more billable members than its plan allows.
 * Only sites that were already over the limit when it arrived can be in this state, since
 * adding a member past the limit is refused (see limits.ts).
 */
describe("userLimit", function() {
  let home: TestServer;
  let nasa: Organization;
  let docId: string;
  let originalFeatures: Features;

  testUtils.setTmpLogLevel("error");
  this.timeout("10s");

  before(async function() {
    const tmpDir = await createTmpDir();
    home = new TestServer(this);
    await home.start(["home", "docs"], { dataDir: tmpDir });
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    nasa = await nasaApi.getOrg("current");
    originalFeatures = nasa.billingAccount!.product.features;

    docId = await home.dbManager.testGetId("Jupiter") as string;
    await home.copyFixtureDoc("Hello.grist", docId);
  });

  after(async function() {
    await setUserLimit(originalFeatures.maxUsersPerOrg);
    await home.stop();
  });

  // Change the limit on the plan the site is on, which is how a site comes to be over it:
  // the members were there before the limit was.
  async function setUserLimit(maxUsersPerOrg: number | undefined) {
    const manager = home.dbManager.connection.manager;
    const product = await manager.findOneOrFail(Product, {
      where: { name: nasa.billingAccount!.product.name },
    });
    product.features = { ...originalFeatures, maxUsersPerOrg };
    await manager.save(product);
  }

  async function setMembers(users: { [email: string]: "editors" | null }) {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    await nasaApi.updateOrgPermissions("current", { users });
  }

  // Note the cheat: calling getDoc() invalidates docAuthCache, without which the change
  // takes a few seconds to become visible.
  async function assertCanWrite(expected: boolean) {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const docApi = nasaApi.getDocAPI(docId);
    // Being held read-only refuses edits without changing the user's role.
    const doc = await nasaApi.getDoc(docId);
    assert.equal(doc.access, "owners");
    assert.equal(doc.readOnlyReason, expected ? undefined : "users");
    // Reading is unaffected either way.
    await assert.isFulfilled(docApi.getRows("Table1"));
    if (expected) {
      await assert.isFulfilled(docApi.addRows("Table1", { A: ["v1"] }));
    } else {
      await assert.isRejected(docApi.addRows("Table1", { A: ["v1"] }), /No write access/);
    }
  }

  it("holds an over-limit site read-only", async function() {
    // Put the site over its limit: chimpy plus kiwi, with a limit of one.
    await setMembers({ "kiwi@getgrist.com": "editors" });
    await setUserLimit(1);
    await assertCanWrite(false);

    // New documents are refused too, rather than being created in a site that cannot edit them.
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const wsId = (await nasaApi.getOrgWorkspaces("current"))[0].id;
    await assert.isRejected(nasaApi.newDoc({ name: "nope" }, wsId), /Site is in readonly mode/);
  });

  it("leaves a site at its limit alone", async function() {
    await setUserLimit(2);
    await assertCanWrite(true);
  });

  it("restores access when the site comes back under the limit", async function() {
    await setUserLimit(1);
    await assertCanWrite(false);

    // Removing the extra member is enough; nothing has to be cleared by hand, since the
    // read-only state is derived from the count rather than stored.
    await setMembers({ "kiwi@getgrist.com": null });
    await assertCanWrite(true);
  });

  it("does nothing on a plan with no member limit", async function() {
    // Lift the limit before adding, since adding past it is refused while it applies.
    await setUserLimit(undefined);
    await setMembers({ "kiwi@getgrist.com": "editors" });
    await assertCanWrite(true);
    await setMembers({ "kiwi@getgrist.com": null });
  });
});
