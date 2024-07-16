/**
 * Contains some non-webdriver functionality needed by tests.
 */
import FormData from 'form-data';
import fetch from 'node-fetch';
import { DocWorkerAPI, UserAPI, UserAPIImpl, UserProfile } from 'app/common/UserAPI';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { TestingHooksClient } from 'app/server/lib/TestingHooks';
import { BrowserContext, expect, Page } from "@playwright/test";
import { UserPrefs } from "app/common/Prefs";
import { ALL_TIPS_DISABLED, ALL_TIPS_ENABLED } from "./homeUtil";
import { normalizeEmail } from "app/common/emails";
import EventEmitter = require('events');
import defaults = require('lodash/defaults');
import { authenticator } from "otplib";
import path from "path";
import * as fse from "fs-extra";

export interface Server extends EventEmitter {
  getTestingHooks(): Promise<TestingHooksClient>;
  getHost(): string;
  getUrl(team: string, relPath: string): string;
  getDatabase(): Promise<HomeDBManager>;
  isExternalServer(): boolean;
}

export class HomeUtil {
  // Cache api keys of test users.  It is often convenient to have various instances
  // of the home api available while making browser tests.
  private _apiKey = new Map<string, string>();

  constructor(public fixturesRoot: string, public server: Server) {
    server.on('stop', () => {
      this._apiKey.clear();
    });
  }

   /**
   * Set current session to a simulated login with the given name and email. Available options
   * include:
   *   - `loginMethod`: when provided will store in the database which method the
   *     user nominally logged in with (e.g. 'Email + Password' or 'Google').
   *   - `isFirstLogin`: when provided will cause user to be redirected or not to the
   *     welcome pages.
   *   - `freshAccount`: when true will cause the user account to be deleted and
   *     recreated if it already existed.
   *   - `cacheCredentials`: when true will result in the user's api key being stored
   *     (after having been created if necessary), so that their home api can be later
   *     instantiated without page loads.
   * When testing against an external server, the simulated login is in fact genuine,
   * done via the Grist login page.
   */
  public async simulateLogin(page: Page, name: string, email: string, org: string = "", options: {
    loginMethod?: UserProfile['loginMethod'],
    freshAccount?: boolean,
    isFirstLogin?: boolean,
    showGristTour?: boolean,
    showTips?: boolean,
    cacheCredentials?: boolean,
  } = {}) {
    const {loginMethod, isFirstLogin, showTips} = defaults(options, {
      loginMethod: 'Email + Password',
      showTips: false,
    });

    const showGristTour = options.showGristTour ?? (options.freshAccount ?? isFirstLogin);

    // For regular tests, we can log in through a testing hook.
    if (!this.server.isExternalServer()) {
      if (options.freshAccount) { await this._deleteUserByEmail(email); }
      if (isFirstLogin !== undefined) { await this._setFirstLogin(email, isFirstLogin); }
      if (showGristTour !== undefined) { await this._initShowGristTour(email, showGristTour); }
      if (showTips) {
        await this.enableTips(page, email);
      } else {
        await this.disableTips(page, email);
      }
      // TestingHooks communicates via JSON, so it's impossible to send an `undefined` value for org
      // through it. Using the empty string happens to work though.
      const testingHooks = await this.server.getTestingHooks();
      const sid = await this.getGristSid(page.context());
      if (!sid) { throw new Error('no session available'); }
      await testingHooks.setLoginSessionProfile(
        sid,
        {name, email, loginEmail: normalizeEmail(email), loginMethod},
        org
      );
    } else {
      if (loginMethod && loginMethod !== 'Email + Password') {
        throw new Error('only Email + Password logins supported for external server tests');
      }
      // Make sure we revisit page in case login is changing.
      await page.goto('about:blank');
      // When running against an external server, we log in through the Grist login page.
      await page.goto(this.server.getUrl(org, ""));
      if (!await this.isOnLoginPage(page)) {
        // Explicitly click Sign In button if necessary.
        await page.locator('css=.test-user-sign-in').click({ timeout: 4000 });
      }

      // Fill the login form (either test or Grist).
      if (await this.isOnTestLoginPage(page)) {
        await this.fillTestLoginForm(page, email, name);
      } else {
        await this.fillGristLoginForm(page, email);
      }

      if (!await this.isWelcomePage(page) && (options.freshAccount || options.isFirstLogin)) {
        await this._recreateCurrentUser(page, email, org, name);
      }
    }
    if (options.freshAccount) {
      this._apiKey.delete(email);
    }
    if (options.cacheCredentials) {
      // Take this opportunity to cache access info.
      if (!this._apiKey.has(email)) {
        await page.goto(this.server.getUrl(org || 'docs', ''));
        const apiKey = await this._getApiKey(page);
        this._apiKey.set(email, apiKey);
      }
    }
  }

