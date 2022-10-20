import * as gu from 'test/nbrowser/gristUtils';
import {server, setupTestSuite} from 'test/nbrowser/testUtils';
import {assert, driver} from 'mocha-webdriver';
import * as testUtils from 'test/server/testUtils';
import {getAppRoot} from 'app/server/lib/places';
import fetch from "node-fetch";
import fs from "fs";
import os from "os";
import path from 'path';

describe("Localization", function() {
  this.timeout(20000);
  setupTestSuite();

  before(async function() {
    const session = await gu.session().personalSite.anon.login();
    await session.loadRelPath("/");
  });

  it("uses default options for English language", async function() {
    // Currently, there is not much translated, so test just what we have.
    assert.equal(await driver.findWait('.test-welcome-title', 3000).getText(), 'Welcome to Grist!');
    // Grist config should contain the list of supported languages;
    const gristConfig: any = await driver.executeScript("return window.gristConfig");

    // client and en is required.
    assert.isTrue(gristConfig.namespaces.includes("client"));
    assert.isTrue(gristConfig.supportedLngs.includes("en"));
  });

  it("loads all files from resource folder", async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    // Grist config should contain the list of supported languages;
    const gristConfig: any = await driver.executeScript("return window.gristConfig");
    // Should report all supported languages and namespaces.
    const localeDirectory = path.join(getAppRoot(), 'static', 'locales');
    // Read all file names from localeDirectory
    const langs: Set<string> = new Set();
    const namespaces: Set<string> = new Set();
    for (const file of fs.readdirSync(localeDirectory)) {
      if (file.endsWith(".json")) {
        const lang = file.split('.')[0];
        const ns = file.split('.')[1];
        langs.add(lang);
        namespaces.add(ns);
      }
    }
    assert.deepEqual(gristConfig.supportedLngs.sort(), [...langs].sort());
    assert.deepEqual(gristConfig.namespaces.sort(), [...namespaces].sort());
  });

  // Now make a Polish language file, and test that it is used.
  describe("with Polish language file", function() {
    let oldEnv: testUtils.EnvironmentSnapshot;
    let tempLocale: string;
    let existingLocales: string[];
    before(async function() {
      if (server.isExternalServer()) {
        this.skip();
      }
      const gristConfig: any = await driver.executeScript("return window.gristConfig");
      existingLocales = gristConfig.supportedLngs, ['en', 'fr', 'pl'];
      oldEnv = new testUtils.EnvironmentSnapshot();
      // Add another language to the list of supported languages.
      tempLocale = makeCopy();
      createLanguage(tempLocale, "pl");
      process.env.GRIST_LOCALES_DIR = tempLocale;
      await server.restart();
    });

    after(async () => {
      oldEnv.restore();
      await server.restart();
    });

    it("detects correct language from client headers", async function() {
      const homeUrl = `${server.getHost()}/o/docs`;
      // Read response from server, and check that it contains the correct language.
      const enResponse = await (await fetch(homeUrl)).text();
      const plResponse = await (await fetch(homeUrl, {headers: {"Accept-Language": "pl-PL,pl;q=1"}})).text();
      const ptResponse = await (await fetch(homeUrl, {headers: {"Accept-Language": "pt-PR,pt;q=1"}})).text();

      function present(response: string, ...langs: string[]) {
        for (const lang of langs) {
          assert.include(response, `href="locales/${lang}.client.json"`);
        }
      }

      function notPresent(response: string, ...langs: string[]) {
        for (const lang of langs) {
          assert.notInclude(response, `href="locales/${lang}.client.json"`);
        }
      }

      // English locale is preloaded always.
      present(enResponse, "en");
      present(plResponse, "en");
      present(ptResponse, "en");

      // Other locales are not preloaded for English.
      notPresent(enResponse, "pl", "pl-PL", "en-US");

      // For Polish we have additional pl locale.
      present(plResponse, "pl");
      // But only pl code is preloaded.
      notPresent(plResponse, "pl-PL");

      // For Portuguese we have only en.
      notPresent(ptResponse, "pt", "pt-PR", "pl", "en-US");
    });

    it("loads correct languages from file system", async function() {
      modifyByCode(tempLocale, "en", {HomeIntro: {Welcome: 'TestMessage'}});
      await driver.navigate().refresh();
      assert.equal(await driver.findWait('.test-welcome-title', 3000).getText(), 'TestMessage');
      const gristConfig: any = await driver.executeScript("return window.gristConfig");
      assert.deepEqual(gristConfig.supportedLngs, [...existingLocales, 'pl']);
    });
  });

  it("breaks the server if something is wrong with resource files", async function() {
    if (server.isExternalServer()) {
      this.skip();
    }
    const oldEnv = new testUtils.EnvironmentSnapshot();
    try {
      // Wrong path to locales.
      process.env.GRIST_LOCALES_DIR = __filename;
      await assert.isRejected(server.restart());
      // Empty folder.
      const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'grist_test_'));
      process.env.GRIST_LOCALES_DIR = tempDirectory;
      await assert.isRejected(server.restart());
      // Wrong file format.
      fs.writeFileSync(path.join(tempDirectory, 'dummy.json'), 'invalid json');
      await assert.isRejected(server.restart());
    } finally {
      oldEnv.restore();
      await server.restart();
    }
  });

  /**
   * Creates a new language by coping existing "en" resources.
   */
  function createLanguage(localesPath: string, code: string) {
    for (const file of fs.readdirSync(localesPath)) {
      if (file.startsWith('en.')) {
        const newFile = file.replace('en', code);
        fs.copyFileSync(path.join(localesPath, file), path.join(localesPath, newFile));
      }
    }
  }

  /**
   * Makes a copy of all resource files and returns path to the temporary directory.
   */
  function makeCopy() {
    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'grist_test_'));
    const localeDirectory = path.join(getAppRoot(), 'static', 'locales');
    // Copy all files from localeDirectory to tempDirectory.
    fs.readdirSync(localeDirectory).forEach(file => {
      fs.copyFileSync(path.join(localeDirectory, file), path.join(tempDirectory, file));
    });
    return tempDirectory;
  }

  function modifyByCode(localeDir: string, code: string, obj: any) {
    // Read current client localization file.
    const filePath = path.join(localeDir, `${code}.client.json`);
    const resources = JSON.parse(fs.readFileSync(filePath).toString());
    const newResource = Object.assign(resources, obj);
    fs.writeFileSync(filePath, JSON.stringify(newResource));
  }
});
