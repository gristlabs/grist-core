import assert from 'assert';
import axios from 'axios';
import { tmpdir } from 'os';
import path from 'path';
import { configForUser } from 'test/gen-server/testUtils';
import { TestServer } from 'test/server/lib/helpers/TestServer';
import { prepareDatabase } from './helpers/PrepareDatabase';
import { prepareFilesystemDirectoryForTests } from './helpers/PrepareFilesystemDirectoryForTests';


const username = process.env.USER || "nobody";
const tmpDir = path.join(tmpdir(), `grist_test_${username}_userendpoint`);
const SUITENAME = 'users';
const chimpy = configForUser('chimpy');
const nobody = configForUser('Anonymous');
const kiwi = configForUser('Kiwi');

describe('UserEndpoint', function () {
  this.timeout(30000);
  let server: TestServer;
  let userEndpoint: string;
  before(async () => {
    await prepareFilesystemDirectoryForTests(tmpDir);
    await prepareDatabase(tmpDir);
    const additionalEnvConfiguration = {
      GRIST_DEFAULT_EMAIL: 'chimpy@getgrist.com'
    };
    server = await TestServer.startServer('home,docs', tmpDir, SUITENAME, additionalEnvConfiguration);
    userEndpoint = `${server.serverUrl}/users/`;
  });

  after(async function () {
    await server.stop();
  });

  describe('POST /users', function () {
    [
      {
        username: 'nobody',
        user: nobody
      }, {
        username: 'kiwi',
        user: kiwi
      }
    ].forEach((ctx) => {
      it(`should disallow creating a user when logged in as ${ctx.username}`, async () => {
        const res = await axios.post(userEndpoint, {
          hello: 'world',
        }, ctx.user);
        assert.equal(res.status, 403);
      });
    });

    it('should create a user', async () => {
      const res = await axios.post(userEndpoint, {
        hello: 'world',
      }, chimpy);
      assert.equal(res.status, 200);
    });
  });
});
