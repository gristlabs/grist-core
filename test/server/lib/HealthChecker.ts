import {TestServer} from 'test/server/lib/helpers/TestServer';
import {RedisForwarder} from 'test/server/tcpForwarder';
import * as testUtils from 'test/server/testUtils';
import {prepareFilesystemDirectoryForTests} from 'test/server/lib/helpers/PrepareFilesystemDirectoryForTests';
import {prepareDatabase} from 'test/server/lib/helpers/PrepareDatabase';

import fetch from 'node-fetch';
import {assert} from 'chai';
import IORedis from "ioredis";

import * as path from 'path';
import {tmpdir} from 'os';

const username = process.env.USER || "nobody";
const tmpDir = path.join(tmpdir(), `grist_test_${username}_health_checker`);

describe('HealthChecker', function() {
  testUtils.setTmpLogLevel('error');
  this.timeout(10_000);

  let servers: {server: TestServer, forwarder?: RedisForwarder}[] = [];
  let client: IORedis;

  before(async function() {
    await prepareFilesystemDirectoryForTests(tmpDir);
    await prepareDatabase(tmpDir);

    if(process.env.TEST_REDIS_URL) {
      client = new IORedis(process.env.TEST_REDIS_URL);
      await client.flushall();

      for(let i = 0; i < 3; i++) {
        // Use a forwarder for each server so we can simulate
        // disconnects
        const forwarder = await RedisForwarder.create();

        const server = await TestServer.startServer('home', tmpDir, `with-redis-${i}`, {
          REDIS_URL: forwarder.redisUrl,
          GRIST_INSTANCE_ID: `test-instance-${i}`,
        });
        servers.push({server, forwarder});
      }
    }
    else {
      servers = [{server: await TestServer.startServer('home', tmpDir, 'without-redis')}];
    }
  });

  after(async function () {
    await Promise.all(servers.map(async (pair) => {
      await pair.server.stop();
      await pair.forwarder?.disconnect();
    }));
    client?.disconnect();
  });

  it('registers all servers', async function () {
    if(!process.env.TEST_REDIS_URL) {
      this.skip();
    }

    const instances = await client.smembers('grist-instances');
    instances.sort();
    assert.deepEqual(instances, ['test-instance-0', 'test-instance-1', 'test-instance-2']);
  });

  it('reports healthy when all servers are healthy', async function () {
    const server = servers[process.env.TEST_REDIS_URL ? 2 : 0].server;
    const resp = await fetch(`${server.serverUrl}/status?allInstancesReady=1`);
    assert.equal(resp.status, 200);
    assert.match(await resp.text(), /allInstancesReady ok/);
  });

  it('reports not healthy when one server is not healthy', async function () {
    if(!process.env.TEST_REDIS_URL) {
      this.skip();
    }

    const downServer = servers[2];
    await downServer.forwarder?.disconnect();

    const server = servers[0].server;
    const resp = await fetch(`${server.serverUrl}/status?allInstancesReady=1&timeout=500`);
    const text = await resp.text();
    assert.equal(resp.status, 500);
    assert.match(text, /allInstancesReady not ok/);

    await downServer.forwarder?.connect();
  });

  it('reports healthy when one server is cleanly disconnected', async function () {
    if(!process.env.TEST_REDIS_URL) {
      this.skip();
    }

    const downServer = servers[2];
    await downServer.server.stop();
    await downServer.forwarder?.disconnect();
    servers.pop();

    const server = servers[0].server;
    const resp = await fetch(`${server.serverUrl}/status?allInstancesReady=1`);
    const text = await resp.text();
    assert.equal(resp.status, 200);
    assert.match(text, /allInstancesReady ok/);
  });

  it('checks when a new server comes back', async function() {
    if(!process.env.TEST_REDIS_URL) {
      this.skip();
    }

    let instances = await client.smembers('grist-instances');
    instances.sort();
    assert.deepEqual(instances, ['test-instance-0', 'test-instance-1']);

    const newForwarder = await RedisForwarder.create();
    await newForwarder.connect();
    const newServer = await TestServer.startServer('home', tmpDir, `with-redis-3`, {
      REDIS_URL: newForwarder.redisUrl,
      GRIST_INSTANCE_ID: `test-instance-3`,
    });

    instances = await client.smembers('grist-instances');
    instances.sort();
    assert.deepEqual(instances, ['test-instance-0', 'test-instance-1', 'test-instance-3']);

    const server = servers[0].server;
    const resp = await fetch(`${server.serverUrl}/status?allInstancesReady=1`);
    const text = await resp.text();
    assert.equal(resp.status, 200);
    assert.match(text, /allInstancesReady ok/);

    await newServer.stop();
    await newForwarder.disconnect();
  });
});
