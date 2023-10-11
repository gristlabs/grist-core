import {DocCreationInfo} from 'app/common/DocListAPI';
import {DocAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';

describe('WebhookPage', function () {
  this.timeout(60000);
  const cleanup = setupTestSuite();
  const clipboard = gu.getLockableClipboard();

  let session: gu.Session;
  let oldEnv: EnvironmentSnapshot;
  let docApi: DocAPI;
  let doc: DocCreationInfo;
  let host: string;

  before(async function () {
    oldEnv = new EnvironmentSnapshot();
    host = new URL(server.getHost()).host;
    process.env.ALLOWED_WEBHOOK_DOMAINS = '*';
    await server.restart();
    session = await gu.session().teamSite.login();
    const api = session.createHomeApi();
    doc = await session.tempDoc(cleanup, 'Hello.grist');
    docApi = api.getDocAPI(doc.id);
    await api.applyUserActions(doc.id, [
      ['AddTable', 'Table2', [{id: 'A'}, {id: 'B'}, {id: 'C'}, {id: 'D'}, {id: 'E'}]],
    ]);
    await api.applyUserActions(doc.id, [
      ['AddTable', 'Table3', [{id: 'A'}, {id: 'B'}, {id: 'C'}, {id: 'D'}, {id: 'E'}]],
    ]);
    await api.updateDocPermissions(doc.id, {
      users: {
        // for convenience, we'll be sending payloads to the document itself.
        'anon@getgrist.com': 'editors',
        // check another owner's perspective.
        [gu.session().user('user2').email]: 'owners',
      }
    });
  });

  after(async function () {
    oldEnv.restore();
  });

  it('starts with an empty card', async function () {
    await openWebhookPage();
    assert.equal(await gu.getCardListCount(), 1);  // includes empty card
    assert.sameDeepMembers(await gu.getCardFieldLabels(), [
      'Name',
      'Memo',
      'Event Types',
      'URL',
      'Table',
      'Ready Column',
      'Webhook Id',
      'Enabled',
      'Status',
    ]);
  });

  it('can create a persistent webhook', async function () {
    // Set up a webhook for Table1, and send it to Table2 (for ease of testing).
    await openWebhookPage();
    await setField(1, 'Event Types', 'add\nupdate\n');
    await setField(1, 'URL', `http://${host}/api/docs/${doc.id}/tables/Table2/records?flat=1`);
    await setField(1, 'Table', 'Table1');
    // Once event types, URL, and table are set, the webhook is created.
    // Up until that point, nothing we've entered is actually persisted,
    // there is no back end for it.
    await gu.waitToPass(async () => {
      assert.include(await getField(1, 'Webhook Id'), '-');
    });
    const id = await getField(1, 'Webhook Id');
    // Reload and make sure the webhook id is still there.
    await driver.navigate().refresh();
    await waitForWebhookPage();
    await gu.waitToPass(async () => {
      assert.equal(await getField(1, 'Webhook Id'), id);
    });
    // Now other fields like name and memo are persisted.
    await setField(1, 'Name', 'Test Webhook');
    await setField(1, 'Memo', 'Test Memo');
    await gu.waitForServer();
    await driver.navigate().refresh();
    await waitForWebhookPage();
    await gu.waitToPass(async () => {
      assert.equal(await getField(1, 'Name'), 'Test Webhook');
      assert.equal(await getField(1, 'Memo'), 'Test Memo');
    });
    // Make sure the webhook is actually working.
    await docApi.addRows('Table1', {A: ['zig'], B: ['zag']});
    // Make sure the data gets delivered, and that the webhook status is updated.
    await gu.waitToPass(async () => {
      assert.lengthOf((await docApi.getRows('Table2')).A, 1);
      assert.equal((await docApi.getRows('Table2')).A[0], 'zig');
      assert.match(await getField(1, 'Status'), /status...success/);
    });
    // Remove the webhook and make sure it is no longer listed.
    assert.equal(await gu.getCardListCount(), 2);
    await gu.getDetailCell({col: 'Name', rowNum: 1}).click();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm(true, true);
    await gu.waitForServer();
    assert.equal(await gu.getCardListCount(), 1);
    await driver.navigate().refresh();
    await waitForWebhookPage();
    assert.equal(await gu.getCardListCount(), 1);
    await docApi.removeRows('Table2', [1]);
    assert.lengthOf((await docApi.getRows('Table2')).A, 0);
  });

  it('can create two webhooks', async function () {
    await openWebhookPage();
    await setField(1, 'Event Types', 'add\nupdate\n');
    await setField(1, 'URL', `http://${host}/api/docs/${doc.id}/tables/Table2/records?flat=1`);
    await setField(1, 'Table', 'Table1');
    await gu.waitForServer();
    await setField(2, 'Event Types', 'add\n');
    await setField(2, 'URL', `http://${host}/api/docs/${doc.id}/tables/Table3/records?flat=1`);
    await setField(2, 'Table', 'Table1');
    await gu.waitForServer();
    await docApi.addRows('Table1', {A: ['zig2'], B: ['zag2']});
    await gu.waitToPass(async () => {
      assert.lengthOf((await docApi.getRows('Table2')).A, 1);
      assert.lengthOf((await docApi.getRows('Table3')).A, 1);
      assert.match(await getField(1, 'Status'), /status...success/);
      assert.match(await getField(2, 'Status'), /status...success/);
    });
    await docApi.updateRows('Table1', {id: [1], A: ['zig3'], B: ['zag3']});
    await gu.waitToPass(async () => {
      assert.lengthOf((await docApi.getRows('Table2')).A, 2);
      assert.lengthOf((await docApi.getRows('Table3')).A, 1);
      assert.match(await getField(1, 'Status'), /status...success/);
    });
    await driver.sleep(100);
    // confirm that nothing shows up to Table3.
    assert.lengthOf((await docApi.getRows('Table3')).A, 1);
    // Break everything down.
    await gu.getDetailCell({col: 'Name', rowNum: 1}).click();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm(true, true);
    await gu.waitForServer();
    await gu.getDetailCell({col: 'Memo', rowNum: 1}).click();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.waitForServer();
    assert.equal(await gu.getCardListCount(), 1);
    await driver.navigate().refresh();
    await waitForWebhookPage();
    assert.equal(await gu.getCardListCount(), 1);
    await docApi.removeRows('Table2', [1, 2]);
    await docApi.removeRows('Table3', [1]);
    assert.lengthOf((await docApi.getRows('Table2')).A, 0);
    assert.lengthOf((await docApi.getRows('Table3')).A, 0);
  });

  it('can create and repair a dud webhook', async function () {
    await openWebhookPage();
    await setField(1, 'Event Types', 'add\nupdate\n');
    await setField(1, 'URL', `http://${host}/notathing`);
    await setField(1, 'Table', 'Table1');
    await gu.waitForServer();
    await docApi.addRows('Table1', {A: ['dud1']});
    await gu.waitToPass(async () => {
      assert.match(await getField(1, 'Status'), /status...failure/);
      assert.match(await getField(1, 'Status'), /numWaiting..1/);
    });
    await setField(1, 'URL', `http://${host}/api/docs/${doc.id}/tables/Table2/records?flat=1`);
    await driver.findContent('button', /Clear Queue/).click();
    await gu.waitForServer();
    await gu.waitToPass(async () => {
      assert.match(await getField(1, 'Status'), /numWaiting..0/);
    });
    assert.lengthOf((await docApi.getRows('Table2')).A, 0);
    await docApi.addRows('Table1', {A: ['dud2']});
    await gu.waitToPass(async () => {
      assert.lengthOf((await docApi.getRows('Table2')).A, 1);
      assert.match(await getField(1, 'Status'), /status...success/);
    });

    // Break everything down.
    await gu.getDetailCell({col: 'Name', rowNum: 1}).click();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm(true, true);
    await gu.waitForServer();
    await docApi.removeRows('Table2', [1]);
    assert.lengthOf((await docApi.getRows('Table2')).A, 0);
  });

  it('can keep multiple sessions in sync', async function () {
    await openWebhookPage();

    // Open another tab.
    await driver.executeScript("window.open('about:blank', '_blank')");
    const [ownerTab, owner2Tab] = await driver.getAllWindowHandles();

    await driver.switchTo().window(owner2Tab);
    const otherSession = await gu.session().teamSite.user('user2').login();
    await otherSession.loadDoc(`/doc/${doc.id}`);
    await openWebhookPage();
    await setField(1, 'Event Types', 'add\nupdate\n');
    await setField(1, 'URL', `http://${host}/multiple`);
    await setField(1, 'Table', 'Table1');
    await gu.waitForServer();
    await driver.switchTo().window(ownerTab);
    await gu.waitToPass(async () => {
      assert.match(await getField(1, 'URL'), /multiple/);
    });
    assert.equal(await gu.getCardListCount(), 2);
    await setField(1, 'Memo', 'multiple memo');
    await driver.switchTo().window(owner2Tab);
    await gu.waitToPass(async () => {
      assert.match(await getField(1, 'Memo'), /multiple memo/);
    });

    // Basic undo support.
    await driver.switchTo().window(ownerTab);
    await gu.undo();
    await gu.waitToPass(async () => {
      assert.equal(await getField(1, 'Memo'), '');
    });
    await driver.switchTo().window(owner2Tab);
    await gu.waitToPass(async () => {
      assert.equal(await getField(1, 'Memo'), '');
    });

    // Basic redo support.
    await driver.switchTo().window(ownerTab);
    await gu.redo();
    await gu.waitToPass(async () => {
      assert.match(await getField(1, 'Memo'), /multiple memo/);
    });
    await driver.switchTo().window(owner2Tab);
    await gu.waitToPass(async () => {
      assert.match(await getField(1, 'Memo'), /multiple memo/);
    });

    await gu.getDetailCell({col: 'Name', rowNum: 1}).click();
    await gu.sendKeys(Key.chord(await gu.modKey(), Key.DELETE));
    await gu.confirm(true, true);
    await driver.switchTo().window(ownerTab);
    await gu.waitToPass(async () => {
      assert.equal(await gu.getCardListCount(), 1);
    });
    await driver.switchTo().window(owner2Tab);
    await driver.close();
    await driver.switchTo().window(ownerTab);
  });

  /**
   * Checks that a particular route to modifying cells in a virtual table
   * is in place (previously it was not).
   */
  it('can paste into a cell without clicking into it', async function() {
    await openWebhookPage();
    await setField(1, 'Name', '1234');
    await gu.waitForServer();
    await clipboard.lockAndPerform(async (cb) => {
      await cb.copy();
      await gu.getDetailCell({col: 'Memo', rowNum: 1}).click();
      await cb.paste();
    });
    await gu.waitForServer();
    assert.equal(await getField(1, 'Memo'), '1234');
  });
});

async function setField(rowNum: number, col: string, text: string) {
  await gu.getDetailCell({col, rowNum}).click();
  await gu.enterCell(text);
}

async function getField(rowNum: number, col: string) {
  const cell = await gu.getDetailCell({col, rowNum});
  return cell.getText();
}

async function openWebhookPage() {
  await gu.openDocumentSettings();
  const button = await driver.findContentWait('a', /Manage Webhooks/, 3000);
  await gu.scrollIntoView(button).click();
  await waitForWebhookPage();
}

async function waitForWebhookPage() {
  await driver.findContentWait('button', /Clear Queue/, 3000);
  // No section, so no easy utility for setting focus. Click on a random cell.
  await gu.getDetailCell({col: 'Webhook Id', rowNum: 1}).click();
}
