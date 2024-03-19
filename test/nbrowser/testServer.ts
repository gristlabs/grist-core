/**
 * NOTE: this server is also exposed via test/nbrowser/testUtils; it's only moved into its own
 * file to untangle dependencies between gristUtils and testUtils.
 *
 * Exports `server` to be used with mocha-webdriver's useServer(). This is normally set up using
 * `setupTestSuite` from test/nbrowser/testUtils.
 *
 * Includes server.testingHooks and some useful methods that rely on them.
 *
 * Run with VERBOSE=1 in the environment to see the server log on the console. Normally it goes
 * into a file whose path is printed when server starts.
 */
import {encodeUrl, IGristUrlState, parseSubdomain} from 'app/common/gristUrls';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import log from 'app/server/lib/log';
import {getAppRoot} from 'app/server/lib/places';
import {makeGristConfig} from 'app/server/lib/sendAppPage';
import {exitPromise} from 'app/server/lib/serverUtils';
import {connectTestingHooks, TestingHooksClient} from 'app/server/lib/TestingHooks';
import {ChildProcess, execFileSync, spawn} from 'child_process';
import EventEmitter from 'events';
import * as fse from 'fs-extra';
import {driver, IMochaServer, WebDriver} from 'mocha-webdriver';
import fetch from 'node-fetch';
import {tmpdir} from 'os';
import * as path from 'path';
import {removeConnection} from 'test/gen-server/seed';
import {HomeUtil} from 'test/nbrowser/homeUtil';
import {getDatabase} from 'test/testUtils';

export class TestServerMerged extends EventEmitter implements IMochaServer {
  public testDir: string;
  public testDocDir: string;
  public testingHooks: TestingHooksClient;

  // These have been moved to HomeUtil, and get set here when HomeUtil is created.
  public simulateLogin: HomeUtil["simulateLogin"];
  public removeLogin: HomeUtil["removeLogin"];

  private _serverUrl: string;
  private _proxyUrl: string|null = null;
  private _server: ChildProcess;
  private _exitPromise: Promise<number|string>;
  private _starts: number = 0;
  private _dbManager?: HomeDBManager;
  private _driver?: WebDriver;

  // The name is used to name the directory for server logs and data.
  constructor(private _name: string) {
    super();
  }

  public async start() {
    await this.restart(true);
  }

  /**
   * Restart the server.  If reset is set, the database is cleared.  If reset is not set,
   * the database is preserved, and the temporary directory is unchanged.
   */
  public async restart(reset: boolean = false, quiet = false) {
    if (this.isExternalServer()) { return; }
    if (this._starts > 0) {
      this.resume();
      await this.stop();
    }
    this._starts++;
    const workerIdText = process.env.MOCHA_WORKER_ID || '0';
    if (reset) {
      if (process.env.TESTDIR) {
        this.testDir = path.join(process.env.TESTDIR, workerIdText);
      } else {
        // Create a testDir of the form grist_test_{USER}_{SERVER_NAME}_{WORKER_ID}, removing any previous one.
        const username = process.env.USER || "nobody";
        this.testDir = path.join(tmpdir(), `grist_test_${username}_${this._name}_${workerIdText}`);
        await fse.remove(this.testDir);
      }
    }
    this.testDocDir = path.join(this.testDir, "data");
    await fse.mkdirs(this.testDocDir);
    log.warn(`Test logs and data are at: ${this.testDir}/`);

    const nodeLogPath = path.join(this.testDir, 'node.log');
    const nodeLogFd = await fse.open(nodeLogPath, 'a');

    // The server isn't set up to close the testing socket cleanly and
    // immediately.  It is simplest to use a diffent socket each time
    // we restart.
    const testingSocket = path.join(this.testDir, `testing-${this._starts}.socket`);
    if (testingSocket.length >= 108) {
      // Unix socket paths typically can't be longer than this. Who knew. Make the error obvious.
      throw new Error(`Path of testingSocket too long: ${testingSocket.length} (${testingSocket})`);
    }

    const stubCmd = '_build/stubs/app/server/server';
    const isCore = await fse.pathExists(stubCmd + '.js');
    const cmd = isCore ? stubCmd : '_build/core/app/server/devServerMain';
    // If a proxy is set, use a single port - otherwise we'd need a lot of
    // proxies.
    const useSinglePort = this._proxyUrl !== null;

    // The reason we fork a process rather than start a server within the same process is mainly
    // logging. Server code uses a global logger, so it's hard to separate out (especially so if
    // we ever run different servers for different tests).
    const serverLog = process.env.VERBOSE ? 'inherit' : nodeLogFd;
    const workerId = parseInt(workerIdText, 10);
    const corePort = String(8295 + workerId * 2);
    const untrustedPort = String(8295 + workerId * 2 + 1);
    const env: Record<string, string> = {
      TYPEORM_DATABASE: this._getDatabaseFile(),
      GRIST_DATA_DIR: this.testDocDir,
      GRIST_INST_DIR: this.testDir,
      // uses the test installed plugins folder as the user installed plugins.
      GRIST_USER_ROOT: path.resolve(getAppRoot(), 'test/fixtures/plugins/browserInstalledPlugins/'),
      GRIST_TESTING_SOCKET: testingSocket,
      // Set low limits for uploads, for testing.
      GRIST_MAX_UPLOAD_IMPORT_MB: '1',
      GRIST_MAX_UPLOAD_ATTACHMENT_MB: '2',
      // The following line only matters for testing with non-localhost URLs, which some tests do.
      GRIST_SERVE_SAME_ORIGIN: 'true',
      // Run with HOME_PORT, STATIC_PORT, DOC_PORT, DOC_WORKER_COUNT in the environment to override.
      ...(useSinglePort ? {
        APP_HOME_URL: this.getHost(),
        GRIST_SINGLE_PORT: 'true',
      } : (isCore ? {
        HOME_PORT: corePort,
        STATIC_PORT: corePort,
        DOC_PORT: corePort,
        DOC_WORKER_COUNT: '1',
        PORT: corePort,
        APP_UNTRUSTED_URL: `http://localhost:${untrustedPort}`,
        GRIST_SERVE_PLUGINS_PORT: untrustedPort,
      } : {
        HOME_PORT: '8095',
        STATIC_PORT: '8096',
        DOC_PORT: '8100',
        DOC_WORKER_COUNT: '5',
        PORT: '0',
        APP_UNTRUSTED_URL : "http://localhost:18096",
      })),
      // This skips type-checking when running server, but reduces startup time a lot.
      TS_NODE_TRANSPILE_ONLY: 'true',
      ...process.env,
      TEST_CLEAN_DATABASE: reset ? 'true' : '',
    };
    if (!process.env.REDIS_URL) {
      // Multiple doc workers only possible when redis is available.
      log.warn('Running without redis and without multiple doc workers');
      delete env.DOC_WORKER_COUNT;
    }
    this._server = spawn('node', [cmd], {
      env: {
        ...env,
        ...(process.env.SERVER_NODE_OPTIONS ? {NODE_OPTIONS: process.env.SERVER_NODE_OPTIONS} : {})
      },
      stdio: quiet ? 'ignore' : ['inherit', serverLog, serverLog],
    });
    this._exitPromise = exitPromise(this._server);

    const port = parseInt(env.HOME_PORT, 10);
    this._serverUrl = `http://localhost:${port}`;
    log.info(`Waiting for node server to respond at ${this._serverUrl}`);

    // Try to be more helpful when server exits by printing out the tail of its log.
    this._exitPromise.then((code) => {
        if (this._server.killed || quiet) { return; }
        log.error("Server died unexpectedly, with code", code);
        const output = execFileSync('tail', ['-30', nodeLogPath]);
        log.info(`\n===== BEGIN SERVER OUTPUT ====\n${output}\n===== END SERVER OUTPUT =====`);
      })
      .catch(() => undefined);

    await this.waitServerReady(60000);

    // Prepare testingHooks for certain behind-the-scenes interactions with the server.
    this.testingHooks = await connectTestingHooks(testingSocket);
    this.emit('start');
  }

