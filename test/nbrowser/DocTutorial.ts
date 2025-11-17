import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DocTutorial', function () {
  this.timeout(60000);

  gu.bigScreen('big');

  let api: UserAPI;
  let ownerSession: gu.Session;
  let editorSession: gu.Session;
  let viewerSession: gu.Session;

  setupTestSuite({samples: true, tutorial: true, team: true});

  gu.withEnvironmentSnapshot({
    'GRIST_UI_FEATURES': 'tutorials',
    'GRIST_TEMPLATE_ORG': 'templates',
    'GRIST_ONBOARDING_TUTORIAL_DOC_ID': 'grist-basics',
  });

  before(async () => {
    ownerSession = await gu.session().customTeamSite('templates').user('support').login();
    api = ownerSession.createHomeApi();
    await api.updateDocPermissions('grist-basics', {users: {
      [gu.translateUser('user1').email]: 'editors',
    }});
  });

  describe('when logged out', function () {
    before(async () => {
      viewerSession = await gu.session().anon.login();
    });

    it('shows a tutorial card', async function() {
      await viewerSession.loadDocMenu('/');
      assert.isTrue(await driver.find('.test-intro-tutorial').isDisplayed());
      assert.equal(await driver.find('.test-intro-tutorial-percent-complete').getText(), '0%');
    });

    it('shows a link to tutorial', async function() {
      assert.isTrue(await driver.find('.test-dm-basic-tutorial').isDisplayed());
    });

    it('redirects user to log in', async function() {
      await driver.find('.test-dm-basic-tutorial').click();
      await gu.checkLoginPage();
    });
  });

  describe('when logged in', function () {
    let forkUrl: string;

    before(async () => {
      editorSession = await gu.session().customTeamSite('templates').user('user1').login({showTips: true});
      await editorSession.loadDocMenu('/');
      await driver.executeScript('resetDismissedPopups();');
      await gu.waitForServer();
    });

    afterEach(() => gu.checkForErrors());

    it('shows a tutorial card', async function() {
      assert.isTrue(await driver.find('.test-intro-tutorial').isDisplayed());
      await gu.waitToPass(async () =>
        assert.equal(await driver.find('.test-intro-tutorial-percent-complete').getText(), '0%'),
        2000
      );
    });

    it('creates a fork the first time the document is opened', async function() {
      await driver.find('.test-dm-basic-tutorial').click();
      await driver.wait(async () => {
        forkUrl = await driver.getCurrentUrl();
        return /~/.test(forkUrl);
      });
    });

    it('shows a popup containing slides generated from the GristDocTutorial table', async function() {
      assert.isTrue(await driver.findWait('.test-doc-tutorial-popup', 2000).isDisplayed());
      assert.equal(await driver.find('.test-doc-tutorial-popup-header').getText(), 'Grist Basics');
      assert.equal(
        await driver.findWait('.test-doc-tutorial-popup h1', 2000).getText(),
        'Intro'
      );
      assert.match(
        await driver.find('.test-doc-tutorial-popup').getText(),
        /Welcome to the Grist Basics tutorial/
      );
    });

    const move = async (pos: {x?: number, y?: number}) => driver.withActions((actions) => actions
      .move({origin: driver.find('.test-doc-tutorial-popup-move-handle')})
      .press()
      .move({origin: driver.find('.test-doc-tutorial-popup-move-handle'), ...pos})
      .release()
    );

    const resize = async (handle: string, pos: {x?: number; y?: number}) =>
      driver.withActions((actions) =>
        actions
          .move({
            origin: driver.find(
              `.test-doc-tutorial-popup .ui-resizable-${handle}`
            ),
          })
          .press()
          .move({
            origin: driver.find(`.test-doc-tutorial-popup .ui-resizable-${handle}`),
            ...pos,
          })
          .release()
      );

    it('can be moved around and minimized', async function() {
      // Get the initial position of the popup.
      const initialDims = await driver.find('.test-doc-tutorial-popup').getRect();

      // Move it a little bit down.
      await move({y: 100, x: -10});

      // Check it is moved but not shrinked.
      let dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.height, initialDims.height);
      // And moving down.
      assert.equal(dims.y, initialDims.y + 100);
      assert.equal(dims.x, initialDims.x - 10);

      // Now move it a little up and test it doesn't grow.
      await move({y: -100});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.height, initialDims.height);
      assert.equal(dims.y, initialDims.y);

      // Resize it in steps.
      await resize("n", {y: 10});
      await resize("n", {y: 10});
      await resize("n", {y: 10});
      await resize("n", {y: 10});
      await resize("n", {y: 10});
      await resize("n", {y: 50});

      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.height, initialDims.height - 100);
      assert.equal(dims.y, initialDims.y + 100);

      // Resize back (in steps, to simulate user actions)
      await resize("n", {y: -20});
      await resize("n", {y: -20});
      await resize("n", {y: -20});
      await resize("n", {y: -40});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.height, initialDims.height);
      assert.equal(dims.y, initialDims.y);

      // Now resize it to the minimum size.
      await resize("n", {y: 700});

      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.height, 300);

      // Get window inner size.
      const windowHeight: any = await driver.executeScript('return window.innerHeight');
      const windowWidth: any = await driver.executeScript('return window.innerWidth');
      assert.equal(dims.y + dims.height, windowHeight - 16);

      // Now we'll test moving the window outside the viewport. Selenium throws when
      // the mouse exceeds the bounds of the viewport, so we can't test every scenario.
      // Start by moving the window as low as possible.
      await move({y: windowHeight - dims.y - 32});

      // Make sure it is still visible.
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.y, windowHeight - 32); // 32px is a header size
      assert.isBelow(dims.x, windowWidth - (32 * 4) + 1); // 120px is the right overflow value.

      // Now move it to the right as far as possible.
      await move({x: windowWidth - dims.x - 10});

      // Make sure it is still visible.
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.y, windowHeight - 32);
      assert.equal(dims.x, windowWidth - (32 * 4) + (2 * 4));

      // Now move it to the left as far as possible.
      await move({x: -windowWidth + (32 * 4) - (2 * 4)});

      // Make sure it is still visible.
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.x, 0);
      assert.isAbove(dims.x + dims.width, 30);

      // Now move it to the top as far as possible.
      // Move it a little right, so that we don't end up on the logo. Driver is clicking logo sometimes.
      await move({y: -windowHeight + 16, x: 100});

      // Make sure it is still visible.
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.equal(dims.y, 16);
      assert.equal(dims.x, 100);
    });

    it('can be resized', async function() {
      await resize("sw", {x: 10, y: 10});
      let dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 110, y: 16, width: 426, height: 310});
      await resize("ne", {x: -5, y: -15});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 110, y: 16, width: 421, height: 310});
      await resize("se", {x: -25, y: -25});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 110, y: 16, width: 396, height: 300});
      await resize("s", {x: 25, y: 100});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 110, y: 16, width: 396, height: 400});
      await resize("se", {x: 50, y: 10});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 110, y: 16, width: 446, height: 410});
      await resize("w", {x: 25, y: 5});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 135, y: 16, width: 421, height: 410});
      await resize("w", {x: -25});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 110, y: 16, width: 446, height: 410});
      await resize("nw", {x: -5, y: -5});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 105, y: 16, width: 451, height: 410});
      await resize("ne", {x: 5, y: 5});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 105, y: 21, width: 456, height: 405});
      await resize("e", {x: 20, y: 20});
      dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 105, y: 21, width: 476, height: 405});
    });

    it('saves last open position and size', async function() {
      await move({x: -84, y: 200});
      const dims = await driver.find('.test-doc-tutorial-popup').getRect();
      assert.deepEqual(dims, {x: 21, y: 221, width: 476, height: 405});
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();
      assert.deepEqual(dims, await driver.find('.test-doc-tutorial-popup').getRect());
    });

    it('is visible on all pages', async function() {
      for (const page of ['access-rules', 'raw', 'code', 'settings']) {
        await driver.find(`.test-tools-${page}`).click();
        if (['access-rules', 'code'].includes(page)) { await gu.waitForServer(); }
        assert.isTrue(await driver.find('.test-doc-tutorial-popup').isDisplayed());
      }
    });

    it('does not break navigation via browser history', async function() {
      // Navigating via browser history was partially broken at one point; if you
      // started a tutorial, and wanted to leave via the browser's back button, you
      // couldn't.
      for (const page of ['code', 'data', 'acl']) {
        await driver.navigate().back();
        const currentUrl = await driver.getCurrentUrl();
        assert.match(currentUrl, new RegExp(`/p/${page}$`));
      }

      await driver.navigate().back();
      await driver.navigate().back();
      await driver.findWait('.test-dm-doclist', 2000);

      await driver.navigate().forward();
      await gu.waitForDocToLoad();
      assert.isTrue(await driver.findWait('.test-doc-tutorial-popup', 2000).isDisplayed());
    });

    it('shows the GristDocTutorial page and table to editors', async function() {
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2', 'GristDocTutorial']);
      await driver.find('.test-tools-raw').click();
      await driver.findWait('.test-raw-data-list', 1000);
      await gu.waitForServer();
      assert.isTrue(await driver.findContent('.test-raw-data-table-id',
        /GristDocTutorial/).isPresent());
    });

    it('does not show the GristDocTutorial page or table to non-editors', async function() {
      viewerSession = await gu.session().customTeamSite('templates').user('user2').login();
      await viewerSession.loadDoc(`/doc/grist-basics`);
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2']);
      await driver.find('.test-tools-raw').click();
      await driver.findWait('.test-raw-data-list', 1000);
      await gu.waitForServer();
      assert.isFalse(await driver.findContent('.test-raw-data-table-id',
        /GristDocTutorial/).isPresent());
    });

    it('does not show behavioral tips', async function() {
      await gu.openPage('Page 1');
      await gu.openAddWidgetToPage();
      assert.equal(await driver.find('.test-behavioral-prompt').isPresent(), false);
      await gu.sendKeys(Key.ESCAPE);
    });

    it('only allows users access to their own forks', async function() {
      await driver.navigate().to(forkUrl);
      assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
      await viewerSession.loadDoc(`/doc/grist-basics`);
      let otherForkUrl: string;
      await driver.wait(async () => {
        otherForkUrl = await driver.getCurrentUrl();
        return /~/.test(forkUrl);
      });
      editorSession = await gu.session().customTeamSite('templates').user('user1').login();
      await driver.navigate().to(otherForkUrl!);
      assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
      await driver.navigate().to(forkUrl);
      await gu.waitForDocToLoad();
    });

    it('supports navigating to the next or previous slide', async function() {
      await driver.findWait('.test-doc-tutorial-popup', 2000);
      assert.isTrue(await driver.findWait('.test-doc-tutorial-popup-next', 2000).isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-previous').isDisplayed());
      await driver.find('.test-doc-tutorial-popup-next').click();
      assert.equal(
        await driver.find('.test-doc-tutorial-popup h1').getText(),
        'Pages'
      );
      assert.equal(
        await driver.find('.test-doc-tutorial-popup h1 + p').getText(),
        'On the left-side panel is a list of pages, which are views of your data. ' +
          'Right now, there are two pages: Page 1 and Page 2. You are looking at Page 1.'
      );
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-next').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-previous').isDisplayed());

      await driver.find('.test-doc-tutorial-popup-previous').click();
      assert.equal(
        await driver.find('.test-doc-tutorial-popup h1').getText(),
        'Intro'
      );
      assert.match(
        await driver.find('.test-doc-tutorial-popup').getText(),
        /Welcome to the Grist Basics tutorial/
      );
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-next').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-previous').isDisplayed());
    });

    it('supports navigating to a specific slide', async function() {
      const slide3 = await driver.find('.test-doc-tutorial-popup-slide-3');
      await slide3.mouseMove();
      await gu.waitToPass(
        async () => assert.isTrue(await driver.find('.test-tooltip').isDisplayed()),
        500
      );
      assert.equal(await driver.find('.test-tooltip').getText(), 'Adding Columns and Rows');
      await slide3.click();
      await driver.find('.test-doc-tutorial-popup-slide-3').click();
      assert.equal(
        await driver.find('.test-doc-tutorial-popup h1').getText(),
        'Adding Columns and Rows'
      );
      assert.equal(
        await driver.find('.test-doc-tutorial-popup p').getText(),
        "Let's start with the basics of working with spreadsheet data — columns and rows."
      );

      const slide1 = await driver.find('.test-doc-tutorial-popup-slide-1');
      await slide1.mouseMove();
      await gu.waitToPass(
        async () => assert.isTrue(await driver.find('.test-tooltip').isDisplayed()),
        500
      );
      assert.equal(await driver.find('.test-tooltip').getText(), 'Intro');
      await slide1.click();
      assert.equal(
        await driver.find('.test-doc-tutorial-popup h1').getText(),
        'Intro'
      );
      assert.match(
        await driver.find('.test-doc-tutorial-popup').getText(),
        /Welcome to the Grist Basics tutorial/
      );
    });

    it('can open images in a lightbox', async function() {
      await driver.find('.test-doc-tutorial-popup img').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-lightbox').isDisplayed());
      assert.equal(
        await driver.find('.test-doc-tutorial-lightbox-image').getAttribute('src'),
        'https://www.getgrist.com/wp-content/uploads/2023/11/Row-1-Intro.png'
      );
      await driver.find('.test-doc-tutorial-lightbox-close').click();
      assert.isFalse(await driver.find('.test-doc-tutorial-lightbox').isPresent());
    });

    it('can be minimized and maximized by clicking a button in the header', async function() {
      await driver.find('.test-doc-tutorial-popup-minimize-maximize').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());

      await driver.find('.test-doc-tutorial-popup-minimize-maximize').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());
    });

    it('can be minimized and maximized by double clicking the header', async function() {
      await driver.withActions(a => a.doubleClick(driver.find('.test-doc-tutorial-popup-title')));
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());

      await driver.withActions(a => a.doubleClick(driver.find('.test-doc-tutorial-popup-title')));
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());
    });

    it('does not play an easter egg when opening an anchor link encoded with rr', async function() {
      await gu.getCell({rowNum: 1, col: 0}).click();
      const link = await gu.getAnchor();
      const easterEggLink = link.replace('.r1', '.rr1');
      await driver.get(easterEggLink);
      await gu.waitForAnchor();
      assert.isFalse(await driver.find('.test-behavioral-prompt').isPresent());
      await gu.assertIsRickRowing(false);
    });

    it('remembers the last slide the user had open', async function() {
      await driver.find('.test-doc-tutorial-popup-slide-3').click();
      // There's a 1000ms debounce in place when updating tutorial progress.
      await driver.sleep(1000 + 250);
      await gu.waitForServer();
      await driver.navigate().refresh();
      await gu.waitForDocToLoad();
      await driver.findWait('.test-doc-tutorial-popup', 2000);
      assert.equal(
        await driver.findWait('.test-doc-tutorial-popup h1', 2000).getText(),
        'Adding Columns and Rows'
      );
      assert.equal(
        await driver.find('.test-doc-tutorial-popup p').getText(),
        "Let's start with the basics of working with spreadsheet data — columns and rows."
      );
    });

    it('always opens the same fork whenever the document is opened', async function() {
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Zane Rails']);
      await gu.getCell(0, 1).click();
      await gu.sendKeys('Redacted', Key.ENTER);
      await gu.waitForServer();
      await editorSession.loadDoc(`/doc/grist-basics`);
      let currentUrl: string;
      await driver.wait(async () => {
        currentUrl = await driver.getCurrentUrl();
        return /~/.test(forkUrl);
      });
      assert.equal(currentUrl!, forkUrl);
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Redacted']);
    });

    it('tracks completion percentage', async function() {
      await driver.find('.test-doc-tutorial-popup-end-tutorial').click();
      await gu.waitForServer();
      await gu.waitForDocMenuToLoad();
      await gu.waitToPass(async () =>
        assert.equal(await driver.find('.test-intro-tutorial-percent-complete').getText(), '15%'),
        2000
      );
      await driver.find('.test-dm-basic-tutorial').click();
      await gu.waitForDocToLoad();
    });

    it('skips starting or resuming a tutorial if the open mode is set to default', async function() {
      ownerSession = await gu.session().customTeamSite('templates').user('support').login();
      await ownerSession.loadDoc(`/doc/grist-basics/m/default`);
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2', 'GristDocTutorial']);
      await driver.find('.test-tools-raw').click();
      await gu.waitForServer();
      assert.isTrue(await driver.findContentWait('.test-raw-data-table-id',
        /GristDocTutorial/, 2000).isPresent());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup').isPresent());
    });

    it('can restart tutorials', async function() {
      // Update the tutorial as the owner.
      await driver.find('.test-bc-doc').doClick();
      await driver.sendKeys('DocTutorial V2', Key.ENTER);
      await gu.waitForServer();
      await gu.addNewTable();

      // Switch back to the editor's fork of the tutorial.
      editorSession = await gu.session().customTeamSite('templates').user('user1').login();
      await driver.navigate().to(forkUrl);
      await gu.waitForDocToLoad();
      await driver.findWait('.test-doc-tutorial-popup', 2000);

      // Check that the new table isn't in the fork.
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2', 'GristDocTutorial']);
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Redacted']);

      // Restart the tutorial.
      await driver.find('.test-doc-tutorial-popup-restart').click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      await driver.findWait('.test-doc-tutorial-popup', 2000);

      // Check that progress was reset.
      assert.equal(
        await driver.findWait('.test-doc-tutorial-popup h1', 2000).getText(),
        'Intro'
      );
      assert.match(
        await driver.find('.test-doc-tutorial-popup').getText(),
        /Welcome to the Grist Basics tutorial/
      );

      // Check that edits were reset.
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Zane Rails']);

      // Check that changes made to the tutorial since it was last started are included.
      assert.equal(await driver.find('.test-doc-tutorial-popup-header').getText(),
        'DocTutorial V2');
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2', 'GristDocTutorial', 'Table1']);
    });

    it('allows owners to replace original', async function() {
      ownerSession = await gu.session().customTeamSite('templates').user('support').login();
      await ownerSession.loadDoc(`/doc/grist-basics`);

      // Make an edit to one of the tutorial slides.
      await gu.openPage('GristDocTutorial');
      await gu.getCell(1, 1).click();
      await gu.sendKeys(
        '# Intro',
        Key.chord(Key.SHIFT, Key.ENTER),
        Key.chord(Key.SHIFT, Key.ENTER),
        'Welcome to the Grist Basics tutorial V2.',
        Key.ENTER,
      );
      await gu.waitForServer();

      // Check that the update is immediately reflected in the tutorial popup.
      assert.equal(
        await driver.findWait('.test-doc-tutorial-popup p', 2000).getText(),
        'Welcome to the Grist Basics tutorial V2.'
      );

      // Replace the original via the Share menu.
      await driver.find('.test-tb-share').click();
      await driver.find('.test-replace-original').click();
      await driver.findWait('.test-modal-confirm', 3000).click();
      await gu.waitForServer();

      // Switch to another user and restart the tutorial.
      viewerSession = await gu.session().customTeamSite('templates').user('user2').login();
      await viewerSession.loadDoc(`/doc/grist-basics`);
      await driver.findWait('.test-doc-tutorial-popup-restart', 2000).click();
      await driver.find('.test-modal-confirm').click();
      await gu.waitForServer();
      await driver.findWait('.test-doc-tutorial-popup', 2000);

      // Check that the changes we made earlier are included.
      assert.equal(
        await driver.findWait('.test-doc-tutorial-popup p', 2000).getText(),
        'Welcome to the Grist Basics tutorial V2.'
      );
    });

    it('redirects to the last visited site when finished', async function() {
      const otherSiteSession = await gu.session().personalSite.user('user1').addLogin();
      await otherSiteSession.loadDocMenu('/');
      await ownerSession.loadDoc(`/doc/grist-basics`);
      await driver.findWait('.test-doc-tutorial-popup-slide-13', 2000).click();
      await driver.find('.test-doc-tutorial-popup-next').click();
      await gu.waitForDocMenuToLoad();
      assert.match(await driver.getCurrentUrl(), /o\/docs\/$/);
      await gu.waitToPass(async () =>
        assert.equal(await driver.find('.test-intro-tutorial-percent-complete').getText(), '0%'),
        2000
      );
      await ownerSession.loadDocMenu('/');
      await gu.waitToPass(async () =>
        assert.equal(await driver.find('.test-intro-tutorial-percent-complete').getText(), '100%'),
        2000
      );
    });
  });

  describe('without tutorial flag set', function () {
    before(async () => {
      await api.updateDoc('grist-basics', {type: null});
      ownerSession = await gu.session().customTeamSite('templates').user('support').login();
      await ownerSession.loadDoc(`/doc/grist-basics`);
    });

    afterEach(() => gu.checkForErrors());

    it('shows the GristDocTutorial page and table', async function() {
      assert.deepEqual(await gu.getPageNames(),
        ['Page 1', 'Page 2', 'GristDocTutorial', 'Table1']);
      await gu.openPage('GristDocTutorial');
      assert.deepEqual(
        await gu.getVisibleGridCells({cols: [1], rowNums: [1]}),
        [
          '# Intro\n\nWelcome to the Grist Basics tutorial V2.',
        ]
      );
      await driver.find('.test-tools-raw').click();
      await gu.waitForServer();
      assert.isTrue(await driver.findContentWait('.test-raw-data-table-id',
        /GristDocTutorial/, 2000).isPresent());
    });

    it('does not show the tutorial popup', async function() {
      assert.isFalse(await driver.find('.test-doc-tutorial-popup').isPresent());
    });
  });
});
