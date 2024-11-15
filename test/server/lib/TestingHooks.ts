import {connectTestingHooks, startTestingHooks, TestingHooksClient} from 'app/server/lib/TestingHooks';
import {assert, setTmpLogLevel} from 'test/server/testUtils';

import * as tmp from 'tmp';
tmp.setGracefulCleanup();

describe('TestingHooks', function() {
  setTmpLogLevel('warn');

  it('should start server and accept basic calls', async function() {
    const tmpName: string = await tmp.tmpNameAsync({prefix: 'gristtest-'});
    const server = await startTestingHooks(tmpName, 192348, null as any, null as any, []);
    const stub: TestingHooksClient = await connectTestingHooks(tmpName);
    try {
      assert.equal(await stub.getPort(), 192348);
    } finally {
      server.close();
      stub.close();
    }
  });
});