  public async stop() {
    if (this.isExternalServer()) { return; }
    log.info("Stopping node server");
    this._server.kill();
    if (this.testingHooks) {
      this.testingHooks.close();
    }
    await this._exitPromise;
    this.emit('stop');
  }

  /**
   * Set server on pause and call `callback()`. Callback must returned a promise and server will
   * resume normal activity when that promise resolves. This is useful to test behavior when a
   * request takes a long time.
   */
  public async pauseUntil(callback: () => Promise<void>) {
    if (this.isExternalServer()) {
      throw new Error("Can't pause external server");
    }
    log.info("Pausing node server");
    this._server.kill('SIGSTOP');
    try {
      await callback();
    } finally {
      log.info("Resuming node server");
      this.resume();
    }
  }

  public resume() {
    if (this.isExternalServer()) { return; }
    this._server.kill('SIGCONT');
  }

  public getHost(): string {
    if (this.isExternalServer()) { return process.env.HOME_URL!; }
    return this._proxyUrl || this._serverUrl;
  }

  public getUrl(team: string, relPath: string) {
    if (!this.isExternalServer()) {
      return `${this.getHost()}/o/${team}${relPath}`;
    }
    const state: IGristUrlState = { org: team };
    const baseDomain = parseSubdomain(new URL(this.getHost()).hostname).base;
    const gristConfig = makeGristConfig({
      homeUrl: this.getHost(),
      extra: {},
      baseDomain,
    });
    const url = encodeUrl(gristConfig, state, new URL(this.getHost())).replace(/\/$/, "");
    return `${url}${relPath}`;
  }

  // Configure the server to be accessed via a proxy. You'll need to
  // restart the server after changing this setting.
  public updateProxy(proxyUrl: string|null) {
    this._proxyUrl = proxyUrl;
  }

  /**
   * Returns whether the server is up and responsive.
   */
  public async isServerReady(): Promise<boolean> {
    try {
      return (await fetch(`${this._serverUrl}/status/hooks`, {timeout: 1000})).ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * Wait for the server to be up and responsitve, for up to `ms` milliseconds.
   */
  public async waitServerReady(ms: number): Promise<void> {
    await this.driver.wait(() => Promise.race([
      this.isServerReady(),
      this._exitPromise.then(() => { throw new Error("Server exited while waiting for it"); }),
    ]), ms);
  }

  /**
   * Returns a connection to the database.
   */
  public async getDatabase(): Promise<HomeDBManager> {
    if (!this._dbManager) {
      this._dbManager = await getDatabase(this._getDatabaseFile());
    }
    return this._dbManager;
  }

  public async closeDatabase() {
    this._dbManager = undefined;
    await removeConnection();
  }

  public get driver() {
    return this._driver || driver;
  }

  // substitute a custom driver
  public setDriver(customDriver?: WebDriver) {
    this._driver = customDriver;
  }

  public async getTestingHooks() {
    return this.testingHooks;
  }

  public isExternalServer() {
    return Boolean(process.env.HOME_URL);
  }

  /**
   * Returns the path to the database.
   */
  private _getDatabaseFile(): string {
    if (process.env.TYPEORM_TYPE === 'postgres') {
      const db = process.env.TYPEORM_DATABASE;
      if (!db) { throw new Error("Missing TYPEORM_DATABASE"); }
      return db;
    }
    return path.join(this.testDir, 'landing.db');
  }
}

export const server = new TestServerMerged("merged");
