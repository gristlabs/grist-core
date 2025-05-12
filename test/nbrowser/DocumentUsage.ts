import {arrayRepeat} from 'app/common/gutil';
import {UserAPI} from 'app/common/UserAPI';
import {TEAM_FREE_PLAN} from 'app/common/Features';
import {assert, driver, Key} from 'mocha-webdriver';
import fetch from 'node-fetch';
import * as gu from 'test/nbrowser/gristUtils';
import moment  from 'moment';
import {server} from 'test/nbrowser/testServer';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DocumentUsage', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  describe('on legacy free personal site', function() {
    let api: UserAPI;
    let docId: string;

    before(async () => {
      await server.simulateLogin('Ham', 'ham@getgrist.com', 'docs');
      api = gu.createHomeApi('Ham', 'docs');
      docId = await gu.createNewDoc('Ham', 'docs', 'Home', 'LegacyFreePersonalDoc');
      cleanup.addAfterAll(() => api.deleteDoc(docId));
      await gu.loadDoc(`/doc/${docId}`);
      await gu.waitForDocToLoad();
    });

    it('does not show limit banners when new document is opened', testBannerNotShown);

    it('shows row usage on the raw data page', async function() {
      await driver.find('.test-tools-raw').click();

      // Check that the Usage section exists.
      await waitForDocUsage();
      assert.equal(await driver.find('.test-doc-usage-heading').getText(), 'Usage');
      await assertUsageMessage(null);

      // Check that usage is at 0.
      await assertRowCount('0');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');

      // Check that banners aren't shown on the raw data page.
      await gu.assertBannerText(null);
    });

    it('updates row usage when rows are added or removed', async function() {
      // Add 1,000 rows, and check that the row count updated.
      await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(1000, null), {}]]);
      await assertRowCount('1,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);

      // Add 4,000 rows to a different table, and check that row count updated.
      await api.applyUserActions(docId, [
        ['AddEmptyTable', null],
        ['BulkAddRecord', 'Table2', arrayRepeat(4000, null), {}]
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
      await gu.assertBannerText(null);
      await assertUsageMessage(null);

      // Delete the first table, and check that the row count updated.
      await api.applyUserActions(docId, [['RemoveTable', 'Table1']]);
      await assertRowCount('4,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);
    });

    it('includes summary table rows in row count', async function() {
      // Add some data to Table2 and create a summary table of it, grouping by A.
      await api.applyUserActions(docId, [
        ['BulkAddRecord', 'Table2', arrayRepeat(8, null), {
          A: ['some', 'text', 'to', 'group', 'by', 'abc', '123', 'abc'],
        }],
      ]);
      await assertRowCount('4,008');
      await gu.addNewPage(/Table/, /Table2/, {summarize: [/A/]});

      // Check that the row count includes the added data AND the rows from the summary table.
      await driver.find('.test-tools-raw').click();
      await assertRowCount('4,016');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);
    });

    it('does not show usage if user lacks permission to edit', async function() {
      // Share the document with everyone as a viewer.
      await api.updateDocPermissions(docId, {
        users: {'everyone@getgrist.com': 'viewers'},
      });

      // Log in as anon, and check that usage is not shown.
      const rawDataPageUrl = await driver.getCurrentUrl();
      await gu.session().anon.login();
      await driver.get(rawDataPageUrl);
      await waitForDocUsage();
      await assertUsageAccessDenied();

      // Switch back to the owner and make sure they can still see usage.
      await server.simulateLogin('Ham', 'ham@getgrist.com', 'docs');
      await driver.get(rawDataPageUrl);
      await waitForDocUsage();
      await assertRowCount('4,016');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
    });

    it('updates data size usage over time', async function() {
      // Add 500 rows with some data in them.
      await api.applyUserActions(docId, [['BulkAddRecord', 'Table2', arrayRepeat(500, null), {
        'A': arrayRepeat(500, 'Some random data for testing that data size usage is working as intended.'),
        'B': arrayRepeat(500, 2500),
        'C': arrayRepeat(500, true),
      }]]);

      // Check that size usage is initially unchanged; it's computed on doc startup, and on interval
      // in the background, to minimize load.
      await assertRowCount('4,517');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');

      // Force the document to reload, and check that size usage updated.
      await api.getDocAPI(docId).forceReload();
      await waitForDocUsage();
      await assertDataSize('0.12');
      await assertAttachmentsSize('0.00');
    });

    it('updates attachments size usage when uploading attachments', async function() {
      // Add a new 'Attachments' column of type Attachment to Table2.
      await gu.getPageItem('Table2').click();
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
      await driver.findContentWait('.test-pw-counter', /of 9/, 4000);
      await driver.find('.test-modal-dialog .test-pw-close').click();
      await gu.waitForServer();

      // Navigate back to the raw data page, and check that attachments size updated.
      await driver.navigate().back();
      await waitForDocUsage();
      await assertDataSize('0.12');
      await assertAttachmentsSize('0.01');

      // Delete the 'Attachments' column; usage should not immediately update.
      await api.applyUserActions(docId, [['RemoveColumn', 'Table2', 'Attachments']]);
      await assertDataSize('0.12');
      await assertAttachmentsSize('0.01');

      // Remove unused attachments via API and check that size automatically updates to 0.
      const headers = {Authorization: `Bearer ${await api.fetchApiKey()}`};
      const url = server.getUrl('docs', `/api/docs/${docId}`);
      await fetch(url + "/attachments/removeUnused?verifyfiles=0&expiredonly=0", {headers, method: "POST"});
      await assertDataSize('0.12');
      await assertAttachmentsSize('0.00');
    });
  });

  describe('on free personal site', function() {
    let api: UserAPI;
    let docId: string;
    let session: gu.Session;

    before(async () => {
      session = await gu.session().user('user1').personalSite.login();
      api = session.createHomeApi();
      docId = await session.tempNewDoc(cleanup, "FreePersonalDoc");
    });

    it('does not show limit banners if row limit is below threshold', testBannerNotShown);
    it('shows row usage on the raw data page', testInitialUsageFreePlan);
    it('updates data size usage over time', () => testDataSizeUpdatesFreePlan(api, docId));
    it('updates attachments size usage when uploading attachments', () =>
      testAttachmentsSizeUpdatesFreePlan(api, docId));
    it('shows approaching limit banner when close to row limit', () =>
      testApproachingLimitBannerFreePlan(api, docId));
    it('shows grace period banner when past row limit', () => testGracePeriodBannerFreePlan(api, docId));
    it('shows delete-only banner when past grace period', () => testDeleteOnlyBannerFreePlan(api, docId));
    it('does not show banners or usage to public visitors', () => testPublicVisitorsFreePlan(api, docId));
    it('shows banners and usage to non-public users with document edit access', () =>
      testEditorsFreePlan(api, docId));
    it('does not show row count if blocked by access rules', async () => {
      // Make Table2 viewable only by the owner.
      await blockTable2(api, docId);
      await assertUsageAccessDenied();
    });

    it('has a functioning close button on approaching limit banners', async function() {
      // Switch back to the owner and check that the "approaching limit" banner is shown.
      const rawDataPageUrl = await driver.getCurrentUrl();
      await gu.session().user('user1').login();
      await driver.get(rawDataPageUrl);
      await waitForDocUsage();
      let expectedText = 'This document is approaching free plan limits. '
        + 'For higher limits, start your 30-day free trial of the Pro plan.';
      await gu.assertBannerText(expectedText);

      // Click the close button, and check that the banner is gone.
      await driver.find('.test-banner-close').click();
      await gu.assertBannerText(null);

      // Reload the page, and check that the banner isn't shown again.
      await driver.navigate().refresh();
      await waitForDocUsage();
      await gu.assertBannerText(null);

      // For good measure, exceed limits again and make sure those banners are not hidden.
      await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(3, null), {}]]);
      expectedText = 'Document limits exceeded. In 14 days, this document will be read-only. '
        + 'For higher limits, start your 30-day free trial of the Pro plan.';
      await gu.assertBannerText(expectedText);

      // Check that exceeding limit banners don't show a close button.
      assert.isFalse(await driver.find('.test-banner-close').isPresent());
    });
    it('show row count for owners if blocked by access rules', () => assertUsageAccessAllowed());
    it('show row count for owners if table is hidden by access rules', async () => {
      await hideTable2(api, docId);
      await assertUsageAccessAllowed();
      await assertDataSize('0.10', '10.00');
      await assertAttachmentsSize('0.00', '1.00');
    });
  });

  describe('on free team site', function() {
    let api: UserAPI;
    let docId: string;
    let session: gu.Session;

    before(async () => {
      session = await gu.session().user('user1').personalSite.login();
      api = session.createHomeApi();
      const billingApi = api.getBillingAPI();
      await billingApi.createTeam('site', 'free-team-site', {
        product: TEAM_FREE_PLAN
      });
      session = await gu.session().user('user1').customTeamSite('free-team-site').login();
      api = session.createHomeApi();
      docId = await session.tempNewDoc(cleanup, 'FreeTeamDoc');
    });

    it('does not show limit banners if row limit is below threshold', testBannerNotShown);
    it('shows row usage on the raw data page', testInitialUsageFreePlan);
    it('updates data size usage over time', () => testDataSizeUpdatesFreePlan(api, docId));
    it('updates attachments size usage when uploading attachments', () =>
      testAttachmentsSizeUpdatesFreePlan(api, docId));
    it('shows approaching limit banner when close to row limit', () =>
      testApproachingLimitBannerFreePlan(api, docId));
    it('shows grace period banner when past row limit', () => testGracePeriodBannerFreePlan(api, docId));
    it('shows delete-only banner when past grace period', () => testDeleteOnlyBannerFreePlan(api, docId));
    it('does not show banners or usage to public visitors', () => testPublicVisitorsFreePlan(api, docId));
    it('shows banners and usage to non-public users with document edit access', () =>
      testEditorsFreePlan(api, docId));
    it('does not show row count if blocked by access rules', async () => {
      // Make Table2 viewable only by the owner.
      await blockTable2(api, docId);
      await assertUsageAccessDenied();
    });

    it('has a functioning close button on approaching limit banners', async function() {
      // Switch back to the owner and check that the "approaching limit" banner is shown.
      const rawDataPageUrl = await driver.getCurrentUrl();
      await gu.session().user('user1').customTeamSite('free-team-site').login();
      await driver.get(rawDataPageUrl);
      await waitForDocUsage();
      let expectedText = 'This document is approaching free plan limits. '
        + 'For higher limits, start your 30-day free trial of the Pro plan.';
      await gu.assertBannerText(expectedText);

      // Click the close button, and check that the banner is gone.
      await driver.find('.test-banner-close').click();
      await gu.assertBannerText(null);

      // Reload the page, and check that the banner isn't shown again.
      await driver.navigate().refresh();
      await waitForDocUsage();
      await gu.assertBannerText(null);

      // For good measure, exceed limits again and make sure those banners are not hidden.
      await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(3, null), {}]]);
      expectedText = 'Document limits exceeded. In 14 days, this document will be read-only. '
        + 'For higher limits, start your 30-day free trial of the Pro plan.';
      await gu.assertBannerText(expectedText);

      // Check that exceeding limit banners don't show a close button.
      assert.isFalse(await driver.find('.test-banner-close').isPresent());
    });
    it('show row count for owners if blocked by access rules', () => assertUsageAccessAllowed());
    it('show row count for owners if table is hidden by access rules', async () => {
      await hideTable2(api, docId);
      await assertUsageAccessAllowed();
      await assertDataSize('0.10', '10.00');
      await assertAttachmentsSize('0.00', '1.00');
    });
  });

  describe('on paid team site', function() {
    let api: UserAPI;
    let docId: string;
    let session: gu.Session;

    before(async () => {
      session = await gu.session().teamSite.login();
      api = session.createHomeApi();
      docId = await session.tempNewDoc(cleanup, 'PaidTeamDoc');
    });

    it('does not show limit banners when new document is opened', testBannerNotShown);

    it('shows row usage on the raw data page', async function() {
      await driver.find('.test-tools-raw').click();

      // Check that the Usage section exists.
      await waitForDocUsage();
      assert.equal(await driver.find('.test-doc-usage-heading').getText(), 'Usage');
      await assertUsageMessage(null);

      // Check that usage is at 0.
      await assertRowCount('0');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');

      // Check that banners aren't shown on the raw data page.
      await gu.assertBannerText(null);
    });

    it('updates row usage when rows are added or removed', async function() {
      // Add 1,000 rows, and check that the row count updated.
      await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(1000, null), {}]]);
      await assertRowCount('1,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);

      // Add 4,000 rows to a different table, and check that row count updated.
      await api.applyUserActions(docId, [
        ['AddEmptyTable', null],
        ['BulkAddRecord', 'Table2', arrayRepeat(4000, null), {}]
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
      await api.applyUserActions(docId, [['RemoveTable', 'Table1']]);
      await assertRowCount('4,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await assertUsageMessage(null);
      await gu.assertBannerText(null);
    });

    it('does not show usage if user lacks permission to edit', async function() {
      // Share the document with everyone as a viewer.
      await api.updateDocPermissions(docId, {
        users: {'everyone@getgrist.com': 'viewers'},
      });

      // Log in as anon, and check that ussage is not shown.
      const rawDataPageUrl = await driver.getCurrentUrl();
      await gu.session().anon.login();
      await driver.get(rawDataPageUrl);
      await waitForDocUsage();
      await assertUsageAccessDenied();
      await gu.assertBannerText(null);

      // Switch back to the owner and make sure they can still see usage.
      await gu.session().user('user1').personalSite.login();
      await driver.get(rawDataPageUrl);
      await waitForDocUsage();
      await assertRowCount('4,000');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');
      await gu.assertBannerText(null);
    });

    it('updates data size usage over time', async function() {
      // Add 500 rows with some data in them.
      await api.applyUserActions(docId, [['BulkAddRecord', 'Table2', arrayRepeat(500, null), {
        'A': arrayRepeat(500, 'Some random data for testing that data size usage is working as intended.'),
        'B': arrayRepeat(500, 2500),
        'C': arrayRepeat(500, true),
      }]]);

      // Check that size usage is initially unchanged; it's computed on doc startup, and on interval
      // in the background, to minimize load.
      await assertRowCount('4,500');
      await assertDataSize('0.00');
      await assertAttachmentsSize('0.00');

      // Force the document to reload, and check that size usage updated.
      await api.getDocAPI(docId).forceReload();
      await waitForDocUsage();
      await assertDataSize('0.10');
      await assertAttachmentsSize('0.00');
    });

    it('updates attachments size usage when uploading attachments', async function() {
      // Add a new 'Attachments' column of type Attachment to Table2.
      await gu.getPageItem('Table2').click();
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
      await driver.findContentWait('.test-pw-counter', /of 9/, 4000);
      await driver.find('.test-modal-dialog .test-pw-close').click();
      await gu.waitForServer();

      // Navigate back to the raw data page, and check that attachments size updated.
      await driver.navigate().back();
      await waitForDocUsage();
      await assertDataSize('0.10');
      await assertAttachmentsSize('0.01');

      // Delete the 'Attachments' column; usage should not immediately update.
      await api.applyUserActions(docId, [['RemoveColumn', 'Table2', 'Attachments']]);
      await assertDataSize('0.10');
      await assertAttachmentsSize('0.01');

      // Remove unused attachments via API and check that size automatically updates to 0.
      const headers = {Authorization: `Bearer ${await api.fetchApiKey()}`};
      const url = server.getUrl(session.orgDomain, `/api/docs/${docId}`);
      await fetch(url + "/attachments/removeUnused?verifyfiles=1&expiredonly=0", {headers, method: "POST"});
      await assertDataSize('0.10');
      await assertAttachmentsSize('0.00');
    });
  });
});

