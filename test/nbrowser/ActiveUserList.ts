import {UserAPI} from 'app/common/UserAPI';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

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
  const extraWindowHandles: string[] = [];

  // Needs to be registered before 'setupTestSuite' to ensure windows are closed before its afterAll hook
  after(async () => {
    for (const handle of extraWindowHandles) {
      await driver.switchTo().window(handle);
      await driver.close();
    }
    // Makes sure the correct window is selected for the cleanup scripts in setupTestSuite
    await switchToWindow(mainWindow);
  });

  const cleanup = setupTestSuite();
  let mainWindow: Window;
  let docId: string;
  let ownerSession: gu.Session;
  let ownerApi: UserAPI;
  const windowsByUser: Map<gu.TestUser, Window[]> = new Map();

  before(async () => {
    process.env.GRIST_ENABLE_USER_PRESENCE = 'true';
    process.env.GRIST_USER_PRESENCE_MAX_USERS = USER_PRESENCE_MAX_USERS.toFixed(0);
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

  it('shows name on hover', async function() {
    await driver.find('.test-aul-container .test-aul-user-icon').mouseMove();
    assert.equal(
      await driver.findWait('.test-tooltip', 1000).getText(),
      gu.translateUser(User3).name,
      'name tooltip not opened'
    );
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
      '.test-aul-user-list-user-name', async (item) => item.getText()
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

  /*
  async function openTrackedClientForUser() {
    const serverUrl = new URL(server.getHost());
    const client = await openClientForUser(serverUrl.port, 'chimpy', 'Chimpyland');
    clients.push(client);
    return client;
  }

  async function closeClient(client: GristClient) {
    if (client.ws.isOpen()) {
      await client.send("closeDoc", 0);
    }
    await client.close();
    clients = clients.filter(clientToTest => clientToTest !== client);
  }
  */
});

async function switchToWindow(window: Window): Promise<void> {
  await driver.switchTo().window(window.handle);
}
