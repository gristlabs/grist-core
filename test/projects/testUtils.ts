import { server } from "test/fixtures/projects/webpack-test-server";

// For the sake of setting chrome options, e.g. to disable password manager.
import "test/nbrowser/testUtils";

import { addToRepl, driver, enableDebugCapture, Key, useServer } from "mocha-webdriver";

// Exports the webpack-dev-server that we set up in setupTestSuite().
export { server };

/**
 * Loads a fixture page, e.g. `await openFixture("MY-PAGE?param=1")`, and waits for it to render.
 * A change to only the #hash doesn't reload the page, so it has nothing to wait for.
 */
export async function openFixture(pathAndQuery: string) {
  await driver.get(`${server.getHost()}/${pathAndQuery}`);
  await waitForFixture();
}

/**
 * Waits for a loaded or reloaded fixture page to render.
 */
export async function waitForFixture() {
  // Check readyState too: a refresh can return while the new page is still loading, before the
  // fixture's script has set the flag.
  await driver.wait(
    () => driver.executeScript("return document.readyState === 'complete' && !window.isFixtureRenderPending"),
    5000, "Timed out waiting for the fixture to render");
}

// Sets up the test suite to use the webpack-dev-server to serve test/fixtures/projects files, and
// to record logs and screenshots after failed tests (if MOCHA_WEBDRIVER_LOGDIR var is set).
export function setupTestSuite() {
  useServer(server);
  enableDebugCapture();
  addToRepl("Key", Key, "key values such as Key.ENTER");

  // After every suite, clear sessionStorage and localStorage to avoid affecting other tests.
  after(clearCurrentWindowStorage);
}

async function clearCurrentWindowStorage() {
  if ((await driver.getCurrentUrl()).startsWith("http")) {
    try {
      await driver.executeScript("window.sessionStorage.clear(); window.localStorage.clear();");
    } catch (err) {
      console.log("Could not clear window storage after the test ended: %s", err.message);
    }
  }
}
