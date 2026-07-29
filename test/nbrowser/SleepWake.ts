/**
 * When a laptop sleeps, its websocket dies, and after a while the server forgets the client
 * altogether. On wake the browser reconnects, and the app has to open the document all over
 * again. Opening a document is not quick, since it may have to be fetched and given a sandbox,
 * and a network that has just come back is not always steady. These tests check that the user
 * ends up looking at a working document rather than an error, whichever way that goes.
 */

import { TestingHooksClient } from "app/server/lib/TestingHooks";
import * as gu from "test/nbrowser/gristUtils";
import { server, setupTestSuite } from "test/nbrowser/testUtils";

import { assert, driver } from "mocha-webdriver";

describe("SleepWake", function() {
  this.timeout(90000);
  const cleanup = setupTestSuite();

  let hooks: TestingHooksClient;

  before(async function() {
    hooks = await server.getTestingHooks();
  });

  afterEach(async function() {
    await hooks.setDocOpenPaused(false);
  });

  beforeEach(async function() {
    const session = await gu.session().teamSite.login();
    await session.tempDoc(cleanup, "Hello.grist");
    await gu.waitForDocToLoad();
    await gu.wipeToasts();
    // Mark the current DocPageModel. The app replaces it when it reopens the document, which is
    // how we tell that the wake has been noticed.
    await driver.executeScript("window.gristDocPageModel.__sleepWakeStamp = true;");
  });

  // Cut the browser off from the server, as a sleeping laptop is: open websockets are
  // terminated, and attempts to reconnect are refused.
  async function networkDown() {
    await hooks.commShutdown();
  }

  async function networkUp() {
    await hooks.commRestart();
  }

  // Go away for long enough that the server unloads the document we had open, and gives up on
  // the client it was holding for us. Both happen well within a night's sleep.
  async function sleep() {
    await networkDown();
    await hooks.closeDocs();
    await hooks.disconnectClients();
  }

  // Wait until the app has thrown away the document it had open and is busy opening it again.
  async function waitForReopenToStart() {
    await driver.wait(async () => driver.executeScript(`
      const pageModel = window.gristDocPageModel;
      return Boolean(pageModel && !pageModel.__sleepWakeStamp);
    `), 30000, "app never started reopening the document");
  }

  // Wait until the server is holding a document open request. That it arrived at all means the
  // app has noticed the wake and started over.
  async function waitForDocOpenInFlight() {
    await driver.wait(async () => (await hooks.getDocOpenCount()) > 0, 30000,
      "no document open request arrived");
  }

  // Check that we are looking at a working document, with nothing broken along the way.
  async function assertDocIsUsable() {
    // Settle first, either way, so that giving up is reported as such rather than as a timeout.
    await driver.wait(async () =>
      (await driver.findAll(".test-modal-title")).length > 0 ||
      (await driver.findAll(".viewsection_title")).length > 0,
    30000, "the app neither opened the document nor said anything about it");

    assert.deepEqual(await driver.findAll(".test-modal-title", e => e.getText()), [],
      "the app gave up on the document instead of waiting for it");
    assert.deepEqual(await gu.getAppErrors(), []);
    await gu.waitForDocToLoad(30000);
    assert.equal(await gu.getCell({ rowNum: 1, col: 0 }).getText(), "hello");
  }

  it("recovers when the network comes back cleanly", async function() {
    await sleep();
    await networkUp();
    await waitForReopenToStart();
    await assertDocIsUsable();
  });

  it("recovers when the network blips while the document is opening", async function() {
    await sleep();

    // Hold the open request, so one is certainly outstanding when the network misbehaves. On a
    // real server, opening a document after a wake takes a while anyway.
    await hooks.setDocOpenPaused(true);
    await networkUp();
    await waitForDocOpenInFlight();

    // Wifi is still settling, and the connection blips. It returns quickly enough that the server
    // still knows us, so the document we asked for is still on its way.
    await networkDown();
    await networkUp();

    await hooks.setDocOpenPaused(false);
    await assertDocIsUsable();

    // The blip cost nothing: the document was opened once and the answer reached us, rather than
    // the app starting over. Checked after loading, by which time a second open would have shown.
    assert.equal(await hooks.getDocOpenCount(), 1, "the document was opened more than once");
  });

  it("recovers when the network goes away again while the document is opening", async function() {
    await sleep();

    await hooks.setDocOpenPaused(true);
    await networkUp();
    await waitForDocOpenInFlight();

    // This time the second outage is long too, so the server gives up on us again and nobody is
    // left to answer for the document. The app has to start over, and may do so quietly.
    await networkDown();
    await hooks.disconnectClients();
    await hooks.setDocOpenPaused(false);
    await networkUp();

    await assertDocIsUsable();
  });
});
