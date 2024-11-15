import {Hosts} from 'app/server/lib/extractOrg';
import {listenPromise} from 'app/server/lib/serverUtils';
import {assert} from 'chai';
import express from 'express';
import * as http from 'http';
import {pick} from 'lodash';
import {AddressInfo} from 'net';
import fetch from 'node-fetch';

describe("extractOrg", function() {

  let port: number;
  let server: http.Server;

  const agent = new http.Agent();
  const createConnection = (agent as any).createConnection;
  (agent as any).createConnection = (options: any, cb: any) =>
    createConnection.call(this, {...options, host: 'localhost', port}, cb);
  const baseDomain = '.getgrist.com';
  const hosts = new Hosts(baseDomain, {
    isMergedOrg(org: string) { return false; },
    connection: {
      manager: {
        async findOne(table: any, options: {where: {domain?: string, host?: string}}) {
          if (options.where.host === 'zoom.quick.com') { return {domain: 'zoomy'}; }
          if (options.where.domain === 'zoomy') { return {host: 'zoom.quick.com'}; }
          return undefined;
        }
      }
    }
  } as any, {
    getPluginUrl() { return 'https://prod.grist-usercontent.com'; }
  } as any);

  before(async () => {
    // Create a dummy express app with extractOrg middleware, and an endpoint which reports
    // various parts of the request.
    const app = express();
    server = http.createServer(app);
    await listenPromise(server.listen(0, 'localhost'));
    app.use(hosts.extractOrg);
    app.use(hosts.redirectHost);
    app.use((req, res) => {
      res.json(pick(req, ['hostname', 'path', 'url', 'org', 'isCustomHost']));
    });
    port = (server.address() as AddressInfo).port;
  });

  after(() => {
    server.close();
    hosts.close();
  });

  // Fetches the URL from our dummy server regardless of the hostname, and returns a parsed JSON
  // response which includes an extra 'STATUS' key with the status.
  async function myFetch(url: string): Promise<any> {
    const resp = await fetch(url, {agent});
    try {
      const values = await resp.json();
      if (!values.isCustomHost) { delete values.isCustomHost; }
      return {...values, STATUS: resp.status};
    } catch (e) {
      return {STATUS: resp.status};
    }
  }

  it("should set org to the subdomain from the Host header", async function() {
    assert.deepEqual(await myFetch('http://foo.getgrist.com'),
      { STATUS: 200, hostname: 'foo.getgrist.com', path: '/', url: '/', org: 'foo' });
    assert.deepEqual(await myFetch('http://foo.getgrist.com/hello?world=1&123%20'),
      { STATUS: 200, hostname: 'foo.getgrist.com', path: '/hello', url: '/hello?world=1&123%20', org: 'foo' });
    assert.deepEqual(await myFetch('http://foo-BAR-123.getgrist.com'),
      { STATUS: 200, hostname: 'foo-bar-123.getgrist.com', path: '/', url: '/', org: 'foo-bar-123' });
    assert.deepEqual(await myFetch('http://foo.getgrist.com:9000'),
      { STATUS: 200, hostname: 'foo.getgrist.com', path: '/', url: '/', org: 'foo' });
    assert.deepEqual(await myFetch('http://x.y.z.getgrist.com'),
      { STATUS: 200, hostname: 'x.y.z.getgrist.com', path: '/', url: '/', org: 'x' });
    assert.deepEqual(await myFetch('http://localhost:9000'),
      { STATUS: 200, hostname: 'localhost', path: '/', url: '/', org: '' });
    assert.deepEqual(await myFetch('http://foo.getgrist.com/o/'),
      { STATUS: 200, hostname: 'foo.getgrist.com', path: '/o/', url: '/o/', org: 'foo' });
  });

  it("should set org to the /o/ORG value when it matches subdomain", async function() {
    assert.deepEqual(await myFetch('http://foo.getgrist.com/o/foo'),
      { STATUS: 200, hostname: 'foo.getgrist.com', path: '/', url: '/', org: 'foo' });
    assert.deepEqual(await myFetch('http://foo.getgrist.com/o/foo/'),
      { STATUS: 200, hostname: 'foo.getgrist.com', path: '/', url: '/', org: 'foo' });
    assert.deepEqual(await myFetch('http://foo.getgrist.com/o/foo/hello?world&123%20'),
      { STATUS: 200, hostname: 'foo.getgrist.com', path: '/hello', url: '/hello?world&123%20', org: 'foo' });
    assert.deepEqual(await myFetch('http://foo-BAR-123.getgrist.com/o/foo-bAr-123/doc/123'),
      { STATUS: 200, hostname: 'foo-bar-123.getgrist.com', path: '/doc/123', url: '/doc/123', org: 'foo-bar-123' });
    assert.deepEqual(await myFetch('http://foo.getgrist.com/o/bar'),
      { STATUS: 400, error: "Wrong org for this domain: 'bar' does not match 'foo'"});
  });

  it("should set org to the /o/ORG value when no subdomain in request", async function() {
    assert.deepEqual(await myFetch('http://localhost:8000/o/foo'),
      { STATUS: 200, hostname: 'localhost', path: '/', url: '/', org: 'foo' });
    assert.deepEqual(await myFetch('http://localhost:8000/o/foo/'),
      { STATUS: 200, hostname: 'localhost', path: '/', url: '/', org: 'foo' });
    assert.deepEqual(await myFetch('http://localhost:8000/o/foo/hello?world&123%20'),
      { STATUS: 200, hostname: 'localhost', path: '/hello', url: '/hello?world&123%20', org: 'foo' });
    assert.deepEqual(await myFetch('http://localhost:8000/o/bar'),
      { STATUS: 200, hostname: 'localhost', path: '/', url: '/', org: 'bar' });
    assert.deepEqual(await myFetch('http://localhost:8000/o/'),
      { STATUS: 200, hostname: 'localhost', path: '/o/', url: '/o/', org: '' });

    assert.deepEqual(await myFetch('http://x.y.z.getgrist.com/o/bar'),
      { STATUS: 400, error: "Wrong org for this domain: 'bar' does not match 'x'"});

    // Certain subdomains are not treated as significant, and org can be read from path
    assert.deepEqual(await myFetch('http://api.getgrist.com/o/bar'),
      { STATUS: 200, hostname: 'api.getgrist.com', path: '/', url: '/', org: 'bar' });
    assert.deepEqual(await myFetch('http://v1-staging.getgrist.com/o/bar/test'),
      { STATUS: 200, hostname: 'v1-staging.getgrist.com', path: '/test', url: '/test', org: 'bar' });
  });

  it("should produce URL that starts with slash", async function() {
    // Trailing slash shouldn't matter to the result.
    assert.deepEqual(await myFetch('http://api.getgrist.com/o/bar'),
      { STATUS: 200, hostname: 'api.getgrist.com', path: '/', url: '/', org: 'bar' });
    assert.deepEqual(await myFetch('http://api.getgrist.com/o/bar/'),
      { STATUS: 200, hostname: 'api.getgrist.com', path: '/', url: '/', org: 'bar' });
    assert.deepEqual(await myFetch('http://bar.getgrist.com'),
      { STATUS: 200, hostname: 'bar.getgrist.com', path: '/', url: '/', org: 'bar' });
    assert.deepEqual(await myFetch('http://bar.getgrist.com/'),
      { STATUS: 200, hostname: 'bar.getgrist.com', path: '/', url: '/', org: 'bar' });

    // Trailing slash shouldn't matter when followed by "?"
    assert.deepEqual(await myFetch('http://api.getgrist.com/o/bar?asdf'),
      { STATUS: 200, hostname: 'api.getgrist.com', path: '/', url: '/?asdf', org: 'bar' });
    assert.deepEqual(await myFetch('http://api.getgrist.com/o/bar/?asdf'),
      { STATUS: 200, hostname: 'api.getgrist.com', path: '/', url: '/?asdf', org: 'bar' });
    assert.deepEqual(await myFetch('http://api.getgrist.com/o/bar/baz?asdf'),
      { STATUS: 200, hostname: 'api.getgrist.com', path: '/baz', url: '/baz?asdf', org: 'bar' });
    assert.deepEqual(await myFetch('http://bar.getgrist.com?asdf'),
      { STATUS: 200, hostname: 'bar.getgrist.com', path: '/', url: '/?asdf', org: 'bar' });
    assert.deepEqual(await myFetch('http://bar.getgrist.com/?asdf'),
      { STATUS: 200, hostname: 'bar.getgrist.com', path: '/', url: '/?asdf', org: 'bar' });
  });

  it("should return 404 for unrecognized domains", async function() {
    assert.deepEqual(await myFetch('http://getgrist.com/'),
      { STATUS: 404, error: 'Domain not recognized: getgrist.com'});
    assert.deepEqual(await myFetch('http://example.com'),
      { STATUS: 404, error: 'Domain not recognized: example.com'});
    assert.deepEqual(await myFetch('http://1.2.3.4/'),
      { STATUS: 404, error: 'Domain not recognized: 1.2.3.4'});
  });

  it("should recognize custom domains", async function() {
    assert.deepEqual(await myFetch('http://zoom.quick.com/d'),
      { STATUS: 200, hostname: 'zoom.quick.com', path: '/d', url: '/d',
        org: 'zoomy', isCustomHost: true });
    assert.deepEqual(await myFetch('http://zoom.quick.com/o/zoomy/d'),
      { STATUS: 200, hostname: 'zoom.quick.com', path: '/d', url: '/d',
        org: 'zoomy', isCustomHost: true });
    assert.deepEqual(await myFetch('http://zoom.quick.com/o/zoom/d'),
      { STATUS: 400, error: "Wrong org for this domain: 'zoom' does not match 'zoomy'"});
  });

  it("should recognize plugin domains", async function() {
    assert.deepEqual(await myFetch('http://prod.grist-usercontent.com/d'),
      { STATUS: 200, hostname: 'prod.grist-usercontent.com', path: '/d', url: '/d',
        org: '' });
    assert.deepEqual(await myFetch('http://prod2.grist-usercontent.com/d'),
      { STATUS: 404, error: 'Domain not recognized: prod2.grist-usercontent.com'});
    assert.deepEqual(await myFetch('http://getgrist.localtest.me/d'),
      { STATUS: 404, error: 'Domain not recognized: getgrist.localtest.me'});
  });

  it("should redirect to custom domains", async function() {
    assert.deepEqual(await myFetch('http://zoomy.getgrist.com/d'),
      { STATUS: 200, hostname: 'zoom.quick.com', path: '/d', url: '/d',
        org: 'zoomy', isCustomHost: true });
  });
});