  /**
   * Fill the Grist test login page.
   *
   * TEST_ACCOUNT_PASSWORD must be set.
   */
  public async fillTestLoginForm(page: Page, email: string, name?: string) {
    const password = process.env.TEST_ACCOUNT_PASSWORD;
    if (!password) { throw new Error('TEST_ACCOUNT_PASSWORD not set'); }

    const form = page.locator('css=div.modal-content-desktop');
    await form.locator('css=input[name="username"]').fill(email);
    if (name) {
      await form.locator('css=input[name="name"]').fill(name);
    }
    await form.locator('css=input[name="password"]').fill(password);
    await form.locator('css=input[name="signInSubmitButton"]').click();
  }

    /**
   * Fill up the Grist login page form, and submit. If called with a user that
   * has TOTP-based 2FA enabled, TEST_ACCOUNT_TOTP_SECRET must be set for a valid
   * code to be submitted on the following form.
   *
   * Should be on the Grist login or sign-up page before calling this method. If
   * `password` is not passed in, TEST_ACCOUNT_PASSWORD must be set.
   */
  public async fillGristLoginForm(page: Page, email: string, password?: string) {
      if (!password) {
        password = process.env.TEST_ACCOUNT_PASSWORD;
        if (!password) {
          throw new Error('TEST_ACCOUNT_PASSWORD not set');
        }
      }
      await this.checkGristLoginPage(page);

      if (page.url().match(/signup\?/)) {
        await page.locator('css=a[href*="login?"]').click({ timeout: 4000 });
      }

      await page.locator('css=input[name="email"]').fill(email);
      await page.locator('css=input[name="password"]').fill(password);
      await page.locator('css=.test-lp-sign-in').click();
      await this.checkGristLoginPage(page, 4000);
      if (!(await (page.locator('css=.test-mfa-title').getByText('Almost there!').count()) > 0)) {
        return;
      }

      const secret = process.env.TEST_ACCOUNT_TOTP_SECRET;
      if (!secret) {
        throw new Error('TEST_ACCOUNT_TOTP_SECRET not set');
      }

      const code = authenticator.generate(secret);
      await page.locator('css=input[name="verificationCode"]').fill(code);
      await page.locator('css=.test-mfa-submit').click();
      await expect(
        page.locator('css=.test-mfa-title:has-text("Almost there!")'),
        'Possible reason: verification code is invalid or expired (i.e. was recently used to log in)'
      ).toBeAttached();
    }

  /**
   * Remove any simulated login from the current session (for the given org, if specified).
   * For testing against an external server, all logins are removed, since there's no way
   * to be more nuanced.
   */
  public async removeLogin(page: Page, org: string = "") {
    // If cursor is on field editor, escape before remove login
    await page.keyboard.press('Escape');
    if (!this.server.isExternalServer()) {
      const testingHooks = await this.server.getTestingHooks();
      const sid = await this.getGristSid(page.context());
      if (sid) { await testingHooks.setLoginSessionProfile(sid, null, org); }
    } else {
      await page.goto(`${this.server.getHost()}/logout`);
    }
  }

  /**
   * Delete the currently logged in user.
   */
  public async deleteCurrentUser(page: Page) {
    const apiKey = await this._getApiKey(page);
    const api = this._createHomeApiUsingApiKey(apiKey);
    const info = await api.getSessionActive();
    await api.deleteUser(info.user.id, info.user.name);
  }

  /**
   * Returns the current Grist session-id (for the selenium browser accessing this server),
   * or null if there is no session.
   */
  public async getGristSid(context: BrowserContext): Promise<string|null> {
    // Load a cheap page on our server to get the session-id cookie from browser.
    const newPage = await context.newPage();
    await newPage.goto(`${this.server.getHost()}/test/session`);
    const cookie = (await context.cookies())
      .find(cookie => cookie.name === (process.env.GRIST_SESSION_COOKIE || 'grist_sid'));
    if (!cookie) { return null; }
    return decodeURIComponent(cookie.value);
  }

