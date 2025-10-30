import {assert, By, driver, Key} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {setupTestSuite} from 'test/nbrowser/testUtils';

const ACCESSIBILITY_SHORTCUT_KEY = 'F4';
const ACCESSIBILITY_SHORTCUT_LABEL = 'Accessibility';

const getA11yShortcut = async () => {
  return await driver.find('.test-accessibility-shortcut');
};

const assertShowsA11yShortcut = async () => {
  const shortcut = await getA11yShortcut();
  assert.isTrue(await shortcut.isDisplayed(), 'Accessibility shortcut button should be visible');

  assert.isTrue(
    (await shortcut.getText()).includes(ACCESSIBILITY_SHORTCUT_LABEL),
    'Accessibility shortcut button should contain a text label',
  );

  const keys = await shortcut.findContent('.test-accessibility-shortcut-keys', new RegExp(ACCESSIBILITY_SHORTCUT_KEY));
  assert.isTrue(await keys.isDisplayed(), 'Accessibility shortcut button should show its keyboard shortcut');
};

const assertA11yModalShown = async () => {
  const modal = await driver.findWait('.test-modal-dialog', 1000);
  await modal.findContent('.test-accessibility-modal-title', /Accessibility/);
};

const assertA11yModalClosed = async () => {
  await gu.waitToPass(async () => {
    assert.isFalse(await driver.find('.test-modal-dialog').isPresent());
  });
};

describe('AccessibilityModal', function() {
  this.timeout(20000);
  setupTestSuite();

  let session: gu.Session;

  it('should always show a shortcut to open the accessibility modal', async function() {
    // Sign out and check homepage
    session = await gu.session().personalSite.anon.login();
    await session.loadDocMenu('/');
    await assertShowsA11yShortcut();

    // Sign in and check homepage
    session = await gu.session().teamSite.user('user1').login();
    await session.loadDocMenu('/');
    await assertShowsA11yShortcut();

    // Go to the profile page and check:
    // this page has a narrow left panel, make sure the button (and its keyboard shortcut info)
    // is also visible in that case.
    await gu.openProfileSettingsPage();
    await assertShowsA11yShortcut();
  });

  it('should open the accessibility modal on click', async function() {
    const shortcut = await getA11yShortcut();
    await shortcut.click();
    await assertA11yModalShown();
  });

  it('should show the main sections in the modal', async function() {
    await driver.findContent('.test-modal-dialog', /High contrast theme/);
    await driver.findContent('.test-modal-dialog', /Keyboard navigation/);
  });

  it('should show a button to switch to high contrast theme', async function() {
    const htmlEl = await driver.findElement(By.css('html[data-grist-theme]'));

    // we should first be on the default light theme
    assert.equal(await htmlEl.getAttribute('data-grist-theme'), 'GristLight');

    // a high contrast button should be there
    const highContrastThemeButton = await driver.find('.test-accessibility-modal-high-contrast-theme-button');

    // click it, and we should now be on the high contrast theme
    await highContrastThemeButton.click();
    await gu.waitForServer();
    await driver.findContent('.test-modal-dialog', /You are currently using the high contrast theme/);
    assert.equal(await htmlEl.getAttribute('data-grist-theme'), 'HighContrastLight');
  });

  it('should close the modal when clicking the close button', async function() {
    await driver.find('.test-accessibility-modal-confirm').click();
    await assertA11yModalClosed();
  });

  it('should open the modal when pressing F4', async function() {
    await gu.sendKeys(Key.F4);
    await assertA11yModalShown();
  });

  it('should close the modal when pressing escape', async function() {
    await gu.sendKeys(Key.ESCAPE);
    await assertA11yModalClosed();

    // cleanup: reset the theme configuration
    await gu.setGristTheme({themeName: 'GristLight', syncWithOS: true});
  });
});
