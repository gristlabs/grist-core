import {assert} from 'chai';
import * as sinon from 'sinon';

import {delay} from 'app/common/delay';
import {ParseFileResult} from 'app/plugin/FileParserAPI';
import {ActiveDoc, Deps} from 'app/server/lib/ActiveDoc';
import {Authorizer, DummyAuthorizer} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';
import {DocPluginManager} from 'app/server/lib/DocPluginManager';
import {DocSession, makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {createDocTools, createUpload} from 'test/server/docTools';
import * as testUtils from 'test/server/testUtils';
import {waitForIt} from 'test/server/wait';

// This makes just enough of a Client to use with ActiveDoc.addClient() and ActiveDoc.closeDoc().
function _makeFakeClient(): Client {
  const addDocSession = sinon.stub().callsFake(function(this: Client, adoc: ActiveDoc, auth: Authorizer) {
    return new DocSession(adoc, this, 0, auth);
  });
  const removeDocSession = sinon.spy();
  const getLogMeta = sinon.spy();
  const sendMessage = sinon.spy();
  const sendMessageOrInterrupt = sinon.spy();
  return {addDocSession, removeDocSession, getLogMeta, sendMessage, sendMessageOrInterrupt} as unknown as Client;
}

describe('ActiveDocShutdown', function() {
  this.timeout(10000);

  // Turn off logging for this test, and restore afterwards.
  testUtils.setTmpLogLevel(process.env.VERBOSE ? 'debug' : 'warn');

  const docTools = createDocTools();

  // Reduce ActiveDoc timeout to shutdown to 0.5 sec, just for this test.
  const sandbox = sinon.createSandbox();
  const timeout = 500;
  const tmpTimeoutSec = timeout / 1000;
  beforeEach(function() {
    sandbox.stub(Deps, 'ACTIVEDOC_TIMEOUT').value(tmpTimeoutSec);
  });

  afterEach(function() {
    sandbox.restore();
    assert.isAbove(Deps.ACTIVEDOC_TIMEOUT, tmpTimeoutSec);   // Check that .restore() worked
  });

  it('should close ActiveDoc if there are no clients connected', async function() {
    const docName = 'active_doc_shutdown1';
    await docTools.createDoc(docName);
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);
    await waitForIt(async () => assert.equal(docTools.getDocManager().numOpenDocs(), 0), 10 * timeout);
  });

  it('should not close ActiveDoc while there are clients connected', async function() {
    const docName = 'active_doc_shutdown2';
    const adoc = await docTools.createDoc(docName);
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // Create and add one fake client.
    const fakeClient1 = _makeFakeClient();
    const docSession1 = adoc.addClient(fakeClient1, new DummyAuthorizer('editors', 'doc'));
    assert.equal((fakeClient1.addDocSession as sinon.SinonSpy).callCount, 1);

    // Wait longer than the timeout and check that doc is still open.
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);
    await delay(2 * timeout);
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // Create and add a second fake client.
    const fakeClient2 = _makeFakeClient();
    const docSession2 = adoc.addClient(fakeClient2, new DummyAuthorizer('editors', 'doc'));
    assert.equal((fakeClient2.addDocSession as sinon.SinonSpy).callCount, 1);

    // "Disconnect" the first client.
    await adoc.closeDoc(docSession1);
    assert.equal((fakeClient1.removeDocSession as sinon.SinonSpy).callCount, 1);

    // Wait longer than the timeout and check that doc is still open.
    await delay(2 * timeout);
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // "Disconnect" the second client.
    await adoc.closeDoc(docSession2);
    assert.equal((fakeClient1.removeDocSession as sinon.SinonSpy).callCount, 1);

    // The doc is still open for a while.
    await delay(timeout / 2);
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // Check that doc eventually closes.
    await waitForIt(async () => assert.equal(docTools.getDocManager().numOpenDocs(), 0), 10 * timeout);
  });

  it('should not close ActiveDoc while an import is pending', async function() {
    const _sandbox = sinon.createSandbox();
    try {
      // Stub parseFile(), which is used in the course of importing, with a function that returns
      // an empty result but takes a long time. We check that ActiveDoc doesn't get closed
      // meanwhile.
      _sandbox.stub(DocPluginManager.prototype, "parseFile").callsFake(async function(): Promise<ParseFileResult> {
        await delay(timeout * 2);
        return {parseOptions: {}, tables: []};
      });

      // The accessId only matters in having to be the same to create and retrieve the upload.
      const userId = 17;
      const accessId = docTools.getDocManager().makeAccessId(userId);
      const uploadId = await createUpload(["foo", "bar"], accessId);

      const start = Date.now();
      await docTools.getDocManager().importDocWithFreshId(makeExceptionalDocSession('nascent'), userId, uploadId);
      // Check that we stubbed the right thing above, and that this import indeed took as long as
      // we expected.
      assert.isAbove(Date.now() - start, timeout * 2);
      // But the doc should still be open.
      assert.equal(docTools.getDocManager().numOpenDocs(), 1);

      // Check that doc eventually closes.
      await waitForIt(async () => assert.equal(docTools.getDocManager().numOpenDocs(), 0), 10 * timeout);

    } finally {
      // Restore the stubbed method.
      _sandbox.restore();
    }
  });

  it('should not close ActiveDoc while loading', async function() {
    sandbox.stub(Deps, 'ACTIVEDOC_TIMEOUT').value(0.001);
    const adoc = await docTools.loadFixtureDoc('World.grist');
    const session = docTools.createFakeSession();
    const {tableData} = await adoc.fetchTable(session, 'Country', true);
    assert.equal(tableData[0], "TableData");
    assert.lengthOf(tableData[2], 239);   // There are 239 countries in this doc
  });

  it('should not close ActiveDoc while using API', async function() {
    const adoc = await docTools.loadFixtureDoc('World.grist');
    const session = docTools.createFakeSession();
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // Use an API method a few times, and make sure the doc hasn't gotten closed.
    for (let i = 0; i < 4; i++) {
      await delay(timeout / 2);
      assert.lengthOf((await adoc.fetchTable(session, 'Country', true)).tableData[2], 239);
    }
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // Same with another method.
    for (let i = 0; i < 4; i++) {
      await delay(timeout / 2);
      await adoc.applyUserActions(session, [['UpdateRecord', 'Country', 1, {Name: 'Hello'}]]);
    }
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // Check that doc eventually closes.
    await waitForIt(async () => assert.equal(docTools.getDocManager().numOpenDocs(), 0), 10 * timeout);
  });

  const infiniteLoopFormula = `\
c = 0
while True:
  c += 1
return c
`;

  it('should close ActiveDoc in infinite loop after timeout', async function() {
    // Reduce the timeouts that affect this test.
    const inactivityTimerMsec = 1000;
    sandbox.stub(Deps, 'ACTIVEDOC_TIMEOUT').value(inactivityTimerMsec / 1000);
    sandbox.stub(Deps, 'KEEP_DOC_OPEN_TIMEOUT_MS').value(1000);
    sandbox.stub(Deps, 'SHUTDOWN_ITEM_TIMEOUT_MS').value(1000);
    const adoc = await docTools.createDoc('ActiveDocShutdown-Loop-Shutdown');
    const session = docTools.createFakeSession();
    await adoc.applyUserActions(session, [
      ["AddTable", 'Table1', [{id: "A"}, {id: "B"}, {id: "C"}]],
      ["AddRecord", 'Table1', 1, {}],
    ]);

    const start = Date.now();

    // Start a infinite-loop action that will never finish on its own.
    const actionResult = adoc.applyUserActions(session,
      [['AddColumn', 'Table1', 'Loop', {isFormula: true, formula: infiniteLoopFormula}]])
      .catch(err => err);

    // Check that the doc is open.
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    // We expect it to close soon. We wait longer, then check how long it actually took.
    // Capture log to suppress expected warnings in the test (e.g. about failing user action).
    await testUtils.captureLog('warn', () =>
      waitForIt(async () => assert.equal(docTools.getDocManager().numOpenDocs(), 0),
        10_000, // how long to wait
        100,    // step between checks
      )
    );
    const totalMsec = Date.now() - start;

    // The applyUserActions call should have failed once we killed the sandbox.
    assert.match((await actionResult).message, /PipeFromSandbox is closed/);

    // Check how long this took.
    const expectedTime = Deps.KEEP_DOC_OPEN_TIMEOUT_MS  // Max wait for hanging applyUserActions
      + Deps.SHUTDOWN_ITEM_TIMEOUT_MS  // Timeout for the hanging RemoveTransformColumns action on shutdown
      + inactivityTimerMsec   // Time after which ActiveDoc decides to shut down
      + 1000;   // Hard-coded extra time NSandbox takes to kill an unresponsive process
    assert.closeTo(totalMsec, expectedTime, 500);
  });

  it('should close ActiveDoc even if timeout is longer than current time updates', async function() {
    // Reduce the timeouts that affect this test.
    const inactivityTimerMsec = 1000;
    const updateTimeMsec = 500;
    sandbox.stub(Deps, 'ACTIVEDOC_TIMEOUT').value(inactivityTimerMsec / 1000);
    sandbox.stub(Deps, 'KEEP_DOC_OPEN_TIMEOUT_MS').value(1000);
    sandbox.stub(Deps, 'SHUTDOWN_ITEM_TIMEOUT_MS').value(1000);
    sandbox.stub(Deps, 'UPDATE_CURRENT_TIME_DELAY').value({delayMs: updateTimeMsec, varianceMs: 0});

    // Create a doc, see that it's open.
    const adoc = await docTools.createDoc('ActiveDocShutdown-UpdateCurrentTime');
    assert.equal(docTools.getDocManager().numOpenDocs(), 1);
    const session = docTools.createFakeSession();

    // Add a NOW() formula.
    const timeBeforeAction = Date.now();
    await adoc.applyUserActions(session, [
      ["AddTable", 'Table1', [{id: "Time", type: 'DateTime', isFormula: true, formula: 'NOW()'}]],
      ["AddRecord", 'Table1', 1, {}],
    ]);
    const timeAfterAction = Date.now();

    // Helper to get the value of the one cell with the formula, as msec since epoch.
    async function getTimeCell() {
      const tableAction = await adoc.fetchTable(session, 'Table1', true);
      return (tableAction.tableData[3].Time[0] as number) * 1000;
    }

    // Check that the formula has the expected timestamp.
    const timeInCell = await getTimeCell();
    assert.isAbove(timeInCell, timeBeforeAction);
    assert.isBelow(timeInCell, timeAfterAction);

    // Wait enough to get a time update, to make sure those work.
    await waitForIt(async () => assert.isAbove(await getTimeCell(), timeInCell + updateTimeMsec / 2),
      updateTimeMsec * 1.5,   // max wait
      updateTimeMsec / 2);    // wait step

    // The fetch in getTimeCell() keeps the doc open, but it should close after another
    // inactivityTimerMsec (even though time updates are happening frequently).
    await waitForIt(async () => assert.equal(docTools.getDocManager().numOpenDocs(), 0),
      inactivityTimerMsec * 1.5,
      inactivityTimerMsec / 4);
  });

  it('should force-reload ActiveDoc quickly even while in infinite loop, with a scheduled task', async function() {
    // Reduce the timeouts that affect this test. Keep inactivity timeout high, since it should
    // *not* affect reload.
    const inactivityTimerMsec = 10_000;
    sandbox.stub(Deps, 'ACTIVEDOC_TIMEOUT').value(inactivityTimerMsec / 1000);
    sandbox.stub(Deps, 'SHUTDOWN_ITEM_TIMEOUT_MS').value(1000);
    sandbox.stub(Deps, 'UPDATE_CURRENT_TIME_DELAY').value({delayMs: 1000, varianceMs: 0});

    const adoc = await docTools.createDoc('ActiveDocShutdown-Loop-Reload');
    const session = docTools.createFakeSession();
    await adoc.applyUserActions(session, [
      ["AddTable", 'Table1', [{id: "A"}, {id: "B"}, {id: "C"}]],
      ["AddRecord", 'Table1', 1, {}],
    ]);

    // Start a infinite-loop action that will never finish on its own.
    const actionResult = adoc.applyUserActions(session,
      [['AddColumn', 'Table1', 'Loop', {isFormula: true, formula: infiniteLoopFormula}]])
      .catch(err => err);

    // Wait enough to get a time update to trigger, since that used to cause hangs.
    await delay(Deps.UPDATE_CURRENT_TIME_DELAY.delayMs * 1.5);

    assert.equal(docTools.getDocManager().numOpenDocs(), 1);

    const start = Date.now();
    await testUtils.captureLog('warn', async (messages) => {
      await adoc.reloadDoc();

      // Check that we did trigger a time update, just to be sure we haven't failed to test that.
      // It should fail by reloadDoc()'s return, but it's asynchronous, so allow a little wait.
      await waitForIt(() =>
        assert.isTrue(messages.some(m => /ActiveDoc failed to update current time/.test(m))),
        500, 50);
    });

    const totalMsec = Date.now() - start;

    assert.equal(docTools.getDocManager().numOpenDocs(), 0);

    // The applyUserActions call should have failed once we killed the sandbox.
    assert.match((await actionResult).message, /PipeFromSandbox is closed/);

    // Check how long this took.
    const expectedTime = Deps.SHUTDOWN_ITEM_TIMEOUT_MS  // Timeout for the hanging UpdateCurrentTime call.
      + Deps.SHUTDOWN_ITEM_TIMEOUT_MS  // Timeout for the hanging RemoveTransformColumns action on shutdown
      + 1000;   // Hard-coded extra time NSandbox takes to kill an unresponsive process
    assert.closeTo(totalMsec, expectedTime, 500);
  });
});
