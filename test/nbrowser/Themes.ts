import { assert, By, ChromiumWebDriver, driver, Key } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";
import { setupTestSuite } from "test/nbrowser/testUtils";

const findSyncWithOSCheckbox = () => driver.find(".test-theme-config-sync-with-os");
const appearanceSelectCssSelector = ".test-theme-config-appearance .test-select-open:not(.disabled)";
const appearanceSelectDisabledCssSelector = ".test-theme-config-appearance .test-select-open.disabled";
/**
 * To verify current theme is correctly applied, we check:
 *
 * - the text color of breadcrumb first item, because it is different for each theme.
 * - the data attributes on the document element, because they are set by the theme.
 */
const assertAppliedTheme = async (expectedTheme: "GristLight" | "GristDark" | "HighContrastLight") => {
  const theme = await driver.find(".test-account-page-home");
  const color = await theme.getCssValue("color");
  let appliedTheme = null;
  switch (color) {
    case "rgba(22, 179, 120, 1)":
      appliedTheme = "GristLight";
      break;
    case "rgba(23, 179, 120, 1)":
      appliedTheme = "GristDark";
      break;
    case "rgba(15, 123, 81, 1)":
      appliedTheme = "HighContrastLight";
      break;
  }
  assert.equal(appliedTheme, expectedTheme);
  assert.equal(
    await driver.findElement(By.css("html[data-grist-theme]")).getAttribute("data-grist-theme"),
    expectedTheme,
  );
  assert.equal(
    await driver.findElement(By.css("[data-grist-appearance]")).getAttribute("data-grist-appearance"),
    expectedTheme === "GristDark" ? "dark" : "light",
  );
};

describe("Themes", function() {
  describe("with default env", function() {
    this.timeout(20000);

    setupTestSuite();

    beforeEach(async function() {
      const session = await gu.session().teamSite.login();
      await session.loadDocMenu("/");
      await gu.openProfileSettingsPage();
    });

    afterEach(async function() {
      // reset to default state
      await enableSyncWithOS();
    });

    it("should follow OS preferences by default", async function() {
      // verify that the sync with OS checkbox is checked
      const syncWithOSCheckbox = await findSyncWithOSCheckbox();
      assert.isTrue(await syncWithOSCheckbox.isSelected());

      // then verify that the theme select is disabled
      const activeAppearanceSelect = await driver.findElements(
        By.css(appearanceSelectCssSelector),
      );
      const disabledAppearanceSelect = await driver.findElements(
        By.css(appearanceSelectDisabledCssSelector),
      );
      assert.isEmpty(activeAppearanceSelect, "Appearance select should be disabled");
      assert.exists(disabledAppearanceSelect[0], "Appearance select should be disabled");
    });

    it("should apply system appearance when sync with OS is enabled", async function() {
      await gu.openProfileSettingsPage();
      const syncWithOSCheckbox = await findSyncWithOSCheckbox();
      const isSelected = await syncWithOSCheckbox.isSelected();
      if (!isSelected) {
        await syncWithOSCheckbox.click();
      }

      // default test env has system light theme set
      await assertAppliedTheme("GristLight");

      // if using chromium web driver, fake the system color scheme to dark and wait for the theme to change
      if ((driver as ChromiumWebDriver).sendDevToolsCommand) {
        await (driver as ChromiumWebDriver).sendDevToolsCommand("Emulation.setEmulatedMedia", { features: [
          { name: "prefers-color-scheme", value: "dark" },
        ] });
        await driver.sleep(500);
        await assertAppliedTheme("GristDark");

        // reset back to default light system appearance
        await (driver as ChromiumWebDriver).sendDevToolsCommand("Emulation.setEmulatedMedia", { features: [
          { name: "prefers-color-scheme", value: "light" },
        ] });
        await driver.sleep(500);
        await assertAppliedTheme("GristLight");
      }
    });

    it("should allow user to select a theme when sync with OS is disabled", async function() {
      await shouldAllowThemeSelection();
    });

    it("should apply the selected theme", async function() {
      await shouldApplyThemes();
    });
  });

  describe("with env APP_STATIC_INCLUDE_CUSTOM_CSS=true", function() {
    this.timeout(60000);
    setupTestSuite();

    gu.withEnvironmentSnapshot({
      APP_STATIC_INCLUDE_CUSTOM_CSS: "true",
    });

    beforeEach(async function() {
      const session = await gu.session().teamSite.login();
      await session.loadDocMenu("/");
      await gu.openProfileSettingsPage();
    });

    afterEach(async function() {
      // reset to default state
      await enableSyncWithOS();
    });

    it("should have a link to the custom CSS file", async function() {
      const customCssTag = await driver.findElements(
        By.css("link#grist-custom-css"),
      );
      assert.exists(customCssTag[0], "Custom CSS link html element should be present");
    });

    it("should allow selecting a theme", async function() {
      await shouldAllowThemeSelection();
    });

    it("should apply the selected theme", async function() {
      await shouldApplyThemes();
    });
  });

  describe("with env GRIST_HIDE_UI_ELEMENTS=themes", function() {
    this.timeout(60000);
    setupTestSuite();

    gu.withEnvironmentSnapshot({
      GRIST_HIDE_UI_ELEMENTS: "themes",
    });

    beforeEach(async function() {
      const session = await gu.session().teamSite.login();
      await session.loadDocMenu("/");
      await gu.openProfileSettingsPage();
    });

    it("should not allow theme selection", async function() {
      await assertThemesAreDisabled();
    });
  });

  describe("with both envs (custom css enabled + themes disabled)", function() {
    this.timeout(60000);
    setupTestSuite();

    gu.withEnvironmentSnapshot({
      APP_STATIC_INCLUDE_CUSTOM_CSS: "true",
      GRIST_HIDE_UI_ELEMENTS: "themes",
    });

    beforeEach(async function() {
      const session = await gu.session().teamSite.login();
      await session.loadDocMenu("/");
      await gu.openProfileSettingsPage();
    });

    it("should not allow theme selection", async function() {
      await assertThemesAreDisabled();
    });
  });
});