async function testBannerNotShown() {
  await gu.assertBannerText(null);
}

async function testInitialUsageFreePlan() {
  await driver.find('.test-tools-raw').click();

  // Check that the Usage section exists.
  await waitForDocUsage();
  assert.equal(await driver.find('.test-doc-usage-heading').getText(), 'Usage');
  await assertUsageMessage(null);

  // Check that usage is at 0.
  await assertRowCount('0', '5,000');
  await assertDataSize('0.00', '10.00');
  await assertAttachmentsSize('0.00', '1.00');

  // Check that banners aren't shown on the raw data page.
  await gu.assertBannerText(null);
}

async function testDataSizeUpdatesFreePlan(api: UserAPI, docId: string) {
  // Add 500 rows with some data in them.
  await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(500, null), {
    'A': arrayRepeat(500, 'Some random data for testing that data size usage is working as intended.'),
    'B': arrayRepeat(500, 2500),
    'C': arrayRepeat(500, true),
  }]]);

  // Check that size usage is initially unchanged; it's computed on doc startup, and on interval
  // in the background, to minimize load.
  await assertRowCount('500', '5,000');
  await assertDataSize('0.00', '10.00');
  await assertAttachmentsSize('0.00', '1.00');

  // Force the document to reload, and check that size usage updated.
  await api.getDocAPI(docId).forceReload();
  await waitForDocUsage();
  await assertDataSize('0.04', '10.00');
  await assertAttachmentsSize('0.00', '1.00');
}

