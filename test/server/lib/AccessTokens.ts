import {delay} from 'app/common/delay';
import {UserAPI} from 'app/common/UserAPI';
import {AccessTokenResult} from 'app/plugin/GristAPI';
import {Deps as AccessTokensDeps} from 'app/server/lib/AccessTokens';
import {assert} from 'chai';
import fetch from 'node-fetch';
import {RequestInit} from 'node-fetch';
import * as sinon from 'sinon';
import {TestServer} from 'test/gen-server/apiUtils';
import {GristClient, openClient} from 'test/server/gristClient';
import * as testUtils from 'test/server/testUtils';

describe('AccessTokens', function() {
  this.timeout(10000);
  let home: TestServer;
  testUtils.setTmpLogLevel('error');
  let owner: UserAPI;
  let docId: string;
  let wsId: number;
  let cliOwner: GristClient;
  const sandbox = sinon.createSandbox();

  before(async function() {
    home = new TestServer(this);
    await home.start(['home', 'docs']);
    const api = await home.createHomeApi('chimpy', 'docs', true);
    await api.newOrg({name: 'testy', domain: 'testy'});
    owner = await home.createHomeApi('chimpy', 'testy', true);
    wsId = await owner.newWorkspace({name: 'ws'}, 'current');
    await owner.updateWorkspacePermissions(wsId, {
      users: {
        'kiwi@getgrist.com': 'owners',
        'charon@getgrist.com': 'editors',
      }
    });
  });

  after(async function() {
    const api = await home.createHomeApi('chimpy', 'docs');
    await api.deleteOrg('testy');
    await home.stop();
  });

  afterEach(async function() {
    if (docId) {
      for (const cli of [cliOwner]) {
        try {
          await cli.send("closeDoc", 0);
        } catch (e) {
          // Do not worry if socket is already closed by the other side.
          if (!String(e).match(/WebSocket is not open/)) {
            throw e;
          }
        }
        await cli.close();
      }
      docId = "";
    }
    sandbox.restore();
  });

  async function freshDoc() {
    docId = await owner.newDoc({name: 'doc'}, wsId);
    const who = await owner.getSessionActive();
    cliOwner = await openClient(home.server, who.user.email, who.org?.domain || 'docs');
    await cliOwner.openDocOnConnect(docId);
  }

  it('honors access tokens', async function() {
    await freshDoc();

    // Make tokens more short-lived for testing purposes.
    sandbox.stub(AccessTokensDeps, 'TOKEN_TTL_MSECS').value(2000);

    // Check we can make a read only token for a document, and use it to read
    // but not write, and that it expires.
    let tokenResult: AccessTokenResult = (await cliOwner.send('getAccessToken', 0, {readOnly: true})).data;
    assert.equal(tokenResult.ttlMsecs, 2000);
    let token = tokenResult.token;
    const baseUrl: string = tokenResult.baseUrl;
    let result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 200);
    assert.sameMembers(Object.keys(await result.json()), ['records']);
    const postOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({records: [{}]}),
    };
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`, postOptions);
    // POST not allowed since read-only.
    assert.equal(result.status, 403);
    assert.match((await result.json()).error, /No write access/);
    await delay(3000);
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 401);
    assert.match((await result.json()).error, /Token has expired/);

    // Check we can make a token to write to a document.
    tokenResult = (await cliOwner.send('getAccessToken', 0, {})).data;
    token = tokenResult.token;
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 200);
    assert.sameMembers(Object.keys(await result.json()), ['records']);
    result = await fetch(baseUrl + `/tables/Table1/records?auth=${token}`, postOptions);
    assert.equal(result.status, 200);
    assert.sameMembers(Object.keys(await result.json()), ['records']);

    // Check that tokens for one document do not work on another.
    const docId2 = await owner.newDoc({name: 'doc2'}, wsId);
    tokenResult = (await cliOwner.send('getAccessToken', 0, {})).data;
    token = tokenResult.token;
    result = await fetch(home.serverUrl + `/api/docs/${docId2}/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 401);
    result = await fetch(home.serverUrl + `/api/docs/${docId}/tables/Table1/records?auth=${token}`);
    assert.equal(result.status, 200);
  });

});
