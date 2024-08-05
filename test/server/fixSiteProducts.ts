import {Organization} from 'app/gen-server/entity/Organization';
import {fixSiteProducts} from 'app/gen-server/lib/Housekeeper';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';
import {assert} from 'chai';
import sinon from "sinon";
import {getDefaultProductNames} from 'app/gen-server/entity/Product';

const email = 'chimpy@getgrist.com';
const profile = {email, name: email};
const org = 'single-org';

describe('fixSiteProducts', function() {
  this.timeout(6000);

  let oldEnv: testUtils.EnvironmentSnapshot;
  let server: TestServer;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    // By default we will simulate 'core' deployment that has 'Free' team site as default product.
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
    process.env.GRIST_DEFAULT_PRODUCT = 'Free';
    server = new TestServer(this);
    await server.start();
  });

  after(async function() {
    oldEnv.restore();
    await server.stop();
  });

  it('fix should be deleted after 2024-10-01', async function() {
    const now = new Date();
    const remove_date = new Date('2024-10-01');
    assert.isTrue(now < remove_date, 'This test and a fix method should be deleted after 2024-10-01');
  });

  it('fixes sites that where created with a wrong product', async function() {
    const db = server.dbManager;
    const user = await db.getUserByLogin(email, {profile}) as any;
    const getOrg = (id: number) => db.connection.manager.findOne(
      Organization,
      {where: {id}, relations: ['billingAccount', 'billingAccount.product']});

    const productOrg = (id: number) => getOrg(id)?.then(org => org?.billingAccount?.product?.name);

    const freeOrgId = db.unwrapQueryResult(await db.addOrg(user, {
      name: org,
      domain: org,
    }, {
      setUserAsOwner: false,
      useNewPlan: true,
      product: 'teamFree',
    }));

    const teamOrgId = db.unwrapQueryResult(await db.addOrg(user, {
      name: 'fix-team-org',
      domain: 'fix-team-org',
    }, {
      setUserAsOwner: false,
      useNewPlan: true,
      product: 'team',
    }));

    // Make sure it is created with teamFree product.
    assert.equal(await productOrg(freeOrgId), 'teamFree');

    // Run the fixer.
    assert.isTrue(await fixSiteProducts({
      db,
      deploymentType: server.server.getDeploymentType(),
    }));

    // Make sure we fixed the product is on Free product.
    assert.equal(await productOrg(freeOrgId), 'Free');

    // Make sure the other org is still on team product.
    assert.equal(await productOrg(teamOrgId), 'team');
  });

  it("doesn't run when on saas deployment", async function() {
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'saas';

    // Stub it in the server. Notice that we assume some knowledge about how the server is implemented - that it won't
    // cache this value (nor any other component) and always read it when needed. Otherwise we would need to recreate
    // the server each time.
    const sandbox = sinon.createSandbox();
    sandbox.stub(server.server, 'getDeploymentType').returns('saas');
    assert.equal(server.server.getDeploymentType(), 'saas');

    assert.isFalse(await fixSiteProducts({
      db: server.dbManager,
      deploymentType: server.server.getDeploymentType(),
    }));

    sandbox.restore();
  });

  it("doesn't run when default product is not set", async function() {
    // Make sure we are in 'core'.
    assert.equal(server.server.getDeploymentType(), 'core');

    // But only when Free product is the default one.
    process.env.GRIST_DEFAULT_PRODUCT = 'teamFree';
    assert.equal(getDefaultProductNames().teamInitial, 'teamFree'); // sanity check that Grist sees it.

    assert.isFalse(await fixSiteProducts({
      db: server.dbManager,
      deploymentType: server.server.getDeploymentType(),
    }));

    process.env.GRIST_DEFAULT_PRODUCT = 'team';
    assert.equal(getDefaultProductNames().teamInitial, 'team');

    assert.isFalse(await fixSiteProducts({
      db: server.dbManager,
      deploymentType: server.server.getDeploymentType(),
    }));

    delete process.env.GRIST_DEFAULT_PRODUCT;
    assert.equal(getDefaultProductNames().teamInitial, 'stub');

    const db = server.dbManager;
    const user = await db.getUserByLogin(email, {profile});
    const orgId = db.unwrapQueryResult(await db.addOrg(user, {
      name: 'sanity-check-org',
      domain: 'sanity-check-org',
    }, {
      setUserAsOwner: false,
      useNewPlan: true,
      product: 'teamFree',
    }));

    const getOrg = (id: number) => db.connection.manager.findOne(Organization,
      {where: {id}, relations: ['billingAccount', 'billingAccount.product']});
    const productOrg = (id: number) => getOrg(id)?.then(org => org?.billingAccount?.product?.name);
    assert.equal(await productOrg(orgId), 'teamFree');

    assert.isFalse(await fixSiteProducts({
      db: server.dbManager,
      deploymentType: server.server.getDeploymentType(),
    }));
    assert.equal(await productOrg(orgId), 'teamFree');
  });
});
