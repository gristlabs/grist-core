import {DocCreationInfo} from 'app/common/DocListAPI';
import {UserAPI} from 'app/common/UserAPI';
import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('DocTutorial', function () {
  this.timeout(30000);
  setupTestSuite();

  let doc: DocCreationInfo;
  let api: UserAPI;
  let session: gu.Session;

  const cleanup = setupTestSuite({team: true});

  before(async () => {
    session = await gu.session().teamSite.user('support').login();
    doc = await session.tempDoc(cleanup, 'DocTutorial.grist');
    api = session.createHomeApi();
    await api.updateDoc(doc.id, {type: 'tutorial'});
    await api.updateDocPermissions(doc.id, {users: {
      'anon@getgrist.com': 'viewers',
      'everyone@getgrist.com': 'viewers',
    }});
  });

  describe('when logged out', function () {
    before(async () => {
      session = await gu.session().anon.login();
    });

    it('shows a tutorial card', async function() {
      await session.loadRelPath('/');
      await gu.waitForDocMenuToLoad();
      await gu.skipWelcomeQuestions();

      assert.isTrue(await driver.find('.test-tutorial-card-content').isDisplayed());
      // Can dismiss it.
      await driver.find('.test-tutorial-card-close').click();
      assert.isFalse((await driver.findAll('.test-tutorial-card-content')).length > 0);
      // When dismissed, we can see link in the menu.
      assert.isTrue(await driver.find('.test-dm-basic-tutorial').isDisplayed());
    });

    it('redirects user to log in', async function() {
      await session.loadDoc(`/doc/${doc.id}`, false);
      await gu.checkLoginPage();
    });
  });

  describe('when logged in', function () {
    let forkUrl: string;

    before(async () => {
      session = await gu.session().teamSite.user('user1').login({showTips: true});
    });

    afterEach(() => gu.checkForErrors());

    it('shows a tutorial card', async function() {
      await session.loadRelPath('/');
      await gu.waitForDocMenuToLoad();
      await gu.skipWelcomeQuestions();

      // Make sure we have clean start.
      await driver.executeScript('resetSeenPopups();');
      await gu.waitForServer();
      await driver.navigate().refresh();
      await gu.waitForDocMenuToLoad();

      // Make sure we see the card.
      assert.isTrue(await driver.find('.test-tutorial-card-content').isDisplayed());

      // And can dismiss it.
      await driver.find('.test-tutorial-card-close').click();
      assert.isFalse((await driver.findAll('.test-tutorial-card-content')).length > 0);

      // When dismissed, we can see link in the menu.
      assert.isTrue(await driver.find('.test-dm-basic-tutorial').isDisplayed());

      // Prefs are preserved after reload.
      await driver.navigate().refresh();
      await gu.waitForDocMenuToLoad();
      assert.isFalse((await driver.findAll('.test-tutorial-card-content')).length > 0);
      assert.isTrue(await driver.find('.test-dm-basic-tutorial').isDisplayed());
    });

    it('creates a fork the first time the document is opened', async function() {
      await session.loadDoc(`/doc/${doc.id}`);
      await driver.wait(async () => {
        forkUrl = await driver.getCurrentUrl();
        return /~/.test(forkUrl);
      });
    });

    it('shows a popup containing slides generated from the GristDocTutorial table', async function() {
      assert.isTrue(await driver.findWait('.test-doc-tutorial-popup', 2000).isDisplayed());
      assert.equal(await driver.find('.test-floating-popup-header').getText(), 'DocTutorial');
      assert.equal(
        await driver.findWait('.test-doc-tutorial-popup h1', 2000).getText(),
        'Intro'
      );
      assert.equal(
        await driver.find('.test-doc-tutorial-popup p').getText(),
        'Welcome to the Grist Basics tutorial. We will cover the most important Grist '
          + 'concepts and features. Let’s get started.'
      );
    });

    it('can be moved around and minimized', async function() {
      // Get the initial position of the popup.
      const initialDims = await driver.find('.test-floating-popup-window').getRect();
      // Get the move handle.
      const mover = await driver.find('.test-floating-popup-move-handle');
      const moverInitial = await mover.getRect();

      const move = async (pos: {x?: number, y?: number}) => driver.withActions((actions) => actions
        .move({origin: driver.find('.test-floating-popup-move-handle')})
        .press()
        .move({origin: driver.find('.test-floating-popup-move-handle'), ...pos})
        .release()
      );

      const resize = async (pos: {x?: number, y?: number}) => driver.withActions((actions) => actions
        .move({origin: driver.find('.test-floating-popup-resize-handle')})
        .press()
        .move({origin: driver.find('.test-floating-popup-resize-handle'), ...pos})
        .release()
      );

      // Move it a little bit down.
      await move({y: 100, x: -10});

      // Check it is moved but not shrinked.
      let dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.height, initialDims.height);
      // And moving down.
      assert.equal(dims.y, initialDims.y + 100);
      assert.equal(dims.x, initialDims.x - 10);

      // Now move it a little up and test it doesn't grow.
      await move({y: -100});
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.height, initialDims.height);
      assert.equal(dims.y, initialDims.y);

      // Resize it in steps.
      await resize({y: 10});
      await resize({y: 10});
      await resize({y: 10});
      await resize({y: 10});
      await resize({y: 10});
      await resize({y: 50});

      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.height, initialDims.height - 100);
      assert.equal(dims.y, initialDims.y + 100);

      // Resize back (in steps, to simulate user actions)
      await resize({y: -20});
      await resize({y: -20});
      await resize({y: -20});
      await resize({y: -40});
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.height, initialDims.height);
      assert.equal(dims.y, initialDims.y);

      // Now resize it beyond the maximum size and check it doesn't move.
      await resize({y: -10});
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.height, initialDims.height);
      assert.equal(dims.y, initialDims.y);

      // Now resize it to the minimum size.
      await resize({y: 700});

      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.height, 300);

      // Get window inner size.
      const windowHeight: any = await driver.executeScript('return window.innerHeight');
      const windowWidth: any = await driver.executeScript('return window.innerWidth');
      assert.equal(dims.y + dims.height, windowHeight - 16);

      // Now move it offscreen as low as possible.
      await move({y: windowHeight - dims.y - 10});

      // Make sure it is still visible.
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.y, windowHeight - 32); // 32px is a header size
      assert.isBelow(dims.x, windowWidth - (32 * 4) + 1); // 120px is the right overflow value.

      // Now move it to the right as far as possible.
      await move({x: windowWidth - dims.x - 10});

      // Make sure it is still visible.
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.y, windowHeight - 32);
      assert.equal(dims.x, windowWidth - 32 * 4);

      // Now move it to the left as far as possible.
      await move({x: -3000});

      // Make sure it is still visible.
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.isBelow(dims.x, 0);
      assert.isAbove(dims.x + dims.width, 30);

      const miniButton = driver.find(".test-floating-popup-minimize-maximize");
      // Now move it back, but this time manually as the move handle is off screen.
      await driver.withActions((a) => a
        .move({origin: miniButton })
        .press()
        .move({origin: miniButton, x: Math.abs(dims.x) + 20})
        .release()
      );

      // Maximize it (it was minimized as we used the button to move it).
      await driver.find(".test-floating-popup-minimize-maximize").click();

      // Now move it to the top as far as possible.
      // Move it a little right, so that we don't end up on the logo. Driver is clicking logo sometimes.
      await move({y: -windowHeight, x: 100});

      // Make sure it is still visible.
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.y, 16);
      assert.isAbove(dims.x, 100);
      assert.isBelow(dims.x, windowWidth);

      // Move back where it was.
      let moverNow = await driver.find('.test-floating-popup-move-handle').getRect();
      await move({x: moverInitial.x - moverNow.x});
      // And restore the size by double clicking the resizer.
      await driver.withActions((a) => a.doubleClick(driver.find('.test-floating-popup-resize-handle')));

      // Now test if we can't resize it offscreen.
      await move({y: 10000});
      await move({y: -100});
      // Header is about 100px above the viewport.
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.isBelow(dims.y, windowHeight);
      assert.isAbove(dims.x, windowHeight - 140);

      // Now resize as far as possible.
      await resize({y: 10});
      await resize({y: 300});

      // Make sure it is still visible.
      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.isBelow(dims.y, windowHeight - 16);

      // Now move back and resize.
      moverNow = await driver.find('.test-floating-popup-move-handle').getRect();
      await move({x: moverInitial.x - moverNow.x, y: moverInitial.y - moverNow.y});
      await driver.withActions((a) => a.doubleClick(driver.find('.test-floating-popup-resize-handle')));

      dims = await driver.find('.test-floating-popup-window').getRect();
      assert.equal(dims.height, initialDims.height);
      assert.equal(dims.y, initialDims.y);
      assert.equal(dims.x, initialDims.x);
    });

    it('is visible on all pages', async function() {
      for (const page of ['access-rules', 'raw', 'code', 'settings']) {
        await driver.find(`.test-tools-${page}`).click();
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

    it('does not show the GristDocTutorial page or table', async function() {
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
      const otherSession = await gu.session().teamSite.user('user2').login();
      await driver.navigate().to(forkUrl);
      assert.match(await driver.findWait('.test-error-header', 2000).getText(), /Access denied/);
      await otherSession.loadDoc(`/doc/${doc.id}`);
      let otherForkUrl: string;
      await driver.wait(async () => {
        otherForkUrl = await driver.getCurrentUrl();
        return /~/.test(forkUrl);
      });
      session = await gu.session().teamSite.user('user1').login();
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
        'On the left-side panel is a list of pages which are views of your data. Right'
          + ' now, there are two pages, Page 1 and Page 2. You are looking at Page 1.'
      );
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-next').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-previous').isDisplayed());

      await driver.find('.test-doc-tutorial-popup-previous').click();
      assert.equal(
        await driver.find('.test-doc-tutorial-popup h1').getText(),
        'Intro'
      );
      assert.equal(
        await driver.find('.test-doc-tutorial-popup p').getText(),
        'Welcome to the Grist Basics tutorial. We will cover the most important Grist '
          + 'concepts and features. Let’s get started.'
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
        "You can add new columns to your table by clicking the ‘+’ icon"
          + ' to the far right of your column headers.'
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
      assert.equal(
        await driver.find('.test-doc-tutorial-popup p').getText(),
        'Welcome to the Grist Basics tutorial. We will cover the most important Grist '
          + 'concepts and features. Let’s get started.'
      );
    });

    it('can open images in a lightbox', async function() {
      await driver.find('.test-doc-tutorial-popup img').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-lightbox').isDisplayed());
      assert.equal(
        await driver.find('.test-doc-tutorial-lightbox-image').getAttribute('src'),
        'https://www.getgrist.com/wp-content/uploads/2023/03/Row-1-Intro.png'
      );
      await driver.find('.test-doc-tutorial-lightbox-close').click();
      assert.isFalse(await driver.find('.test-doc-tutorial-lightbox').isPresent());
    });

    it('can be minimized and maximized by clicking a button in the header', async function() {
      await driver.find('.test-floating-popup-minimize-maximize').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());

      await driver.find('.test-floating-popup-minimize-maximize').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());
    });

    it('can be minimized and maximized by double clicking the header', async function() {
      await driver.withActions(a => a.doubleClick(driver.find('.test-floating-popup-title')));
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());

      await driver.withActions(a => a.doubleClick(driver.find('.test-floating-popup-title')));
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
      // There's a 1000ms debounce in place for updates to the last slide.
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
        "You can add new columns to your table by clicking the ‘+’ icon"
          + ' to the far right of your column headers.'
      );
    });

    it('always opens the same fork whenever the document is opened', async function() {
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Zane Rails']);
      await gu.getCell(0, 1).click();
      await gu.sendKeys('Redacted', Key.ENTER);
      await gu.waitForServer();
      await session.loadDoc(`/doc/${doc.id}`);
      let currentUrl: string;
      await driver.wait(async () => {
        currentUrl = await driver.getCurrentUrl();
        return /~/.test(forkUrl);
      });
      assert.equal(currentUrl!, forkUrl);
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Redacted']);
    });

    it('skips starting or resuming a tutorial if the open mode is set to default', async function() {
      await session.loadDoc(`/doc/${doc.id}/m/default`);
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2', 'GristDocTutorial']);
      await driver.find('.test-tools-raw').click();
      await gu.waitForServer();
      assert.isTrue(await driver.findContentWait('.test-raw-data-table-id',
        /GristDocTutorial/, 2000).isPresent());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup').isPresent());
    });

    it('can restart tutorials', async function() {
      // Simulate that the tutorial has been updated since it was forked.
      await api.updateDoc(doc.id, {name: 'DocTutorial V2'});
      await api.applyUserActions(doc.id, [['AddTable', 'NewTable', [{id: 'A'}]]]);

      // Load the fork of the tutorial.
      await driver.navigate().to(forkUrl);
      await gu.waitForDocToLoad();
      await driver.findWait('.test-doc-tutorial-popup', 2000);

      // Check that the new table isn't in the fork.
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2']);
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
      assert.equal(
        await driver.find('.test-doc-tutorial-popup p').getText(),
        'Welcome to the Grist Basics tutorial. We will cover the most important Grist '
          + 'concepts and features. Let’s get started.'
      );

      // Check that edits were reset.
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Zane Rails']);

      // Check that changes made to the tutorial since it was last started are included.
      assert.equal(await driver.find('.test-doc-tutorial-popup-header').getText(),
        'DocTutorial V2');
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2', 'NewTable']);
    });

    it('redirects to the last visited site when finished', async function() {
      const otherSession = await gu.session().personalSite.user('user1').addLogin();
      await otherSession.loadDocMenu('/');
      await session.loadDoc(`/doc/${doc.id}`);
      await driver.findWait('.test-doc-tutorial-popup-slide-13', 2000).click();
      await driver.find('.test-doc-tutorial-popup-next').click();
      await gu.waitForDocMenuToLoad();
      assert.match(await driver.getCurrentUrl(), /o\/docs\/$/);
    });
  });

  describe('without tutorial flag set', function () {
    before(async () => {
      await api.updateDoc(doc.id, {type: null});
      session = await gu.session().teamSite.user('user1').login();
      await session.loadDoc(`/doc/${doc.id}`);
    });

    afterEach(() => gu.checkForErrors());

    it('shows the GristDocTutorial page and table', async function() {
      assert.deepEqual(await gu.getPageNames(),
        ['Page 1', 'Page 2', 'GristDocTutorial', 'NewTable']);
      await gu.openPage('GristDocTutorial');
      assert.deepEqual(
        await gu.getVisibleGridCells({cols: [1, 2], rowNums: [1]}),
        [
          "# Intro\n\nWelcome to the Grist Basics tutorial. We will cover"
            + " the most important Grist concepts and features. Let’s get"
            + " started.\n\n![Grist Basics Tutorial](\n"
            + "https://www.getgrist.com/wp-content/uploads/2023/03/Row-1-Intro.png)",
          '',
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