async function testAttachmentsSizeUpdatesFreePlan(api: UserAPI, docId: string) {
  // Add a new 'Attachments' column of type Attachment to Table1.
  await gu.getPageItem('Table1').click();
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
  await driver.findContentWait('.test-pw-counter', /of 9/, 4000);
  await driver.find('.test-modal-dialog .test-pw-close').click();
  await gu.waitForServer();

  // Navigate back to the raw data page, and check that attachments size updated.
  await driver.navigate().back();
  await waitForDocUsage();
  await assertDataSize('0.04', '10.00');
  await assertAttachmentsSize('0.01', '1.00');

  // Delete the 'Attachments' column; usage should not immediately update.
  await api.applyUserActions(docId, [['RemoveColumn', 'Table1', 'Attachments']]);
  await assertDataSize('0.04', '10.00');
  await assertAttachmentsSize('0.01', '1.00');

  // Remove unused attachments via API and check that size automatically updates to 0.
  const headers = {Authorization: `Bearer ${await api.fetchApiKey()}`};
  const url = server.getUrl('docs', `/api/docs/${docId}`);
  await fetch(url + "/attachments/removeUnused?verifyfiles=0&expiredonly=0", {headers, method: "POST"});
  await assertDataSize('0.04', '10.00');
  await assertAttachmentsSize('0.00', '1.00');
}

