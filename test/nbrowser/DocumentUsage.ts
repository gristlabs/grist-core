import {arrayRepeat} from 'app/common/gutil';
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

  describe('row usage', function() {
    let docId: string;

    before(async () => {
      docId = await session.tempNewDoc(cleanup, "RowUsageTestDoc");
    });

    it('updates row usage when rows are added or removed', async function() {
      await goToDocUsage();

      // Add 1,000 rows, and check that the row count updated.
      await api.applyUserActions(docId, [
        ['AddEmptyTable', "RowCheckTable"],
        ['BulkAddRecord', 'RowCheckTable', arrayRepeat(1000, null), {}]
      ]);
      await assertRowCount('1,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);

      // Add 4,000 rows to a different table, and check that row count updated.
      await api.applyUserActions(docId, [
        ['AddEmptyTable', "RowCheckTable2"],
        ['BulkAddRecord', 'RowCheckTable2', arrayRepeat(4000, null), {}]
      ]);
      await assertRowCount('5,000');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);

      // Refresh the page, and make sure banners still aren't shown. (Only free team
      // sites should currently show them.)
      await driver.navigate().refresh();
      await waitForDocUsage();
      await assertRowCount('5,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);

      // Delete the first table, and check that the row count updated.
      await api.applyUserActions(docId, [['RemoveTable', 'RowCheckTable']]);
      await assertRowCount('4,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);

      // Delete the second table so we're back at 0.
      await api.applyUserActions(docId, [['RemoveTable', 'RowCheckTable2']]);
      await assertRowCount('0');
    });

    it('updates data size usage over time', async function() {
      await goToDocUsage();

      // Add 500 rows with some data in them.
      await api.applyUserActions(docId, [
        ['AddEmptyTable', "DataSizeTable"],
        ['BulkAddRecord', 'DataSizeTable', arrayRepeat(500, null), {
          'A': arrayRepeat(500, 'Some random data for testing that data size usage is working as intended.'),
          'B': arrayRepeat(500, 2500),
          'C': arrayRepeat(500, true),
        }]
      ]);

      // Check that size usage is initially unchanged; it's computed on doc startup, and on interval
      // in the background, to minimize load.

      await assertRowCount('500');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');

      // Force the document to reload, and check that size usage updated.
      await api.getDocAPI(docId).forceReload();
      await waitForDocUsage();
      await assertDataSize('0.04');
      await assertAttachmentsSize('0.00');
    });
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

  describe('doc usage access', function() {
    let docId: string;
    let docUsagePageUrl: string;

    before(async () => {
      docId = await session.tempNewDoc(cleanup, "DocUsageAccessTestDoc");

      // Share the document with everyone as an editor.
      await api.updateDocPermissions(docId, {
        users: {
          'everyone@getgrist.com': 'editors',
          [gu.session().user('user2').email]: 'editors',
        },
      });

      await goToDocUsage();
      docUsagePageUrl = await driver.getCurrentUrl();
    });

    it('does not show banners or usage to public visitors', async function() {
      // Log in as anon, and check that the delete-only banner is not shown.
      await gu.session().anon.login();
      await driver.navigate().to(docUsagePageUrl);
      await assertUsageAccessDenied();
      await gu.assertBannerText(null);

      /*
      // Delete a few rows, putting the document in "approaching limit" mode. Make sure a banner is
      // still not shown.
      await api.applyUserActions(docId, [['BulkRemoveRecord', 'Table1', [1, 2, 3]]]);
      await assertUsageAccessDenied();
      await gu.assertBannerText(null);

      // Finally, add back some rows to push the document back into "grace period" mode, and check
      // once more that a banner is still not shown.
      await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(3, null), {}]]);
      await assertUsageAccessDenied();
      await gu.assertBannerText(null);
      */
    });

    it('shows usage count to logged in users with edit access', async function() {
      await gu.session().user('user2').login();
      await driver.navigate().to(docUsagePageUrl);
      await goToDocUsage();
      await assertRowCount('0');
    });

    describe('access rules', async function () {
      before(async function () {
        session = await gu.session().user(ownerUser).login();
        await driver.navigate().to(docUsagePageUrl);
        // Make Table2 viewable only by the owner.
        await blockTable(api, docId, 'Table1');
      });

      it('show row count for owners if blocked by access rules', async function() {
        await goToDocUsage();
        await assertUsageAccessAllowed();
      });

      it('show row count for owners if table is hidden by access rules', async () => {
        await hideTable(api, docId, 'Table1');
        await assertUsageAccessAllowed();
        await assertDataSize('0.00');
        await assertAttachmentsSize('0.00');
      });

      it('does not show row count if blocked by access rules', async () => {
        await gu.session().user('user2').login();
        await driver.navigate().to(docUsagePageUrl);
        await assertUsageAccessDenied();
      });
    });

    describe ('owner', async function () {

    });
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

async function getTableResourceAclId(
  api: UserAPI, docId: string, tableId: string, colIds: string = '*'
): Promise<number | undefined> {
  const table = await api.getTable(docId, '_grist_ACLResources');
  const index = table.tableId.indexOf(tableId);
  // Returns undefined if index is -1
  return table.id[index];
}

async function blockTable(api: UserAPI, docId: string, tableId: string) {
  await api.applyUserActions(docId, [
    ['AddRecord', '_grist_ACLResources', 2, {tableId: tableId, colIds: '*'}],
    ['AddRecord', '_grist_ACLRules', null, {
      resource: 2, aclFormula: 'user.Access != "owners"', permissionsText: '-R',
    }],
  ]);
}

async function hideTable(api: UserAPI, docId: string, tableId: string) {
  const resourceId = await getTableResourceAclId(api, docId, tableId);
  await api.applyUserActions(docId, [
    ['AddRecord', '_grist_ACLRules', null, {
      resource: resourceId, aclFormula: 'True', permissionsText: '-R',
    }],
  ]);
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

const USAGE_ACCESS_DENIED_TEXT = 'Usage statistics are only available to users with full access to the document data.';
async function assertUsageAccessDenied() {
  await assertUsageMessage(USAGE_ACCESS_DENIED_TEXT);
  assert.isFalse(await driver.find('.test-doc-usage-metrics').isPresent());
}

async function assertUsageAccessAllowed() {
  await assert.isRejected(driver.findWait('.test-doc-usage-message-text', 2000));
  assert.isTrue(await driver.find('.test-doc-usage-metrics').isPresent());
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
  // Extended timeout from 2000 to 8000
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
