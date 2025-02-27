import {addToRepl, driver, enableDebugCapture, Key, useServer} from 'mocha-webdriver';
import {server} from 'test/fixtures/projects/webpack-test-server';

// tslint:disable:no-console

// Exports the webpack-dev-server that we set up in setupTestSuite(), mainly for its getHost()
// method, e.g.
//
//    await driver.get(`${server.getHost()}/MY-PAGE`);
//
export {server};

// Sets up the test suite to use the webpack-dev-server to serve test/fixtures/projects files, and
// to record logs and screenshots after failed tests (if MOCHA_WEBDRIVER_LOGDIR var is set).
export function setupTestSuite() {
  useServer(server);
  enableDebugCapture();
  addToRepl('Key', Key, 'key values such as Key.ENTER');

  // After every suite, clear sessionStorage and localStorage to avoid affecting other tests.
  after(clearCurrentWindowStorage);
}

async function clearCurrentWindowStorage() {
  if ((await driver.getCurrentUrl()).startsWith('http')) {
    try {
      await driver.executeScript('window.sessionStorage.clear(); window.localStorage.clear();');
    } catch (err) {
      console.log("Could not clear window storage after the test ended: %s", err.message);
    }
  }
}
