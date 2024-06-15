/**
 * Exports `server`, set up to start using setupTestSuite(), e.g.
 *
 *    import {assert, driver} from 'mocha-webdriver';
 *    import {server, setupTestSuite} from 'test/nbrowser/testUtils';
 *
 *    describe("MyTest", function() {
 *      this.timeout(20000);      // Needed because we wait for server for up to 15s.
 *      setupTestSuite();
 *    });
 *
 * Run with VERBOSE=1 in the environment to see the server log on the console. Normally it goes
 * into a file whose path is printed when server starts.
 *
 * Run `bin/mocha 'test/nbrowser/*.ts' -b --no-exit` to open a command-line prompt on
 * first-failure for debugging and quick reruns.
 */
import * as gu from 'test/nbrowser/gristUtils';
import { server } from 'test/nbrowser/testServer';
import { test } from '@playwright/test';

// Exports the server object with useful methods such as getHost(), waitServerReady(),
// simulateLogin(), etc.
export {server};

interface TestSuiteOptions {
  samples?: boolean;
  team?: boolean;

  // If set, clear user preferences for all test users at the end of the suite. It should be used
  // for suites that modify preferences. Not that it only works in dev, not in deployment tests.
  clearUserPrefs?: boolean;

  // Max milliseconds to wait for a page to finish loading. E.g. affects clicks that cause
  // navigation, which wait for that. A navigation that takes longer will throw an exception.
  pageLoadTimeout?: number;
}

// Sets up the test suite to use the Grist server, and also to record logs and screenshots after
// failed tests (if MOCHA_WEBDRIVER_LOGDIR var is set).
//
// Returns a Cleanup instance as a convenience, for use scheduling any clean-up that would have
// the same scope as the test suite.
export function setupTestSuite(options?: TestSuiteOptions) {
  test.beforeAll(async () => server.start());
  test.afterAll(async () => server.stop());

  // After every suite, assert it didn't leave new browser windows open.
  // Don't know if we need this in playwright
  //checkForExtraWindows();

  // After every suite, clear sessionStorage and localStorage to avoid affecting other tests.
  if (!process.env.NO_CLEANUP) {
    // Not sure this works in playwright? or is needed?
    //test.afterAll(({ page }) => clearCurrentWindowStorage(page));
  }
  // Also, log out, to avoid logins interacting, unless NO_CLEANUP is requested (useful for
  // debugging tests).
  if (!process.env.NO_CLEANUP) {
    test.afterAll(() => server.removeLogin());
  }

  // If requested, clear user preferences for all test users after this suite.
  if (options?.clearUserPrefs) {
    test.afterAll(clearTestUserPreferences);
  }

  // Though unlikely it is possible that the server was left paused by a previous test, so let's
  // always call resume.
  test.afterEach(() => server.resume());

  // Close database until next test explicitly needs it, to avoid conflicts
  // with tests that don't use the same server.
  test.afterAll(async () => server.closeDatabase());

  // Not needed in playwright? Uses different timing model.
  /*
  if (options?.pageLoadTimeout) {
    setDriverTimeoutsForSuite({pageLoad: options.pageLoadTimeout});
  }
   */

  return setupRequirement({team: true, ...options});
}

async function clearTestUserPreferences() {
  // After every suite, clear user preferences for all test users.
  const dbManager = await server.getDatabase();
  let emails = Object.keys(gu.TestUserEnum).map(user => gu.translateUser(user as any).email);
  emails = [...new Set(emails)];    // Remove duplicates.
  await dbManager.testClearUserPrefs(emails);
}

export type CleanupFunc = (() => void|Promise<void>);

/**
 * Helper to run cleanup callbacks created in a test case. See setupCleanup() below for usage.
 */
export class Cleanup {
  private _callbacksAfterAll: CleanupFunc[] = [];
  private _callbacksAfterEach: CleanupFunc[] = [];

  public addAfterAll(cleanupFunc: CleanupFunc) {
    this._callbacksAfterAll.push(cleanupFunc);
  }
  public addAfterEach(cleanupFunc: CleanupFunc) {
    this._callbacksAfterEach.push(cleanupFunc);
  }

  public async runCleanup(which: 'all'|'each') {
    const callbacks = which === 'all' ? this._callbacksAfterAll : this._callbacksAfterEach;
    const list = callbacks.splice(0);   // Get a copy of the list AND clear it out.
    for (const f of list) {
      await f();
    }
  }
}

/**
 * Helper to run cleanup callbacks created in the course of running a test.
 * Usage:
 *    const cleanup = setupCleanup();
 *    it("should do stuff", function() {
 *      cleanup.addAfterAll(() => { ...doSomething1()... });
 *      cleanup.addAfterEach(() => { ...doSomething2()... });
 *    });
 *
 * Here, doSomething1() is called at the end of a suite, while doSomething2() is called at the end
 * of the current test case.
 */
export function setupCleanup() {
  const cleanup = new Cleanup();
  test.afterAll(() => cleanup.runCleanup('all'));
  test.afterEach(() => cleanup.runCleanup('each'));
  return cleanup;
}

/**
 * Implement some optional requirements for a test, such as having an example document
 * present, or a team site to run tests in.  These requirements should be automatically
 * satisfied by staging/prod deployments, and only need doing in self-contained tests
 * or tests against dev servers.
 *
 * Returns a Cleanup instance for any cleanup that would have the same scope as the
 * requirement.
 */
export function setupRequirement(options: TestSuiteOptions) {
  const cleanup = setupCleanup();
  if (options.samples) {
    if (process.env.TEST_ADD_SAMPLES || !server.isExternalServer()) {
      gu.shareSupportWorkspaceForSuitePlaywright(); // TODO: Remove after the support workspace is removed from the backend.
      gu.addSamplesForSuitePlaywright();
    }
  }

  before(async function() {

    if (new URL(server.getHost()).hostname !== 'localhost') {
      // Non-dev servers should already meet the requirements; in any case we should not
      // fiddle with them here.
      return;
    }

    // Optionally ensure that a team site is available for tests.
    if (options.team) {
      await gu.addSupportUserIfPossible();
      const api = gu.createHomeApi('support', 'docs');
      for (const suffix of ['', '2'] as const) {
        let orgName = `test${suffix}-grist`;
        const deployment = process.env.GRIST_ID_PREFIX;
        if (deployment) { orgName = `${orgName}-${deployment}`; }
        let isNew: boolean = false;
        try {
          await api.newOrg({name: `Test${suffix} Grist`, domain: orgName});
          isNew = true;
        } catch (e) {
          // Assume the org already exists.
        }
        if (isNew) {
          await api.updateOrgPermissions(orgName, {
            users: {
              'gristoid+chimpy@gmail.com': 'owners',
            }
          });
          // Recreate the api for the correct org, then update billing.
          const api2 = gu.createHomeApi('support', orgName);
          const billing = api2.getBillingAPI();
          try {
            await billing.updateBillingManagers({
              users: {
                'gristoid+chimpy@gmail.com': 'managers',
              }
            });
          } catch (e) {
            // ignore if no billing endpoint
            if (!String(e).match('404: Not Found')) {
              throw e;
            }
          }
        }
      }
    }
  });
  return cleanup;
}
