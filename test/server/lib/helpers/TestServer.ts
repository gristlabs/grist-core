import {connectTestingHooks, TestingHooksClient} from "app/server/lib/TestingHooks";
import {ChildProcess, execFileSync, spawn} from "child_process";
import * as http from "http";
import FormData from 'form-data';
import path from "path";
import * as fse from "fs-extra";
import * as testUtils from "test/server/testUtils";
import {UserAPIImpl} from "app/common/UserAPI";
import {exitPromise} from "app/server/lib/serverUtils";
import log from "app/server/lib/log";
import {delay} from "bluebird";
import fetch from "node-fetch";
import {Writable} from "stream";
import express from "express";
import { AddressInfo } from "net";

/**
 * This starts a server in a separate process.
 */
export class TestServer {
  public static async startServer(
    serverTypes: string,
    tempDirectory: string,
    suitename: string,
    customEnv?: NodeJS.ProcessEnv,
    _homeUrl?: string,
    options: {output?: Writable} = {},      // Pipe server output to the given stream
  ): Promise<TestServer> {

    const server = new this(serverTypes, tempDirectory, suitename);
    await server.start(_homeUrl, customEnv, options);
    return server;
  }

  public testingSocket: string;
  public testingHooks: TestingHooksClient;
  public stopped = false;
  public get serverUrl() {
    if (this._proxiedServer) {
      throw new Error('Direct access to this test server is disallowed');
    }
    return this._serverUrl;
  }
  public get proxiedServer() { return this._proxiedServer; }

  private _server: ChildProcess;
  private _exitPromise: Promise<number | string>;
  private _serverUrl: string;
  private _proxiedServer: boolean = false;

  private readonly _defaultEnv;

  constructor(private _serverTypes: string, public readonly rootDir: string, private _suiteName: string) {
    this._defaultEnv = {
      GRIST_INST_DIR: this.rootDir,
      GRIST_DATA_DIR: path.join(this.rootDir, "data"),
      GRIST_SERVERS: this._serverTypes,
      // with port '0' no need to hard code a port number (we can use testing hooks to find out what
      // port server is listening on).
      GRIST_PORT: '0',
      GRIST_DISABLE_S3: 'true',
      REDIS_URL: process.env.TEST_REDIS_URL,
      GRIST_TRIGGER_WAIT_DELAY: '100',
      // this is calculated value, some tests expect 4 attempts and some will try 3 times
      GRIST_TRIGGER_MAX_ATTEMPTS: '4',
      GRIST_MAX_QUEUE_SIZE: '10',
      ...process.env
    };
  }
  public async start(_homeUrl?: string, customEnv?: NodeJS.ProcessEnv, options: {output?: Writable} = {}) {
    // put node logs into files with meaningful name that relate to the suite name and server type
    const fixedName = this._serverTypes.replace(/,/, '_');
    const nodeLogPath = path.join(this.rootDir, `${this._suiteName}-${fixedName}-node.log`);
    const nodeLogFd = await fse.open(nodeLogPath, 'a');
    const serverLog = options.output ? 'pipe' : (process.env.VERBOSE ? 'inherit' : nodeLogFd);
    // use a path for socket that relates to suite name and server types
    this.testingSocket = path.join(this.rootDir, `${this._suiteName}-${fixedName}.socket`);
    if (this.testingSocket.length >= 108) {
      // Unix socket paths typically can't be longer than this. Who knew. Make the error obvious.
      throw new Error(`Path of testingSocket too long: ${this.testingSocket.length} (${this.testingSocket})`);
    }
    const env = {
      APP_HOME_URL: _homeUrl,
      APP_HOME_INTERNAL_URL: _homeUrl,
      GRIST_TESTING_SOCKET: this.testingSocket,
      ...this._defaultEnv,
      ...customEnv
    };
    const main = await testUtils.getBuildFile('app/server/mergedServerMain.js');
    this._server = spawn('node', [main, '--testingHooks'], {
      env,
      stdio: ['inherit', serverLog, serverLog]
    });
    if (options.output) {
      this._server.stdout!.pipe(options.output);
      this._server.stderr!.pipe(options.output);
    }

    this._exitPromise = exitPromise(this._server);

    // Try to be more helpful when server exits by printing out the tail of its log.
    this._exitPromise.then((code) => {
      if (this._server.killed) {
        return;
      }
      log.error("Server died unexpectedly, with code", code);
      const output = execFileSync('tail', ['-30', nodeLogPath]);
      log.info(`\n===== BEGIN SERVER OUTPUT ====\n${output}\n===== END SERVER OUTPUT =====`);
    })
      .catch(() => undefined);

    await this._waitServerReady();
    log.info(`server ${this._serverTypes} up and listening on ${this._serverUrl}`);
  }

  public async stop() {
    if (this.stopped) {
      return;
    }
    log.info("Stopping node server: " + this._serverTypes);
    this.stopped = true;
    this._server.kill();
    this.testingHooks.close();
    await this._exitPromise;
  }

