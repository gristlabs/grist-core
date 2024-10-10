import {prepareDatabase} from 'test/server/lib/helpers/PrepareDatabase';
import {TestServer} from 'test/server/lib/helpers/TestServer';
import {createTestDir, setTmpLogLevel} from 'test/server/testUtils';
import * as testUtils from 'test/server/testUtils';
import {waitForIt} from 'test/server/wait';
import {assert} from 'chai';
import fetch from 'node-fetch';
import {PassThrough} from 'stream';

/**
 * Grist sticks to the Node 18 default and recommendation to give up and exit on uncaught
 * exceptions, unhandled promise rejections, and unhandled 'error' events. But it makes an effort
 * to clean up before exiting, and to log the error in a better way.
 */
describe('UnhandledErrors', function() {
  this.timeout(30000);

  setTmpLogLevel('warn');

  let testDir: string;
  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    testDir = await createTestDir('UnhandledErrors');
    await prepareDatabase(testDir);
  });

  after(function() {
    oldEnv.restore();
  });

  for (const errType of ['exception', 'rejection', 'error-event']) {
    it(`should clean up on unhandled ${errType}`, async function() {
      // Capture server log output, so that we can look to see how the server coped.
      const output = new PassThrough();
      const serverLogLines: string[] = [];
      output.on('data', (data) => serverLogLines.push(data.toString()));

      const server = await TestServer.startServer('home', testDir, errType, undefined, undefined, {output});

      try {
        assert.equal((await fetch(`${await server.getServerUrl()}/status`)).status, 200);
        serverLogLines.length  = 0;

        // Trigger an unhandled error, and check that the server logged it and attempted cleanup.
        await server.testingHooks.tickleUnhandledErrors(errType);
        await waitForIt(() => {
          assert.isTrue(serverLogLines.some(line => new RegExp(`Fake ${errType}`).test(line)));
          assert.isTrue(serverLogLines.some(line => /Server .* cleaning up/.test(line)));
        }, 1000, 100);

        // We expect the server to be dead now.
        await assert.isRejected(fetch(`${await server.getServerUrl()}/status`), /failed.*ECONNREFUSED/);

      } finally {
        await server.stop();
      }
    });
  }
});
