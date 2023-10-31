import {DocCreationInfo} from 'app/common/DocListAPI';
import {DocAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';
import {WebhookFields} from "../../app/common/Triggers";

describe('WebhookOverflow', function () {
  this.timeout(30000);
  const cleanup = setupTestSuite();
  let session: gu.Session;
  let oldEnv: EnvironmentSnapshot;
  let doc: DocCreationInfo;
  let docApi: DocAPI;
  gu.bigScreen();

  before(async function () {
    oldEnv = new EnvironmentSnapshot();
    process.env.ALLOWED_WEBHOOK_DOMAINS = '*';
    process.env.GRIST_MAX_QUEUE_SIZE = '4';
    await server.restart();
    session = await gu.session().teamSite.login();
    const api = session.createHomeApi();
    doc = await session.tempDoc(cleanup, 'Hello.grist');
    docApi = api.getDocAPI(doc.id);
    await api.applyUserActions(doc.id, [
      ['AddTable', 'Table2', [{id: 'A'}, {id: 'B'}, {id: 'C'}, {id: 'D'}, {id: 'E'}]],
      ['AddRecord', 'Table2', null, {}],
    ]);
    const webhookDetails: WebhookFields = {
      url: 'https://localhost/WrongWebhook',
      eventTypes: ["update"],
      enabled: true,
      name: 'test webhook',
      tableId: 'Table2',
    };
    await docApi.addWebhook(webhookDetails);
    await docApi.addWebhook(webhookDetails);
  });

  after(async function () {
    oldEnv.restore();
    await server.restart();
  });

  async function enterCellWithoutWaitingOnServer(...keys: string[]) {
    const lastKey = keys[keys.length - 1];
    if (![Key.ENTER, Key.TAB, Key.DELETE].includes(lastKey)) {
      keys.push(Key.ENTER);
    }
    await driver.sendKeys(...keys);
  }

  async function getNumWaiting() {
    const cells = await gu.getVisibleDetailCells({col: 'Status', rowNums: [1, 2]});
    return cells.map((cell) => {
      const status = JSON.parse(cell.replace(/\n/g, ''));
      return status.numWaiting;
    });
  }

  async function overflowWebhook() {
    await gu.openPage('Table2');
    await gu.getCell('A', 1).click();
    await gu.enterCell(new Date().toString());
    await gu.getCell('B', 1).click();
    await enterCellWithoutWaitingOnServer(new Date().toString());
    await gu.waitToPass(async () => {
      const toast = await gu.getToasts();
      assert.include(toast, 'New changes are temporarily suspended. Webhooks queue overflowed.' +
        ' Please check webhooks settings, remove invalid webhooks, and clean the queue.\ngo to webhook settings');
    }, 4000);
  }

  async function overflowResolved() {
    await gu.waitForServer();
    await gu.waitToPass(async () => {
      const toast = await gu.getToasts();
      assert.notInclude(toast, 'New changes are temporarily suspended. Webhooks queue overflowed.' +
        ' Please check webhooks settings, remove invalid webhooks, and clean the queue.\ngo to webhook settings');
    }, 12500);
  }

  it('should show a message when overflowed', async function () {
    await overflowWebhook();
  });

  it('message should disappear after clearing queue', async function () {
    await openWebhookPageWithoutWaitForServer();
    assert.deepEqual(await getNumWaiting(), [2, 2]);
    await driver.findContent('button', /Clear Queue/).click();
    await overflowResolved();
    assert.deepEqual(await getNumWaiting(), [0, 0]);
  });

  it('should clear a single webhook queue when that webhook is disabled', async function () {
    await overflowWebhook();
    await openWebhookPageWithoutWaitForServer();
    await gu.waitToPass(async () => {
      assert.deepEqual(await getNumWaiting(), [2, 2]);
    }, 4000);
    await gu.getDetailCell({col: 'Enabled', rowNum: 1}).click();
    await overflowResolved();
    assert.deepEqual(await getNumWaiting(), [0, 2]);
  });
});

async function openWebhookPageWithoutWaitForServer() {
  await openDocumentSettings();
  const button = await driver.findContentWait('a', /Manage Webhooks/, 3000);
  await gu.scrollIntoView(button).click();
  await waitForWebhookPage();
}

async function waitForWebhookPage() {
  await driver.findContentWait('button', /Clear Queue/, 3000);
  // No section, so no easy utility for setting focus. Click on a random cell.
  await gu.getDetailCell({col: 'Webhook Id', rowNum: 1}).click();
}

export async function openAccountMenu() {
  await driver.findWait('.test-dm-account', 1000).click();
  // Since the AccountWidget loads orgs and the user data asynchronously, the menu
  // can expand itself causing the click to land on a wrong button.
  await driver.findWait('.test-site-switcher-org', 1000);
  await driver.sleep(250);  // There's still some jitter (scroll-bar? other user accounts?)
}

export async function openDocumentSettings() {
  await openAccountMenu();
  await driver.findContent('.grist-floating-menu a', 'Document Settings').click();
  await gu.waitForUrl(/settings/, 5000);
}
