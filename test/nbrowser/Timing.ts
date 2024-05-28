import { DocAPI, UserAPI } from "app/common/UserAPI";
import difference from 'lodash/difference';
import { assert, driver } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

describe("Timing", function () {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  let docApi: DocAPI;
  let userApi: UserAPI;
  let docId: string;
  let session: gu.Session;

  before(async () => {
    session = await gu.session().teamSite.login();
    docId = await session.tempNewDoc(cleanup);
    userApi = session.createHomeApi();
    docApi = userApi.getDocAPI(docId);
  });

  async function assertOn() {
    await gu.waitToPass(async () => {
      assert.equal(await timingText.text(), "Timing is on...");
    });

    assert.isTrue(await stopTiming.visible());
    assert.isFalse(await startTiming.present());
  }

  async function assertOff() {
    await gu.waitToPass(async () => {
      assert.equal(await timingText.text(), "Find slow formulas");
    });
    assert.isTrue(await startTiming.visible());
    assert.isFalse(await stopTiming.present());
  }


  it("should allow to start session", async function () {
    await gu.openDocumentSettings();
    // Make sure we see the timing button.
    await assertOff();

    // Start timing.
    await startTiming.click();

    // Wait for modal.
    await modal.wait();

    // We have two options.
    assert.isTrue(await optionStart.visible());
    assert.isTrue(await optionReload.visible());

    // Start is selected by default.
    assert.isTrue(await optionStart.checked());
    assert.isFalse(await optionReload.checked());

    await modalConfirm.click();

    await assertOn();
  });

  it('should reflect that in the API', async function() {
    assert.equal(await docApi.timing().then(x => x.status), 'active');
  });

  it('should stop session from outside', async function() {
    await docApi.stopTiming();
    await assertOff();
  });

  it('should start session from API', async function() {
    await docApi.startTiming();

    // Add new record through the API (to trigger formula calculations).
    await userApi.applyUserActions(docId, [
      ['AddRecord', 'Table1', null, {}]
    ]);
  });

  it('should show result and stop session', async function() {
    // The stop button is actually stop and show results, and it will open new window in.
    const myTab = await gu.myTab();
    const tabs = await driver.getAllWindowHandles();
    await stopTiming.click();

    // Now new tab will be opened, and the timings will be stopped.
    await gu.waitToPass(async () => {
      assert.equal(await docApi.timing().then(x => x.status), 'disabled');
    });

    // Find the new tab.
    const newTab = difference(await driver.getAllWindowHandles(), tabs)[0];
    assert.isDefined(newTab);
    await driver.switchTo().window(newTab);

    // Sanity check that we see some results.
    assert.isTrue(await driver.findContentWait('div', 'Formula timer', 1000).isDisplayed());

    await gu.waitToPass(async () => {
      assert.equal(await gu.getCell(0, 1).getText(), 'Table1');
    });

    // Switch back to the original tab.
    await myTab.open();

    // Make sure controls are back to the initial state.
    await assertOff();

    // Close the new tab.
    await driver.switchTo().window(newTab);
    await driver.close();
    await myTab.open();
  });

  it("should allow to time the document load", async function () {
    await assertOff();

    await startTiming.click();
    await modal.wait();

    // Check that cancel works.
    await modalCancel.click();
    assert.isFalse(await modal.present());
    await assertOff();

    // Open modal once again but this time select reload.
    await startTiming.click();
    await optionReload.click();
    assert.isTrue(await optionReload.checked());
    await modalConfirm.click();

    // We will see spinner.
    await gu.waitToPass(async () => {
      await driver.findContentWait('div', 'Loading timing data.', 1000);
    });

    // We land on the timing page in the same tab.
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.findContentWait('div', 'Formula timer', 1000).isDisplayed());
      assert.equal(await gu.getCell(0, 1).getText(), 'Table1');
    });

    // Refreshing this tab will move us to the settings page.
    await driver.navigate().refresh();
    await gu.waitForUrl('/settings');
  });
});

const element = (testId: string) => ({
  element() {
    return driver.find(testId);
  },
  async wait() {
    await driver.findWait(testId, 1000);
  },
  async visible() {
    return await this.element().isDisplayed();
  },
  async present() {
    return await this.element().isPresent();
  }
});

const label = (testId: string) => ({
  ...element(testId),
  async text() {
    return this.element().getText();
  },
});

const button = (testId: string) => ({
  ...element(testId),
  async click() {
    await gu.scrollIntoView(this.element());
    await this.element().click();
  },
});

const option = (testId: string) => ({
  ...button(testId),
  async checked() {
    return 'true' === await this.element().findClosest("label").find("input[type='checkbox']").getAttribute('checked');
  }
});

const startTiming = button(".test-settings-timing-start");
const stopTiming = button(".test-settings-timing-stop");
const timingText = label(".test-settings-timing-desc");
const modal = element(".test-settings-timing-modal");
const optionStart = option('.test-settings-timing-modal-option-adhoc');
const optionReload = option('.test-settings-timing-modal-option-reload');
const modalConfirm = button('.test-settings-timing-modal-confirm');
const modalCancel = button('.test-settings-timing-modal-cancel');
