import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('BehavioralPrompts', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite();

  let session: gu.Session;
  let docId: string;

  before(async () => {
    session = await gu.session().user('user1').login({showTips: true});
    await gu.dismissCoachingCall();
    docId = await session.tempNewDoc(cleanup, 'BehavioralPrompts');
  });

  afterEach(() => gu.checkForErrors());

  describe('when helpCenter is hidden', function() {
    gu.withEnvironmentSnapshot({'GRIST_HIDE_UI_ELEMENTS': 'helpCenter'});

    before(async () => {
      const sessionNoHelpCenter = await gu.session().user('user3').login({
        isFirstLogin: false,
        freshAccount: true,
        showTips: true,
      });
      await gu.dismissCoachingCall();
      await sessionNoHelpCenter.tempNewDoc(cleanup, 'BehavioralPromptsNoHelpCenter');
    });

    it('should not be shown', async function() {
      await assertPromptTitle(null);
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-right-tab-field').click();
      await driver.find('.test-fbuilder-type-select').click();
      await assertPromptTitle(null);
    });
  });

  it('should show an announcement for forms', async function() {
    await assertPromptTitle('Forms are here!');
    await gu.dismissBehavioralPrompts();
  });

  describe('when anonymous', function() {
    before(async () => {
      const anonymousSession = await gu.session().anon.login({
        showTips: true,
      });
      await anonymousSession.loadDocMenu('/');
      await driver.find('.test-intro-create-doc').click();
      await gu.waitForDocToLoad();
    });

    it('should not shown an announcement for forms', async function() {
      await assertPromptTitle(null);
    });
  });

  it('should be shown when the column type select menu is opened', async function() {
    await gu.toggleSidePanel('right', 'open');
    await driver.find('.test-right-tab-field').click();
    await driver.find('.test-fbuilder-type-select').click();
    await assertPromptTitle('Reference Columns');
  });

  it('should be temporarily dismissed on click-away', async function() {
    await gu.getCell({col: 'A', rowNum: 1}).click();
    await assertPromptTitle(null);
  });

  it('should be shown again the next time the menu is opened', async function() {
    await driver.find('.test-fbuilder-type-select').click();
    await assertPromptTitle('Reference Columns');
  });

  it('should be permanently dismissed when "Got it" is clicked', async function() {
    await gu.dismissBehavioralPrompts();
    await assertPromptTitle(null);

    // Refresh the page and make sure the prompt isn't shown again.
    await session.loadDoc(`/doc/${docId}`);
    await driver.find('.test-fbuilder-type-select').click();
    await assertPromptTitle(null);
    await gu.sendKeys(Key.ESCAPE);
  });

  it('should be shown after selecting a reference column type', async function() {
    await gu.setType(/Reference$/);
    await assertPromptTitle('Reference Columns');
    await gu.undo();
  });

  it('should be shown after selecting a reference list column type', async function() {
    await gu.setType(/Reference List$/);
    await assertPromptTitle('Reference Columns');
  });

  it('should be shown when opening the Raw Data page', async function() {
    await driver.find('.test-tools-raw').click();
    await assertPromptTitle('Raw Data page');
  });

  it('should be shown when opening the Access Rules page', async function() {
    await driver.find('.test-tools-access-rules').click();
    await assertPromptTitle('Access Rules');
  });

  it('should be shown when opening the filter menu', async function() {
    await gu.openPage('Table1');
    await gu.openColumnMenu('A', 'Filter');
    await assertPromptTitle('Pinning Filters');
    await gu.dismissBehavioralPrompts();
  });

  it('should be shown when adding a second pinned filter', async function() {
    await driver.find('.test-filter-menu-apply-btn').click();
    await assertPromptTitle(null);
    await gu.openColumnMenu('B', 'Filter');
    await driver.find('.test-filter-menu-apply-btn').click();
    await assertPromptTitle('Nested Filtering');
  });

  it('should be shown when opening the page widget picker', async function() {
    await gu.openAddWidgetToPage();
    await assertPromptTitle('Selecting Data');
    await gu.dismissBehavioralPrompts();
  });

  it('should be shown when select by is an available option', async function() {
    await driver.findContent('.test-wselect-table', /Table1/).click();
    await assertPromptTitle('Linking Widgets');
    await gu.dismissBehavioralPrompts();
  });

  it('should be shown when adding a card widget', async function() {
    await gu.selectWidget('Card', /Table1/);
    await assertPromptTitle('Editing Card Layout');
  });

  it('should not be shown when adding a non-card widget', async function() {
    await gu.addNewPage('Table', /Table1/);
    await assertPromptTitle(null);
  });

  it('should be shown when adding a card list widget', async function() {
    await gu.addNewPage('Card List', /Table1/);
    await assertPromptTitle('Editing Card Layout');
  });

  it('should be shown after adding custom view as a new page', async function() {
    await gu.addNewPage('Custom', 'Table1');
    await assertPromptTitle('Custom Widgets');
    await gu.undo();
  });

  it('should be shown after adding custom section', async function() {
    await gu.addNewSection('Custom', 'Table1');
    await assertPromptTitle('Custom Widgets');
    await gu.undo();
  });

  describe('for the Add New button', function() {
    it('should not be shown if site is empty', async function() {
      session = await gu.session().user('user4').login({showTips: true});
      await gu.dismissCoachingCall();
      await driver.navigate().refresh();
      await gu.loadDocMenu('/');
      await assertPromptTitle(null);
    });

    it('should be shown if site has documents', async function() {
      await session.tempNewDoc(cleanup, 'BehavioralPromptsAddNew');
      await session.loadDocMenu('/');
      await assertPromptTitle('Add New');
    });

    it('should not be shown on the Trash page', async function() {
      // Load /p/trash and check that tip isn't initially shown.
      await session.loadDocMenu('/p/trash');
      await assertPromptTitle(null);
    });

    it('should only be shown once each visit to the doc menu', async function() {
      // Navigate to another page without reloading; the tip should now be shown.
      await driver.find('.test-dm-all-docs').click();
      await gu.waitForDocMenuToLoad();
      await assertPromptTitle('Add New');

      // Navigate to another page; the tip should no longer be shown.
      await driver.findContent('.test-dm-workspace', /Home/).click();
      await gu.waitForDocMenuToLoad();
      await assertPromptTitle(null);
    });
  });

  it(`should stop showing tips if "Don't show tips" is checked`, async function() {
    // Log in as a new user who hasn't seen any tips yet.
    session = await gu.session().user('user2').login({showTips: true});
    docId = await session.tempNewDoc(cleanup, 'BehavioralPromptsDontShowTips');
    await gu.loadDoc(`/doc/${docId}`);

    // Check "Don't show tips" in the Reference Columns tip and dismiss it.
    await gu.setType(/Reference$/);
    await gu.scrollPanel(false);
    await driver.findWait('.test-behavioral-prompt-dont-show-tips', 1000).click();
    await gu.dismissBehavioralPrompts();

    // Now visit Raw Data and check that its tip isn't shown.
    await driver.find('.test-tools-raw').click();
    await assertPromptTitle(null);
  });

  describe('when welcome tour is active', function() {
    before(async () => {
      const welcomeTourSession = await gu.session().user('user3').login({
        isFirstLogin: false,
        freshAccount: true,
        showTips: true,
      });
      await welcomeTourSession.tempNewDoc(cleanup, 'BehavioralPromptsWelcomeTour');
    });

    it('should not be shown', async function() {
      assert.isTrue(await driver.find('.test-onboarding-close').isDisplayed());
      // The forms announcement is normally shown here.
      await assertPromptTitle(null);
    });
  });

  describe('when in a tutorial', function() {
    gu.withEnvironmentSnapshot({'GRIST_UI_FEATURES': 'tutorials'});

    before(async () => {
      const tutorialSession = await gu.session().user('user3').login({
        showTips: true,
      });
      const doc = await tutorialSession.tempDoc(cleanup, 'DocTutorial.grist', {load: false});
      const api = tutorialSession.createHomeApi();
      await api.updateDoc(doc.id, {type: 'tutorial'});
      await tutorialSession.loadDoc(`/doc/${doc.id}`);
    });

    it('should not be shown', async function() {
      // The forms announcement is normally shown here.
      await assertPromptTitle(null);
      await driver.find('.test-floating-popup-minimize-maximize').click();
      await gu.toggleSidePanel('right', 'open');
      await driver.find('.test-right-tab-field').click();
      await driver.find('.test-fbuilder-type-select').click();
      await assertPromptTitle(null);
    });
  });
});

async function assertPromptTitle(title: string | null) {
  if (title === null) {
    await gu.waitToPass(async () => {
      assert.equal(await driver.find('.test-behavioral-prompt').isPresent(), false);
    });
  } else {
    await gu.waitToPass(async () => {
      assert.equal(await driver.find('.test-behavioral-prompt-title').getText(), title);
    });
  }
}
