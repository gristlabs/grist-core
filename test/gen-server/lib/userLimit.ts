import { Features } from "app/common/Features";
import { Organization } from "app/common/UserAPI";
import { Product } from "app/gen-server/entity/Product";
import { Deps } from "app/gen-server/lib/homedb/HomeDBManager";
import { TestServer } from "test/gen-server/apiUtils";
import { createTmpDir } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";
import * as sinon from "sinon";

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
  const sandbox = sinon.createSandbox();

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

  afterEach(function() {
    sandbox.restore();
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

  // Note the cheat borrowed from suspension.ts: calling getDoc() invalidates docAuthCache,
  // without which the change in access level takes a few seconds to become visible.
  async function assertCanWrite(expected: boolean) {
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const docApi = nasaApi.getDocAPI(docId);
    assert.equal((await nasaApi.getDoc(docId)).access, expected ? "owners" : "viewers");
    // Reading is unaffected either way.
    await assert.isFulfilled(docApi.getRows("Table1"));
    if (expected) {
      await assert.isFulfilled(docApi.addRows("Table1", { A: ["v1"] }));
    } else {
      await assert.isRejected(docApi.addRows("Table1", { A: ["v1"] }), /No write access/);
    }
  }

  it("does nothing while the flag is off", async function() {
    // Put the site over its limit: chimpy plus kiwi, with a limit of one.
    await setMembers({ "kiwi@getgrist.com": "editors" });
    await setUserLimit(1);
    await assertCanWrite(true);
    // Creating documents is unaffected too, which is the other place the clamp applies.
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const wsId = (await nasaApi.getOrgWorkspaces("current"))[0].id;
    const newDocId = await nasaApi.newDoc({ name: "still allowed" }, wsId);
    await nasaApi.deleteDoc(newDocId);
  });

  it("holds an over-limit site read-only once the flag is on", async function() {
    sandbox.stub(Deps, "readOnlyOverUserLimit").value(true);
    await assertCanWrite(false);

    // New documents are refused too, rather than being created in a site that cannot edit them.
    const nasaApi = await home.createHomeApi("Chimpy", "nasa");
    const wsId = (await nasaApi.getOrgWorkspaces("current"))[0].id;
    await assert.isRejected(nasaApi.newDoc({ name: "nope" }, wsId), /Site is in readonly mode/);
  });

  it("leaves a site at its limit alone", async function() {
    sandbox.stub(Deps, "readOnlyOverUserLimit").value(true);
    await setUserLimit(2);
    await assertCanWrite(true);
  });

  it("restores access when the site comes back under the limit", async function() {
    sandbox.stub(Deps, "readOnlyOverUserLimit").value(true);
    await setUserLimit(1);
    await assertCanWrite(false);

    // Removing the extra member is enough; nothing has to be cleared by hand, since the
    // read-only state is derived from the count rather than stored.
    await setMembers({ "kiwi@getgrist.com": null });
    await assertCanWrite(true);
  });

  it("does nothing on a plan with no member limit", async function() {
    sandbox.stub(Deps, "readOnlyOverUserLimit").value(true);
    // Lift the limit before adding, since adding past it is refused while it applies.
    await setUserLimit(undefined);
    await setMembers({ "kiwi@getgrist.com": "editors" });
    await assertCanWrite(true);
    await setMembers({ "kiwi@getgrist.com": null });
  });
});
