import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("WelcomePage", function() {
  this.timeout(20000);
  setupTestSuite();

  // Loads /welcome/select-account with the given `next` query param, and returns the `href` of the
  // first account button.
  async function getSelectUserHref(next: string): Promise<string> {
    const url = new URL("/welcome/select-account", server.getHost());
    url.searchParams.set("next", next);
    await driver.get(url.href);
    return await driver.findWait(".test-select-user", 5000).getAttribute("href");
  }

  before(async function() {
    // Sign in with two accounts so the multi-account picker is shown.
    await server.removeLogin();
    await server.simulateLogin("Chimpy", "chimpy@getgrist.com", "nasa");
    await server.simulateLogin("Kiwi", "kiwi@getgrist.com", "nasa");
    await driver.get(server.getHost());
  });

  after(async function() {
    await server.removeLogin();
  });

  it("addUserToLink rejects unsafe and cross-origin `next` URLs (XSS-62)", async function() {
    // First check that a relative next-param works as expected.
    assert.equal(await getSelectUserHref("/o/nasa/p/2"),
      `${server.getHost()}/o/nasa/p/2?user=chimpy%40getgrist.com`);

    // A same-origin next-param should also work normally.
    assert.equal(await getSelectUserHref(`${server.getHost()}/hello-world`),
      `${server.getHost()}/hello-world?user=chimpy%40getgrist.com`);

    // A `javascript:` next must not produce a javascript: href.
    assert.equal(await getSelectUserHref("javascript:alert(1)"),
      `${server.getHost()}/?user=chimpy%40getgrist.com`);

    // A cross-origin next falls back to the same-origin site home.
    assert.equal(await getSelectUserHref("https://evil.example/x"),
      `${server.getHost()}/?user=chimpy%40getgrist.com`);
  });
});
