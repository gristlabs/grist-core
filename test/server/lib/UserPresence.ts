import {ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL, UserAPI} from 'app/common/UserAPI';
import {GristClient, openClient} from 'test/server/gristClient';
import {TestServer} from 'test/gen-server/apiUtils';
import {isUserPresenceDisabled, SETTING_ENABLE_USER_PRESENCE} from 'app/server/lib/DocClients';
import {assert} from 'chai';
import * as sinon from 'sinon';

const TEST_ORG = "userpresence";

const Users = {
  owner: {
    name: 'Chimpy',
    username: 'chimpy',
    email: 'chimpy@getgrist.com',
  },
  editor: {
    name: 'Charon',
    username: 'charon',
    email: 'charon@getgrist.com',
  },
  loggedInPublic: {
    name: 'Kiwi',
    username: 'kiwi',
    email: 'kiwi@getgrist.com',
  },
  anon: {
    name: 'Anonymous User',
    email: ANONYMOUS_USER_EMAIL,
  },
};

describe('UserPresence', function() {
  // Keep a short timeout so we don't waste time waiting for messages that won't arrive.
  this.timeout(7000);
  let home: TestServer;
  let owner: UserAPI;
  let editor: UserAPI;
  let docId: string;
  let wsId: number;
  const sandbox = sinon.createSandbox();
  let clients: GristClient[] = [];
  let oldUserPresenceSetting: boolean;

  async function openTrackedClient(...args: Parameters<typeof openClient>) {
    const client = await openClient(...args);
    clients.push(client);
    return client;
  }

  async function closeClient(client: GristClient) {
    if (client.ws.isOpen()) {
      await client.send("closeDoc", 0);
    }
    await client.close();
    clients = clients.filter(clientToTest => clientToTest !== client);
  }

  async function openTrackedClientForUser(email: string) {
    return openTrackedClient(home.server, email, TEST_ORG, undefined);
  }

  async function getWebsocket(api: UserAPI) {
    const who = await api.getSessionActive();
    return openTrackedClient(home.server, who.user.email, who.org?.domain || 'docs');
  }

  before(async function () {
    oldUserPresenceSetting = isUserPresenceDisabled();
    SETTING_ENABLE_USER_PRESENCE.set(true);

    home = new TestServer(this);
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: TEST_ORG, domain: TEST_ORG});
    owner = await home.createHomeApi(Users.owner.username, TEST_ORG, true);
    wsId = await owner.newWorkspace({name: 'userpresence'}, 'current');
    docId = await owner.newDoc({name: 'doc'}, wsId);

    await owner.updateWorkspacePermissions(wsId, {
      users: {
        [Users.editor.email]: 'editors',
      }
    });
    await owner.updateDocPermissions(docId, {
      users: {
        [EVERYONE_EMAIL]: 'viewers',
      }
    });
    editor = await home.createHomeApi(Users.editor.username, TEST_ORG, true);
  });

  after(async function () {
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.deleteOrg(TEST_ORG);
    await home.stop();
    SETTING_ENABLE_USER_PRESENCE.set(oldUserPresenceSetting);
  });

  afterEach(async function () {
    // Close all tracked clients to make sure the node process can exit normally.
    await Promise.all(clients.map(closeClient));
    clients = [];
    sandbox.restore();
  });

  const joiningTestCases = [
    {
      name: 'editors can see other users',
      makeObserverClient: () => getWebsocket(editor),
      makeJoinerClient: () => getWebsocket(owner),
      expectedProfile: {
        name: Users.owner.name,
        picture: null,
        isAnonymous: false,
      }
    },
    {
      name: 'anonymous users show as anonymous',
      makeObserverClient: () => getWebsocket(editor),
      makeJoinerClient: () => openTrackedClientForUser(Users.anon.email),
      expectedProfile: {
        name: Users.anon.name,
        isAnonymous: true,
      }
    },
    {
      name: 'public users show as anonymous',
      makeObserverClient: () => getWebsocket(editor),
      makeJoinerClient: () => openTrackedClientForUser(Users.loggedInPublic.email),
      expectedProfile: {
        name: Users.anon.name,
        isAnonymous: true,
      }
    },
  ];

  joiningTestCases.forEach(testCase =>
    it(`sends the correct update messages: ${testCase.name}`, async function () {
      const observerClient = await testCase.makeObserverClient();
      const joiningClient = await testCase.makeJoinerClient();
      await observerClient.openDocOnConnect(docId);
      await joiningClient.openDocOnConnect(docId);

      const joinMessage = await waitForDocUserPresenceUpdateMessage(observerClient);
      assert.deepInclude(joinMessage.data.profile, testCase.expectedProfile);

      await closeClient(joiningClient);

      const sessionEndMessage = await waitForDocUserPresenceUpdateMessage(observerClient);
      assert.equal(sessionEndMessage.data.id, joinMessage.data.id, "id of session ended doesn't match start");
    })
  );

  describe("users without the correct permissions can't see other users", async function () {
    before(async () => {
      await owner.updateDocPermissions(docId, {
        users: {
          [Users.loggedInPublic.email]: 'viewers',
          // Make all public users editors to show that no public users can see others.
          [EVERYONE_EMAIL]: 'editors',
        }
      });
    });

    after(async () => {
      await owner.updateDocPermissions(docId, {
        users: {
          [Users.loggedInPublic.email]: null,
          [EVERYONE_EMAIL]: 'viewers',
        }
      });
    });

    const testCases = [
      {
        name: "viewers can't see other users",
        makeObserverClient: () => openTrackedClientForUser(Users.loggedInPublic.email),
      },
      {
        name: "anonymous can't see other users",
        makeObserverClient: () => openTrackedClientForUser(Users.anon.email),
      },
    ];

    testCases.forEach(testCase => {
      it(testCase.name, async function () {
        const viewerClient = await testCase.makeObserverClient();
        const joiningClient = await getWebsocket(owner);

        await viewerClient.openDocOnConnect(docId);
        await joiningClient.openDocOnConnect(docId);

        await assert.isFulfilled(new Promise((resolve, reject) => {
          setTimeout(() => {
            while (viewerClient.count() > 0) {
              const msg = viewerClient.shift();
              if (msg && "type" in msg && msg.type === "docUserPresenceUpdate") {
                reject(msg);
              }
            }
            resolve(undefined);
          }, 2000);
        }));
      });
    });
  });
});

async function waitForDocUserPresenceUpdateMessage(client: GristClient): Promise<any> {
  return waitForMatchingMessage(client, msg => {
    return msg.type === 'docUserPresenceUpdate';
  });
}

async function waitForMatchingMessage(client: GristClient, checkMessage: (msg: any) => boolean): Promise<any> {
  for (;;) {
    const message = await client.read();
    if (checkMessage(message)) {
      return message;
    }
  }
}