async function testApproachingLimitBannerFreePlan(api: UserAPI, docId: string) {
  // Add 4,000 rows, and check that the row count updated.
  await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(4000, null), {}]]);
  await assertRowCount('4,500', '5,000');
  await gu.assertBannerText(null);
  await assertUsageMessage(null);

  // Add 1 more row (to a new table), and check that the banner is shown.
  await api.applyUserActions(docId, [
    ['AddEmptyTable', null],
    ['BulkAddRecord', 'Table2', arrayRepeat(1, null), {}]
  ]);
  await assertRowCount('4,501', '5,000');
  const expectedText = 'This document is approaching free plan limits. '
    + 'For higher limits, start your 30-day free trial of the Pro plan.';
  await gu.assertBannerText(expectedText);
  await assertUsageMessage(expectedText);
}

async function testGracePeriodBannerFreePlan(api: UserAPI, docId: string) {
  // Add 499 more rows, and check that the approaching limit banner is still shown.
  await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(499, null), {}]]);
  await assertRowCount('5,000', '5,000');
  const approachingText = 'This document is approaching free plan limits. '
    + 'For higher limits, start your 30-day free trial of the Pro plan.';
  await gu.assertBannerText(approachingText);
  await assertUsageMessage(approachingText);

  // Now add 2 more rows, and check that the grace period banner is shown.
  await api.applyUserActions(docId, [['BulkAddRecord', 'Table1', arrayRepeat(2, null), {}]]);
  await assertRowCount('5,002', '5,000');
  const gracePeriodText = 'Document limits exceeded. In 14 days, this document '
    + 'will be read-only. For higher limits, start your 30-day free trial of the Pro plan.';
  await gu.assertBannerText(gracePeriodText);
  await assertUsageMessage(gracePeriodText);

  // Set the grace period to 5 days ago, confirm only 9 days are remaining
  const db = await server.getDatabase();
  await db.setDocGracePeriodStart(docId, moment().subtract(5, 'days').toDate());
  await api.getDocAPI(docId).forceReload();
  await waitForDocUsage();
  const grace9PeriodText = 'Document limits exceeded. In 9 days, this document '
    + 'will be read-only. For higher limits, start your 30-day free trial of the Pro plan.';
  await gu.assertBannerText(grace9PeriodText);
  await assertUsageMessage(grace9PeriodText);
}

