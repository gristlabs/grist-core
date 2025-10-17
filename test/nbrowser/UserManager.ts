import { setupTestSuite } from 'test/nbrowser/testUtils';
import * as gu from 'test/nbrowser/gristUtils';
import { UserAPIImpl } from 'app/common/UserAPI';

import { assert } from 'chai';

describe('UserManager', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();
  gu.withEnvironmentSnapshot({GRIST_WARN_BEFORE_SHARING_PUBLICLY: '1'});
  const user1 = gu.translateUser('user1');
  const user2 = gu.translateUser('user2');
  const user3 = gu.translateUser('user3');
  const anon = gu.translateUser('anon');
  let docId: string;
  let api: UserAPIImpl;

  async function findUserAndGetRole(userEmail: string) {
    const userElement = await gu.currentDriver().findContentWait(".test-um-member-email", userEmail, 5000);
    return userElement.findClosest(".test-um-member").findWait(".test-um-member-role", 5000).getText();
  }

  async function openDocAs(user: gu.UserData, options?: {wait: boolean}) {
    const mainSession = await gu.session().teamSite.user(user).login();
    return await mainSession.loadDoc(`/doc/${docId}`, options);
  }

  async function checkAccessDenied(user: gu.UserData) {
    await openDocAs(user, {wait: false});
    if (user.email === anon.email) {
      assert.include(await gu.currentDriver().getCurrentUrl(), '/test/login');
    } else {
      await gu.currentDriver().findContentWait('.test-error-header', 'Access denied', 1000);
    }
  }

  before(async function () {
    // Import a test document we've set up for this.
    const mainSession = await gu.session().teamSite.user('user1').login();
    docId = (await mainSession.tempDoc(cleanup, 'World.grist', {load: false})).id;
    // Share it with a few users.
    api = mainSession.createHomeApi();
  });

  afterEach(async function () {
    await api.updateDocPermissions(docId, { users: {
      [gu.translateUser("user2").email]: null,
      [gu.translateUser("user3").email]: null,
      [gu.translateUser("everyone").email]: null,
    } });
  });

  it('should give access users to documents', async function () {
    // Check user2 and user3 don't have access to the document as a prerequisite
    for (const user of [user2, user3]) {
      await checkAccessDenied(user);
    }
    await openDocAs(user1);

    // Give them access
    await gu.addUser(user2.email, 'Editor', 'document');
    await gu.addUser(user3.email, 'Viewer', 'document');

    // This time check these new members have access
    // NB: this will create the users in the app, do that before checking the content
    // of the modal below.
    for (const user of [user2, user3]) {
      await openDocAs(user, {wait: true});
    }
    await openDocAs(user1);

    // Check the content of the UserManager modal.
    await gu.editDocAcls();
    assert.include(await findUserAndGetRole(user1.email), 'Owner');
    assert.include(await findUserAndGetRole(user2.email), 'Editor');
    assert.include(await findUserAndGetRole(user3.email), 'Viewer');
  });

  it('should give access publicly with a confirmation dialog', async function () {
    const driver = gu.currentDriver();
    await checkAccessDenied(anon);
    await openDocAs(user1);

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

    await openDocAs(anon, {wait: true});
    await openDocAs(user1);

    await changePublicAccess('Off');
    await waitForUserModalToDisappear();
    await checkAccessDenied(anon);
  });
});
