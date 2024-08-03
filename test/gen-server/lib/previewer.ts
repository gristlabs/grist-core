import {Organization} from 'app/gen-server/entity/Organization';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import axios from 'axios';
import {AxiosRequestConfig} from 'axios';
import {assert} from 'chai';
import {TestServer} from 'test/gen-server/apiUtils';
import {configForUser} from 'test/gen-server/testUtils';
import * as testUtils from 'test/server/testUtils';


const previewer = configForUser('thumbnail');

function permit(permitKey: string): AxiosRequestConfig {
  return {
    responseType: 'json',
    validateStatus: (status: number) => true,
    headers: {
      Permit: permitKey
    }
  };
}

describe('previewer', function() {

  let home: TestServer;
  let dbManager: HomeDBManager;
  let homeUrl: string;

  testUtils.setTmpLogLevel('error');

  before(async function() {
    home = new TestServer(this);
    await home.start(['home', 'docs']);
    dbManager = home.dbManager;
    homeUrl = home.serverUrl;
    // for these tests, give the previewer an api key.
    await dbManager.connection.query(`update users set api_key = 'api_key_for_thumbnail' where name = 'Preview'`);
  });

  after(async function() {
    await home.stop();
  });

  it('has view access to all orgs', async function() {
    const resp = await axios.get(`${homeUrl}/api/orgs`, previewer);
    assert.equal(resp.status, 200);
    const orgs: any[] = resp.data;
    assert.lengthOf(orgs, await Organization.count());
    orgs.forEach((org: any) => assert.equal(org.access, 'viewers'));
  });

  it('has view access to workspaces and docs', async function() {
    const oid = await dbManager.testGetId('NASA');
    const resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, previewer);
    assert.equal(resp.status, 200);
    const workspaces: any[] = resp.data;
    assert.lengthOf(workspaces, 2);
    workspaces.forEach((ws: any) => {
      assert.equal(ws.access, 'viewers');
      const docs: any[] = ws.docs;
      docs.forEach((doc: any) => assert.equal(doc.access, 'viewers'));
    });
  });

  it('cannot delete or update docs and workspaces', async function() {
    const oid = await dbManager.testGetId('NASA');
    let resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, previewer);
    assert.equal(resp.status, 200);

    const wsId = resp.data[0].id;
    const docId = resp.data[0].docs[0].id;

    resp = await axios.get(`${homeUrl}/api/docs/${docId}`, previewer);
    assert.equal(resp.status, 200);
    resp = await axios.delete(`${homeUrl}/api/docs/${docId}`, previewer);
    assert.equal(resp.status, 403);
    resp = await axios.patch(`${homeUrl}/api/docs/${docId}`, {name: 'diff'}, previewer);
    assert.equal(resp.status, 403);

    resp = await axios.get(`${homeUrl}/api/workspaces/${wsId}`, previewer);
    assert.equal(resp.status, 200);
    resp = await axios.delete(`${homeUrl}/api/workspaces/${wsId}`, previewer);
    assert.equal(resp.status, 403);
    resp = await axios.patch(`${homeUrl}/api/workspaces/${wsId}`, {name: 'diff'}, previewer);
    assert.equal(resp.status, 403);
  });

  it('can delete workspaces and docs using permits', async function() {
    const oid = await dbManager.testGetId('NASA');
    let resp = await axios.get(`${homeUrl}/api/orgs/${oid}/workspaces`, previewer);
    assert.equal(resp.status, 200);

    const wsId = resp.data[0].id;
    const docId = resp.data[0].docs[0].id;

    const store = home.getWorkStore().getPermitStore('internal');
    const goodDocPermit = await store.setPermit({docId});
    const badDocPermit = await store.setPermit({docId: 'dud'});
    const goodWsPermit = await store.setPermit({workspaceId: wsId});
    const badWsPermit = await store.setPermit({workspaceId: wsId + 1});

    // Check that external store is no good for internal use.
    const externalStore = home.getWorkStore().getPermitStore('external');
    const externalDocPermit = await externalStore.setPermit({docId});
    resp = await axios.get(`${homeUrl}/api/docs/${docId}`, permit(externalDocPermit));
    //assert.equal(resp.status, 401);

    resp = await axios.get(`${homeUrl}/api/docs/${docId}`, permit(badDocPermit));
    assert.equal(resp.status, 403);
    resp = await axios.delete(`${homeUrl}/api/docs/${docId}`, permit(badDocPermit));
    assert.equal(resp.status, 403);
    resp = await axios.delete(`${homeUrl}/api/docs/${docId}`, permit(goodWsPermit));
    assert.equal(resp.status, 403);
    resp = await axios.get(`${homeUrl}/api/docs/${docId}`, permit(goodDocPermit));
    assert.equal(resp.status, 403);
    resp = await axios.patch(`${homeUrl}/api/docs/${docId}`, {name: 'diff'}, permit(goodDocPermit));
    assert.equal(resp.status, 403);
    resp = await axios.delete(`${homeUrl}/api/docs/${docId}`, permit(goodDocPermit));
    assert.equal(resp.status, 200);

    resp = await axios.get(`${homeUrl}/api/workspaces/${wsId}`, permit(badWsPermit));
    assert.equal(resp.status, 403);
    resp = await axios.delete(`${homeUrl}/api/workspaces/${wsId}`, permit(badWsPermit));
    assert.equal(resp.status, 403);
    resp = await axios.delete(`${homeUrl}/api/workspaces/${wsId}`, permit(goodDocPermit));
    assert.equal(resp.status, 403);
    resp = await axios.get(`${homeUrl}/api/workspaces/${wsId}`, permit(goodWsPermit));
    assert.equal(resp.status, 403);
    resp = await axios.patch(`${homeUrl}/api/workspaces/${wsId}`, {name: 'diff'}, permit(goodWsPermit));
    assert.equal(resp.status, 403);
    resp = await axios.delete(`${homeUrl}/api/workspaces/${wsId}`, permit(goodWsPermit));
    assert.equal(resp.status, 200);

  });
});
