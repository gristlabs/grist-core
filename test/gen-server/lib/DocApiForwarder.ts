import { delay } from 'app/common/delay';
import { createDummyGristServer } from 'app/server/lib/GristServer';
import axios, { AxiosResponse } from 'axios';
import { fromCallback } from "bluebird";
import { assert } from 'chai';
import express = require("express");
import FormData from 'form-data';
import { Server } from 'http';
import defaultsDeep = require('lodash/defaultsDeep');
import morganLogger from 'morgan';
import { AddressInfo } from 'net';
import sinon = require("sinon");

import { createInitialDb, removeConnection, setUpDB } from "test/gen-server/seed";
import { configForUser } from 'test/gen-server/testUtils';

import { DocApiForwarder } from "app/gen-server/lib/DocApiForwarder";
import { DocWorkerMap, getDocWorkerMap } from "app/gen-server/lib/DocWorkerMap";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { addRequestUser } from 'app/server/lib/Authorizer';
import { jsonErrorHandler } from 'app/server/lib/expressWrap';
import log from 'app/server/lib/log';
import * as testUtils from 'test/server/testUtils';


const chimpy = configForUser('Chimpy');
const kiwi = configForUser('kiwi');

const logToConsole = false;

async function createServer(app: express.Application, name: string) {
  let server: Server;
  if (logToConsole) {
    app.use(morganLogger((...args: any[]) => {
      return `${log.timestamp()} ${name} ${morganLogger.dev(...args)}`;
    }));
  }
  app.set('port', 0);
  await fromCallback((cb: any) => server = app.listen(app.get('port'), 'localhost', cb));
  log.info(`${name} listening ${getUrl(server!)}`);
  return server!;
}