  /**
   * Create a new document.
   */
  public async createNewDoc(username: string, org: string, workspace: string, docName: string,
                            options: {email?: string} = {}) {
    const homeApi = this.createHomeApi(username, org, options.email);
    const workspaceId = await this.getWorkspaceId(homeApi, workspace);
    return await homeApi.newDoc({name: docName}, workspaceId);
  }

  /**
   * Create a copy of a doc. Similar to importFixturesDoc, but starts with an existing docId.
   */
  public async copyDoc(username: string, org: string, workspace: string,
                       docId: string, options: {newName?: string} = {}) {
    const homeApi = this.createHomeApi(username, org);
    const docWorker = await homeApi.getWorkerAPI('import');
    const workspaceId = await this.getWorkspaceId(homeApi, workspace);
    const uploadId = await docWorker.copyDoc(docId);
    return docWorker.importDocToWorkspace(uploadId, workspaceId);
  }

  // A helper that find a workspace id by name for a given username and org.
  public async getWorkspaceId(homeApi: UserAPIImpl, workspace: string): Promise<number> {
    return (await homeApi.getOrgWorkspaces('current')).find((w) => w.name === workspace)!.id;
  }

  // A helper that returns the list of names of all documents within a workspace.
  public async listDocs(homeApi: UserAPI, wid: number): Promise<string[]> {
    const workspace = await homeApi.getWorkspace(wid);
    return workspace.docs.map(d => d.name);
  }

  // A helper to create a UserAPI instance for a given useranme and org, that targets the home server
  // Username can be null for anonymous access.
  public createHomeApi(username: string|null, org: string, email?: string): UserAPIImpl {
    const apiKey = this.getApiKey(username, email);
    return this._createHomeApiUsingApiKey(apiKey, org);
  }

  public getApiKey(username: string|null, email?: string): string | null {
    const name = (username || '').toLowerCase();
    const apiKey = username && ((email && this._apiKey.get(email)) || `api_key_for_${name}`);
    return apiKey;
  }

  /**
   * Returns whether we are currently on any login page (including the test page).
   */
  public async isOnLoginPage(page: Page) {
    return await this.isOnGristLoginPage(page) || await this.isOnTestLoginPage(page);
  }

  /**
   * Returns whether we are currently on a Grist login page.
   */
  public async isOnGristLoginPage(page: Page) {
    const isOnSignupPage = await page.locator('css=.test-sp-heading').count() > 0;
    const isOnLoginPage = await page.locator('css=.test-lp-heading').count() > 0;
    return isOnSignupPage || isOnLoginPage;
  }

  /**
   * Returns whether we are currently on the test login page.
   */
  public async isOnTestLoginPage(page: Page) {
    return await page.getByText('A Very Credulous Login Page').count() > 0;
  }

  /**
   * Waits for browser to navigate to a Grist login page.
   */
  public async checkGristLoginPage(page: Page, waitMs: number = 2000) {
    const isOnSignUpPage = await page.locator('css=.test-sp-heading').waitFor({ timeout: waitMs });
    const isOnLoginPage = await page.locator('css=.test-lp-heading').waitFor({ timeout: waitMs });
    await Promise.race([isOnSignUpPage, isOnLoginPage]);
  }

  /**
   * Delete and recreate the user, via the specified org.  The specified user must be
   * currently logged in!
   */
  private async _recreateCurrentUser(page: Page, email: string, org: string, name?: string) {
    await this.deleteCurrentUser(page);
    await this.removeLogin(page, org);
    await page.goto(this.server.getUrl(org, ""));
    await page.locator('css=.test-user-sign-in').click({ timeout: 4000 });
    await this.checkGristLoginPage(page);
    // Fill the login form (either test or Grist).
    if (await this.isOnTestLoginPage(page)) {
      await this.fillTestLoginForm(page, email, name);
    } else {
      await this.fillGristLoginForm(page, email);
    }
  }


  public async enableTips(page: Page, email: string) {
    await this._toggleTips(page, true, email);
  }

  public async disableTips(page: Page, email: string) {
    await this._toggleTips(page, false, email);
  }

