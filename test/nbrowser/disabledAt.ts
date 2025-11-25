import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';

describe('disabledAt', function() {
  this.timeout(60000);

  let oldEnv: EnvironmentSnapshot;
  const cleanup = setupTestSuite({team: true});

  let ownerSession: gu.Session;
  let adminSession: gu.Session;

  const team = gu.session().teamSite;

  let ownerApi: UserAPI;
  let adminApi: UserAPI;

  let docId: string;
  let wsId: number;


  before(async function() {
    oldEnv = new EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = gu.translateUser('support').email;
    await server.restart(false);

    ownerSession = await team.user('user1').login();
    adminSession = await team.user('support').login();
    ownerApi = ownerSession.createHomeApi();
    adminApi = adminSession.createHomeApi();

    wsId = await ownerSession.tempWorkspace(cleanup, 'owner-ws');

    const doc = await ownerSession.tempDoc(cleanup, 'Hello.grist', {load: false});
    await ownerSession.tempDoc(cleanup, 'Widgets.grist', {load: false}); // second doc not used further
    docId = doc.id;

    const docInfo = await ownerApi.getDoc(docId);
    assert.equal(docInfo.id, docId, 'owner should have access to created doc');
  });

  after(async function() {
    oldEnv.restore();
    await server.restart(true);
  });

  it('prevents non-admin from disabling a document via API', async function() {
    await assert.isRejected(ownerApi.disableDoc(docId), /Access denied/);
  });

  it('lets admin disable a document via API', async function() {
    await adminApi.disableDoc(docId);
    assert.typeOf((await adminApi.getDoc(docId)).disabledAt, 'string');
  });

  it('blocks owner from moving, renaming, or accessing disabled doc', async function() {
    await assert403(ownerApi.moveDoc(docId, wsId));
    await assert403(ownerApi.renameDoc(docId, 'A rose by any other name'));
    await assert403(ownerApi.getDocAPI(docId).getRecords('Table1'));
    await assert403((await ownerApi.getWorkerAPI(docId)).downloadDoc(docId));
  });

  it('should remove some UI on disabled doc in DocList UI for owner', async function() {
    await ownerSession.loadDocMenu('/');
    await driver.findWait('.test-component-tabs-list', 5000);

    const entries = await driver.findAll('.test-dm-doc');
    assert.equal(entries.length, 4, 'All docs should still be visible');
    const enabledDoc = entries[0];
    const disabledDoc = entries[1];

    assert.isFalse(await enabledDoc.matches('[class*=-no-access]'),
      'Enabled doc should not have -no-access css class');
    assert.isTrue(await disabledDoc.matches('[class*=-no-access]'),
      'Disabled doc should have -no-access css class');

    await enabledDoc.findWait('.test-dm-doc-options', 500).click();
    assert.isFalse(await gu.findOpenMenuItem('li', /Move/).matches('[class*=disabled]'));
    assert.isFalse(await gu.findOpenMenuItem('li', /Rename/).matches('[class*=disabled]'));
    assert.isFalse(await gu.findOpenMenuItem('li', /Download/).matches('[class*=disabled]'));
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();

    await disabledDoc.findWait('.test-dm-doc-options', 500).click();
    assert.isTrue(await gu.findOpenMenuItem('li', /Move/).matches('[class*=disabled]'));
    assert.isTrue(await gu.findOpenMenuItem('li', /Rename/).matches('[class*=disabled]'));
    assert.isTrue(await gu.findOpenMenuItem('li', /Download/).matches('[class*=disabled]'));
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();
  });


  it('allows owner to soft-delete and undelete disabled doc', async function() {
    await ownerApi.softDeleteDoc(docId);
    await assert.isRejected(ownerApi.getDoc(docId), /not found/);

    await ownerApi.undeleteDoc(docId);
    const doc = await ownerApi.getDoc(docId);
    assert.isUndefined(doc.removedAt);
  });


  it('prevents non-admin from enabling the document via API', async function() {
    await assert.isRejected(ownerApi.enableDoc(docId), /Access denied/);
  });


  it('lets admin enable the document via API', async function() {
    await adminApi.enableDoc(docId);
    const doc = await adminApi.getDoc(docId);
    assert.isUndefined(doc.disabledAt);
  });


  it('lets owner access and rename re-enabled document and see it in DocList', async function() {
    const docApi = ownerApi.getDocAPI(docId);
    await assert.isFulfilled(docApi.getRecords('Table1'));
    await assert.isFulfilled(ownerApi.renameDoc(docId, 'A rose by any other name'));
    await assert.isFulfilled((await ownerApi.getWorkerAPI(docId)).downloadDoc(docId));

    await ownerSession.loadDocMenu('/');
    const reEnabledDoc = await driver.find('.test-dm-doc');
    await reEnabledDoc.findWait('.test-dm-doc-options', 500).click();
    assert.isFalse(await gu.findOpenMenuItem('li', /Move/).matches('[class*=disabled]'));
    assert.isFalse(await gu.findOpenMenuItem('li', /Rename/).matches('[class*=disabled]'));
    assert.isFalse(await gu.findOpenMenuItem('li', /Download/).matches('[class*=disabled]'));
    await gu.sendKeys(Key.ESCAPE);
    await gu.waitForMenuToClose();

    const titleText = await reEnabledDoc.findWait('.test-dm-doc-name', 500).getText();
    assert.include(titleText, 'A rose by any other name');
  });
});

async function assert403<T>(testPromise: Promise<T>) {
    let caughtErr: any = null;
    try {
      await testPromise;
    } catch (err: any) {
      caughtErr = err;
    }
    assert.equal(caughtErr?.status, 403);
}
