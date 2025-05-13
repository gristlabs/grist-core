import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import fetch from 'node-fetch';
import * as gu from 'test/nbrowser/gristUtils';
import {server} from 'test/nbrowser/testServer';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DocumentUsage', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  const ownerUser = 'user1';
  let api: UserAPI;
  let session: gu.Session;

  gu.enableExternalAttachments();

  async function makeSessionAndLogin() {
    // login() needs an options object passing to bypass an optimization that causes .login()
    // to think we're already logged in when we're not after using `server.restart()`.
    // Without this we end up with old credentials on the original session, or bad credentials on a new one.
    session = await gu.session().user(ownerUser).login({ retainExistingLogin: false });
    api = session.createHomeApi();
  }

  before(async function () {
    await makeSessionAndLogin();
  });

  it('shows usage stats on the raw data page', async function() {
    await session.tempNewDoc(cleanup, "EmptyUsageDoc");
    await testDocUsageStatsAreZero();
  });

  function testAttachmentsUsage(getDocId: () => string) {
    it('updates attachments size usage when uploading attachments', async function () {
      const docId = getDocId();
      // Add a new 'Attachments' column of type Attachment to Table1.
      await api.applyUserActions(docId, [['AddEmptyTable', "AttachmentsTable"]]);
      await gu.getPageItem('AttachmentsTable').click();
      await gu.waitForServer();
      await addAttachmentColumn('Attachments');

      // Upload some files into the first row. (We're putting Grist docs in a Grist doc!)
      await driver.sendKeys(Key.ENTER);
      await gu.fileDialogUpload(
        'docs/Covid-19.grist,docs/World-v0.grist,docs/World-v1.grist,docs/World-v3.grist,'
        + 'docs/Landlord.grist,docs/ImportReferences.grist,docs/WorldUndo.grist,'
        + 'docs/Ref-List-AC-Test.grist,docs/PasteParsing.grist',
        () => driver.find('.test-pw-add').click()
      );
      // Check all 9 attachments have uploaded.
      await driver.findContentWait('.test-pw-counter', /of 9/, 4000);
      await driver.find('.test-modal-dialog .test-pw-close').click();
      await gu.waitForServer();

      // Navigate back to the raw data page, and check that attachments size updated.
      await goToDocUsage();
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.01');

      // Delete the 'Attachments' column; usage should not immediately update.
      await api.applyUserActions(docId, [['RemoveColumn', 'AttachmentsTable', 'Attachments']]);
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.01');

      // Remove unused attachments via API and check that size automatically updates to 0.
      await removeUnusedAttachments(api, docId);
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
    });
  }

  describe('attachment usage without external attachments', function() {
    let docId: string;

    before(async () => {
      docId = await session.tempNewDoc(cleanup, `AttachmentUsageTestDoc - internal`);
    });

    testAttachmentsUsage(() => docId);
  });

  describe('attachment usage with external attachments', function() {
    let docId: string;

    before(async () => {
      docId = await session.tempNewDoc(cleanup, `AttachmentUsageTestDoc - internal`);
      const docApi = api.getDocAPI(docId);
      await docApi.setAttachmentStore("external");
      assert.equal((await docApi.getAttachmentStore()).type, "external");
    });

    testAttachmentsUsage(() => docId);
  });
});

async function testDocUsageStatsAreZero() {
  // Check that the Usage section exists.
  await goToDocUsage();
  assert.equal(await driver.find('.test-doc-usage-heading').getText(), 'Usage');
  await assertUsageMessage(null);

  // Check that usage is at 0.
  await assertRowCount('0');
  await assertDataSize('0.00');
  await assertAttachmentsSize('0.00');

  // Check that banners aren't shown on the raw data page.
  await gu.assertBannerText(null);
}

async function goToDocUsage() {
  await driver.findWait('.test-tools-raw', 2000).click();

  // Check that the Usage section exists.
  await waitForDocUsage();
}

async function assertUsageMessage(text: string | null) {
  if (text === null) {
    assert.isFalse(await driver.find('.test-doc-usage-message').isPresent());
  } else {
    assert.equal(await driver.findWait('.test-doc-usage-message-text', 2000).getText(), text);
  }
}

async function assertRowCount(currentValue: string, maximumValue?: string) {
  await gu.waitToPass(async () => {
    const rowUsage = await driver.find('.test-doc-usage-rows .test-doc-usage-value').getText();
    const [, foundValue, foundMax] = rowUsage.match(/([0-9,]+) (?:of ([0-9,]+) )?rows/) || [];
    assert.equal(foundValue, currentValue);
    if (maximumValue) {
      assert.equal(foundMax, maximumValue);
    }
  });
}

async function assertDataSize(currentValue: string, maximumValue?: string) {
  await gu.waitToPass(async () => {
    const dataUsage = await driver.find('.test-doc-usage-data-size .test-doc-usage-value').getText();
    const [, foundValue, foundMax] = dataUsage.match(/([0-9,.]+) (?:of ([0-9,.]+) )?MB/) || [];
    assert.equal(foundValue, currentValue);
    if (maximumValue) {
      assert.equal(foundMax, maximumValue);
    }
  });
}

async function assertAttachmentsSize(currentValue: string, maximumValue?: string) {
  await gu.waitToPass(async () => {
    const attachmentUsage = await driver.find('.test-doc-usage-attachments-size .test-doc-usage-value').getText();
    const [, foundValue, foundMax] = attachmentUsage.match(/([0-9,.]+) (?:of ([0-9,.]+) )?GB/) || [];
    assert.equal(foundValue, currentValue);
    if (maximumValue) {
      assert.equal(foundMax, maximumValue);
    }
  });
}

async function waitForDocUsage() {
  await driver.findWait('.test-doc-usage-container', 8000);
  await gu.waitToPass(async () => {
    return assert.isFalse(await driver.find('.test-doc-usage-loading').isPresent());
  });
}

async function addAttachmentColumn(columnName: string) {
  await gu.toggleSidePanel('right', 'open');
  await driver.find('.test-right-tab-field').click();
  await gu.addColumn(columnName);
  await gu.setType(/Attachment/);
}

async function removeUnusedAttachments(api: UserAPI, docId: string) {
  const headers = {Authorization: `Bearer ${await api.fetchApiKey()}`};
  const url = server.getUrl('docs', `/api/docs/${docId}`);
  await fetch(url + "/attachments/removeUnused?verifyfiles=0&expiredonly=0", {
    headers,
    method: "POST"
  });
}