async function testDeleteOnlyBannerFreePlan(api: UserAPI, docId: string) {
  // Set the document's grace period start to a date outside the last 14 days.
  const db = await server.getDatabase();
  await db.setDocGracePeriodStart(docId, new Date(2021, 1, 1));

  // Reload the active document.
  await api.getDocAPI(docId).forceReload();
  await waitForDocUsage();

  // Check that the active document is now in delete-only mode.
  await assertRowCount('5,002', '5,000');
  const expectedText = 'This document exceeded free plan limits and is now read-only, '
    + 'but you can delete rows. For higher limits, start your 30-day free trial of the Pro plan.';
  await gu.assertBannerText(expectedText);
  await assertUsageMessage(expectedText);

  // Check that rows cannot be added.
  await gu.getPageItem('Table1').click();
  await gu.waitForServer();
  await gu.sendKeys(Key.chord(await gu.modKey(), Key.DOWN));
  await gu.getCell(0, 5002).click();
  await gu.sendKeys('Adding should be blocked', Key.ENTER);
  await gu.waitForServer();
  let toasts = await gu.getToasts();
  assert.match(toasts[0], /Document is in delete-only mode/);
  assert.equal(await gu.getGridRowCount(), 5002);

  // Check that rows cannot be edited.
  await gu.getCell(0, 5001).click();
  await gu.sendKeys('Editing should be blocked', Key.ENTER);
  await gu.waitForServer();
  toasts = await gu.getToasts();
  assert.match(toasts[0], /Document is in delete-only mode/);
  assert.deepEqual(await gu.getVisibleGridCells(0, [5001]), ['']);

  // Check that rows can be deleted.
  await gu.removeRow(5001);
  assert.equal(await gu.getGridRowCount(), 5001);

  // Navigate back to the Raw Data page.
  await driver.navigate().back();
  await waitForDocUsage();
}