async function enableSyncWithOS() {
  const syncWithOSCheckbox = await findSyncWithOSCheckbox();
  const isSelected = await syncWithOSCheckbox.isSelected();
  if (!isSelected) {
    await syncWithOSCheckbox.click();
  }
}

async function shouldAllowThemeSelection() {
  await gu.openProfileSettingsPage();

  const syncWithOSCheckbox = await findSyncWithOSCheckbox();
  const isSelected = await syncWithOSCheckbox.isSelected();
  if (isSelected) {
    await syncWithOSCheckbox.click();
  }
  await gu.scrollIntoView(driver.findWait(appearanceSelectCssSelector, 500));
  await driver.findWait(appearanceSelectCssSelector, 500).click();
  assert.deepEqual(
    await gu.findOpenMenuAllItems("li", el => el.getText()),
    ["Light", "Dark", "Light (High Contrast)"],
  );
  await driver.sendKeys(Key.ESCAPE);    // Close menu.
}

async function shouldApplyThemes() {
  await gu.setGristTheme({ themeName: "GristLight", syncWithOS: false });
  await assertAppliedTheme("GristLight");

  await gu.setGristTheme({ themeName: "GristDark", syncWithOS: false });
  await assertAppliedTheme("GristDark");

  await gu.setGristTheme({ themeName: "HighContrastLight", syncWithOS: false });
  await assertAppliedTheme("HighContrastLight");
}

async function assertThemesAreDisabled() {
  const appearanceSelect = await driver.findElements(
    By.css(".test-theme-config-appearance .test-select-open"),
  );
  const syncWithOSCheckbox = await driver.findElements(
    By.css(".test-theme-config-sync-with-os"),
  );
  assert.isEmpty(appearanceSelect, "Appearance select should not be shown");
  assert.isEmpty(syncWithOSCheckbox, "Sync with OS checkbox should not be shown");
}