  public async isServerReady(): Promise<boolean> {
    // Let's wait for the testingSocket to be created, then get the port the server is listening on,
    // and then do an api check. This approach allow us to start server with GRIST_PORT set to '0',
    // which will listen on first available port, removing the need to hard code a port number.
    try {

      // wait for testing socket
      while (!(await fse.pathExists(this.testingSocket))) {
        await delay(200);
      }

      // create testing hooks and get own port
      this.testingHooks = await connectTestingHooks(this.testingSocket);
      const port: number = await this.testingHooks.getOwnPort();
      this._serverUrl = `http://localhost:${port}`;

      // wait for check
      return (await fetch(`${this._serverUrl}/status/hooks`, {timeout: 1000})).ok;
    } catch (err) {
      log.warn("Failed to initialize server", err);
      return false;
    }
  }

  // Get access to the ChildProcess object for this server, e.g. to get its PID.
  public getChildProcess(): ChildProcess { return this._server; }

  // Returns the promise for the ChildProcess's signal or exit code.
  public getExitPromise(): Promise<string|number> { return this._exitPromise; }

  public makeUserApi(
    org: string,
    user: string = 'chimpy',
    {
      headers = {Authorization: `Bearer api_key_for_${user}`},
      serverUrl = this._serverUrl,
    }: {
      headers?: Record<string, string>
      serverUrl?: string,
    } = { headers: undefined, serverUrl: undefined },
  ): UserAPIImpl {
    return new UserAPIImpl(`${serverUrl}/o/${org}`, {
      headers,
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });
  }

  public disallowDirectAccess() {
    this._proxiedServer = true;
  }

  private async _waitServerReady() {
    // It's important to clear the timeout, because it can prevent node from exiting otherwise,
    // which is annoying when running only this test for debugging.
    let timeout: any;
    const maxDelay = new Promise((resolve) => {
      timeout = setTimeout(resolve, 30000);
    });
    try {
      await Promise.race([
        this.isServerReady(),
        this._exitPromise.then(() => {
          throw new Error("Server exited while waiting for it");
        }),
        maxDelay,
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class TestServerReverseProxy {

  // Use a different hostname for the proxy than the doc and home workers'
  // so we can ensure that either we omit the Origin header (so the internal calls to home and doc workers
  // are not considered as CORS requests), or otherwise we fail because the hostnames are different
  // https://github.com/gristlabs/grist-core/blob/24b39c651b9590cc360cc91b587d3e1b301a9c63/app/server/lib/requestUtils.ts#L85-L98
  public static readonly HOSTNAME: string = 'grist-test-proxy.127.0.0.1.nip.io';

  private _app = express();
  private _server: http.Server;
  private _address: Promise<AddressInfo>;

  public get stopped() { return !this._server.listening; }

  public constructor() {
    this._address = new Promise(resolve => {
      this._server = this._app.listen(0, () => {
        resolve(this._server.address() as AddressInfo);
      });
    });
  }

  public async start(homeServer: TestServer, docServer: TestServer) {
    this._app.all(['/dw/dw1', '/dw/dw1/*'], (oreq, ores) => this._getRequestHandlerFor(docServer));
    this._app.all('/*', this._getRequestHandlerFor(homeServer));
    // Forbid now the use of serverUrl property
    homeServer.disallowDirectAccess();
    docServer.disallowDirectAccess();
    log.info('proxy server running on ', await this.getServerUrl());
  }

  public async getAddress() {
    return this._address;
  }

  public async getServerUrl() {
    const address = await this.getAddress();
    return `http://${TestServerReverseProxy.HOSTNAME}:${address.port}`;
  }

  public stop() {
    if (this.stopped) {
      return;
    }
    log.info("Stopping node TestServerProxy");
    this._server.close();
  }

  private _getRequestHandlerFor(server: TestServer) {
    const serverUrl = new URL(server.serverUrl);

    return (oreq: express.Request, ores: express.Response) => {
      const options = {
        host: serverUrl.hostname,
        port: serverUrl.port,
        path: oreq.url,
        method: oreq.method,
        headers: oreq.headers,
      };

      log.debug(`[proxy] Requesting (method=${oreq.method}): ${new URL(oreq.url, serverUrl).href}`);

      const creq = http
      .request(options, pres => {
        log.debug('[proxy] Received response for ' + oreq.url);

        // set encoding, required?
        pres.setEncoding('utf8');

        // set http status code based on proxied response
        ores.writeHead(pres.statusCode ?? 200, pres.statusMessage, pres.headers);

        // wait for data
        pres.on('data', chunk => {
          ores.write(chunk);
        });

        pres.on('close', () => {
          // closed, let's end client request as well
          ores.end();
        });

        pres.on('end', () => {
          // finished, let's finish client request as well
          ores.end();
        });
      })
      .on('error', e => {
        // we got an error
        console.log(e.message);
        try {
          // attempt to set error message and http status
          ores.writeHead(500);
          ores.write(e.message);
        } catch (e) {
          // ignore
        }
        ores.end();
      });

      oreq.pipe(creq).on('end', () => creq.end());
    };
  }
}