async function testPublicVisitorsFreePlan(api: UserAPI, docId: string) {
  // Share the document with everyone as an editor.
  await api.updateDocPermissions(docId, {
    users: {'everyone@getgrist.com': 'editors'},
  });

  // Log in as anon, and check that the delete-only banner is not shown.
  const rawDataPageUrl = await driver.getCurrentUrl();
  await gu.session().anon.login();
  await driver.get(rawDataPageUrl);
  await waitForDocUsage();
  await assertUsageAccessDenied();
  await gu.assertBannerText(null);

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
}

async function testEditorsFreePlan(api: UserAPI, docId: string) {
  // Share the document with a user and grant them edit rights.
  const rawDataPageUrl = await driver.getCurrentUrl();
  const editorSession = await gu.session().user('user2').personalSite.login();
  await api.updateOrgPermissions('current', {
    users: {[editorSession.email]: 'editors'},
  });

  // Check that the grace period banner is shown.
  await driver.get(rawDataPageUrl);
  await waitForDocUsage();
  await assertRowCount('5,001', '5,000');
  await assertDataSize('0.10', '10.00');
  await assertAttachmentsSize('0.00', '1.00');
  const gracePeriodText = 'Document limits exceeded. In 14 days, this document will be read-only.'
    + ' Contact the site owner to upgrade the plan to raise limits.';
  await gu.assertBannerText(gracePeriodText);
  await assertUsageMessage(gracePeriodText);

  // Delete a few rows, putting the document in "approaching limit" mode. Check that a
  // banner is still shown.
  await api.applyUserActions(docId, [['BulkRemoveRecord', 'Table1', [4, 5, 6]]]);
  await assertRowCount('4,998', '5,000');
  await assertDataSize('0.10', '10.00');
  await assertAttachmentsSize('0.00', '1.00');
  const approachingLimitText = 'This document is approaching free plan limits.'
    + ' Contact the site owner to upgrade the plan to raise limits.';
  await gu.assertBannerText(approachingLimitText);
  await assertUsageMessage(approachingLimitText);
}

