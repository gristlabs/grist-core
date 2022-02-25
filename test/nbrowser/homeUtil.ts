/**
 * Contains some non-webdriver functionality needed by tests.
 */
import * as FormData from 'form-data';
import * as fse from 'fs-extra';
import defaults = require('lodash/defaults');
import {WebElement} from 'mocha-webdriver';
import fetch from 'node-fetch';
import * as path from 'path';
import {WebDriver} from 'selenium-webdriver';

import {UserProfile} from 'app/common/LoginSessionAPI';
import {DocWorkerAPI, UserAPI, UserAPIImpl} from 'app/common/UserAPI';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import * as log from 'app/server/lib/log';
import {TestingHooksClient} from 'app/server/lib/TestingHooks';

export interface Server {
  driver: WebDriver;
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

  constructor(public fixturesRoot: string, public server: Server) {}

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
   * done via Cognito.
   */
  public async simulateLogin(name: string, email: string, org: string = "", options: {
    loginMethod?: UserProfile['loginMethod'],
    freshAccount?: boolean,
    isFirstLogin?: boolean,
    showGristTour?: boolean,
    cacheCredentials?: boolean,
  } = {}) {
    const {loginMethod, isFirstLogin} = defaults(options, {loginMethod: 'Email + Password'});
    const showGristTour = options.showGristTour ?? (options.freshAccount ?? isFirstLogin);

    // For regular tests, we can log in through a testing hook.
    if (!this.server.isExternalServer()) {
      if (options.freshAccount) { await this._deleteUserByEmail(email); }
      if (isFirstLogin !== undefined) { await this._setFirstLogin(email, isFirstLogin); }
      if (showGristTour !== undefined) { await this._initShowGristTour(email, showGristTour); }
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
      // When running against an external server, we log in through Cognito.
      await this.driver.get(this.server.getUrl(org, ""));
      if (!(await this.isOnGristLoginPage()) && !(await this.isOnLoginPage())) {
        // Explicitly click sign-in link if necessary.
        await this.driver.findWait('.test-user-signin', 4000).click();
        await this.driver.findContentWait('.grist-floating-menu a', 'Sign in', 500).click();
      }
      // Check if we need to switch to Cognito login from the Grist sign-up page.
      if (await this.isOnGristLoginPage()) {
        await this.driver.findWait('a[href*="login?"]', 4000).click();
      }
      await this.checkLoginPage();
      await this.fillLoginForm(email);
      if (!(await this.isWelcomePage()) && (options.freshAccount || options.isFirstLogin)) {
        await this._recreateCurrentUser(email, org);
      }
    }
    if (options.freshAccount) {
      this._apiKey.delete(email);
    }
    if (options.cacheCredentials) {
      // Take this opportunity to cache access info.
      if (!this._apiKey.has(email)) {
        await this.driver.get(this.server.getUrl(org, ''));
        this._apiKey.set(email, await this._getApiKey());
      }
    }
  }

  /**
   * Remove any simulated login from the current session (for the given org, if specified).
   * For testing against an external server, all logins are removed, since there's no way
   * to be more nuanced.
   */
  public async removeLogin(org: string = "") {
    if (!this.server.isExternalServer()) {
      const testingHooks = await this.server.getTestingHooks();
      const sid = await this.getGristSid();
      if (sid) { await testingHooks.setLoginSessionProfile(sid, null, org); }
    } else {
      await this.driver.get(`${this.server.getHost()}/logout`);
    }
  }

  // Check if the url looks like a welcome page.  The check is weak, but good enough
  // for testing.
  public async isWelcomePage() {
    const url = await this.driver.getCurrentUrl();
    return Boolean(url.match(/\/welcome\//));
  }

  // Fill up a Cognito login page.  If on a signup page, switch to a login page.
  // TEST_ACCOUNT_PASSWORD must be set, or a password provided.  Should be on a Cognito
  // login/signup page before calling this method.
  public async fillLoginForm(email: string, password?: string) {
    if (!password) {
      password = process.env.TEST_ACCOUNT_PASSWORD;
      if (!password) {
        throw new Error('TEST_ACCOUNT_PASSWORD not set');
      }
    }
    await this.checkLoginPage();
    if ((await this.driver.getCurrentUrl()).match(/signup\?/)) {
      await this.driver.findWait('a[href*="login?"]', 4000).click();
    }
    // There are two login forms, one hidden, one shown. Pick the one that is shown.
    const block =
      (await this.driver.find('div.modal-content-desktop').isDisplayed()) ?
      (await this.driver.find('div.modal-content-desktop')) :
      (await this.driver.find('div.modal-content-mobile'));
    await block.findWait('input[name="username"]', 4000);
    await this.setValue(block.findWait('input[name="username"]', 4000), email);
    await this.setValue(block.findWait('input[name="password"]', 4000), password);
    await block.find('input[name="signInSubmitButton"]').click();
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
    const name = (username || '').toLowerCase();
    const apiKey = username && ((email && this._apiKey.get(email)) || `api_key_for_${name}`);
    return this._createHomeApiUsingApiKey(apiKey, org);
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
   * Returns whether we are currently on the Cognito login page.
   */
  public async isOnLoginPage() {
    return /^https:\/\/gristlogin/.test(await this.driver.getCurrentUrl());
  }

  /**
   * Returns whether we are currently on a Grist login page.
   */
  public async isOnGristLoginPage() {
    return /^https:\/\/login(-s)?\.getgrist\.com/.test(await this.driver.getCurrentUrl());
  }

  /**
   * Waits for browser to navigate to Cognito login page.
   */
  public async checkLoginPage(waitMs: number = 2000) {
    await this.driver.wait(this.isOnLoginPage.bind(this), waitMs);
  }

  /**
   * Waits for browser to navigate to Grist login page.
   */
   public async checkGristLoginPage(waitMs: number = 2000) {
    await this.driver.wait(this.isOnGristLoginPage.bind(this), waitMs);
  }

  /**
   * Waits for browser to navigate to either the Cognito or Grist login page.
   */
  public async checkSigninPage(waitMs: number = 4000) {
    await this.driver.wait(
      async () => await this.isOnLoginPage() || await this.isOnGristLoginPage(),
      waitMs
    );
  }

  /**
   * Delete and recreate the user, via the specified org.  The specified user must be
   * currently logged in!
   */
  private async _recreateCurrentUser(email: string, org: string) {
    await this.deleteCurrentUser();
    await this.removeLogin(org);
    await this.driver.get(this.server.getUrl(org, ""));
    await this.driver.findWait('.test-user-signin', 4000).click();
    await this.driver.findContentWait('.grist-floating-menu a', 'Sign in', 500).click();
    await this.checkLoginPage();
    await this.fillLoginForm(email);
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
      logger: log});
  }
}
