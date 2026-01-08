import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

import difference from "lodash/difference";
import { assert, driver, WebElementPromise } from "mocha-webdriver";

describe("ApiConsole", function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  before(async function() {
    const session = await gu.session().user("user1").login();
    await session.tempDoc(cleanup, "Hello.grist");
    await gu.dismissWelcomeTourIfNeeded();
  });

  it("confirms delete operations before doing them", async function() {
    const myTab = await gu.myTab();
    await openApiConsolePage();

    try {
      // Start a DELETE operation but cancel it
      await clickWithRetry(() => gu.scrollIntoView(driver.find("div#operations-orgs-deleteOrg")));
      await clickWithRetry(() => driver.findWait("button.try-out__btn", 3000));
      await clickWithRetry(() => driver.findWait("button.execute", 3000));
      assert.equal(await driver.findWait(".test-modal-title", 3000).getText(),
        "Confirm Deletion");
      await driver.findWait("button.test-modal-cancel", 3000).click();
      let toasts = await gu.getToasts();
      assert.equal(toasts.length, 1);
      assert.match(toasts[0], /Deletion was not confirmed/);
      await gu.wipeToasts();

      // Start a DELETE operation and confirm it without writing "DELETE"
      await clickWithRetry(() => driver.findWait("button.try-out__btn.cancel", 3000));
      await clickWithRetry(() => driver.findWait("button.try-out__btn:not(.cancel)", 3000));
      await clickWithRetry(() => driver.findWait("button.execute", 3000));
      await driver.findWait("button.test-modal-confirm", 3000).click();
      toasts = await gu.getToasts();
      assert.equal(toasts.length, 1);
      assert.match(toasts[0], /Deletion was not confirmed/);
      await gu.wipeToasts();

      // Start a DELETE operation and confirm it without writing "DELETE" correctly
      await clickWithRetry(() => driver.findWait("button.try-out__btn.cancel", 3000));
      await clickWithRetry(() => driver.findWait("button.try-out__btn:not(.cancel)", 3000));
      await driver.findWait("button.execute", 3000).click();
      await driver.findWait("input.test-modal-prompt", 3000).sendKeys("DELETENO");
      await driver.findWait("button.test-modal-confirm", 3000).click();
      toasts = await gu.getToasts();
      assert.equal(toasts.length, 1);
      assert.match(toasts[0], /Deletion was not confirmed/);
      await gu.wipeToasts();

      // Start a DELETE operation and confirm it with "DELETE"
      await clickWithRetry(() => driver.findWait("button.try-out__btn.cancel", 3000));
      await clickWithRetry(() => driver.findWait("button.try-out__btn:not(.cancel)", 3000));
      await driver.findWait("button.execute", 3000).click();
      await driver.findWait("input.test-modal-prompt", 3000).sendKeys("DELETE");
      await driver.findWait("button.test-modal-confirm", 3000).click();
      toasts = await gu.getToasts();
      assert.equal(toasts.length, 0);
    } finally {
      // There is an extra browser tab open for the api console.
      await driver.close();
      await myTab.open();
    }
  });
});

async function openApiConsolePage() {
  await gu.wipeToasts();
  await gu.openDocumentSettings();
  const tabs = await driver.getAllWindowHandles();
  await gu.scrollIntoView(driver.findContentWait("a", /API console/i, 3000)).click();
  const newTab = difference(await driver.getAllWindowHandles(), tabs)[0];
  assert.isDefined(newTab);
  await driver.switchTo().window(newTab);
  await driver.findContentWait("p", /An API for manipulating Grist/, 3000);
  // Swagger code is external, a little slow, a little async.
  // Give it some time. Not obvious what to wait on.
  await driver.sleep(2000);
}

// The swagger-ui code is external, a little slow, a little async.
// Elements can flicker in and out of existence. Maybe there is a
// smart way to deal with this, but in the absence of that, here's
// a little retry.
async function clickWithRetry(finder: () => WebElementPromise) {
  try {
    await finder().click();
  } catch (e) {
    await finder().click();
  }
}
