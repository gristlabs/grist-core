import {GristDeploymentType} from 'app/common/gristUrls';
import {PrefSource} from 'app/common/InstallAPI';
import {TelemetryEvent, TelemetryLevel} from 'app/common/Telemetry';
import {ILogMeta, LogMethods} from 'app/server/lib/LogMethods';
import {filterMetadata, ITelemetry, Telemetry} from 'app/server/lib/Telemetry';
import axios from 'axios';
import {assert} from 'chai';
import * as sinon from 'sinon';
import {TestServer} from 'test/gen-server/apiUtils';
import {configForUser} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

const chimpy = configForUser('Chimpy');
const kiwi = configForUser('Kiwi');
const anon = configForUser('Anonymous');

describe('Telemetry', function() {
  let oldEnv: testUtils.EnvironmentSnapshot;

  before(async function() {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.TYPEORM_DATABASE = ':memory:';
  });

  after(function() {
    oldEnv.restore();
  });

  const variants: [GristDeploymentType, TelemetryLevel, PrefSource][] = [
    ['saas', 'off', 'environment-variable'],
    ['saas', 'limited', 'environment-variable'],
    ['saas', 'full', 'environment-variable'],
    ['core', 'off', 'environment-variable'],
    ['core', 'limited', 'environment-variable'],
    ['core', 'full', 'environment-variable'],
    ['core', 'off', 'preferences'],
    ['core', 'limited', 'preferences'],
    ['core', 'full', 'preferences'],
  ];

  for (const [deploymentType, telemetryLevel, settingSource] of variants) {
    describe(`in grist-${deploymentType} with level "${telemetryLevel}" set via ${settingSource}`, function() {
      let server: TestServer;
      let homeUrl: string;
      let installationId: string;
      let telemetry: ITelemetry;
      let forwardEventSpy: sinon.SinonSpy;
      let doForwardEventStub: sinon.SinonStub;

      const sandbox = sinon.createSandbox();
      const loggedEvents: [TelemetryEvent, ILogMeta][] = [];

      before(async function() {
        process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = deploymentType;
        if (settingSource === 'environment-variable') {
          process.env.GRIST_TELEMETRY_LEVEL = telemetryLevel;
        }
        process.env.GRIST_DEFAULT_EMAIL = 'chimpy@getgrist.com';
        server = new TestServer(this);
        homeUrl = await server.start();
        if (settingSource ==='preferences') {
          await axios.patch(`${homeUrl}/api/install/prefs`, {
            telemetry: {telemetryLevel},
          }, chimpy);
        }
        installationId = (await server.server.getActivations().current()).id;
        telemetry = server.server.getTelemetry();

        sandbox
          .stub(LogMethods.prototype, 'rawLog')
          .callsFake((_level: string, _info: unknown, name: string, meta: ILogMeta) => {
            loggedEvents.push([name as TelemetryEvent, meta]);
          });
        forwardEventSpy = sandbox
          .spy(Telemetry.prototype as any, '_forwardEvent');
        doForwardEventStub = sandbox
          .stub(Telemetry.prototype as any, '_doForwardEvent');
      });

      after(async function() {
        delete process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE;
        delete process.env.GRIST_TELEMETRY_LEVEL;
        delete process.env.GRIST_DEFAULT_EMAIL;
        await server.stop();
        sandbox.restore();
      });

      it('returns the current telemetry config', async function() {
        assert.deepEqual(telemetry.getTelemetryConfig(), {
          telemetryLevel,
        });
      });

      if (deploymentType === 'core') {
        it('returns the current telemetry status', async function() {
          const resp = await axios.get(`${homeUrl}/api/install/prefs`, chimpy);
          assert.equal(resp.status, 200);
          assert.deepEqual(resp.data, {
            telemetry: {
              telemetryLevel: {
                value: telemetryLevel,
                source: settingSource,
              },
            },
          });
        });
      }

      if (telemetryLevel !== 'off') {
        if (deploymentType === 'saas') {
          it('logs telemetry events', async function() {
            if (telemetryLevel === 'limited') {
              telemetry.logEvent(null, 'documentOpened', {
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
                  docIdDigest: 'dige:Vq9L3nCkeufQ8euzDkXtM2Fl1cnsALqakjEeM6QlbXQ=',
                  isPublic: false,
                  installationId,
                }
              ]);
            }

            if (telemetryLevel === 'full') {
              telemetry.logEvent(null, 'documentOpened', {
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
                  docIdDigest: 'dige:Vq9L3nCkeufQ8euzDkXtM2Fl1cnsALqakjEeM6QlbXQ=',
                  isPublic: false,
                  userId: 1,
                  installationId,
                }
              ]);
            }

            assert.equal(loggedEvents.length, 1);
            assert.equal(forwardEventSpy.callCount, 0);
          });
        } else {
          it('forwards telemetry events', async function() {
            if (telemetryLevel === 'limited') {
              telemetry.logEvent(null, 'documentOpened', {
                limited: {
                  docIdDigest: 'digest',
                  isPublic: false,
                },
              });
              assert.deepEqual(forwardEventSpy.lastCall.args, [
                null,
                'documentOpened',
                {
                  docIdDigest: 'dige:Vq9L3nCkeufQ8euzDkXtM2Fl1cnsALqakjEeM6QlbXQ=',
                  isPublic: false,
                }
              ]);
              assert.equal(forwardEventSpy.callCount, 1);
            }

            if (telemetryLevel === 'full') {
              telemetry.logEvent(null, 'documentOpened', {
                limited: {
                  docIdDigest: 'digest',
                  isPublic: false,
                },
                full: {
                  userId: 1,
                },
              });
              assert.deepEqual(forwardEventSpy.lastCall.args, [
                null,
                'documentOpened',
                {
                  docIdDigest: 'dige:Vq9L3nCkeufQ8euzDkXtM2Fl1cnsALqakjEeM6QlbXQ=',
                  isPublic: false,
                  userId: 1,
                }
              ]);
              // An earlier test triggered an apiUsage event.
              assert.equal(forwardEventSpy.callCount, 2);
            }

            assert.isEmpty(loggedEvents);
          });
        }
      } else {
        it('does not log telemetry events', async function() {
          telemetry.logEvent(null, 'documentOpened', {
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
            telemetry.logEventAsync(null, 'invalidEvent' as TelemetryEvent, {limited: {method: 'GET'}}),
            /Unknown telemetry event: invalidEvent/
          );
        });

        it("throws an error when an event's metadata is invalid", async function() {
          await assert.isRejected(
            telemetry.logEventAsync(null, 'documentOpened', {limited: {invalidMetadata: 'GET'}}),
            /Unknown metadata for telemetry event documentOpened: invalidMetadata/
          );
        });

        if (telemetryLevel === 'limited') {
          it("throws an error when an event's metadata requires an elevated telemetry level", async function() {
            await assert.isRejected(
              telemetry.logEventAsync(null, 'documentOpened', {limited: {userId: 1}}),
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
                eventCategory: 'Welcome',
                eventSource: `grist-${deploymentType}`,
                watchTimeSeconds: 30,
                installationId,
                isInternalUser: true,
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
            const [, event, metadata] = forwardEventSpy.lastCall.args;
            assert.equal(event, 'watchedVideoTour');
            if (telemetryLevel === 'limited') {
              assert.deepEqual(metadata, {
                watchTimeSeconds: 30,
              });
            } else {
              assert.containsAllKeys(metadata, [
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
              // The count below includes 2 apiUsage events triggered as side effects.
              assert.equal(forwardEventSpy.callCount, 4);
              assert.equal(forwardEventSpy.thirdCall.args[1], 'apiUsage');
            }
            assert.isEmpty(loggedEvents);
          });

          it('skips forwarding events if too many requests are pending', async function() {
            let numRequestsMade = 0;
            doForwardEventStub.callsFake(async () => {
              numRequestsMade += 1;
              await new Promise(resolve => setTimeout(resolve, 1000));
            });
            forwardEventSpy.resetHistory();

            // Log enough events simultaneously to cause some to be skipped. (The limit is 25.)
            for (let i = 0; i < 30; i++) {
              void telemetry.logEvent(null, 'documentOpened', {
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
          telemetry.logEvent(null, 'apiUsage', {limited: {method: 'GET'}});
          assert.isEmpty(loggedEvents);
          assert.equal(forwardEventSpy.callCount, 0);
        });
      }
    });
  }

  describe('api', function() {
    let server: TestServer;
    let homeUrl: string;

    const sandbox = sinon.createSandbox();

    before(async function() {
      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
      process.env.GRIST_DEFAULT_EMAIL = 'chimpy@getgrist.com';
      server = new TestServer(this);
      homeUrl = await server.start();
      sandbox.stub(Telemetry.prototype as any, '_doForwardEvent');
    });

    after(async function() {
      delete process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE;
      delete process.env.GRIST_DEFAULT_EMAIL;
      await server.stop();
      sandbox.restore();
    });

    it('GET /install/prefs returns 403 for non-default users', async function() {
      const resp = await axios.get(`${homeUrl}/api/install/prefs`, kiwi);
      assert.equal(resp.status, 403);
    });

    it('GET /install/prefs returns 200 for the default user', async function() {
      const resp = await axios.get(`${homeUrl}/api/install/prefs`, chimpy);
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {
        telemetry: {
          telemetryLevel: {
            value: 'off',
            source: 'preferences',
          },
        },
      });
    });

    it('PATCH /install/prefs returns 403 for non-default users', async function() {
      const resp = await axios.patch(`${homeUrl}/api/install/prefs`, {
        telemetry: {telemetryLevel: 'limited'},
      }, kiwi);
      assert.equal(resp.status, 403);
    });

    it('PATCH /install/prefs returns 200 for the default user', async function() {
      let resp = await axios.patch(`${homeUrl}/api/install/prefs`, {
        telemetry: {telemetryLevel: 'limited'},
      }, chimpy);
      assert.equal(resp.status, 200);

      resp = await axios.get(`${homeUrl}/api/install/prefs`, chimpy);
      assert.deepEqual(resp.data, {
        telemetry: {
          telemetryLevel: {
            value: 'limited',
            source: 'preferences',
          },
        },
      });
    });
  });

  describe('filterMetadata', function() {
    it('returns filtered and flattened metadata when maxLevel is "full"', function() {
      const metadata = {
        limited: {
          foo: 'abc',
        },
        full: {
          bar: '123',
        },
      };
      assert.deepEqual(filterMetadata(metadata, 'full'), {
        foo: 'abc',
        bar: '123',
      });
    });

    it('returns filtered and flattened metadata when maxLevel is "limited"', function() {
      const metadata = {
        limited: {
          foo: 'abc',
        },
        full: {
          bar: '123',
        },
      };
      assert.deepEqual(filterMetadata(metadata, 'limited'), {
        foo: 'abc',
      });
    });

    it('returns undefined when maxLevel is "off"', function() {
      assert.isUndefined(filterMetadata(undefined, 'off'));
    });

    it('returns an empty object when metadata is empty', function() {
      assert.isEmpty(filterMetadata({}, 'full'));
    });

    it('returns undefined when metadata is undefined', function() {
      assert.isUndefined(filterMetadata(undefined, 'full'));
    });

    it('does not mutate metadata', function() {
      const metadata = {
        limited: {
          foo: 'abc',
        },
        full: {
          bar: '123',
        },
      };
      filterMetadata(metadata, 'limited');
      assert.deepEqual(metadata, {
        limited: {
          foo: 'abc',
        },
        full: {
          bar: '123',
        },
      });
    });

    it('excludes keys with nullish values', function() {
      const metadata = {
        limited: {
          foo1: null,
          foo2: 'abc',
        },
        full: {
          bar1: undefined,
          bar2: '123',
        },
      };
      assert.deepEqual(filterMetadata(metadata, 'full'), {
        foo2: 'abc',
        bar2: '123',
      });
    });

    it('hashes keys suffixed with "Digest"', function() {
      const metadata = {
        limited: {
          docIdDigest: 'FGWGX4S6TB6',
          docId: '3WH3D68J28',
        },
      };
      assert.deepEqual(filterMetadata(metadata, 'limited'), {
        docIdDigest: 'FGWG:omhYAysWiM7coZK+FLK/tIOPW4BaowXjU7J/P9ynYcU=',
        docId: '3WH3D68J28',
      });
    });
  });
});
