import axios from 'axios';
import {configForUser} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

import {assert} from 'chai';

import {FlexServer} from 'app/server/lib/FlexServer';

import {createBenchmarkServer, removeConnection, setUpDB} from 'test/gen-server/seed';

let home: FlexServer;
let homeUrl: string;

const chimpy = configForUser('Chimpy');

describe('ApiServerBenchmark', function() {

  testUtils.setTmpLogLevel('error');

  before(async function() {
    if (!process.env.ENABLE_BENCHMARKS) {
      this.skip();
      return;
    }
    this.timeout(600000);
    setUpDB(this);
    home = await createBenchmarkServer(0);
    homeUrl = home.getOwnUrl();
  });

  after(async function() {
    if (home) {
      await home.stopListening();
      await removeConnection();
    }
  });

  it('GET /orgs returns in a timely manner', async function() {
    this.timeout(600000);
    for (let i = 0; i < 10; i++) {
      const resp = await axios.get(`${homeUrl}/api/orgs`, chimpy);
      assert(resp.data.length === 100);
    }
  });

  // Note the organization id which is being fetched.
  it('GET /orgs/{oid} returns in a timely manner', async function() {
    this.timeout(600000);
    for (let i = 0; i < 100; i++) {
      await axios.get(`${homeUrl}/api/orgs/1`, chimpy);
    }
  });

  // Note the organization id which is being fetched.
  it('GET /orgs/{oid}/workspaces returns in a timely manner', async function() {
    this.timeout(600000);
    for (let i = 0; i < 100; i++) {
      await axios.get(`${homeUrl}/api/orgs/1/workspaces`, chimpy);
    }
  });

  // Note the workspace ids which are being fetched.
  it('GET /workspaces/{wid} returns in a timely manner', async function() {
    this.timeout(600000);
    for (let wid = 0; wid < 100; wid++) {
      await axios.get(`${homeUrl}/api/workspaces/${wid}`, chimpy);
    }
  });
});
