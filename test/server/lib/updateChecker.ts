import { LatestVersion } from "app/common/InstallAPI";
import { version as installedVersion } from "app/common/version";
import { TestServer } from 'test/gen-server/apiUtils';
import { getGristConfig } from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';

import { assert } from 'chai';
import * as sinon from 'sinon';
import fetch from 'node-fetch';
import { FlexServer } from "app/server/lib/FlexServer";
import { Timings } from "app/gen-server/lib/Housekeeper";


const fakeVersionUrl = 'https://whatever.computer/version';
describe('updateChecker', () => {
  testUtils.setTmpLogLevel('error');

  let fetchStub: sinon.SinonStub;
  let setVersionStub: sinon.SinonStub;
  let sandbox: sinon.SinonSandbox;
  let server: TestServer;
  let homeUrl: string;

  const oldServerEnv = new testUtils.EnvironmentSnapshot();

  function setupTestServer(mockResponse: LatestVersion) {
    beforeEach(async function () {
      // Stub out the fetch to the external version API endpoint so we
      // can specify what the latest publicly available version is.
      fetchStub = sinon.stub(global, 'fetch');
      fetchStub
        .withArgs(fakeVersionUrl, sinon.match.any)
        .resolves(new Response(
          JSON.stringify(mockResponse),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        ))
        .callThrough();

      // Stub out FlexServer.setLatestVersionAvailable so we can await
      // a promise that it's been called before we start running our tests.
      let setVersionResolved: () => void;
      const setVersionPromise: Promise<void> = new Promise<void>((resolve) => {
        setVersionResolved = resolve;
      });
      const originalSetMethod = FlexServer.prototype.setLatestVersionAvailable;
      setVersionStub = sinon.stub(FlexServer.prototype, 'setLatestVersionAvailable')
        .callsFake(function (this: FlexServer, ...args){
          originalSetMethod.apply(this, args);
          setVersionResolved();
        });

      // Remove the waiting time to do the first version check at startup
      sandbox = sinon.createSandbox();
      sandbox.stub(Timings, 'VERSION_CHECK_OFFSET_MS').value(0);

      process.env.GRIST_ALLOW_AUTOMATIC_VERSION_CHECKING = 'true';
      process.env.GRIST_TEST_VERSION_CHECK_URL = fakeVersionUrl;
      server = new TestServer(this);
      homeUrl = await server.start();
      await setVersionPromise;
    });

    afterEach(async function () {
      await server.stop();
      fetchStub.restore();
      setVersionStub.restore();
      oldServerEnv.restore();
      sandbox.restore();
    });
    return {
      server: () => server,
      homeUrl: () => homeUrl
    };
  }

  describe('when everything is up to date', () => {
    const mockVersionResponse: LatestVersion = {
      latestVersion: installedVersion,
      updatedAt: '2025-02-18T22:11:09.455904Z',
      isCritical: false,
      updateURL: 'https://hub.docker.com/r/gristlabs/grist'
    };
    const {homeUrl} = setupTestServer(mockVersionResponse);

    it('can get the latest available version information', async function () {
      const doc = await fetch(homeUrl());
      const pageBody = await doc.text();
      const config = getGristConfig(pageBody);
      const latestVersionAvailable = config.latestVersionAvailable;
      assert.equal(latestVersionAvailable?.version, installedVersion);
      assert.equal(latestVersionAvailable?.isNewer, false);
    });
  });

  describe('when a newer version is available', () => {
    const newestVersion = '99.99.99';
    const mockVersionResponse: LatestVersion = {
      latestVersion: newestVersion,
      updatedAt: '2025-02-18T22:11:09.455904Z',
      isCritical: false,
      updateURL: 'https://hub.docker.com/r/gristlabs/grist'
    };
    const {homeUrl} = setupTestServer(mockVersionResponse);

    it('can get the latest available version information', async function () {
      const doc = await fetch(homeUrl());
      const pageBody = await doc.text();
      const config = getGristConfig(pageBody);
      const latestVersionAvailable = config.latestVersionAvailable;
      assert.equal(latestVersionAvailable?.version, newestVersion);
      assert.equal(latestVersionAvailable?.isNewer, true);
    });

  });
});
