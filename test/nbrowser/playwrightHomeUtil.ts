/**
 * Contains some non-webdriver functionality needed by tests.
 */
import FormData from 'form-data';
import { WebDriver } from 'mocha-webdriver';
import fetch from 'node-fetch';
import { UserAPI, UserAPIImpl } from 'app/common/UserAPI';
import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { TestingHooksClient } from 'app/server/lib/TestingHooks';
import { BrowserContext, Page } from "@playwright/test";
import EventEmitter = require('events');

export interface Server extends EventEmitter {
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

  constructor(public fixturesRoot: string, public server: Server) {
    server.on('stop', () => {
      this._apiKey.clear();
    });
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

  // @ts-ignore
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
}
