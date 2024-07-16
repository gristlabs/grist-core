import { BrowserContext, expect, Page } from '@playwright/test';
import { HomeUtil } from "./playwrightHomeUtil";
import * as testUtils from "../server/testUtils";
import { server } from "./testServer";
import { resetOrg } from "app/common/resetOrg";
import { FullUser, UserProfile } from "app/common/LoginSessionAPI";
import { Organization as APIOrganization } from "app/common/UserAPI";
import type { Cleanup } from "./testUtils";
import * as fse from "fs-extra";
import { ImportOpts, noCleanup, TestUser, translateUser } from "./gristUtils";
import { decodeUrl } from 'app/common/gristUrls';
import { noop } from "lodash";

export const homeUtil = new HomeUtil(testUtils.fixturesRoot, server);

export async function checkForErrors(page: Page) {
  const errors = await page.evaluate(() => (window as any).getAppErrors());
  expect(errors).toEqual([]);
}

/**
 * Dismisses any tutorial card that might be active.
 */
export async function dismissTutorialCard(page: Page) {
  // If there is something in our way, we can't do it.
  if (await page.locator('css=.test-welcome-questions').count() > 0) {
    return;
  }

  const cardClose = page.locator('css=.test-tutorial-card-close');
  if (await cardClose.isVisible()) {
    await cardClose.click();
  }
}

export async function skipWelcomeQuestions(page: Page) {
  if (await page.locator('css=.test-welcome-questions').isVisible()) {
    await page.keyboard.press('Escape');
    await expect(page.locator('css=.test-welcome-questions')).not.toBeVisible();
  }
}

/**
 * Returns the current org of gristApp in the currently-loaded page.
 */
export async function getOrg(page: Page, waitMs: number = 1000): Promise<APIOrganization> {
  const org = await page.evaluate(() => {
    const gristApp = (window as any).gristApp;
    const appObs = gristApp && gristApp.topAppModel.appObs.get();
    return appObs && appObs.currentOrg;
  }) as APIOrganization;

  if (!org) { throw new Error('could not find org'); }
  return org;
}

/**
 * Returns the current user of gristApp in the currently-loaded page.
 */
export async function getUser(page: Page, waitMs: number = 1000): Promise<FullUser> {
  const user = await page.evaluate(() => {
    const gristApp = (window as any).gristApp;
    const appObs = gristApp && gristApp.topAppModel.appObs.get();
    return appObs && appObs.currentUser;
  }) as FullUser;

  if (!user) { throw new Error('could not find user'); }
  return user;
}

/**
 * Waits for all pending comm requests from the client to the doc worker to complete. This taps into
 * Grist's communication object in the browser to get the count of pending requests.
 *
 * Simply call this after some request has been made, and when it resolves, you know that request
 * has been processed.
 * @param page - Page to wait for
 * @param optTimeout - Timeout in ms, defaults to 5000.
 */
export async function waitForServer(page: Page, optTimeout: number = 5000) {
  await page.waitForFunction(() => {
    const gristApp = (window as any).gristApp;
    return gristApp && (!gristApp.comm || !gristApp.comm.hasActiveRequests()) &&
      gristApp.testNumPendingApiRequests() === 0;
  }, undefined, { timeout: optTimeout });
}

/**
 * Wait for the doc to be loaded, to the point of finishing fetch for the data on the current
 * page. If you navigate from a doc page, use e.g. waitForUrl() before waitForDocToLoad() to
 * ensure you are checking the new page and not the old.
 */
export async function waitForDocToLoad(page: Page, timeoutMs: number = 10000): Promise<void> {
  await page.locator('css=.viewsection_title').isVisible({ timeout: timeoutMs });
  await waitForServer(page);
}

/**
 * Wait for the doc list to show, to know that workspaces are fetched, and imports enabled.
 */
export async function waitForDocMenuToLoad(page: Page): Promise<void> {
  await page.locator('css=.test-dm-doclist').waitFor({ timeout: 2000 });
}

/**
 * Helper to get the urlId of the current document. Resolves to undefined if called while not
 * on a document page.
 */
export async function getCurrentUrlId(page: Page) {
  return decodeUrl({}, new URL(page.url())).doc;
}

/**
 * Import a fixture doc into a workspace. Loads the document afterward unless `load` is false.
 *
 * Usage:
 *  > await importFixturesDoc('chimpy', 'nasa', 'Horizon', 'Hello.grist');
 */
// TODO New code should use {load: false} to prevent loading. The 'newui' value is now equivalent
// to the default ({load: true}), and should no longer be used in new code.
export async function importFixturesDoc(page: Page, username: string, org: string, workspace: string,
                                        filename: string, options: ImportOpts|false|'newui' = {load: true}) {
  if (typeof options !== 'object') {
    options = {load: Boolean(options)};   // false becomes {load: false}, 'newui' becomes {load: true}
  }
  const doc = await homeUtil.importFixturesDoc(username, org, workspace, filename, options);
  if (options.load !== false) {
    await page.goto(server.getUrl(org, `/doc/${doc.id}`));
    await waitForDocToLoad(page);
  }
  return doc;
}

