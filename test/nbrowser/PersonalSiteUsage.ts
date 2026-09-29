import { PERSONAL_FREE_PLAN } from "app/common/Features";
import { personalFreeFeatures } from "app/gen-server/entity/Product";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("PersonalSiteUsage", function() {
  this.timeout("30s");
  setupTestSuite();

  // Read from the product, so the test says nothing about the numbers themselves.
  const apiLimit = personalFreeFeatures.maxApiCallsPerOrgMonth;
  const aiLimit = personalFreeFeatures.baseMaxAssistantCalls;

  let oldEnv: EnvironmentSnapshot;

  before(async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    oldEnv = new EnvironmentSnapshot();
    // grist-core defaults personal sites to the unlimited 'Free' product, which sets none of
    // the limits this page reports. The plan only applies to sites created while it is set.
    process.env.GRIST_DEFAULT_PRODUCT = PERSONAL_FREE_PLAN;
    await server.restart();
    // A fresh account, so its personal site is created on the plan set above, and unspent.
    await gu.session().personalSite.user("fresh").login({ freshAccount: true });
    await driver.get(`${server.getHost()}/o/docs/account/personal-site`);
  });

  after(async function() {
    oldEnv?.restore();
    await server.restart();
  });

  it("shows what the personal site has used", async function() {
    assert.match(
      await driver.findWait(".test-account-page-usage-assistant", 5000).getText(),
      new RegExp(`You have ${aiLimit} one time AI Assistant credits`));
    // The api count is kept in redis, so the line is only there when the server has one.
    if (!process.env.REDIS_URL) { return; }
    // Either wording, since logging in spends some of the count.
    assert.match(
      await driver.find(".test-account-page-usage-api").getText(),
      new RegExp(`You have (\\d+ of )?${apiLimit} monthly API calls`));
  });
});
