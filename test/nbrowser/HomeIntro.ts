/**
 * Test the HomeIntro screen for empty orgs and the special rendering of Examples & Templates
 * page, both for anonymous and logged-in users.
 */

import {assert, driver, stackWrapFunc, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('HomeIntro', function() {
  this.timeout(40000);
  setupTestSuite({samples: true});

  describe("Anonymous on merged-org", function() {
    it('should show welcome for anonymous user', async function() {
      // Sign out
      const session = await gu.session().personalSite.anon.login();

      // Open doc-menu
      await session.loadDocMenu('/');

      // Check message specific to anon
      assert.equal(await driver.find('.test-welcome-title').getText(), 'Welcome to Grist!');
      assert.match(await driver.find('.test-welcome-text').getText(), /without logging in.*need to sign up/);

      // Check the sign-up link.
      const signUp = await driver.findContent('.test-welcome-text a', 'sign up');
      assert.include(await signUp.getAttribute('href'), '/signin');

      // Check that the link takes us to a Grist login page.
      await signUp.click();
      await gu.checkLoginPage();
      await driver.navigate().back();
      await gu.waitForDocMenuToLoad();
    });

    // Check intro screen.
    it('should should intro screen for anon, with video thumbnail', async function() {
      // Check image for first video.
      assert.equal(await driver.find('.test-intro-image img').isPresent(), true);
      await checkImageLoaded(driver.find('.test-intro-image img'));

      // Check links to first video in image and title.
      assert.include(await driver.find('.test-intro-image img').findClosest('a').getAttribute('href'),
        'support.getgrist.com');

      // Check link to Help Center
      assert.include(await driver.findContent('.test-welcome-text a', /Help Center/).getAttribute('href'),
        'support.getgrist.com');
    });

    it('should not show Other Sites section', testOtherSitesSection);
    it('should allow create/import from intro screen', testCreateImport.bind(null, false));
    it('should allow collapsing examples and remember the state', testExamplesCollapsing);
    it('should show examples workspace with the intro', testExamplesSection);
    it('should render selected Examples workspace specially', testSelectedExamplesPage);
  });

  describe("Logged-in on merged-org", function() {
    it('should show welcome for logged-in user', async function() {
      // Sign in as a new user who has no docs.
      const session = gu.session().personalSite.user('user3');
      await session.login({
        isFirstLogin: false,
        freshAccount: true,
      });

      // Open doc-menu
      await session.loadDocMenu('/', 'skipWelcomeQuestions');

      // Check message specific to logged-in user
      assert.match(await driver.find('.test-welcome-title').getText(), new RegExp(`Welcome.* ${session.name}`));
      assert.match(await driver.find('.test-welcome-text').getText(), /Watch video/);
      assert.notMatch(await driver.find('.test-welcome-text').getText(), /sign up/);
    });

    it('should not show Other Sites section', testOtherSitesSection);
    it('should show intro screen for empty org', testIntroScreenLoggedIn);
    it('should allow create/import from intro screen', testCreateImport.bind(null, true));
    it('should allow collapsing examples and remember the state', testExamplesCollapsing);
    it('should show examples workspace with the intro', testExamplesSection);
    it('should allow copying examples', testCopyingExamples.bind(null, undefined));
    it('should render selected Examples workspace specially', testSelectedExamplesPage);
  });

  describe("Logged-in on team site", function() {
    it('should show welcome for logged-in user', async function() {
      // Sign in as to a team that has no docs.
      const session = await gu.session().teamSite.user('user1').login();
      await session.loadDocMenu('/');
      await session.resetSite();

      // Open doc-menu
      await session.loadDocMenu('/', 'skipWelcomeQuestions');

      // Check message specific to logged-in user
      assert.match(await driver.find('.test-welcome-title').getText(), new RegExp(`Welcome.* ${session.name}`));
      assert.match(await driver.find('.test-welcome-text').getText(), /Watch video/);
      assert.notMatch(await driver.find('.test-welcome-text').getText(), /sign up/);
    });

    it('should not show Other Sites section', testOtherSitesSection);
    it('should show intro screen for empty org', testIntroScreenLoggedIn);
    it('should show examples workspace with the intro', testExamplesSection);
    it('should allow copying examples', testCopyingExamples.bind(null, gu.session().teamSite.orgName));
    it('should render selected Examples workspace specially', testSelectedExamplesPage);
  });

  async function testOtherSitesSection() {
    // Check that the Other Sites section is not shown.
    assert.isFalse(await driver.find('.test-dm-other-sites-header').isPresent());
  }

  async function testIntroScreenLoggedIn() {
    // Check image for first video.
    assert.equal(await driver.find('.test-intro-image img').isPresent(), true);
    await checkImageLoaded(driver.find('.test-intro-image img'));

    // Check link to first video in welcome text
    assert.include(await driver.findContent('.test-welcome-text a', /creating a document/).getAttribute('href'),
      'support.getgrist.com');

    // Check link to Help Center
    assert.include(await driver.findContent('.test-welcome-text a', /Help Center/).getAttribute('href'),
      'support.getgrist.com');
  }

  async function testCreateImport(isLoggedIn: boolean) {
    // Create doc from intro button
    await driver.find('.test-intro-create-doc').click();
    await checkDocAndRestore(isLoggedIn, async () => assert.equal(await gu.getCell('A', 1).getText(), ''));

    // Import doc from intro button
    await gu.fileDialogUpload('uploads/FileUploadData.csv', () => driver.find('.test-intro-import-doc').click());
    await checkDocAndRestore(isLoggedIn, async () => assert.equal(await gu.getCell('fname', 1).getText(), 'george'));

    // Check that add-new menu has enabled Create Empty and Import Doc items.
    await driver.find('.test-dm-add-new').doClick();
    assert.equal(await driver.find('.test-dm-new-doc').matches('[class*=-disabled]'), false);
    assert.equal(await driver.find('.test-dm-import').matches('[class*=-disabled]'), false);

    // Create doc from add-new menu
    await driver.find('.test-dm-new-doc').doClick();
    await checkDocAndRestore(isLoggedIn, async () => {
      await gu.dismissWelcomeTourIfNeeded();
      assert.equal(await gu.getCell('A', 1).getText(), '');
      if (!isLoggedIn) {
        assert.equal(await driver.find('.test-tb-share-action').getText(), 'Save Document');
        await driver.find('.test-tb-share').click();
        assert.equal(await driver.find('.test-save-copy').isPresent(), true);
        // There is no original of this document.
        assert.equal(await driver.find('.test-open-original').isPresent(), false);
      } else {
        assert.equal(await driver.find('.test-tb-share-action').isPresent(), false);
      }
    });

    // Import doc from add-new menu
    await gu.docMenuImport('uploads/FileUploadData.csv');
    await checkDocAndRestore(isLoggedIn, async () => assert.equal(await gu.getCell('fname', 1).getText(), 'george'));
  }

  // Wait for image to load (or fail), then check naturalWidth to ensure it loaded successfully.
  const checkImageLoaded = stackWrapFunc(async function(img: WebElement) {
    await driver.wait(() => img.getAttribute('complete'), 10000);
    assert.isAbove(Number(await img.getAttribute('naturalWidth')), 0);
  });

  // Wait for doc to load, check it, then return to home page, and remove the doc so that we
  // can see the intro again.
  const checkDocAndRestore = stackWrapFunc(async function(isLoggedIn: boolean, docChecker: () => Promise<void>,
                                                          stepsBackToDocMenu: number = 1) {
    await gu.waitForDocToLoad();
    await gu.dismissWelcomeTourIfNeeded();
    await docChecker();
    for (let i = 0; i < stepsBackToDocMenu; i++) {
      await driver.navigate().back();
    }
    await gu.waitForDocMenuToLoad();

    // If not logged in, we create docs "unsaved" and don't see them in doc-menu.
    if (isLoggedIn) {
      // Delete the first doc we find. We expect exactly one to exist.
      assert.equal(await driver.find('.test-dm-doc').isPresent(), true);
      await driver.find('.test-dm-doc').mouseMove().find('.test-dm-pinned-doc-options').click();
      await driver.find('.test-dm-delete-doc').click();
      await driver.find('.test-modal-confirm').click();
      await driver.wait(async () => !(await driver.find('.test-modal-dialog').isPresent()), 3000);
    }
    assert.equal(await driver.find('.test-dm-doc').isPresent(), false);
  });

  async function testExamplesCollapsing() {
    assert.equal(await driver.find('.test-dm-pinned-doc-name').isDisplayed(), true);

    // Collapse the templates section, check it's collapsed
    await driver.find('.test-dm-all-docs-templates-header').click();
    assert.equal(await driver.find('.test-dm-pinned-doc-name').isPresent(), false);

    // Reload and check it's still collapsed.
    await driver.navigate().refresh();
    await gu.waitForDocMenuToLoad();
    assert.equal(await driver.find('.test-dm-pinned-doc-name').isPresent(), false);

    // Expand back, and check.
    await driver.find('.test-dm-all-docs-templates-header').click();
    assert.equal(await driver.find('.test-dm-pinned-doc-name').isDisplayed(), true);

    // Reload and check it's still expanded.
    await driver.navigate().refresh();
    await gu.waitForDocMenuToLoad();
    assert.equal(await driver.find('.test-dm-pinned-doc-name').isDisplayed(), true);
  }

  async function testExamplesSection() {
    // Check rendering and functionality of the examples and templates section

    // Check titles.
    assert.includeMembers(await driver.findAll('.test-dm-pinned-doc-name', (el) => el.getText()),
      ['Lightweight CRM']);

    // Check the Discover More Templates button is shown.
    const discoverMoreButton = await driver.find('.test-dm-all-docs-templates-discover-more');
    assert(await discoverMoreButton.isPresent());
    assert.include(await discoverMoreButton.getAttribute('href'), '/p/templates');

    // Check that the button takes us to the templates page, then go back.
    await discoverMoreButton.click();
    await gu.waitForDocMenuToLoad();
    assert(gu.testCurrentUrl(/p\/templates/));
    await driver.navigate().back();
    await gu.waitForDocMenuToLoad();

    // Check images.
    const docItem = await driver.findContent('.test-dm-pinned-doc', /Lightweight CRM/);
    assert.equal(await docItem.find('img').isPresent(), true);
    await checkImageLoaded(docItem.find('img'));

    // Both the image and the doc title link to the doc.
    const imgHref = await docItem.find('img').findClosest('a').getAttribute('href');
    const docHref = await docItem.find('.test-dm-pinned-doc-name').findClosest('a').getAttribute('href');
    assert.match(docHref, /lightweight-crm/i);
    assert.equal(imgHref, docHref);

    // Open the example.
    await docItem.find('.test-dm-pinned-doc-name').click();
    await gu.waitForDocToLoad();
    assert.match(await gu.getCell('Company', 1).getText(), /Sporer/);
    assert.match(await driver.find('.test-bc-doc').value(), /Lightweight CRM/);
    await driver.navigate().back();
    await gu.waitForDocMenuToLoad();
  }

  async function testCopyingExamples(destination?: string) {
    // Open the example to copy it. Note that we no longer support copying examples from doc menu.
    // Make full copy of the example.
    await driver.findContent('.test-dm-pinned-doc-name', /Lightweight CRM/).click();
    await gu.waitForDocToLoad();
    await driver.findWait('.test-tb-share-action', 500).click();
    await gu.completeCopy({destName: 'LCRM Copy', destOrg: destination ?? 'Personal'});
    await checkDocAndRestore(true, async () => {
      assert.match(await gu.getCell('Company', 1).getText(), /Sporer/);
      assert.match(await driver.find('.test-bc-doc').value(), /LCRM Copy/);
    }, 2);

    // Make a template copy of the example.
    await driver.findContent('.test-dm-pinned-doc-name', /Lightweight CRM/).click();
    await gu.waitForDocToLoad();
    await driver.findWait('.test-tb-share-action', 500).click();
    await driver.findWait('.test-save-as-template', 1000).click();
    await gu.completeCopy({destName: 'LCRM Template Copy', destOrg: destination ?? 'Personal'});
    await checkDocAndRestore(true, async () => {
      // No data, because the file was copied as a template.
      assert.equal(await gu.getCell(0, 1).getText(), '');
      assert.match(await driver.find('.test-bc-doc').value(), /LCRM Template Copy/);
    }, 2);
  }

  async function testSelectedExamplesPage() {
    // Click Examples & Templates in left panel.
    await driver.findContent('.test-dm-templates-page', /Examples & Templates/).click();
    await gu.waitForDocMenuToLoad();

    // Check Featured Templates are shown at the top of the page.
    assert.equal(await driver.findWait('.test-dm-featured-templates-header', 500).getText(), 'Featured');
    assert.includeMembers(
      await driver.findAll('.test-dm-pinned-doc-list .test-dm-pinned-doc-name', (el) => el.getText()),
      ['Lightweight CRM']);
    assert.includeMembers(
      await driver.findAll('.test-dm-pinned-doc-list .test-dm-pinned-doc-desc', (el) => el.getText()),
      ['CRM template and example for linking data, and creating productive layouts.']
    );

    // External servers may have additional templates beyond the 3 above, so stop here.
    if (server.isExternalServer()) { return; }

    // Check the CRM and Invoice sections are shown below Featured Templates.
    assert.includeMembers(
      await driver.findAll('.test-dm-templates-header', (el) => el.getText()),
      ['CRM', 'Other']);

    // Check that each section has the correct templates (title and description).
    const [crmSection, otherSection] = await driver.findAll('.test-dm-templates');
    assert.includeMembers(
      await crmSection.findAll('.test-dm-pinned-doc-name', (el) => el.getText()),
      ['Lightweight CRM']);
    assert.includeMembers(
      await otherSection.findAll('.test-dm-pinned-doc-name', (el) => el.getText()),
      ['Afterschool Program', 'Investment Research']);
    assert.includeMembers(
      await crmSection.findAll('.test-dm-pinned-doc-desc', (el) => el.getText()),
      ['CRM template and example for linking data, and creating productive layouts.']);
    assert.includeMembers(
      await otherSection.findAll('.test-dm-pinned-doc-desc', (el) => el.getText()),
      [
        'Example for how to model business data, use formulas, and manage complexity.',
        'Example for analyzing and visualizing with summary tables and linked charts.'
      ]);

    const docItem = await driver.findContent('.test-dm-pinned-doc', /Lightweight CRM/);
    assert.equal(await docItem.find('img').isPresent(), true);
    await checkImageLoaded(docItem.find('img'));
  }
});