function getUrl(server: Server) {
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

describe('DocApiForwarder', function() {

  testUtils.setTmpLogLevel('error');

  let homeServer: Server;
  let docWorker: Server;
  let resp: AxiosResponse;
  let homeUrl: string;
  let dbManager: HomeDBManager;
  const docWorkerStub = sinon.stub();

  before(async function() {
    setUpDB(this);
    dbManager = new HomeDBManager();
    await dbManager.connect();
    await createInitialDb(dbManager.connection);
    await dbManager.initializeSpecialIds();

    // create cheap doc worker
    let app = express();
    docWorker = await createServer(app, 'docw');
    app.use(express.json());
    app.use(docWorkerStub);

    // create cheap home server
    app = express();
    homeServer = await createServer(app, 'home');
    homeUrl = getUrl(homeServer);

    // stubs doc worker map
    const docWorkerMapStub = sinon.createStubInstance(DocWorkerMap);
    docWorkerMapStub.assignDocWorker.returns(Promise.resolve({
      docWorker: {
        internalUrl: getUrl(docWorker) + '/dw/foo',
        publicUrl: '',
        id: '',
      },
      docMD5: null,
      isActive: true,
    }));

    // create and register forwarder
    const docApiForwarder = new DocApiForwarder(docWorkerMapStub, dbManager, null as any);
    app.use("/api", addRequestUser.bind(null, dbManager, getDocWorkerMap().getPermitStore('internal'),
                                        {gristServer: createDummyGristServer()} as any));
    docApiForwarder.addEndpoints(app);
    app.use('/api', jsonErrorHandler);
  });

  after(async function() {
    await removeConnection();
    homeServer.close();
    docWorker.close();
    dbManager.flushDocAuthCache();    // To avoid hanging up exit from tests.
  });

  beforeEach(() => {
    docWorkerStub.resetHistory();
    docWorkerStub.callsFake((req: any, res: any) => res.status(200).json('mango tree'));
  });

  it('should forward GET /api/docs/:did/tables/:tid/data', async function() {
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, 'mango tree');
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get('Authorization'), 'Bearer api_key_for_chimpy');
    assert.equal(req.get('Content-Type'), 'application/json');
    assert.equal(req.originalUrl, '/dw/foo/api/docs/sampledocid_16/tables/table1/data');
    assert.equal(req.method, 'GET');
  });

  it('should forward GET /api/docs/:did/tables/:tid/data?filter=<...>', async function() {
    const filter = encodeURIComponent(JSON.stringify({FOO: ['bar']})); // => %7B%22FOO%22%3A%5B%22bar%22%5D%7D
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data?filter=${filter}`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, 'mango tree');
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get('Authorization'), 'Bearer api_key_for_chimpy');
    assert.equal(req.get('Content-Type'), 'application/json');
    assert.equal(req.originalUrl,
                 '/dw/foo/api/docs/sampledocid_16/tables/table1/data?filter=%7B%22FOO%22%3A%5B%22bar%22%5D%7D');
    assert.equal(req.method, 'GET');
  });

  it('should deny user without view permissions', async function() {
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_13/tables/table1/data`, kiwi);
    assert.equal(resp.status, 403);
    assert.deepEqual(resp.data, {error: 'No view access'});
    assert.equal(docWorkerStub.callCount, 0);
  });


  it('should forward POST /api/docs/:did/tables/:tid/data', async function() {
    resp = await axios.post(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, {message: 'golden pears'}, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, 'mango tree');
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get('Authorization'), 'Bearer api_key_for_chimpy');
    assert.equal(req.get('Content-Type'), 'application/json');
    assert.equal(req.originalUrl, '/dw/foo/api/docs/sampledocid_16/tables/table1/data');
    assert.equal(req.method, 'POST');
    assert.deepEqual(req.body, {message: 'golden pears'});
  });


  it('should forward PATCH /api/docs/:did/tables/:tid/data', async function() {
    resp = await axios.patch(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`,
                             {message: 'golden pears'}, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data, 'mango tree');
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get('Authorization'), 'Bearer api_key_for_chimpy');
    assert.equal(req.get('Content-Type'), 'application/json');
    assert.equal(req.originalUrl, '/dw/foo/api/docs/sampledocid_16/tables/table1/data');
    assert.equal(req.method, 'PATCH');
    assert.deepEqual(req.body, {message: 'golden pears'});
  });

  it('should forward POST /api/docs/:did/attachments', async function() {
    const formData = new FormData();
    formData.append('upload', 'abcdef', "hello.png");
    resp = await axios.post(`${homeUrl}/api/docs/sampledocid_16/attachments`, formData,
      defaultsDeep({headers: formData.getHeaders()}, chimpy));
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(resp.data, 'mango tree');
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get('Authorization'), 'Bearer api_key_for_chimpy');
    assert.match(req.get('Content-Type'), /^multipart\/form-data; boundary=/);
    assert.equal(req.originalUrl, '/dw/foo/api/docs/sampledocid_16/attachments');
    assert.equal(req.method, 'POST');
  });

  it('should forward GET /api/docs/:did/attachments/:attId/download', async function() {
    docWorkerStub.callsFake((_req: any, res: any) =>
      res.status(200)
        .type('.png')
        .set('Content-Disposition', 'attachment; filename="hello.png"')
        .set('Cache-Control', 'private, max-age=3600')
        .send(Buffer.from('abcdef')));
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/attachments/123/download`, chimpy);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.headers['content-type'], 'image/png');
    assert.deepEqual(resp.headers['content-disposition'], 'attachment; filename="hello.png"');
    assert.deepEqual(resp.headers['cache-control'], 'private, max-age=3600');
    assert.deepEqual(resp.data, 'abcdef');
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get('Authorization'), 'Bearer api_key_for_chimpy');
    assert.equal(req.get('Content-Type'), 'application/json');
    assert.equal(req.originalUrl, '/dw/foo/api/docs/sampledocid_16/attachments/123/download');
    assert.equal(req.method, 'GET');
  });

  it('should forward error message on failure', async function() {
    docWorkerStub.callsFake((_req: any, res: any) => res.status(500).send({error: 'internal error'}));
    resp = await axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`, chimpy);
    assert.equal(resp.status, 500);
    assert.deepEqual(resp.data, {error: 'internal error'});
    assert(docWorkerStub.calledOnce);
    const req = docWorkerStub.getCall(0).args[0];
    assert.equal(req.get('Authorization'), 'Bearer api_key_for_chimpy');
    assert.equal(req.get('Content-Type'), 'application/json');
    assert.equal(req.originalUrl, '/dw/foo/api/docs/sampledocid_16/tables/table1/data');
    assert.equal(req.method, 'GET');
  });

  it('should notice aborted requests and cancel forwarded ones', async function() {
    let requestReceived: Function;
    let closeReceived: Function;
    let requestDone: Function;
    const checkIsClosed = sinon.spy();
    const promiseForRequestReceived = new Promise(r => { requestReceived = r; });
    const promiseForCloseReceived = new Promise(r => { closeReceived = r; });
    const promiseForRequestDone = new Promise(r => { requestDone = r; });
    docWorkerStub.callsFake(async (req: any, res: any) => {
      req.on('close', closeReceived);
      requestReceived();
      await Promise.race([promiseForCloseReceived, delay(100)]);
      checkIsClosed(req.closed || req.aborted);
      res.status(200).json('fig tree?');
      requestDone();
    });
    const CancelToken = axios.CancelToken;
    const source = CancelToken.source();
    const response = axios.get(`${homeUrl}/api/docs/sampledocid_16/tables/table1/data`,
      {...chimpy, cancelToken: source.token});
    await promiseForRequestReceived;
    source.cancel('cancelled for testing');
    await assert.isRejected(response, /cancelled for testing/);
    await promiseForRequestDone;
    sinon.assert.calledOnce(checkIsClosed);
    assert.deepEqual(checkIsClosed.args, [[true]]);
  });
});
