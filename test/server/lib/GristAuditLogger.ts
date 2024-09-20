import {IAuditLogger} from 'app/server/lib/AuditLogger';
import {LogMethods} from 'app/server/lib/LogMethods';
import {assert} from 'chai';
import moment from 'moment-timezone';
import nock from 'nock';
import * as sinon from 'sinon';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';

describe('GristAuditLogger', function() {
  let auditLogger: IAuditLogger;
  let oldEnv: testUtils.EnvironmentSnapshot;
  let server: TestServer;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_AUDIT_HTTP_ENDPOINT = 'https://api.getgrist.com/events';
    process.env.GRIST_AUDIT_HTTP_AUTHORIZATION_HEADER = 'Grist bb48d1f8-8f6c-4065-8951-8543a8e70597';
    server = new TestServer(this);
    await server.start();
    auditLogger = server.server.getAuditLogger();
  });

  after(async function() {
    await server.stop();
    oldEnv.restore();
  });

  describe('logEventAsync', function() {
    const sandbox: sinon.SinonSandbox = sinon.createSandbox();
    let logErrorCallArguments: any[] = [];

    before(async function() {
      sandbox
        .stub(LogMethods.prototype, 'error')
        .callsFake((...args) => logErrorCallArguments.push([...args]));
    });

    after(async function() {
      sandbox.restore();
    });

    afterEach(function() {
      logErrorCallArguments = [];
      nock.cleanAll();
    });

    it('logs audit events', async function() {
      const timestamp = moment().toISOString();
      const scope = nock('https://api.getgrist.com')
        .matchHeader('Authorization', 'Grist bb48d1f8-8f6c-4065-8951-8543a8e70597')
        .post('/events', {
          event: {
            name: 'createDocument',
            user: null,
            details: {
              id: 'docId',
            },
          },
          timestamp,
        })
        .reply(200);
      await assert.isFulfilled(
        auditLogger.logEventAsync(null, {
          event: {
            name: 'createDocument',
            details: {id: 'docId'},
          },
          timestamp,
        })
      );
      assert.isTrue(scope.isDone());
    });

    it('throws on failure to log', async function() {
      nock('https://api.getgrist.com')
        .post('/events')
        .reply(404, 'Not found');
      await assert.isRejected(
        auditLogger.logEventAsync(null, {
          event: {
            name: 'createDocument',
            details: {id: 'docId'},
          },
        }),
        'received a non-200 response from https://api.getgrist.com/events: 404 Not found'
      );
    });

    it('throws if max pending requests exceeded', async function() {
      nock('https://api.getgrist.com')
        .persist()
        .post('/events')
        .delay(2000)
        .reply(200);
      // Queue up enough pending requests to reach the limit (25).
      for (let i = 0; i < 25; i++) {
        void auditLogger.logEvent(null, {
          event: {
            name: 'createDocument',
            details: {id: 'docId'},
          },
        });
      }
      await assert.isRejected(
        auditLogger.logEventAsync(null, {
          event: {
            name: 'createDocument',
            details: {id: 'docId'},
          },
        }),
        'exceeded the maximum number of pending audit event calls (25)'
      );
      nock.abortPendingRequests();
    });
  });
});
