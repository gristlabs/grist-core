import { assert, By, ChromiumWebDriver, driver } from 'mocha-webdriver';
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from 'test/nbrowser/testUtils';

const findSyncWithOSCheckbox = () => driver.find('.test-theme-config-sync-with-os');
const appearanceSelectCssSelector = '.test-theme-config-appearance .test-select-open:not(.disabled)';
const appearanceSelectDisabledCssSelector = '.test-theme-config-appearance .test-select-open.disabled';
/**
 * To verify current theme is correctly applied, we check the text color of breadcrumb first item,
 * because it is different for each theme.
 */
const getCurrentlyAppliedTheme = async () => {
  const theme = await driver.find('.test-account-page-home');
  const color = await theme.getCssValue('color');
  switch (color) {
    case 'rgba(22, 179, 120, 1)':
      return 'GristLight';
    case 'rgba(23, 179, 120, 1)':
      return 'GristDark';
    case 'rgba(15, 123, 81, 1)':
      return 'HighContrastLight';
    default:
      throw new Error(`Current theme has unexpected .test-account-page-home color: ${color}`);
  }
};

describe('Themes', function () {
  this.timeout(20000);

  setupTestSuite();

  beforeEach(async function () {
    const session = await gu.session().teamSite.login();
    await session.loadDocMenu("/");
  });

  it('should follow OS preferences by default', async function () {
    await gu.openProfileSettingsPage();

    // verify that the sync with OS checkbox is checked
    const syncWithOSCheckbox = await findSyncWithOSCheckbox();
    assert.isTrue(await syncWithOSCheckbox.isSelected());

    // then verify that the theme select is disabled
    const activeAppearanceSelect = await driver.findElements(
      By.css(appearanceSelectCssSelector)
    );
    const disabledAppearanceSelect = await driver.findElements(
      By.css(appearanceSelectDisabledCssSelector)
    );
    assert.isEmpty(activeAppearanceSelect, 'Appearance select should be disabled');
    assert.exists(disabledAppearanceSelect[0], 'Appearance select should be disabled');
  });

  it('should apply system appearance when sync with OS is enabled', async function() {
    await gu.openProfileSettingsPage();
    const syncWithOSCheckbox = await findSyncWithOSCheckbox();
    const isSelected = await syncWithOSCheckbox.isSelected();
    if (!isSelected) {
      await syncWithOSCheckbox.click();
    }

    // default test env has system light theme set
    assert.equal(await getCurrentlyAppliedTheme(), 'GristLight');

    // if using chromium web driver, fake the system color scheme to dark and wait for the theme to change
    if ((driver as ChromiumWebDriver).sendDevToolsCommand) {
      await (driver as ChromiumWebDriver).sendDevToolsCommand('Emulation.setEmulatedMedia', {features: [
        {name: 'prefers-color-scheme', value: 'dark'}
      ]});
      await driver.sleep(500);
      assert.equal(await getCurrentlyAppliedTheme(), 'GristDark');

      // reset back to default light system appearance
      await (driver as ChromiumWebDriver).sendDevToolsCommand('Emulation.setEmulatedMedia', {features: [
        {name: 'prefers-color-scheme', value: 'light'}
      ]});
      await driver.sleep(500);
      assert.equal(await getCurrentlyAppliedTheme(), 'GristLight');
    }
  });

  it('should allow user to select between 3 themes when sync with OS is disabled', async function() {
    await gu.openProfileSettingsPage();

    const syncWithOSCheckbox = await findSyncWithOSCheckbox();
    await syncWithOSCheckbox.click();
    assert.isFalse(await syncWithOSCheckbox.isSelected());

    await gu.scrollIntoView(driver.find(appearanceSelectCssSelector));
    await driver.find(appearanceSelectCssSelector).click();
    assert.deepEqual(
      await gu.findOpenMenuAllItems('li', el => el.getText()),
      ['Light', 'Dark', 'Light (High Contrast)']
    );
  });

  it('should apply the selected theme', async function() {
    await gu.setGristTheme({themeName: 'GristLight', syncWithOS: false});
    assert.equal(await getCurrentlyAppliedTheme(), 'GristLight');

    await gu.setGristTheme({themeName: 'GristDark', syncWithOS: false});
    assert.equal(await getCurrentlyAppliedTheme(), 'GristDark');

    await gu.setGristTheme({themeName: 'HighContrastLight', syncWithOS: false});
    assert.equal(await getCurrentlyAppliedTheme(), 'HighContrastLight');
  });
});
