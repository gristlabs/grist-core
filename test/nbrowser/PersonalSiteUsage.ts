import { personalFreeFeatures } from "app/gen-server/entity/Product";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("PersonalSiteUsage", function() {
  this.timeout("30s");
  setupTestSuite();

  // Read from the product, so the test says nothing about the numbers themselves.
  const apiLimit = personalFreeFeatures.maxApiCallsPerOrgMonth;
  const aiLimit = personalFreeFeatures.baseMaxAssistantCalls;

  before(async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    await gu.session().personalSite.login();
    await driver.get(`${server.getHost()}/o/docs/account/personal-site`);
  });

  it("shows what the personal site has used", async function() {
    assert.match(
      await driver.findWait(".test-account-page-usage-assistant", 5000).getText(),
      new RegExp(`You have ${aiLimit} one time AI Assistant credits`));
    // The api count is kept in redis, so the line is only there when the server has one.
    if (!process.env.REDIS_URL) { return; }
    // Either wording, since other tests share this site and may spend some of the count.
    assert.match(
      await driver.find(".test-account-page-usage-api").getText(),
      new RegExp(`You have (\\d+ of )?${apiLimit} monthly API calls`));
  });
});
