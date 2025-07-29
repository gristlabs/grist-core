import { assert } from 'chai';
import fetch from 'node-fetch';
import { TestServer } from 'test/gen-server/apiUtils';
import { RedisForwarder } from 'test/server/tcpForwarder';
import * as testUtils from 'test/server/testUtils';
import { waitForIt } from 'test/server/wait';

describe('HealthCheck', function() {
  testUtils.setTmpLogLevel('error');

  for (const serverType of ['home', 'docs'] as Array<'home'|'docs'>) {
    describe(serverType, function() {
      let server: TestServer;
      let oldEnv: testUtils.EnvironmentSnapshot;
      let redisForwarder: RedisForwarder;

      before(async function() {
        oldEnv = new testUtils.EnvironmentSnapshot();

        // We set up Redis via a forwarder, so that we can simulate disconnects.
        redisForwarder = await RedisForwarder.create();
        process.env.REDIS_URL = `redis://localhost:${redisForwarder.port}`;
        server = new TestServer(this);
        await server.start([serverType]);
      });

      after(async function() {
        await server.stop();
        await redisForwarder.disconnect();
        oldEnv.restore();
      });

      it('has a working simple /status endpoint', async function() {
        const result = await fetch(server.server.getOwnUrl() + '/status');
        const text = await result.text();
        assert.match(text, /Grist server.*alive/);
        assert.notMatch(text, /db|redis/);
        assert.equal(result.ok, true);
        assert.equal(result.status, 200);
      });

      it('allows asking for db and redis status', async function() {
        const result = await fetch(server.server.getOwnUrl() + '/status?db=1&redis=1&timeout=500');
        assert.match(await result.text(), /Grist server.*alive.*db ok, redis ok/);
        assert.equal(result.ok, true);
        assert.equal(result.status, 200);
      });

      function blockPostgres(driver: any) {
        // Make the database unhealthy by exausting the connection pool. This happens to be a way
        // that has occurred in practice.
        const blockers: Array<Promise<void>> = [];
        const resolvers: Array<() => void> = [];
        for (let i = 0; i < driver.master.options.max; i++) {
          const promise = new Promise<void>((resolve) => { resolvers.push(resolve); });
          blockers.push(server.dbManager.connection.transaction((manager) => promise));
        }
        return {
          blockerPromise: Promise.all(blockers),
          resolve: () => resolvers.forEach(resolve => resolve()),
        };
      }

      it('reports error when database is unhealthy', async function() {
        if (server.dbManager.connection.options.type !== 'postgres') {
          // On postgres, we have a way to interfere with connections. Elsewhere (sqlite) it's not
          // so obvious how to make DB unhealthy, so don't bother testing that.
          this.skip();
        }
        this.timeout(5000);

        const {blockerPromise, resolve} = blockPostgres(server.dbManager.connection.driver as any);
        try {
          const result = await fetch(server.server.getOwnUrl() + '/status?db=1&redis=1&timeout=500');
          assert.match(await result.text(), /Grist server.*unhealthy.*db not ok, redis ok/);
          assert.equal(result.ok, false);
          assert.equal(result.status, 500);

          // Plain /status endpoint should be unaffected.
          assert.isTrue((await fetch(server.server.getOwnUrl() + '/status')).ok);
        } finally {
          resolve();
          await blockerPromise;
        }
        assert.isTrue((await fetch(server.server.getOwnUrl() + '/status?db=1&redis=1&timeout=100')).ok);
      });

      it('reports error when redis is unhealthy', async function() {
        this.timeout(5000);
        await redisForwarder.disconnect();
        try {
          const result = await fetch(server.server.getOwnUrl() + '/status?db=1&redis=1&timeout=500');
          assert.match(await result.text(), /Grist server.*unhealthy.*db ok, redis not ok/);
          assert.equal(result.ok, false);
          assert.equal(result.status, 500);

          // Plain /status endpoint should be unaffected.
          assert.isTrue((await fetch(server.server.getOwnUrl() + '/status')).ok);
        } finally {
          await redisForwarder.connect();
        }
        await waitForIt(async () =>
          assert.isTrue((await fetch(server.server.getOwnUrl() + '/status?db=1&redis=1&timeout=100')).ok),
          2000);
      });
    });
  }
});
