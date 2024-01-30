import {assert, createDriver, driver, WebDriver} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';

describe("LanguageSettings", function() {
  this.timeout('50s');
  const cleanup = setupTestSuite();

  before(async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
  });

  // List of languages that chrome supports https://developer.chrome.com/docs/webstore/i18n/#localeTable
  const locales = [ // [language to set in the browser, country code detected, language name detected]
    ['fr', 'FR', 'Français'],
    ['te', 'US', 'English'], // Telugu is not supported yet, so Grist should fallback to English (US).
    ['en', 'US', 'English'], // This is a default language for Grist.
    ['pt-BR', 'BR', 'Português (Brasil)']
  ];

  for (const [locale, countryCode, language] of locales) {
    describe(`correctly detects browser language ${locale}`, () => {
      // Change the language to the one we want to test.
      const skipStatus = withLang(locale);
      before(async function() {
        if (skipStatus.skipped) { return; }
        const session = await gu.session().personalSite.anon.login();
        await session.loadRelPath("/");
        await gu.waitForDocMenuToLoad();
      });
      it("shows correct language from browser settings", async () => {
        // Find the button to switch the language.
        const button = await langButton();
        assert.isTrue(await button.isDisplayed());
        // Make sure correct flag is shown.
        const flag = await button.find(".test-language-button-icon").getCssValue("background-image");
        assert.isTrue(flag.endsWith(countryCode + '.svg")'), `Flag is ${flag} search for ${countryCode}`);
        // Make sure we see the all languages in the menu.
        await button.click();
        const menu = await gu.currentDriver().findWait(".grist-floating-menu", 100);
        const allLangues = (await menu.findAll("li", e => e.getText())).map(l => l.toLowerCase());
        for (const [, , language] of locales) {
          assert.include(allLangues, language.toLowerCase());
        }
        // Make sure that this language is selected.
        assert.equal(await selectedLang(), language.toLowerCase());
        // Smoke test that we see the correct language.
        const welcomeText = await gu.currentDriver().find(".test-welcome-title").getText();
        if (locale === 'en') {
          assert.equal(welcomeText, "Welcome to Grist!");
        } else if (locale === 'fr') {
          assert.equal(welcomeText, "Bienvenue sur Grist !");
        }
      });
    });
  }

  describe("for Anonymous", function() {
    before(async function() {
      const session = await gu.session().personalSite.anon.login();
      await session.loadRelPath("/");
      await gu.waitForDocMenuToLoad();
    });
    it("allows anonymous user to switch a language", async () => {
      await langButton().click();
      // By default we have English (US) selected.
      assert.equal(await selectedLang(), "english");
      // Change to French.
      await gu.currentDriver().find(".test-language-lang-fr").click();
      // We will be reloaded, so wait until we see the new language.
      await waitForLangButton("fr");
      // Now we have a cookie with the language selected, so reloading the page should keep it.
      await gu.currentDriver().navigate().refresh();
      await gu.waitForDocMenuToLoad();
      await waitForLangButton("fr");
      assert.equal(await languageInCookie(), "fr");
      // Switch to German.
      await langButton().click();
      await gu.currentDriver().find(".test-language-lang-de").click();
      await waitForLangButton("de");
      // Make sure we see new cookie.
      assert.equal(await languageInCookie(), "de");
      // Remove the cookie and reload.
      await clearCookie();
      await gu.currentDriver().navigate().refresh();
      await gu.waitForDocMenuToLoad();
      // Make sure we see the default language.
      await waitForLangButton("en");
      // Test if changing the cookie is reflected in the UI. This cookie is available for javascript.
      await setCookie("fr");
      await gu.currentDriver().navigate().refresh();
      await gu.waitForDocMenuToLoad();
      await waitForLangButton("fr");
      assert.equal(await languageInCookie(), "fr");
      // Go back to English.
      await clearCookie();
      await gu.currentDriver().navigate().refresh();
      await gu.waitForDocMenuToLoad();
    });
    it("when user is logged in the language is still taken from the cookie", async () => {
      await langButton().click();
      // By default we have English (US) selected ()
      assert.equal(await selectedLang(), "english");

      // Now login to the account.
      const user = await gu.session().personalSite.user('user1').login();
      await user.loadRelPath("/");
      await gu.waitForDocMenuToLoad();
      // Language should still be english.
      await waitForHiddenButton("en");
      // And we should not have a cookie.
      assert.isNull(await languageInCookie());

      // Go back to anonymous.
      const anonym = await gu.session().personalSite.anon.login();
      await anonym.loadRelPath("/");
      await gu.waitForDocMenuToLoad();
      assert.isNull(await languageInCookie());

      // Change language to french.
      await langButton().click();
      await driver.find(".test-language-lang-fr").click();
      await waitForLangButton("fr");
      assert.equal(await languageInCookie(), "fr");

      // Login as user.
      await user.login();
      await anonym.loadRelPath("/");
      await gu.waitForDocMenuToLoad();
      // But now we should have a cookie (cookie is reused).
      assert.equal(await languageInCookie(), 'fr');

      // Language should still be french.
      await waitForHiddenButton("fr");
      await clearCookie();
    });
  });

  describe("for logged in user with nb-NO", function() {
    const skipStatus = withLang("de");
    let session: gu.Session;
    before(async function() {
      if (skipStatus.skipped) { return; }
      session = await gu.session().login();
      await session.loadRelPath("/");
      await gu.waitForDocMenuToLoad();
    });
    after(async function() {
      if (skipStatus.skipped) { return; }
      await clearCookie();
      const api = session.createHomeApi();
      await api.updateUserLocale(null);
    });
    it("profile page detects correct language", async () => {
      const driver = gu.currentDriver();
      // Make sure we don't have a cookie yet.
      assert.isNull(await languageInCookie());
      // Or a saved setting.
      let gristConfig: any = await driver.executeScript("return window.gristConfig");
      assert.isNull(gristConfig.userLocale);
      await gu.openProfileSettingsPage();
      // Make sure we see the correct language.
      assert.equal(await languageMenu().getText(), "Deutsch");
      // Make sure we see hidden indicator.
      await waitForHiddenButton("de");
      // Change language to nb-.NO
      await languageMenu().click();
      await driver.findContentWait('.test-select-menu li', 'Norsk bokmål (Norge)', 100).click();
      // This is api call and we will be reloaded, so wait for the hidden indicator.
      await waitForHiddenButton("nb-NO");
      // Now we should have a cookie.
      assert.equal(await languageInCookie(), "nb-NO");
      // And the gristConfig should have this language.
      gristConfig = await driver.executeScript("return window.gristConfig");
      assert.equal(gristConfig.userLocale, "nb-NO");
      // If we remove the cookie, we should still use the gristConfig.
      await clearCookie();
      await driver.navigate().refresh();
      await waitForHiddenButton("nb-NO");
      // If we set a different cookie, we should still use the saved setting.
      await setCookie("de");
      await driver.navigate().refresh();
      await waitForHiddenButton("nb-NO");
      // Make sure this works on the document, by adding a new doc and smoke testing the Add New button.
      await session.tempNewDoc(cleanup, "Test");
      assert.equal(await driver.findWait(".test-dp-add-new", 3000).getText(), "Legg til ny");
    });
  });
});


