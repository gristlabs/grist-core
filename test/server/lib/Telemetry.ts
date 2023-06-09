import {GristDeploymentType} from 'app/common/gristUrls';
import {TelemetryEvent, TelemetryLevel} from 'app/common/Telemetry';
import {ILogMeta, LogMethods} from 'app/server/lib/LogMethods';
import {ITelemetry, Telemetry} from 'app/server/lib/Telemetry';
import axios from 'axios';
import {assert} from 'chai';
import * as sinon from 'sinon';
import {TestServer} from 'test/gen-server/apiUtils';
import {configForUser} from 'test/gen-server/testUtils';

const chimpy = configForUser('Chimpy');
const anon = configForUser('Anonymous');

describe('Telemetry', function() {
  const deploymentTypesAndTelemetryLevels: [GristDeploymentType, TelemetryLevel][] = [
    ['saas', 'off'],
    ['saas', 'limited'],
    ['saas', 'full'],
    ['core', 'off'],
    ['core', 'limited'],
    ['core', 'full'],
  ];

  for (const [deploymentType, telemetryLevel] of deploymentTypesAndTelemetryLevels) {
    describe(`in grist-${deploymentType} with a telemetry level of "${telemetryLevel}"`, function() {
      let homeUrl: string;
      let installationId: string;
      let server: TestServer;
      let telemetry: ITelemetry;
      let forwardEventSpy: sinon.SinonSpy;
      let postJsonPayloadStub: sinon.SinonStub;

      const sandbox = sinon.createSandbox();
      const loggedEvents: [TelemetryEvent, ILogMeta][] = [];

      before(async function() {
        process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = deploymentType;
        process.env.GRIST_TELEMETRY_LEVEL = telemetryLevel;
        server = new TestServer(this);
        homeUrl = await server.start();
        installationId = (await server.server.getActivations().current()).id;
        sandbox
          .stub(LogMethods.prototype, 'rawLog')
          .callsFake((_level: string, _info: unknown, name: string, meta: ILogMeta) => {
            loggedEvents.push([name as TelemetryEvent, meta]);
          });
        forwardEventSpy = sandbox
          .spy(Telemetry.prototype as any, '_forwardEvent');
        postJsonPayloadStub = sandbox
          .stub(Telemetry.prototype as any, '_postJsonPayload');
        telemetry = server.server.getTelemetry();
      });

      after(async function() {
        await server.stop();
        sandbox.restore();
        delete process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE;
        delete process.env.GRIST_TELEMETRY_LEVEL;
      });

      it('returns the current telemetry level', async function() {
        assert.equal(telemetry.getTelemetryLevel(), telemetryLevel);
      });

      if (telemetryLevel !== 'off') {
        if (deploymentType === 'saas') {
          it('logs telemetry events', async function() {
            if (telemetryLevel === 'limited') {
              await telemetry.logEvent('documentOpened', {
                limited: {
                  docIdDigest: 'digest',
                  isPublic: false,
                },
              });
              assert.deepEqual(loggedEvents[loggedEvents.length - 1], [
                'documentOpened',
                {
                  eventName: 'documentOpened',
                  eventSource: `grist-${deploymentType}`,
                  docIdDigest: 'digest',
                  isPublic: false,
                }
              ]);
            }

            if (telemetryLevel === 'full') {
              await telemetry.logEvent('documentOpened', {
                limited: {
                  docIdDigest: 'digest',
                  isPublic: false,
                },
                full: {
                  userId: 1,
                },
              });
              assert.deepEqual(loggedEvents[loggedEvents.length - 1], [
                'documentOpened',
                {
                  eventName: 'documentOpened',
                  eventSource: `grist-${deploymentType}`,
                  docIdDigest: 'digest',
                  isPublic: false,
                  userId: 1,
                }
              ]);
            }

            assert.equal(loggedEvents.length, 1);
            assert.equal(forwardEventSpy.callCount, 0);
          });
        } else {
          it('forwards telemetry events', async function() {
            if (telemetryLevel === 'limited') {
              await telemetry.logEvent('documentOpened', {
                limited: {
                  docIdDigest: 'digest',
                  isPublic: false,
                },
              });
              assert.deepEqual(forwardEventSpy.lastCall.args, [
                'documentOpened',
                {
                  docIdDigest: 'digest',
                  isPublic: false,
                }
              ]);
            }

            if (telemetryLevel === 'full') {
              await telemetry.logEvent('documentOpened', {
                limited: {
                  docIdDigest: 'digest',
                  isPublic: false,
                },
                full: {
                  userId: 1,
                },
              });
              assert.deepEqual(forwardEventSpy.lastCall.args, [
                'documentOpened',
                {
                  docIdDigest: 'digest',
                  isPublic: false,
                  userId: 1,
                }
              ]);
            }

            assert.equal(forwardEventSpy.callCount, 1);
            assert.isEmpty(loggedEvents);
          });
        }
      } else {
        it('does not log telemetry events', async function() {
          await telemetry.logEvent('documentOpened', {
            limited: {
              docIdDigest: 'digest',
              isPublic: false,
            },
          });
          assert.isEmpty(loggedEvents);
          assert.equal(forwardEventSpy.callCount, 0);
        });
      }

      if (telemetryLevel !== 'off') {
        it('throws an error when an event is invalid', async function() {
          await assert.isRejected(
            telemetry.logEvent('invalidEvent' as TelemetryEvent, {limited: {method: 'GET'}}),
            /Unknown telemetry event: invalidEvent/
          );
        });

        it("throws an error when an event's metadata is invalid", async function() {
          await assert.isRejected(
            telemetry.logEvent('documentOpened', {limited: {invalidMetadata: 'GET'}}),
            /Unknown metadata for telemetry event documentOpened: invalidMetadata/
          );
        });

        if (telemetryLevel === 'limited') {
          it('throws an error when an event requires an elevated telemetry level', async function() {
            await assert.isRejected(
              telemetry.logEvent('signupVerified', {}),
              /Telemetry event signupVerified requires a minimum telemetry level of 2 but the current level is 1/
            );
          });

          it("throws an error when an event's metadata requires an elevated telemetry level", async function() {
            await assert.isRejected(
              telemetry.logEvent('documentOpened', {limited: {userId: 1}}),
              // eslint-disable-next-line max-len
              /Telemetry metadata userId of event documentOpened requires a minimum telemetry level of 2 but the current level is 1/
            );
          });
        }
      }

      if (telemetryLevel !== 'off') {
        if (deploymentType === 'saas') {
          it('logs telemetry events sent to /api/telemetry', async function() {
            await axios.post(`${homeUrl}/api/telemetry`, {
              event: 'watchedVideoTour',
              metadata: {
                limited: {watchTimeSeconds: 30},
              },
            }, chimpy);
            const [event, metadata] = loggedEvents[loggedEvents.length - 1];
            assert.equal(event, 'watchedVideoTour');
            if (telemetryLevel === 'limited') {
              assert.deepEqual(metadata, {
                eventName: 'watchedVideoTour',
                eventSource: `grist-${deploymentType}`,
                watchTimeSeconds: 30,
              });
            } else {
              assert.containsAllKeys(metadata, [
                'eventSource',
                'watchTimeSeconds',
                'userId',
                'altSessionId',
              ]);
              assert.equal(metadata.watchTimeSeconds, 30);
              assert.equal(metadata.userId, 1);
            }

            if (telemetryLevel === 'limited') {
              assert.equal(loggedEvents.length, 2);
            } else {
              // The POST above also triggers an "apiUsage" event.
              assert.equal(loggedEvents.length, 3);
              assert.equal(loggedEvents[1][0], 'apiUsage');
            }
            assert.equal(forwardEventSpy.callCount, 0);
          });

          if (telemetryLevel === 'limited') {
            it('skips checks if event sent to /api/telemetry is from an external source', async function() {
              await axios.post(`${homeUrl}/api/telemetry`, {
                event: 'watchedVideoTour',
                metadata: {
                  eventSource: 'grist-core',
                  watchTimeSeconds: 60,
                  userId: 123,
                  altSessionId: 'altSessionId',
                },
              }, anon);
              const [event, metadata] = loggedEvents[loggedEvents.length - 1];
              assert.equal(event, 'watchedVideoTour');
              assert.containsAllKeys(metadata, [
                'eventSource',
                'watchTimeSeconds',
                'userId',
                'altSessionId',
              ]);
              assert.equal(metadata.watchTimeSeconds, 60);
              assert.equal(metadata.userId, 123);
              assert.equal(loggedEvents.length, 3);
              assert.equal(forwardEventSpy.callCount, 0);
            });
          }
        } else {
          it('forwards telemetry events sent to /api/telemetry', async function() {
            await axios.post(`${homeUrl}/api/telemetry`, {
              event: 'watchedVideoTour',
              metadata: {
                limited: {watchTimeSeconds: 30},
              },
            }, chimpy);
            const [event, metadata] = forwardEventSpy.lastCall.args;
            assert.equal(event, 'watchedVideoTour');
            if (telemetryLevel === 'limited') {
              assert.deepEqual(metadata, {
                eventSource: `grist-${deploymentType}`,
                installationId,
                watchTimeSeconds: 30,
              });
            } else {
              assert.containsAllKeys(metadata, [
                'eventSource',
                'installationId',
                'watchTimeSeconds',
                'userId',
                'altSessionId',
              ]);
              assert.equal(metadata.watchTimeSeconds, 30);
              assert.equal(metadata.userId, 1);
            }

            if (telemetryLevel === 'limited') {
              assert.equal(forwardEventSpy.callCount, 2);
            } else {
              // The POST above also triggers an "apiUsage" event.
              assert.equal(forwardEventSpy.callCount, 3);
              assert.equal(forwardEventSpy.secondCall.args[0], 'apiUsage');
            }
            assert.isEmpty(loggedEvents);
          });

          it('skips forwarding events if too many requests are pending', async function() {
            let numRequestsMade = 0;
            postJsonPayloadStub.callsFake(async () => {
              numRequestsMade += 1;
              await new Promise(resolve => setTimeout(resolve, 1000));
            });
            forwardEventSpy.resetHistory();

            // Log enough events simultaneously to cause some to be skipped. (The limit is 25.)
            for (let i = 0; i < 30; i++) {
              void telemetry.logEvent('documentOpened', {
                limited: {
                  docIdDigest: 'digest',
                  isPublic: false,
                },
              });
            }

            // Check that out of the 30 forwardEvent calls, only 25 made POST requests.
            assert.equal(forwardEventSpy.callCount, 30);
            assert.equal(numRequestsMade, 25);
          });
        }
      } else {
        it('does not log telemetry events sent to /api/telemetry', async function() {
          await telemetry.logEvent('apiUsage', {limited: {method: 'GET'}});
          assert.isEmpty(loggedEvents);
          assert.equal(forwardEventSpy.callCount, 0);
        });
      }
    });
  }
});
