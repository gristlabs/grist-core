import { server } from "test/fixtures/projects/webpack-test-server";

import { assert, driver, Key,  useServer } from "mocha-webdriver";

describe("simpleList", function() {
  useServer(server);

  beforeEach(async function() {
    await driver.get(`${server.getHost()}/simpleList`);
  });

  function getLogs() {
    return driver.findAll(".test-logs div", e => e.getText());
  }

  async function toggle() {
    await driver.findWait("input", 1000).doClick();
    // Wait for the weasel popup to appear
    return driver.findWait("input.weasel-popup-open", 1000);
  }

  function getSelected() {
    return driver.findAll(".grist-floating-menu [class*=-sel]", e => e.getText());
  }

  it("should support keyboard navigation without stealing focus", async function() {
    await toggle();
    await driver.sendKeys(Key.ARROW_DOWN);
    assert.deepEqual(await getSelected(), ["foo"]);
    await driver.sendKeys(Key.ENTER);
    assert.deepEqual(await getLogs(), ["foo"]);
  });

  it("should trigger action on click", async function() {
    await toggle();
    await driver.findContentWait(".grist-floating-menu li", "bar", 1000).click();
    assert.deepEqual(await getLogs(), ["bar"]);
  });

  it("should update selected on mouse hover", async function() {
    await toggle();
    await driver.findContentWait(".grist-floating-menu li", "bar", 1000).mouseMove();
    assert.deepEqual(await getSelected(), ["bar"]);
  });
});
