import {assert, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

describe('BehavioralPrompts', function() {
  this.timeout(20000);
  const cleanup = setupTestSuite({tutorial: true});

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

  describe('for the Add New button', function() {
    it('should not be shown if site is empty', async function() {
      session = await gu.session().user('user4').login({showTips: true});
      await session.loadDocMenu('/');
      await assertPromptTitle(null);
    });

    it('should be shown if site has documents', async function() {
      await session.tempNewDoc(cleanup, 'BehavioralPromptsAddNew');
      await driver.find('.test-bc-workspace').click();
      await gu.waitForDocMenuToLoad();
      await assertPromptTitle('Add New');
    });

    it('should not be shown on the Trash page', async function() {
      // Load /p/trash and check that tip isn't initially shown.
      await session.loadDocMenu('/p/trash');
      await assertPromptTitle(null);
    });

    it('should only be shown on the All Documents page if intro is hidden', async function() {
      await session.loadDocMenu('/');
      await assertPromptTitle(null);
      await driver.find('.test-welcome-menu').click();
      await driver.find('.test-welcome-menu-only-show-documents').click();
      await gu.waitForServer();
      await assertPromptTitle(null);
      await gu.loadDocMenu('/');
      await assertPromptTitle('Add New');
    });

    it('should only be shown once on each visit', async function() {
      // Navigate to the home page for the first time; the tip should be shown.
      await gu.loadDocMenu('/');
      await assertPromptTitle('Add New');

      // Switch to a different page; the tip should no longer be shown.
      await driver.findContent('.test-dm-workspace', /Home/).click();
      await gu.waitForDocMenuToLoad();
      await assertPromptTitle(null);

      // Reload the page; the tip should be shown again.
      await driver.navigate().refresh();
      await gu.waitForDocMenuToLoad();
      await assertPromptTitle('Add New');
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
    gu.withEnvironmentSnapshot({
      'GRIST_UI_FEATURES': 'tutorials',
      'GRIST_TEMPLATE_ORG': 'templates',
      'GRIST_ONBOARDING_TUTORIAL_DOC_ID': 'grist-basics',
    });

    before(async () => {
      const tutorialSession = await gu.session().user('user3').login({
        showTips: true,
      });
      await tutorialSession.loadDocMenu('/');
      await driver.find('.test-dm-basic-tutorial').click();
      await gu.waitForDocToLoad();
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
