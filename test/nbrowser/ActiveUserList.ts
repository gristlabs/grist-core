import {UserAPI} from 'app/common/UserAPI';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';

import {assert} from 'chai';
import {driver, Key} from 'mocha-webdriver';

interface Window {
  user: gu.TestUser,
  handle: string;
}

const UserOwner: gu.TestUser = 'user1';
const User2: gu.TestUser = 'user2';
const User3: gu.TestUser = 'user3';
const USER_PRESENCE_MAX_USERS = 6;

describe('ActiveUserList', async function() {
  this.timeout('120s');
  let envSnapshot: EnvironmentSnapshot;
  let extraWindows: Window[] = [];

  // Needs to be registered before 'setupTestSuite' to ensure windows are closed before its afterAll hook
  after(async () => {
    for (const window of extraWindows) {
      await closeWindow(window);
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
      user: UserOwner,
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

  it('does not show a remaining users icon at 4 users', async function() {
    const desiredUsers = 4;
    const windowsToOpen = desiredUsers - extraWindows.length;
    for (let i = 0; i < windowsToOpen; i++) {
      await openDocWindowWithUser(docId, User3);
    }
    await switchToWindow(mainWindow);
    await gu.waitToPass(async () => {
      const userIcons = await driver.findAll('.test-aul-container .test-aul-user-icon');
      assert.equal(userIcons.length, 4);
      assert.isFalse(await driver.find('.test-aul-all-users-button').isPresent());
    }, 5000);
  });

  it('shows a remaining users icon at 5 users', async function() {
    const desiredUsers = 5;
    const windowsToOpen = desiredUsers - extraWindows.length;
    for (let i = 0; i < windowsToOpen; i++) {
      await openDocWindowWithUser(docId, User3);
    }
    await switchToWindow(mainWindow);
    await gu.waitToPass(async () => {
      const userIcons = await driver.findAll('.test-aul-container .test-aul-user-icon');
      assert.equal(userIcons.length, 3);
      assert.equal(await driver.find('.test-aul-all-users-button').getText(), '+2');
    }, 5000);
  });

  it('shows a list of all users when button is clicked', async function() {
    await driver.find('.test-aul-all-users-button').click();
    const menuItemTexts = await gu.findOpenMenuAllItems(
      '.test-aul-user-name', async (item) => item.getText()
    );
    assert.equal(menuItemTexts.length, 5, 'wrong number of users in user list');
    // There should be several copies of Kiwi here, but I don't think counting them improves anything
    assert.includeMembers(menuItemTexts, [gu.translateUser(User2).name, gu.translateUser(User3).name]);

    let iconVisibility = await driver.findAll('.test-aul-container .test-aul-user-icon', (el) => el.isDisplayed());
    assert.isTrue(iconVisibility.every(visible => visible === false));
    await gu.sendKeys(Key.ESCAPE);
    iconVisibility = await driver.findAll('.test-aul-container .test-aul-user-icon', (el) => el.isDisplayed());
    assert.isTrue(iconVisibility.every(visible => visible === true));
  });

  it('keeps the user list open when a new user appears', async function() {
    await driver.find('.test-aul-all-users-button').click();
    const getMenuItems = async () =>  await gu.findOpenMenuAllItems(
        '.test-aul-user-name', async (item) => item
    );
    await driver.switchTo().window(mainWindow.handle);
    const currentMenuItemCount = (await getMenuItems()).length;
    assert(currentMenuItemCount > 0, "menu does not exist");

    await openDocWindowWithUser(docId, User3);
    await driver.switchTo().window(mainWindow.handle);

    await gu.waitToPass(async () => {
      const menuItems = await getMenuItems();
      assert.equal(menuItems.length, currentMenuItemCount + 1, "incorrect number of users in list");
    }, 35000);

    await driver.sleep(5000);
  });

  it('enforces max users displayed', async function() {
    // Open enough windows to exceed USER_PRESENCE_MAX_USERS
    const windowsToOpen = (USER_PRESENCE_MAX_USERS - extraWindows.length) + 3;
    for (let i = 0; i < windowsToOpen; i++) {
      await openDocWindowWithUser(docId, User3);
    }
    await driver.switchTo().window(mainWindow.handle);
    const menuItems = await gu.findOpenMenuAllItems('.test-aul-user-name', async (item) => item);
    assert.equal(menuItems.length, USER_PRESENCE_MAX_USERS, 'max users not enforced');
  });

  async function openDocWindowWithUser(docId: string, user: gu.TestUser): Promise<Window> {
    await driver.switchTo().newWindow('tab');
    const session = await gu.session().user(user).teamSite.addLogin();
    await session.loadDoc(`/${docId}`);
    const window = {
      user,
      handle: await driver.getWindowHandle(),
    };
    let windowList = windowsByUser.get(user);
    if (!windowList) {
      windowList = [];
      windowsByUser.set(user, windowList);
    }
    windowList.push(window);
    extraWindows.push(window);
    return window;
  }

  async function closeWindow(window: Window) {
    const currentWindow = await driver.getWindowHandle();
    await driver.switchTo().window(window.handle);
    await driver.close();
    // Remove window from window lists
    const userWindowList = windowsByUser.get(window.user) ?? [];
    windowsByUser.set(window.user, userWindowList.filter(w => w !== window));
    extraWindows = extraWindows.filter(w => w !== window);

    if (currentWindow !== window.handle) {
      await driver.switchTo().window(currentWindow);
    } else {
      await driver.switchTo().window(mainWindow.handle);
    }
  }
});

async function switchToWindow(window: Window): Promise<void> {
  await driver.switchTo().window(window.handle);
}