function languageMenu() {
  return gu.currentDriver().find('.test-account-page-language .test-select-open');
}

async function clearCookie() {
  await gu.currentDriver().executeScript(
    "document.cookie = 'grist_user_locale=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';");
}

async function setCookie(locale: string) {
  await gu.currentDriver().executeScript(
    `document.cookie = 'grist_user_locale=${locale}; expires=Thu, 01 Jan 2970 00:00:00 UTC; path=/;';`);
}

async function waitForLangButton(locale: string) {
  await gu.waitToPass(async () =>
    assert.isTrue(await gu.currentDriver().findWait(`.test-language-current-${locale}`, 1000).isDisplayed()), 4000);
}

async function waitForHiddenButton(locale: string) {
  await gu.waitToPass(async () =>
    assert.isTrue(await gu.currentDriver().findWait(`input.test-language-current-${locale}`, 1000).isPresent()), 4000);
}

async function languageInCookie(): Promise<string | null> {
  const cookie2: string = await gu.currentDriver().executeScript("return document.cookie");
  return cookie2.match(/grist_user_locale=([^;]+)/)?.[1] ?? null;
}

function withLang(locale: string): {skipped: boolean} {
  let customDriver: WebDriver;
  let oldLanguage: string | undefined;
  const skipStatus = {skipped: false};
  before(async function() {
    // On Mac we can't change the language (except for English), so skip the test.
    if (await gu.isMac() && locale !== 'en') { skipStatus.skipped = true; return this.skip(); }
    oldLanguage = process.env.LANGUAGE;
    // How to run chrome with a different language:
    // https://developer.chrome.com/docs/extensions/reference/i18n/#how-to-set-browsers-locale
    process.env.LANGUAGE = locale;
    customDriver = await createDriver({
      extraArgs: [
        'lang=' + locale,
        ...(process.env.MOCHA_WEBDRIVER_HEADLESS ? [`headless=chrome`] : [])
      ]
    });
    server.setDriver(customDriver);
    gu.setDriver(customDriver);
    const session = await gu.session().personalSite.anon.login();
    await session.loadRelPath("/");
    await gu.waitForDocMenuToLoad();
  });
  after(async function() {
    if (skipStatus.skipped) { return; }
    gu.setDriver();
    server.setDriver();
    await customDriver.quit();
    process.env.LANGUAGE = oldLanguage;
  });
  return skipStatus;
}

function langButton() {
  return gu.currentDriver().findWait(".test-language-button", 500);
}

async function selectedLang() {
  const menu = gu.currentDriver().findWait(".grist-floating-menu", 100);
  return (await menu.find(".test-language-selected").findClosest("li").getText()).toLowerCase();
}
