/**
 * Contains some non-webdriver functionality needed by tests.
 */
import FormData from 'form-data';
import * as fse from 'fs-extra';
import defaults = require('lodash/defaults');
import {Key, WebDriver, WebElement} from 'mocha-webdriver';
import fetch from 'node-fetch';
import {authenticator} from 'otplib';
import * as path from 'path';

import {UserProfile} from 'app/common/LoginSessionAPI';
import {BehavioralPrompt, UserPrefs, WelcomePopup} from 'app/common/Prefs';
import {DocWorkerAPI, UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {TestingHooksClient} from 'app/server/lib/TestingHooks';
import EventEmitter = require('events');

export interface Server extends EventEmitter {
  driver: WebDriver;
  getTestingHooks(): Promise<TestingHooksClient>;
  getHost(): string;
  getUrl(team: string, relPath: string): string;
  getDatabase(): Promise<HomeDBManager>;
  isExternalServer(): boolean;
}

const ALL_TIPS_ENABLED = {
  behavioralPrompts: {
    dontShowTips: false,
    dismissedTips: [],
  },
  dismissedWelcomePopups: [],
};

const ALL_TIPS_DISABLED = {
  behavioralPrompts: {
    dontShowTips: true,
    dismissedTips: BehavioralPrompt.values,
  },
  dismissedWelcomePopups: WelcomePopup.values.map(id => {
    return {
      id,
      lastDismissedAt: 0,
      nextAppearanceAt: null,
      timesDismissed: 1,
    };
  }),
};

export class HomeUtil {
  // Cache api keys of test users.  It is often convenient to have various instances
  // of the home api available while making browser tests.
  private _apiKey = new Map<string, string>();

  constructor(public fixturesRoot: string, public server: Server) {
    server.on('stop', () => {
      this._apiKey.clear();
    });
  }

  public get driver(): WebDriver { return this.server.driver; }

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
  public async simulateLogin(name: string, email: string, org: string = "", options: {
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
        await this.enableTips(email);
      } else {
        await this.disableTips(email);
      }
      // TestingHooks communicates via JSON, so it's impossible to send an `undefined` value for org
      // through it. Using the empty string happens to work though.
      const testingHooks = await this.server.getTestingHooks();
      const sid = await this.getGristSid();
      if (!sid) { throw new Error('no session available'); }
      await testingHooks.setLoginSessionProfile(sid, {name, email, loginMethod}, org);
    } else {
      if (loginMethod && loginMethod !== 'Email + Password') {
        throw new Error('only Email + Password logins supported for external server tests');
      }
      // Make sure we revisit page in case login is changing.
      await this.driver.get('about:blank');
      await this._acceptAlertIfPresent();
      // When running against an external server, we log in through the Grist login page.
      await this.driver.get(this.server.getUrl(org, ""));
      if (!await this.isOnLoginPage()) {
        // Explicitly click Sign In button if necessary.
        await this.driver.findWait('.test-user-sign-in', 4000).click();
      }

      // Fill the login form (either test or Grist).
      if (await this.isOnTestLoginPage()) {
        await this.fillTestLoginForm(email, name);
      } else {
        await this.fillGristLoginForm(email);
      }

      if (!await this.isWelcomePage() && (options.freshAccount || options.isFirstLogin)) {
        await this._recreateCurrentUser(email, org, name);
      }
    }
    if (options.freshAccount) {
      this._apiKey.delete(email);
    }
    if (options.cacheCredentials) {
      // Take this opportunity to cache access info.
      if (!this._apiKey.has(email)) {
        await this.driver.get(this.server.getUrl(org || 'docs', ''));
        const apiKey = await this._getApiKey();
        this._apiKey.set(email, apiKey);
      }
    }
  }

  /**
   * Remove any simulated login from the current session (for the given org, if specified).
   * For testing against an external server, all logins are removed, since there's no way
   * to be more nuanced.
   */
  public async removeLogin(org: string = "") {
    // If cursor is on field editor, escape before remove login
    await this.driver.sendKeys(Key.ESCAPE);
    if (!this.server.isExternalServer()) {
      const testingHooks = await this.server.getTestingHooks();
      const sid = await this.getGristSid();
      if (sid) { await testingHooks.setLoginSessionProfile(sid, null, org); }
    } else {
      await this.driver.get(`${this.server.getHost()}/logout`);
      await this._acceptAlertIfPresent();
    }
  }

  public async enableTips(email: string) {
    await this._toggleTips(true, email);
  }

  public async disableTips(email: string) {
    await this._toggleTips(false, email);
  }

  // Check if the url looks like a welcome page.  The check is weak, but good enough
  // for testing.
  public async isWelcomePage() {
    const url = await this.driver.getCurrentUrl();
    return Boolean(url.match(/\/welcome\//));
  }

  /**
   * Fill the Grist test login page.
   *
   * TEST_ACCOUNT_PASSWORD must be set.
   */
  public async fillTestLoginForm(email: string, name?: string) {
    const password = process.env.TEST_ACCOUNT_PASSWORD;
    if (!password) { throw new Error('TEST_ACCOUNT_PASSWORD not set'); }

    const form = await this.driver.find('div.modal-content-desktop');
    await this.setValue(form.find('input[name="username"]'), email);
    if (name) { await this.setValue(form.find('input[name="name"]'), name); }
    await this.setValue(form.find('input[name="password"]'), password);
    await form.find('input[name="signInSubmitButton"]').click();
  }

  /**
   * Fill up the Grist login page form, and submit. If called with a user that
   * has TOTP-based 2FA enabled, TEST_ACCOUNT_TOTP_SECRET must be set for a valid
   * code to be submitted on the following form.
   *
   * Should be on the Grist login or sign-up page before calling this method. If
   * `password` is not passed in, TEST_ACCOUNT_PASSWORD must be set.
   */
  public async fillGristLoginForm(email: string, password?: string) {
    if (!password) {
      password = process.env.TEST_ACCOUNT_PASSWORD;
      if (!password) {
        throw new Error('TEST_ACCOUNT_PASSWORD not set');
      }
    }
    await this.checkGristLoginPage();
    if ((await this.driver.getCurrentUrl()).match(/signup\?/)) {
      await this.driver.findWait('a[href*="login?"]', 4000).click();
    }

    await this.driver.findWait('input[name="email"]', 4000).sendKeys(email);
    await this.driver.find('input[name="password"]').sendKeys(password);
    await this.driver.find('.test-lp-sign-in').click();
    await this.driver.wait(async () => !await this.isOnGristLoginPage(), 4000);
    if (!await this.driver.findContent('.test-mfa-title', 'Almost there!').isPresent()) {
      return;
    }

    const secret = process.env.TEST_ACCOUNT_TOTP_SECRET;
    if (!secret) { throw new Error('TEST_ACCOUNT_TOTP_SECRET not set'); }

    const code = authenticator.generate(secret);
    await this.driver.find('input[name="verificationCode"]').sendKeys(code);
    await this.driver.find('.test-mfa-submit').click();
    await this.driver.wait(
      async () => {
        return !await this.driver.findContent('.test-mfa-title', 'Almost there!').isPresent();
      },
      4000,
      'Possible reason: verification code is invalid or expired (i.e. was recently used to log in)'
    );
  }

  /**
   * Delete the currently logged in user.
   */
  public async deleteCurrentUser() {
    const apiKey = await this._getApiKey();
    const api = this._createHomeApiUsingApiKey(apiKey);
    const info = await api.getSessionActive();
    await api.deleteUser(info.user.id, info.user.name);
  }

  /**
   * Returns the current Grist session-id (for the selenium browser accessing this server),
   * or null if there is no session.
   */
  public async getGristSid(): Promise<string|null> {
    // Load a cheap page on our server to get the session-id cookie from browser.
    await this.driver.get(`${this.server.getHost()}/test/session`);
    await this._acceptAlertIfPresent();
    const cookie = await this.driver.manage().getCookie(process.env.GRIST_SESSION_COOKIE || 'grist_sid');
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

  // upload fixture document to the doc worker at url.
  public async uploadFixtureDoc(docWorker: DocWorkerAPI, filename: string, newName: string = filename) {
    const filepath = path.resolve(this.fixturesRoot, "docs", filename);
    if (!await fse.pathExists(filepath)) {
      throw new Error(`Can't find file: ${filepath}`);
    }
    const fileStream = fse.createReadStream(filepath);
    // node-fetch can upload streams, although browser fetch can't
    return docWorker.upload(fileStream as any, newName);
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
   * Set the value of an input element. This is to be used when the input element appears with its
   * content already selected which can create some flakiness when using the normal approach based on
   * `driver.sendKeys`. This is due to the fact that the implementation of such behaviour relies on a
   * timeout that there is no easy way to listen to with selenium, so when sending keys, the
   * `<element>.select()` could happens anytime on the client, which results in the value being
   * truncated.
   */
  public async setValue(inputEl: WebElement, value: string) {
    await this.driver.executeScript(
      (input: HTMLInputElement, val: string) => { input.value = val; },
      inputEl, value
    );
  }

  /**
   * Returns whether we are currently on any login page (including the test page).
   */
  public async isOnLoginPage() {
    return await this.isOnGristLoginPage() || await this.isOnTestLoginPage();
  }

  /**
   * Returns whether we are currently on a Grist login page.
   */
  public async isOnGristLoginPage() {
    const isOnSignupPage = await this.driver.find('.test-sp-heading').isPresent();
    const isOnLoginPage = await this.driver.find('.test-lp-heading').isPresent();
    return isOnSignupPage || isOnLoginPage;
  }

  /**
   * Returns whether we are currently on the test login page.
   */
  public isOnTestLoginPage() {
    return this.driver.findContent('h1', 'A Very Credulous Login Page').isPresent();
  }

  /**
   * Waits for browser to navigate to any login page (including the test page).
   */
  public async checkLoginPage(waitMs: number = 2000) {
    await this.driver.wait(this.isOnLoginPage.bind(this), waitMs);
  }

  /**
   * Waits for browser to navigate to a Grist login page.
   */
  public async checkGristLoginPage(waitMs: number = 2000) {
    await this.driver.wait(this.isOnGristLoginPage.bind(this), waitMs);
  }

  /**
   * Delete and recreate the user, via the specified org.  The specified user must be
   * currently logged in!
   */
  private async _recreateCurrentUser(email: string, org: string, name?: string) {
    await this.deleteCurrentUser();
    await this.removeLogin(org);
    await this.driver.get(this.server.getUrl(org, ""));
    await this.driver.findWait('.test-user-sign-in', 4000).click();
    await this.checkLoginPage();
    // Fill the login form (either test or Grist).
    if (await this.isOnTestLoginPage()) {
      await this.fillTestLoginForm(email, name);
    } else {
      await this.fillGristLoginForm(email);
    }
  }

  private async _getApiKey(): Promise<string> {
    return this.driver.wait(() => this.driver.executeAsyncScript<string>((done: (key: string) => void) => {
      const app = (window as any).gristApp;
      if (!app) { done(""); return; }
      const api: UserAPI = app.topAppModel.api;
      return api.fetchApiKey().then(key => {
        if (key) { return key; }
        return api.createApiKey();
      }).then(done).catch(() => done(""));
    }), 4000);
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

  private async _toggleTips(enabled: boolean, email: string) {
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
      await this.driver.executeScript(`
        const userPrefs = JSON.parse(localStorage.getItem('userPrefs:u=${user.id}') || '{}');
        localStorage.setItem('userPrefs:u=${user.id}', JSON.stringify({
          ...userPrefs,
          ...${JSON.stringify(enabled ? ALL_TIPS_ENABLED : ALL_TIPS_DISABLED)},
        }));
      `);
    }
  }

  private async _acceptAlertIfPresent() {
    try {
      await (await this.driver.switchTo().alert()).accept();
    } catch {
      /* There was no alert to accept. */
    }
  }
}
