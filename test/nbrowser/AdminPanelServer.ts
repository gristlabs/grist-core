import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";
import * as testUtils from "test/server/testUtils";

import { assert, driver } from "mocha-webdriver";

/**
 * Read activation install prefs from the running server. Requires the
 * browser to be on a same-origin admin page so the fetch is authenticated.
 */
async function getInstallPrefs(): Promise<{ envVars?: Record<string, string | undefined> }> {
  return driver.executeScript(
    "return fetch('/api/install/prefs').then(r => r.json())",
  );
}

/** PATCH activation envVars. Pass `null` for a key to clear it. */
async function setEnvVars(envVars: Record<string, string | null>): Promise<void> {
  const status = await driver.executeScript<number>(`
    return fetch('/api/install/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify({ envVars }))},
    }).then(r => r.status);
  `);
  assert.equal(status, 200);
}

describe("AdminPanelServer", function() {
  this.timeout(300000);
  setupTestSuite();

  let oldEnv: testUtils.EnvironmentSnapshot;
  afterEach(() => gu.checkForErrors());

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = "core";
    process.env.GRIST_DEFAULT_EMAIL = gu.session().email;
    await server.restart(true);
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  describe("Admin panel Server section", function() {
    before(async function() {
      await gu.session().personalSite.login();
      await driver.get(`${server.getHost()}/admin`);
      await gu.waitForAdminPanel();
    });

    it("should show Base URL item in the Server section", async function() {
      const item = await driver.findWait(".test-admin-panel-item-base-url", 3000);
      assert.equal(await item.isDisplayed(), true);
      assert.match(await item.getText(), /Base URL/);
    });

    it("should show Edition item in the Server section", async function() {
      const item = await driver.findWait(".test-admin-panel-item-edition", 3000);
      assert.equal(await item.isDisplayed(), true);
      assert.match(await item.getText(), /Edition/);
    });

    it("should not flag Base URL as dirty until Test + Confirm", async function() {
      // Do everything in one expanded session so the item stays open.
      const header = await driver.findWait(".test-admin-panel-item-name-base-url", 1000);
      await header.click();
      await driver.sleep(500);

      // Edit the URL. Typing alone should NOT flag Base URL as dirty — the
      // confirmed pill should stay hidden, the Confirm URL button should
      // not appear, and the user should be in the Test URL phase.
      const input = await driver.findWait(".test-base-url-input", 1000);
      await input.click();
      await driver.executeScript(
        "arguments[0].value = '';" +
        "arguments[0].dispatchEvent(new Event('input', { bubbles: true }));",
        input,
      );
      await driver.sendKeys(`${server.getHost()}/`);
      await driver.sleep(300);

      // Still in Test URL phase.
      assert.isTrue(await driver.findContent(".test-base-url-test", /Test URL/).isPresent());
      assert.isFalse(await driver.findContent(".test-base-url-save", /Confirm URL/).isPresent());
      assert.isFalse(await driver.find(".test-base-url-confirmed-row").isPresent());

      // Click Test URL — still no confirmed row, just validation result.
      const testBtn = await driver.find(".test-base-url-test");
      await testBtn.click();
      await driver.findContentWait(".test-base-url-test-status", /reachable/i, 5000);
      assert.isFalse(await driver.find(".test-base-url-confirmed-row").isPresent());

      // Click Confirm URL — NOW the confirmed row appears.
      const confirmBtn = await driver.findContent(".test-base-url-save", /Confirm URL/);
      await confirmBtn.click();
      await driver.findWait(".test-base-url-confirmed-row", 2000);
    });

    it("should persist the URL via the API", async function() {
      // We can't actually click "Restart Grist" here because it would
      // restart and reload, so verify persistence via the endpoint that
      // the Apply and Continue button uses.
      await setEnvVars({ APP_HOME_URL: "http://test.example.com" });
      const prefs = await getInstallPrefs();
      assert.equal(prefs.envVars?.APP_HOME_URL, "http://test.example.com");
    });

    after(async function() {
      // Undo the URL set by the persistence test so the wizard suite
      // below starts from an unset APP_HOME_URL.
      await setEnvVars({ APP_HOME_URL: null });
    });
  });

  describe("Setup wizard Server step", function() {
    before(async function() {
      await gu.session().personalSite.login();
    });

    it("should show the Server step with Base URL and Edition", async function() {
      await driver.get(`${server.getHost()}/admin/setup`);
      await gu.waitForAdminPanel();

      await driver.findContentWait("div", /Server/, 3000);
      await driver.findContentWait("h3", /Base URL/, 3000);
      await driver.findContentWait("h3", /Edition/, 3000);
    });

    it("should show disabled continue button initially", async function() {
      const btn = await driver.findWait(".test-quick-setup-server-continue", 3000);
      // disabled attribute is either "" (grainjs boolAttr) or "true" depending on setter.
      assert.isNotNull(await btn.getAttribute("disabled"));
      // Wait for the Computed-driven button text to resolve.
      await driver.findContentWait(".test-quick-setup-server-continue",
        /Confirm.*base URL.*edition/i, 3000);
    });

    describe("getting through without changes", function() {
      // APP_HOME_URL is not set in this test env, so "Leave automatic"
      // produces no change and the Continue button offers Continue (not
      // Apply). When APP_HOME_URL is set, the same choice would be dirty
      // and would clear the URL via PATCH /install/prefs instead.
      it("should allow leaving Base URL automatic", async function() {
        const skipUrl = await driver.findContentWait("button", /Leave automatic/, 3000);
        await skipUrl.click();
        await driver.sleep(300);

        assert.isTrue(await driver.findContent(".test-base-url-confirmed-row", /Automatic/).isDisplayed());
      });

      it("should allow confirming Community Edition", async function() {
        // Explicitly pick Community first: on builds where Full Grist is
        // available the default selection is "enterprise", which would mark
        // Edition dirty (server is "core") and flip the button text.
        const community = await driver.findContentWait(".test-edition-community", /Community/, 3000);
        await community.click();
        await driver.sleep(100);

        const confirmEdition = await driver.findContentWait("button", /Confirm edition/, 3000);
        await confirmEdition.click();
        await driver.sleep(300);

        assert.isTrue(await driver.findContent(".test-edition-confirmed-row", /Confirmed/).isDisplayed());
      });

      it("should show Continue (not Apply) when nothing changed", async function() {
        const btn = await driver.find(".test-quick-setup-server-continue");
        assert.equal(await btn.getAttribute("disabled"), null);
        assert.equal(await btn.getText(), "Continue");
      });

      it("should advance to the next step on Continue", async function() {
        const btn = await driver.find(".test-quick-setup-server-continue");
        await btn.click();
        await driver.sleep(500);

        assert.equal(await driver.find(".test-base-url-section").isPresent(), false);
      });
    });

    describe("Test URL flow", function() {
      before(async function() {
        await driver.get(`${server.getHost()}/admin/setup`);
        await gu.waitForAdminPanel();
      });

      it("should show Test URL button initially", async function() {
        await driver.findContentWait(".test-base-url-test", /Test URL/, 3000);
        // In wizard mode the save button is the "Confirm URL" button, shown only after testing.
        // It should not be present initially (before testing).
        assert.isFalse(await driver.findContent(".test-base-url-save", /Confirm URL/).isPresent());
      });

      it("should test the URL and show success", async function() {
        // Set input to the actual server host so the test fetch succeeds.
        const input = await driver.find(".test-base-url-input");
        await driver.executeScript(
          `arguments[0].value = arguments[1];
           arguments[0].dispatchEvent(new Event('input', { bubbles: true }));`,
          input, server.getHost(),
        );
        const testBtn = await driver.findContentWait("button", /Test URL/, 3000);
        await testBtn.click();
        // Wait for the test result.
        await driver.findWait(".test-base-url-test-status", 5000);
        await driver.sleep(500);

        // Should show reachable message.
        const status = await driver.find(".test-base-url-test-status").getText();
        assert.match(status, /reachable/i);
      });

      it("should show Confirm URL after successful test", async function() {
        const confirmBtn = await driver.findContentWait("button", /Confirm URL/, 3000);
        assert.isTrue(await confirmBtn.isDisplayed());
      });

      it("should disable input after confirming", async function() {
        const confirmBtn = await driver.findContent("button", /Confirm URL/);
        await confirmBtn.click();
        await driver.sleep(300);

        const input = await driver.find(".test-base-url-input");
        assert.isNotNull(await input.getAttribute("disabled"));
      });

      it("should re-enable input after clicking edit", async function() {
        const editBtn = await driver.find(".test-base-url-edit");
        await editBtn.click();
        await driver.sleep(300);

        const input = await driver.find(".test-base-url-input");
        assert.isNull(await input.getAttribute("disabled"));
      });

      it("should revert to Test URL when URL is changed", async function() {
        const input = await driver.find(".test-base-url-input");
        await input.click();
        await driver.executeScript(
          "arguments[0].value = '';" +
          "arguments[0].dispatchEvent(new Event('input', { bubbles: true }));",
          input,
        );
        await driver.sendKeys("http://nonexistent.invalid");
        await driver.sleep(200);

        // Should show Test URL again, not Confirm URL.
        const testBtn = await driver.findContentWait("button", /Test URL/, 1000);
        assert.isTrue(await testBtn.isDisplayed());
      });

      it("should show error when test fails", async function() {
        const testBtn = await driver.findContent("button", /Test URL/);
        await testBtn.click();
        // BaseUrlSection._testUrl aborts after 10s; wait longer so a slow
        // DNS/network failure has time to surface.
        await driver.findContentWait(".test-base-url-test-status", /Could not reach/i, 15000);
      });
    });

    describe("Apply and Continue", function() {
      before(async function() {
        await driver.get(`${server.getHost()}/admin/setup`);
        await gu.waitForAdminPanel();
      });

      it("should show Apply and Continue when URL differs from server", async function() {
        // Test and confirm the URL (use the actual server host so the test passes).
        const input = await driver.findWait(".test-base-url-input", 3000);
        await input.click();
        await driver.executeScript(
          "arguments[0].value = '';" +
          "arguments[0].dispatchEvent(new Event('input', { bubbles: true }));",
          input,
        );
        await driver.sendKeys(`${server.getHost()}`);
        await driver.sleep(200);

        // Test it first.
        const testBtn = await driver.find(".test-base-url-test");
        await testBtn.click();
        await driver.findContentWait(".test-base-url-test-status", /reachable/i, 5000);

        // Confirm URL.
        const confirmUrl = await driver.find(".test-base-url-save");
        await confirmUrl.click();
        await driver.sleep(300);

        // Confirm edition.
        const confirmEdition = await driver.find(".test-edition-confirm");
        await confirmEdition.click();
        await driver.sleep(300);

        // Button should say "Apply and Continue".
        await driver.findContentWait(".test-quick-setup-server-continue",
          /Apply and Continue/, 3000);
      });
    });
  });
});
