/**
 * Test the HomeIntro screen for empty orgs and the special rendering of Examples & Templates
 * page, both for anonymous and logged-in users.
 */

import {assert, driver, stackWrapFunc, WebElement} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe('HomeIntro', function() {
  this.timeout(40000);
  setupTestSuite({samples: true, tutorial: true});
  gu.withEnvironmentSnapshot({
    'GRIST_UI_FEATURES': 'templates,tutorials',
    'GRIST_TEMPLATE_ORG': 'templates',
    'GRIST_ONBOARDING_TUTORIAL_DOC_ID': 'grist-basics',
  });

  describe("Anonymous on merged-org", function() {
    it('should show welcome for anonymous user', async function() {
      // Sign out
      const session = await gu.session().personalSite.anon.login();

      // Open doc-menu
      await session.loadDocMenu('/');

      // Check message specific to anon
      assert.equal(await driver.find('.test-welcome-title').getText(), 'Welcome to Grist!');
    });

    it('should should intro screen for anon', () => testIntroScreen({anon: true, team: false}));
    it('should should set meta tags for URL previews', testMetaTags);
    it('should not show Other Sites section', testOtherSitesSection);
    it('should allow create/import from intro screen', testCreateImport.bind(null, false));
    it('should link to examples page from the intro', testExamplesPage);
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

      // Open doc-menu and skip onboarding
      await session.loadDocMenu('/', 'skipOnboarding');

      // Reload the doc-menu and dismiss the coaching call popup
      await session.loadDocMenu('/');
      await gu.dismissCardPopups();

      // Check message specific to logged-in user
      assert.match(await driver.find('.test-welcome-title').getText(), new RegExp(`Welcome.* ${session.name}`));
    });

    it('should not show Other Sites section', testOtherSitesSection);
    it('should show intro screen for empty org', () => testIntroScreen({anon: false, team: false}));
    it('should allow create/import from intro screen', testCreateImport.bind(null, true));
    it('should link to examples page from the intro', testExamplesPage);
    it('should allow copying examples', testCopyingExamples.bind(null, undefined));
    it('should render selected Examples workspace specially', testSelectedExamplesPage);
    it('should show empty workspace info', testEmptyWorkspace);
  });

  describe("Logged-in on team site", function() {
    it('should show welcome for logged-in user', async function() {
      // Sign in as to a team that has no docs.
      const session = await gu.session().teamSite.user('user1').login();
      await session.loadDocMenu('/');
      await session.resetSite();

      // Open doc-menu
      await session.loadDocMenu('/');

      // Check message specific to logged-in user and an empty team site.
      assert.match(await driver.find('.test-welcome-title').getText(), new RegExp(`Welcome.* ${session.orgName}`));
    });

    it('should not show Other Sites section', testOtherSitesSection);
    it('should show intro screen for empty org', () => testIntroScreen({anon: false, team: true}));
    it('should allow create/import from intro screen', testCreateImport.bind(null, true));
    it('should link to examples page from the intro', testExamplesPage);
    it('should allow copying examples', testCopyingExamples.bind(null, gu.session().teamSite.orgName));
    it('should render selected Examples workspace specially', testSelectedExamplesPage);
    it('should show empty workspace info', testEmptyWorkspace);
  });

  async function testOtherSitesSection() {
    // Check that the Other Sites section is not shown.
    assert.isFalse(await driver.find('.test-dm-other-sites-header').isPresent());
  }

  async function testIntroScreen(options: {anon: boolean; team: boolean}) {
    // TODO There is no longer a thumbnail + video link on an empty site, but it's a good place to
    // check for the presence and functionality of the planned links that open an intro video.

    assert.isTrue(await driver.find('.test-intro-cards').isDisplayed());
    assert.isTrue(await driver.find('.test-intro-video-tour').isDisplayed());
    assert.isTrue(await driver.find('.test-intro-create-doc').isDisplayed());
    assert.isTrue(await driver.find('.test-intro-import-doc').isDisplayed());
    assert.isTrue(await driver.find('.test-intro-templates').isDisplayed());
    assert.include(await driver.find('.test-intro-webinars').getAttribute('href'),
      'www.getgrist.com/webinars');
    assert.include(await driver.find('.test-intro-help-center').getAttribute('href'),
      'support.getgrist.com');

    if (options.team) {
      assert.equal(await driver.find('.test-topbar-manage-team').getText(), 'Manage team');
    } else {
      assert.equal(await driver.find('.test-topbar-manage-team').isPresent(), false);
    }

    if (options.anon) {
      assert.isFalse(await driver.find('.test-welcome-menu').isPresent());
    } else {
      await driver.find('.test-welcome-menu').click();
      await driver.find('.test-welcome-menu-only-show-documents').click();
      await gu.waitForServer();
      assert.isFalse(await driver.find('.test-intro-cards').isPresent());
      await driver.navigate().refresh();
      await gu.waitForDocMenuToLoad();
      assert.isFalse(await driver.find('.test-intro-cards').isPresent());
      await driver.find('.test-welcome-menu').click();
      await driver.find('.test-welcome-menu-only-show-documents').click();
      await gu.waitForServer();
      assert.isTrue(await driver.find('.test-intro-cards').isDisplayed());
    }
  }

  async function testMetaTags() {
    const expectedTitle = 'Grist, the evolution of spreadsheets';
    assert.equal(await driver.find('meta[name="twitter:title"]').getAttribute('content'), expectedTitle);
    assert.equal(await driver.find('meta[property="og:title"]').getAttribute('content'), expectedTitle);

    const expectedDescription = 'A modern, open source spreadsheet that goes beyond the grid';
    assert.equal(await driver.find('meta[name="description"]').getAttribute('content'), expectedDescription);
    assert.equal(await driver.find('meta[name="twitter:description"]').getAttribute('content'), expectedDescription);
    assert.equal(await driver.find('meta[property="og:description"]').getAttribute('content'), expectedDescription);

    const gristIconFileName = 'opengraph-preview-image.png';
    assert.include(await driver.find('meta[name="thumbnail"]').getAttribute('content'), gristIconFileName);
    assert.include(await driver.find('meta[name="twitter:image"]').getAttribute('content'), gristIconFileName);
    assert.include(await driver.find('meta[property="og:image"]').getAttribute('content'), gristIconFileName);
  }

  async function testCreateImport(isLoggedIn: boolean) {
    await checkIntroButtons(isLoggedIn);

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

  async function testExamplesPage() {
    // Make sure we can get to the templates page from the home page.
    await driver.find('.test-intro-templates').click();
    await gu.waitForDocMenuToLoad();
    assert(gu.testCurrentUrl(/p\/templates/));

    // Check titles.
    assert.includeMembers(await driver.findAll('.test-dm-pinned-doc-name', (el) => el.getText()),
      ['Lightweight CRM']);

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
    // Open the example and make a full copy of it.
    await driver.find('.test-dm-templates-page').click();
    await gu.waitForDocMenuToLoad();
    await driver.findContent('.test-dm-pinned-doc-name', /Lightweight CRM/).click();
    await gu.waitForDocToLoad();
    await driver.findWait('.test-tb-share-action', 500).click();
    await gu.completeCopy({destName: 'LCRM Copy', destOrg: destination ?? 'Personal'});
    await checkDocAndRestore(true, async () => {
      assert.match(await gu.getCell('Company', 1).getText(), /Sporer/);
      assert.match(await driver.find('.test-bc-doc').value(), /LCRM Copy/);
    }, 3);

    // Make a template copy of the example.
    await driver.find('.test-dm-templates-page').click();
    await gu.waitForDocMenuToLoad();
    await driver.findContent('.test-dm-pinned-doc-name', /Lightweight CRM/).click();
    await gu.waitForDocToLoad();
    await driver.findWait('.test-tb-share-action', 500).click();
    await driver.findWait('.test-save-as-template', 1000).click();
    await gu.completeCopy({destName: 'LCRM Template Copy', destOrg: destination ?? 'Personal'});
    await checkDocAndRestore(true, async () => {
      // No data, because the file was copied as a template.
      assert.equal(await gu.getCell(0, 1).getText(), '');
      assert.match(await driver.find('.test-bc-doc').value(), /LCRM Template Copy/);
    }, 3);
  }

  async function testSelectedExamplesPage() {
    // Click Examples & Templates in left panel.
    await driver.find('.test-dm-templates-page').click();
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

async function testEmptyWorkspace() {
  await gu.openWorkspace("Home");
  assert.isTrue(await driver.findWait('.test-dm-no-docs-message', 400).isDisplayed());
  // Create doc and check it is created.
  await driver.find('.test-dm-add-new').click();
  await driver.find('.test-dm-new-doc').click();
  await waitAndDismiss();
  await emptyDocChecker();
  // Check that we don't see the "No documents..." message anymore.
  await driver.navigate().back();
  await gu.waitForDocMenuToLoad();
  await gu.dismissBehavioralPrompts();
  assert.isFalse(await driver.find('.test-dm-no-docs-message').isPresent());
  // Remove created document, it also checks that document is visible.
  await deleteFirstDoc();
  assert.isTrue(await driver.findWait('.test-dm-no-docs-message', 400).isDisplayed());
}

// Wait for doc to load, check it, then return to home page, and remove the doc so that we
// can see the intro again.
async function checkDocAndRestore(
  isLoggedIn: boolean,
  docChecker: () => Promise<void>,
  stepsBackToDocMenu: number = 1)
{
  await waitAndDismiss();
  await docChecker();
  for (let i = 0; i < stepsBackToDocMenu; i++) {
    await driver.navigate().back();
    if (await gu.isAlertShown()) { await gu.acceptAlert(); }
  }
  await gu.waitForDocMenuToLoad();
  // If not logged in, we create docs "unsaved" and don't see them in doc-menu.
  if (isLoggedIn) {
    // Delete the first doc we find. We expect exactly one to exist.
    await deleteFirstDoc();
  }
  assert.equal(await driver.find('.test-dm-doc').isPresent(), false);
}

async function waitAndDismiss() {
  await gu.waitForDocToLoad();
  await gu.dismissWelcomeTourIfNeeded();
}

async function deleteFirstDoc() {
  assert.equal(await driver.find('.test-dm-doc').isPresent(), true);
  await driver.find('.test-dm-doc').mouseMove().find('.test-dm-doc-options').click();
  await driver.find('.test-dm-delete-doc').click();
  await driver.find('.test-modal-confirm').click();
  await gu.waitForServer();
  await driver.wait(async () => !(await driver.find('.test-modal-dialog').isPresent()), 3000);
}

async function checkIntroButtons(isLoggedIn: boolean) {
  // Create doc from intro button
  await checkCreateDocButton(isLoggedIn);

  // Import doc from intro button
  await checkImportDocButton(isLoggedIn);
}

async function checkImportDocButton(isLoggedIn: boolean) {
  await gu.fileDialogUpload('uploads/FileUploadData.csv', () => driver.find('.test-intro-import-doc').click());
  await checkDocAndRestore(isLoggedIn, async () => assert.equal(await gu.getCell('fname', 1).getText(), 'george'));
}

async function checkCreateDocButton(isLoggedIn: boolean) {
  await driver.find('.test-intro-create-doc').click();
  await checkDocAndRestore(isLoggedIn, emptyDocChecker);
}

async function emptyDocChecker() {
  assert.equal(await gu.getCell('A', 1).getText(), '');
}
