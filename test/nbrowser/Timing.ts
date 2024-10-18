import { DocAPI, UserAPI } from "app/common/UserAPI";
import difference from 'lodash/difference';
import { assert, driver } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";
import { button, element, label, option } from "test/nbrowser/elementUtils";

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

  it('clears virtual table when navigated away', async function() {
    // Start timing and go to results.
    await startTiming.click();
    await modal.wait();
    await optionReload.click();
    await modalConfirm.click();

    // Wait for the results page.
    await gu.waitToPass(async () => {
      assert.isTrue(await driver.findContentWait('div', 'Formula timer', 1000).isDisplayed());
      assert.equal(await gu.getCell(0, 1).getText(), 'Table1');
    });

    // Now go to the raw data page, and make sure we see only Table1.
    await driver.find('.test-tools-raw').click();
    await driver.findWait('.test-raw-data-list', 2000);
    assert.deepEqual(await driver.findAll('.test-raw-data-table-id', e => e.getText()), ['Table1']);
  });

  it('should be disabled for non-owners', async function() {
    await userApi.updateDocPermissions(docId, {users: {
      [gu.translateUser('user2').email]: 'editors',
    }});

    const session = await gu.session().teamSite.user('user2').login();
    await session.loadDoc(`/doc/${docId}`);
    await gu.openDocumentSettings();

    const start = driver.find('.test-settings-timing-start');
    assert.equal(await start.isPresent(), true);

    // Check that we have an informative tooltip.
    await start.mouseMove();
    assert.match(await driver.findWait('.test-tooltip', 2000).getText(), /Only available to document owners/);

    // Nothing should happen on click. We click the location rather than the element, since the
    // element isn't actually clickable.
    await start.mouseMove();
    await driver.withActions(a => a.press().release());
    await driver.sleep(100);
    assert.equal(await driver.find(".test-settings-timing-modal").isPresent(), false);
  });
});

const startTiming = button(".test-settings-timing-start");
const stopTiming = button(".test-settings-timing-stop");
const timingText = label(".test-settings-timing-desc");
const modal = element(".test-settings-timing-modal");
const optionStart = option('.test-settings-timing-modal-option-adhoc');
const optionReload = option('.test-settings-timing-modal-option-reload');
const modalConfirm = button('.test-settings-timing-modal-confirm');
const modalCancel = button('.test-settings-timing-modal-cancel');