export async function openAccountMenu(page: Page) {
  await page.locator('css=.test-dm-account').click({ timeout: 1000 });
  // Since the AccountWidget loads orgs and the user data asynchronously, the menu
  // can expand itself. Wait for it to load.
  await page.locator('css=.test-site-switcher-org').waitFor({ timeout: 1000 });
}

/**
 * A class representing a user on a particular site, with a default
 * workspaces.  Tests written using this class can be more
 * conveniently adapted to run locally, or against deployed versions
 * of grist.
 */
export class Session {
  public static get DEFAULT_SETTINGS() {
    return {name: '', email: '', orgDomain: '', orgName: '', workspace: 'Home'};
  }

  // private constructor - access sessions via session() or Session.default
  private constructor(
    public context: BrowserContext,
    public settings: { email: string, orgDomain: string,
                       orgName: string, name: string,
                       workspace: string }) {
  }

  // Get a session configured for the personal site of a default user.
  public static default(context: BrowserContext) {
    // Start with an empty session, then fill in the personal site (typically docs, or docs-s
    // in staging), and then fill in a default user (currently gristoid+chimpy@gmail.com).
    return new Session(
      context,
      Session.DEFAULT_SETTINGS
    ).personalSite.user();
  }

  // Return a session configured for the personal site of the current session's user.
  public get personalSite() {
    const orgName = this.settings.name ? `@${this.settings.name}` : '';
    return this.customTeamSite('docs', orgName);
  }

  // Return a session configured for a default team site and the current session's user.
  public get teamSite() {
    return this.customTeamSite('test-grist', 'Test Grist');
  }

  // Return a session configured for an alternative team site and the current session's user.
  public get teamSite2() {
    return this.customTeamSite('test2-grist', 'Test2 Grist');
  }

  // Return a session configured for a particular team site and the current session's user.
  public customTeamSite(orgDomain: string = 'test-grist', orgName = 'Test Grist') {
    const deployment = process.env.GRIST_ID_PREFIX;
    if (deployment) {
      orgDomain = `${orgDomain}-${deployment}`;
    }
    return new Session(this.context, {...this.settings, orgDomain, orgName});
  }

  // Return a session configured to create and import docs in the given workspace.
  public forWorkspace(workspace: string) {
    return new Session(this.context, {...this.settings, workspace});
  }

  // Wipe the current site.  The current user ends up being its only owner and manager.
  public async resetSite() {
    return resetOrg(this.createHomeApi(), this.settings.orgDomain);
  }

  // Return a session configured for the current session's site but a different user.
  public user(userName: TestUser = 'user1') {
    return new Session(this.context, {...this.settings, ...translateUser(userName)});
  }

  // Return a session configured for the current session's site and anonymous access.
  public get anon() {
    return this.user('anon');
  }

  public async addLogin() {
    return this.login({retainExistingLogin: true});
  }

  // Make sure we are logged in to the current session's site as the current session's user.
  public async login(options?: {loginMethod?: UserProfile['loginMethod'],
                                freshAccount?: boolean,
                                isFirstLogin?: boolean,
                                showTips?: boolean,
                                skipTutorial?: boolean, // By default true
                                userName?: string,
                                email?: string,
                                retainExistingLogin?: boolean
                                page?: Page }) {
    const page = options?.page ?? await this.context.newPage()

    if (options?.userName) {
      this.settings.name = options.userName;
      this.settings.email = options.email || '';
    }
    // Optimize testing a little bit, so if we are already logged in as the expected
    // user on the expected org, and there are no options set, we can just continue.
    if (!options && await this.isLoggedInCorrectly(page)) { return this; }
    if (!options?.retainExistingLogin) {
      await homeUtil.removeLogin(page);
      if (this.settings.email === 'anon@getgrist.com') {
        if (options?.showTips) {
          await homeUtil.enableTips(page, this.settings.email);
        } else {
          await homeUtil.disableTips(page, this.settings.email);
        }
        return this;
      }
    }
    await homeUtil.simulateLogin(page, this.settings.name, this.settings.email, this.settings.orgDomain,
                               {isFirstLogin: false, cacheCredentials: true, ...options});

    if (options?.skipTutorial ?? true) {
      await dismissTutorialCard(page);
    }

    return this;
  }

  // Check whether we are logged in to the current session's site as the current session's user.
  public async isLoggedInCorrectly(page: Page) {
    let currentUser: FullUser|undefined;
    let currentOrg: APIOrganization|undefined;
    try {
      currentOrg = await getOrg(page);
    } catch (err) {
      // ok, we may not be in a page associated with an org.
    }
    try {
      currentUser = await getUser(page);
    } catch (err) {
      // ok, we may not be in a page associated with a user.
    }
    return currentUser && currentUser.email === this.settings.email &&
      currentOrg && (currentOrg.name === this.settings.orgName ||
                     // This is an imprecise check for personal sites, but adequate for tests.
                     (currentOrg.owner && (this.settings.orgDomain.startsWith('docs'))));
  }

