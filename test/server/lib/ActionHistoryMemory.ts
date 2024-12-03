import axios from 'axios';
import { delay } from 'bluebird';
import { assert } from 'chai';
import { ChildProcess, execFileSync, spawn} from 'child_process';
import FormData from 'form-data';
import * as fse from 'fs-extra';
import fetch from 'node-fetch';
import { tmpdir } from 'os';
import * as path from 'path';

import { GristClientSocket } from 'app/client/components/GristClientSocket';
import { UserAPIImpl } from 'app/common/UserAPI';
import log from 'app/server/lib/log';
import { exitPromise } from 'app/server/lib/serverUtils';
import { GristClient } from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';

/**
 * This suite tests that when we start node with limited memory, and then call openDoc on a doc
 * with multiple large actions, node doesn't crash due to decoding all actions together.
 *
 * This test is pretty limited. We actually need to tune the number and size of the actions in
 * such a way that the actions on their own, and the doc data, are not enough to exceed memory
 * limit, but that ActionLog decoding puts it over the limit.
 */
describe('ActionHistoryMemory', function() {
  this.timeout(120000);
  testUtils.setTmpLogLevel('info');

  const MAX_SPACE = 110;     // Memory limit for node to use (in MB).
  const RANGE = 200_000;    // Our "big actions" are formula calculations returning a python
                            // range() of this length

  let serverProcess: ChildProcess;
  let serverExitPromise: Promise<number|string>;
  let serverUrl: string;
  let serverPort: number;

  before(async function() {
    // Set up a server process that uses the following flag to reduce heap size available to node.
    // This is not precise: node may get some amount more than requested.
    // This flag is crucial to this test, or else it's not testing anything interesting.
    const flags = [`--max-old-space-size=${MAX_SPACE}`];

    const username = process.env.USER || "nobody";
    const tmpDir = path.join(process.env.TESTDIR || tmpdir(), `grist_test_${username}_action_history_memory`);
    const dataDir = path.join(tmpDir, `data`);

    // Create the tmp dir removing any previous one
    await fse.remove(tmpDir);
    await fse.mkdirs(tmpDir);
    await fse.mkdirs(dataDir);
    log.warn(`Test logs and data are at: ${tmpDir}/`);

    const nodeLogPath = path.join(tmpDir, 'node.log');
    const serverLog = process.env.VERBOSE ? 'inherit' : await fse.open(nodeLogPath, 'a');

    const stubCmd = '_build/stubs/app/server/server';
    const isCore = await fse.pathExists(stubCmd + '.js');
    const cmd = isCore ? stubCmd : '_build/core/app/server/devServerMain';

    const env = {
      TYPEORM_DATABASE: path.join(tmpDir, 'landing.db'),
      TEST_CLEAN_DATABASE: 'true',
      GRIST_DATA_DIR: dataDir,
      GRIST_INST_DIR: tmpDir,
      HOME_PORT: '8110',
      GRIST_SINGLE_PORT: 'true',
      PORT: isCore ? '8110' : '0',
      ...process.env,
    };

    // Start up the server with the special flag.
    serverProcess = spawn('node', [...flags, cmd], {
      env,
      stdio: ['inherit', serverLog, serverLog],
    });

    // Dump output if server dies unexpectedly.
    serverExitPromise = exitPromise(serverProcess).then((code) => {
      if (!serverProcess.killed) {
        log.error("Server died unexpectedly, with code", code);
        const output = execFileSync('tail', ['-30', nodeLogPath]);
        log.warn(`\n===== BEGIN SERVER OUTPUT ====\n${output}\n===== END SERVER OUTPUT =====`);
        throw new Error("Server exited while waiting for it");
      }
      return code;
    });

    serverPort = parseInt(env.HOME_PORT, 10);
    serverUrl = `http://localhost:${serverPort}`;

    // Check if the server is responsive and healthy.
    async function isServerReady() {
      return fetch(`${serverUrl}/status`, {timeout: 1000}).then(r => r.ok).catch(() => false);
    }

    // Wait for server to become responsive, or fail if the server crashes while waiting.
    async function waitForServer() {
      for (let i = 0; i < 60; i++) {
        const ok = await Promise.race([isServerReady(), serverExitPromise]);
        if (ok) { break; }
        await delay(1000);
      }
      if (!await isServerReady()) {
        throw new Error('server not ready');
      }
    }

    await waitForServer();
  });

  after(async function() {
    serverProcess.kill();
    await serverExitPromise;
  });

  it('should not run out of memory from loading many ActionHistory entries', async function() {
    const api = new UserAPIImpl(`${serverUrl}/o/docs`, {
      headers: {Authorization: 'Bearer api_key_for_chimpy'},
      fetch : fetch as any,
      newFormData: () => new FormData() as any,
    });

    // Createa a doc.
    const wsId = (await api.getOrgWorkspaces('current')).find((w) => w.name === 'Public')!.id;
    const docId = await api.newDoc({name: 'large-actions'}, wsId);

    // Add a formula column returning a large value (so the .calc part of the action is large).
    await api.applyUserActions(docId, [['AddRecord', 'Table1', null, {A: 0}]]);
    await api.applyUserActions(docId, [['ModifyColumn', 'Table1', 'B',
      {formula: `range(int($A), int($A) + ${RANGE})`}]]);

    // Add a bunch of actions that each produce an equally large ActionBundle. Each action isn't
    // too large on its own, but if openDoc collects full recent actions in memory, node (running
    // with limited memory) would crash.
    for (let i = 1; i < 10; i++) {
      await api.applyUserActions(docId, [['UpdateRecord', 'Table1', 1, {A: i}]]);
    }

    // Make the doc public, to simplify auth for websocket below.
    await api.updateDocPermissions(docId, { users: { 'everyone@getgrist.com': 'viewers' } });

    // Connect a websocket. We do this in order to call the websocket openDoc() method: it is the
    // only method that involves getRecentActions (unlike API calls like fetchTable).
    const resp = await axios.get(`${serverUrl}/test/session`);
    const cookie = resp.headers['set-cookie']![0];
    const ws = new GristClientSocket(`ws://localhost:${serverPort}/o/docs`, {headers: { Cookie: cookie }});
    await new Promise((resolve, reject) => {
      ws.onopen = () => resolve(undefined);
      ws.onerror = reject;
    });
    const cli = new GristClient(ws);
    assert.equal((await cli.readMessage()).type, 'clientConnect');

    // Once we have a connected websocket, call openDoc().
    const openDocPromise = cli.send("openDoc", docId);

    // On failure, the 'fail' promise would reject first, aborting the test.
    const fail = new Promise((resolve, reject) => {
      ws.onerror = reject;
      ws.onclose = () => reject(new Error('socket closed'));
    });
    await Promise.race([openDocPromise, fail]);

    // As long as it succeeds, we are good. If node takes too much memory in handling openDoc, it
    // would crash and the call above would hang.
    const openDoc = await openDocPromise;
    assert.equal(openDoc.error, undefined);
    assert.match(JSON.stringify(openDoc.data), /Table1/);
    await cli.close();
  });
});
