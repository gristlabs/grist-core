import {ANONYMOUS_USER_EMAIL, UserAPI} from 'app/common/UserAPI';
import * as sinon from 'sinon';
import {TestServer} from 'test/gen-server/apiUtils';
import {GristClient, openClient} from 'test/server/gristClient';

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
  viewer: {
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
  this.timeout(5000);
  let home: TestServer;
  let owner: UserAPI;
  let editor: UserAPI;
  let viewer: UserAPI;
  let docId: string;
  let wsId: number;
  const sandbox = sinon.createSandbox();
  let clients: GristClient[] = [];

  async function openTrackedClient(...args: Parameters<typeof openClient>) {
    const client = await openClient(...args);
    clients.push(client);
    return client;
  }

  async function getWebsocket(api: UserAPI) {
    const who = await api.getSessionActive();
    return openTrackedClient(home.server, who.user.email, who.org?.domain || 'docs');
  }

  before(async function () {
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
        [Users.viewer.email]: 'viewers',
      }
    });
    editor = await home.createHomeApi(Users.editor.username, TEST_ORG, true);
    viewer = await home.createHomeApi(Users.viewer.username, TEST_ORG, true);
  });

  after(async function () {
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.deleteOrg(TEST_ORG);
    await home.stop();
  });

  afterEach(async function () {
    // Close all tracked clients to make sure the node process can exit normally.
    await Promise.all(clients.map(closeClient));
    clients = [];
    sandbox.restore();
  });

  it('propagates docUserPresenceUpdate messages to owners and editors', async function () {
    const ownerClient = await getWebsocket(owner);
    const editorClient = await getWebsocket(editor);
    await ownerClient.openDocOnConnect(docId);
    await editorClient.openDocOnConnect(docId);

    console.log(await waitForMatchingMessage(ownerClient, msg => {
      if (msg.type === 'docUserPresenceUpdate') {
        return true;
      }
      return false;
    }));

    console.log(viewer);
    console.log(closeClient);
  });
});

async function waitForMatchingMessage(client: GristClient, checkMessage: (msg: any) => boolean): Promise<any> {
  for (;;) {
    const message = await client.read();
    if (checkMessage(message)) {
      return message;
    }
  }
}

async function closeClient(client: GristClient) {
  if (client.ws.isOpen()) {
    await client.send("closeDoc", 0);
  }
  await client.close();
}
