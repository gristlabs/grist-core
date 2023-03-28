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

  const cleanup = setupTestSuite();

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
      session = await gu.session().teamSite.user('user1').login();
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

    it('is visible on all pages', async function() {
      for (const page of ['access-rules', 'raw', 'code', 'settings']) {
        await driver.find(`.test-tools-${page}`).click();
        assert.isTrue(await driver.find('.test-doc-tutorial-popup').isDisplayed());
      }
    });

    it('does not show the GristDocTutorial page or table', async function() {
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2']);
      await driver.find('.test-tools-raw').click();
      await driver.findWait('.test-raw-data-list', 1000);
      await gu.waitForServer();
      assert.isFalse(await driver.findContent('.test-raw-data-table-id',
        /GristDocTutorial/).isPresent());
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
      assert.equal(await slide3.getAttribute('title'), 'Adding Columns and Rows');
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
      assert.equal(await slide1.getAttribute('title'), 'Intro');
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

    it('can be minimized and maximized', async function() {
      await driver.find('.test-floating-popup-minimize-maximize').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-body').isPresent());
      assert.isFalse(await driver.find('.test-doc-tutorial-popup-footer').isPresent());

      await driver.find('.test-floating-popup-minimize-maximize').click();
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-header').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-body').isDisplayed());
      assert.isTrue(await driver.find('.test-doc-tutorial-popup-footer').isDisplayed());
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

      // Load the current fork of the tutorial.
      await driver.navigate().to(forkUrl);
      await gu.waitForDocToLoad();
      await driver.findWait('.test-doc-tutorial-popup', 2000);

      // Check that the new table isn't in the fork.
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2']);
      assert.deepEqual(await gu.getVisibleGridCells({cols: [0], rowNums: [1]}), ['Redacted']);

      // Restart the tutorial and wait for a new fork to be created.
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

      // Check that changes made to the tutorial since the last fork are included.
      assert.equal(await driver.find('.test-doc-tutorial-popup-header').getText(),
        'DocTutorial V2');
      assert.deepEqual(await gu.getPageNames(), ['Page 1', 'Page 2', 'NewTable']);
    });

    it('redirects to the doc menu when finished', async function() {
      await driver.find('.test-doc-tutorial-popup-slide-13').click();
      await driver.find('.test-doc-tutorial-popup-next').click();
      await driver.findWait('.test-dm-doclist', 2000);
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
