import {UserAPI} from 'app/common/UserAPI';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';

import {assert} from 'chai';
import {driver} from 'mocha-webdriver';

interface Window {
  handle: string;
}

const UserOwner: gu.TestUser = 'user1';
const User2: gu.TestUser = 'user2';
const User3: gu.TestUser = 'user3';
const USER_PRESENCE_MAX_USERS = 6;

describe('ActiveUserList', async function() {
  this.timeout('120s');
  let envSnapshot: EnvironmentSnapshot;
  const extraWindowHandles: string[] = [];

  // Needs to be registered before 'setupTestSuite' to ensure windows are closed before its afterAll hook
  after(async () => {
    for (const handle of extraWindowHandles) {
      await driver.switchTo().window(handle);
      await driver.close();
    }
    // Makes sure the correct window is selected for the cleanup scripts in setupTestSuite
    await switchToWindow(mainWindow);
    envSnapshot.restore();
  });

  const cleanup = setupTestSuite();
  let mainWindow: Window;
  let docId: string;
  let ownerSession: gu.Session;
  let ownerApi: UserAPI;
  const windowsByUser: Map<gu.TestUser, Window[]> = new Map();

  before(async () => {
    envSnapshot = new EnvironmentSnapshot();
    process.env.GRIST_ENABLE_USER_PRESENCE = 'true';
    process.env.GRIST_USER_PRESENCE_MAX_USERS = USER_PRESENCE_MAX_USERS.toFixed(0);
    // Allows the same user to have many user presence sessions - needed to make enough icons show.
    process.env.GRIST_USER_PRESENCE_ICON_PER_TAB = 'true';
    await server.restart();

    mainWindow = {
      handle: await driver.getWindowHandle(),
    };

    ownerSession = await gu.session().user(UserOwner).teamSite.login();
    ownerApi = ownerSession.createHomeApi();

    docId = await ownerSession.tempNewDoc(cleanup, 'ActiveUserList');
    await ownerApi.updateDocPermissions(docId, {
      users: {
        [gu.translateUser(User2).email]: "editors",
        [gu.translateUser(User3).email]: "viewers",
      }
    });

    await openDocWindowWithUser(docId, User2);
    await openDocWindowWithUser(docId, User3);
    await switchToWindow(mainWindow);
  });

  it('shows other active users', async function() {
    // Wait ensures presence icons have time to load
    await gu.waitToPass(async () => {
      const userIcons = await driver.findAll('.test-aul-container .test-aul-user-icon');
      assert.equal(userIcons.length, 2);
    }, 5000);
  });

  it('shows name and email on hover', async function() {
    await driver.find('.test-aul-container .test-aul-user-icon').mouseMove();
    const tooltipText = await driver.findWait('.test-tooltip', 1000).getText();
    const user = gu.translateUser(User3);
    assert.include(tooltipText, user.name, 'name not in tooltip');
    assert.include(tooltipText, user.email, 'email not in tooltip');
  });

  it('shows a remaining users icon with many users', async function() {
    // Ensure we have at least the max users open
    for (let i = 0; i < USER_PRESENCE_MAX_USERS; i++) {
      await openDocWindowWithUser(docId, User3);
    }
    await switchToWindow(mainWindow);
    await driver.findWait('.test-aul-all-users-button', 2000);
  });

  it('shows a list of all users when button is clicked', async function() {
    await driver.find('.test-aul-all-users-button').click();
    const menuItemTexts = await gu.findOpenMenuAllItems(
      '.test-aul-user-name', async (item) => item.getText()
    );
    assert.isFalse(menuItemTexts.length < USER_PRESENCE_MAX_USERS, 'not all users in user list');
    assert.isFalse(menuItemTexts.length > USER_PRESENCE_MAX_USERS, 'max users not enforced');
    // There should be several copies of Kiwi here, but I don't think counting them improves anything
    assert.includeMembers(menuItemTexts, [gu.translateUser(User2).name, gu.translateUser(User3).name]);
  });

  async function openDocWindowWithUser(docId: string, user: gu.TestUser): Promise<Window> {
    await driver.switchTo().newWindow('tab');
    const session = await gu.session().user(user).teamSite.addLogin();
    await session.loadDoc(`/${docId}`);
    const window = {
      handle: await driver.getWindowHandle(),
    };
    let windowList = windowsByUser.get(user);
    if (!windowList) {
      windowList = [];
      windowsByUser.set(user, windowList);
    }
    windowList.push(window);
    extraWindowHandles.push(window.handle);
    return window;
  }
});

async function switchToWindow(window: Window): Promise<void> {
  await driver.switchTo().window(window.handle);
}