async function blockTable2(api: UserAPI, docId: string) {
  await api.applyUserActions(docId, [
    ['AddRecord', '_grist_ACLResources', 2, {tableId: 'Table2', colIds: '*'}],
    ['AddRecord', '_grist_ACLRules', null, {
      resource: 2, aclFormula: 'user.Access != "owners"', permissionsText: '-R',
    }],
  ]);
}

async function hideTable2(api: UserAPI, docId: string) {
  await api.applyUserActions(docId, [
    ['AddRecord', '_grist_ACLRules', null, {
      resource: 2, aclFormula: 'True', permissionsText: '-R',
    }],
  ]);
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
  assert.notEqual(await driver.findWait('.test-doc-usage-message-text', 2000).getText(), USAGE_ACCESS_DENIED_TEXT);
  assert.isTrue(await driver.find('.test-doc-usage-metrics').isPresent());
}

async function assertRowCount(currentValue: string, maximumValue?: string) {
  await gu.waitToPass(async () => {
    assert.equal(
      await driver.find('.test-doc-usage-rows .test-doc-usage-value').getText(),
      maximumValue ? `${currentValue} of ${maximumValue} rows` : `${currentValue} rows`,
    );
  });
}

async function assertDataSize(currentValue: string, maximumValue?: string) {
  await gu.waitToPass(async () => {
    assert.equal(
      await driver.find('.test-doc-usage-data-size .test-doc-usage-value').getText(),
      maximumValue ? `${currentValue} of ${maximumValue} MB` : `${currentValue} MB`,
    );
  });
}

async function assertAttachmentsSize(currentValue: string, maximumValue?: string) {
  await gu.waitToPass(async () => {
    assert.equal(
      await driver.find('.test-doc-usage-attachments-size .test-doc-usage-value').getText(),
      maximumValue ? `${currentValue} of ${maximumValue} GB` : `${currentValue} GB`,
    );
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