  // Load a document on a site.
  public async loadDoc(
    page: Page,
    relPath: string,
    options: {
      wait?: boolean,
    } = {}
  ) {
    const {wait = true} = options;
    await this.loadRelPath(page, relPath);
    if (wait) { await waitForDocToLoad(page); }
  }

  // Load a DocMenu on a site.
  // If loading for a potentially first-time user, you may give 'skipWelcomeQuestions' for second
  // argument to dismiss the popup with welcome questions, if it gets shown.
  public async loadDocMenu(page: Page, relPath: string, wait: boolean|'skipWelcomeQuestions' = true) {
    await this.loadRelPath(page, relPath);
    if (wait) { await waitForDocMenuToLoad(page); }

    if (wait === 'skipWelcomeQuestions') {
      // When waitForDocMenuToLoad() returns, welcome questions should also render, so that we
      // don't need to wait extra for them.
      await skipWelcomeQuestions(page);
    }
  }

  public async loadRelPath(page: Page, relPath: string) {
    const part = relPath.match(/^\/o\/([^/]*)(\/.*)/);
    if (part) {
      if (part[1] !== this.settings.orgDomain) {
        throw new Error(`org mismatch: ${this.settings.orgDomain} vs ${part[1]}`);
      }
      relPath = part[2];
    }
    await page.goto(server.getUrl(this.settings.orgDomain, relPath));
  }

  // Import a file into the current site + workspace.
  public async importFixturesDoc(page: Page, fileName: string, options: ImportOpts = {load: true}) {
    return importFixturesDoc(page, this.settings.name, this.settings.orgDomain, this.settings.workspace, fileName,
                             {email: this.settings.email, ...options});
  }

  // As for importFixturesDoc, but delete the document at the end of testing.
  public async tempDoc(page: Page, cleanup: Cleanup, fileName: string, options: ImportOpts = {load: true}) {
    const doc = await this.importFixturesDoc(page, fileName, options);
    const api = this.createHomeApi();
    if (!noCleanup) {
      cleanup.addAfterAll(async () => {
        await api.deleteDoc(doc.id).catch(noop);
        doc.id = '';
      });
    }
    return doc;
  }

  // As for importFixturesDoc, but delete the document at the end of each test.
  public async tempShortDoc(page: Page, cleanup: Cleanup, fileName: string, options: ImportOpts = {load: true}) {
    const doc = await this.importFixturesDoc(page, fileName, options);
    const api = this.createHomeApi();
    if (!noCleanup) {
      cleanup.addAfterEach(async () => {
        if (doc.id) {
          await api.deleteDoc(doc.id).catch(noop);
        }
        doc.id = '';
      });
    }
    return doc;
  }

  public async tempNewDoc(page: Page, cleanup: Cleanup, docName: string = '', {load} = {load: true}) {
    docName ||= `Test${Date.now()}`;
    const docId = await homeUtil.createNewDoc(this.settings.name, this.settings.orgDomain, this.settings.workspace,
                                     docName, {email: this.settings.email});
    if (load) {
      await this.loadDoc(page, `/doc/${docId}`);
    }
    const api = this.createHomeApi();
    if (!noCleanup) {
      cleanup.addAfterAll(() => api.deleteDoc(docId).catch(noop));
    }
    return docId;
  }

  // Create a workspace that will be deleted at the end of testing.
  public async tempWorkspace(cleanup: Cleanup, workspaceName: string) {
    const api = this.createHomeApi();
    const workspaceId = await api.newWorkspace({name: workspaceName}, 'current');
    if (!noCleanup) {
      cleanup.addAfterAll(async () => {
        await api.deleteWorkspace(workspaceId).catch(noop);
      });
    }
    return workspaceId;
  }

  // Get an appropriate home api object.
  public createHomeApi() {
    if (this.settings.email === 'anon@getgrist.com') {
      return homeUtil.createHomeApi(null, this.settings.orgDomain);
    }
    return homeUtil.createHomeApi(this.settings.name, this.settings.orgDomain, this.settings.email);
  }

  public getApiKey(): string|null {
    if (this.settings.email === 'anon@getgrist.com') {
      return homeUtil.getApiKey(null);
    }
    return homeUtil.getApiKey(this.settings.name, this.settings.email);
  }

  // Get the id of this user.
  public async getUserId(): Promise<number> {
    await this.login();
    const docPage = await this.context.newPage();
    await this.loadDocMenu(docPage, '/');
    const user = await getUser(docPage);
    return user.id;
  }

  public get email() { return this.settings.email; }
  public get name()  { return this.settings.name;  }
  public get orgDomain()   { return this.settings.orgDomain; }
  public get orgName()   { return this.settings.orgName; }
  public get workspace()   { return this.settings.workspace; }

  public async downloadDoc(fname: string, urlId: string) {
    const api = this.createHomeApi();
    const doc = await api.getDoc(urlId);
    const workerApi = await api.getWorkerAPI(doc.id);
    const response = await workerApi.downloadDoc(doc.id);
    await fse.writeFile(fname, Buffer.from(await response.arrayBuffer()));
  }
}

// Configure a session, for the personal site of a default user.
export function session(context: BrowserContext): Session {
  return Session.default(context);
}
