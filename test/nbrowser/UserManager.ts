import { setupTestSuite } from 'test/nbrowser/testUtils'; import * as gu from 'test/nbrowser/gristUtils';
import { UserAPIImpl } from 'app/common/UserAPI';

import { assert } from 'chai';
import { Key } from 'selenium-webdriver';
import axios from 'axios';

describe('UserManager', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  let docId: string;
  let api: UserAPIImpl;

  before(async function () {
    // Import a test document we've set up for this.
    const mainSession = await gu.session().teamSite.user('user1').login();
    docId = (await mainSession.tempDoc(cleanup, 'World.grist', {load: false})).id;
    // Share it with a few users.
    api = mainSession.createHomeApi();
    await mainSession.loadDoc(`/doc/${docId}`);
  });

  async function checkAnonymousAccess() {
    return await axios.get(api.getDocAPI(docId).getBaseUrl(), {
      responseType: 'json',
    });
  }

  async function findUserAndGetRole(userEmail: string, options?: {invited: boolean}) {
    // await gu.currentDriver().sleep(60_000);
    const emailElementSelector = options?.invited ? '.test-um-member-name' : '.test-um-member-email';

    const userElement = await gu.currentDriver().findContentWait(emailElementSelector, userEmail, 5000);
    return userElement.findClosest(".test-um-member").findWait(".test-um-member-role", 5000).getText();
  }

  afterEach(async function () {
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: null,
      [gu.translateUser("user3").email]: null,
      [gu.translateUser("everyone").email]: null,
    } });
  });

  it('should give access users to documents', async function () {
    const driver = gu.currentDriver();
    const user1 = gu.translateUser('user1');
    const user2 = gu.translateUser('user2');
    const user3 = gu.translateUser('user3');
    const { orgDomain } = gu.session().teamSite;
    const user2Api = gu.createHomeApi(user2.name, orgDomain, user2.email);
    const user3Api = gu.createHomeApi(user3.name, orgDomain, user3.email);

    await assert.isRejected(user2Api.getDoc(docId));
    await assert.isRejected(user3Api.getDoc(docId));

    await gu.addUser(user2.email, 'Editor', 'document');
    await gu.addUser(user3.email, 'Viewer', 'document');
    await gu.editDocAcls();

    assert.include(await findUserAndGetRole(user1.email), 'Owner');
    assert.include(await findUserAndGetRole(user2.email, {invited: true}), 'Editor');
    assert.include(await findUserAndGetRole(user3.email, {invited: true}), 'Viewer');

    await driver.sendKeys(Key.ESCAPE);
    await driver.wait(async () => !await driver.find('.test-um-members').isPresent(), 500);
  });

  it('should give access publicly with a confirmation dialog', async function () {
    const driver = gu.currentDriver();
    await assert.isRejected(checkAnonymousAccess());

    const changePublicAccess = async (value: string) => {
      await gu.editDocAcls();
      await driver.find('.test-um-public-access').click();
      await driver.findContentWait('.test-um-public-option', value, 1000).click();
      await driver.find(".test-um-confirm").click();
    };

    const waitForUserModalToDisappear = async ()  => {
      await driver.wait(async () => !await driver.find('.test-um-members').isPresent(), 500);
    };

    await changePublicAccess('On');
    await driver.findWait(".test-modal-dialog", 1000);
    assert.include(await driver.find(".test-modal-title").getText(), 'sharing publicly');

    await driver.find('.test-modal-confirm').click();
    await waitForUserModalToDisappear();

    await assert.isFulfilled(checkAnonymousAccess());

    await changePublicAccess('Off');
    await waitForUserModalToDisappear();
    await assert.isRejected(checkAnonymousAccess());
  });
});