  // Check if the url looks like a welcome page.  The check is weak, but good enough
  // for testing.
  public async isWelcomePage(page: Page) {
    return Boolean(page.url().match(/\/welcome\//));
  }

  /**
   * Import a fixture doc into a workspace.
   */
  public async importFixturesDoc(username: string, org: string, workspace: string,
                                 filename: string, options: {newName?: string, email?: string} = {}) {
    const homeApi = this.createHomeApi(username, org, options.email);
    const docWorker = await homeApi.getWorkerAPI('import');
    const workspaceId = await this.getWorkspaceId(homeApi, workspace);
    const uploadId = await this.uploadFixtureDoc(docWorker, filename, options.newName);
    return docWorker.importDocToWorkspace(uploadId, workspaceId);
  }

  public async uploadFixtureDoc(docWorker: DocWorkerAPI, filename: string, newName: string = filename) {
    const filepath = path.resolve(this.fixturesRoot, "docs", filename);
    if (!await fse.pathExists(filepath)) {
      throw new Error(`Can't find file: ${filepath}`);
    }
    const fileStream = fse.createReadStream(filepath);
    // node-fetch can upload streams, although browser fetch can't
    return docWorker.upload(fileStream as any, newName);
  }

  private async _getApiKey(page: Page): Promise<string> {
    return page.evaluate(() => {
      const app = (window as any).gristApp;
      if (!app) { return ""; }
      const api: UserAPI = app.topAppModel.api;
      return api.fetchApiKey().then(key => {
        if (key) { return key; }
        return api.createApiKey();
      }).catch(() => "");
    });
  }

  // Make a home api instance with the given api key, for the specified org.
  // If no api key given, work anonymously.
  private _createHomeApiUsingApiKey(apiKey: string|null, org?: string): UserAPIImpl {
    const headers = apiKey ? {Authorization: `Bearer ${apiKey}`} : undefined;
    return new UserAPIImpl(org ? this.server.getUrl(org, '') : this.server.getHost(), {
      headers,
      fetch: fetch as any,
      newFormData: () => new FormData() as any,  // form-data isn't quite type compatible
    });
  }

  private async _toggleTips(page: Page, enabled: boolean, email: string) {
    if (this.server.isExternalServer()) {
      // Unsupported due to lack of access to the database.
      return;
    }

    const dbManager = await this.server.getDatabase();
    const user = await dbManager.getUserByLogin(email);
    if (!user) { return; }

    if (user.personalOrg) {
      const org = await dbManager.getOrg({userId: user.id}, user.personalOrg.id);
      const userPrefs = (org.data as any)?.userPrefs ?? {};
      const newUserPrefs: UserPrefs = {
        ...userPrefs,
        ...(enabled ? ALL_TIPS_ENABLED : ALL_TIPS_DISABLED),
      };
      await dbManager.updateOrg({userId: user.id}, user.personalOrg.id, {userPrefs: newUserPrefs});
    } else {
      await page.evaluate(() => {
        const userPrefs = JSON.parse(localStorage.getItem('userPrefs:u=${user.id}') || '{}');
        localStorage.setItem('userPrefs:u=${user.id}', JSON.stringify({
          ...userPrefs,
          ...(enabled ? ALL_TIPS_ENABLED : ALL_TIPS_DISABLED),
        }));
      });
    }
  }

  // Delete a user using their email address.  Requires access to the database.
  private async _deleteUserByEmail(email: string) {
    if (this.server.isExternalServer()) { throw new Error('not supported'); }
    const dbManager = await this.server.getDatabase();
    const user = await dbManager.getUserByLogin(email);
    if (user) { await dbManager.deleteUser({userId: user.id}, user.id, user.name); }
  }

  // Set whether this is the user's first time logging in.  Requires access to the database.
  private async _setFirstLogin(email: string, isFirstLogin: boolean) {
    if (this.server.isExternalServer()) { throw new Error('not supported'); }
    const dbManager = await this.server.getDatabase();
    const user = await dbManager.getUserByLogin(email);
    if (user) {
      user.isFirstTimeUser = isFirstLogin;
      await user.save();
    }
  }

  private async _initShowGristTour(email: string, showGristTour: boolean) {
    if (this.server.isExternalServer()) { throw new Error('not supported'); }
    const dbManager = await this.server.getDatabase();
    const user = await dbManager.getUserByLogin(email);
    if (user && user.personalOrg) {
      const userOrgPrefs = {showGristTour};
      await dbManager.updateOrg({userId: user.id}, user.personalOrg.id, {userOrgPrefs});
    }
  }
}
