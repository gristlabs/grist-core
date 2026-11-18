import { openFixture, setupTestSuite } from "test/projects/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("errorPages", function() {
  this.timeout(60000);      // Set a longer default timeout.
  setupTestSuite();

  it("should show forbidden page for inaccessible orgs", async function() {
    // No error loading plain DocMenu page.
    await openFixture("DocMenu");
    assert.equal(await driver.find(".test-error-header").isPresent(), false);

    // We are still user "Santa"
    await openFixture("DocMenu#org=nonexistent");
    assert.equal(await driver.findWait(".test-error-header", 1000).getText(), "Access denied");
    assert.equal(await driver.find(".test-error-signin").getText(), "Add account");

    // Check the same for the Anonymous user.
    await openFixture("DocMenu#org=nonexistent&user=anon");
    await driver.findContentWait(".test-error-signin", "Sign in", 1000);
    assert.equal(await driver.find(".test-error-header").getText(), "Access denied");

    // Check the same for missing user.
    await openFixture("DocMenu#org=nonexistent&user=null");
    await driver.findContentWait(".test-error-signin", "Sign in", 1000);
    assert.equal(await driver.find(".test-error-header").getText(), "Access denied");
  });
});
