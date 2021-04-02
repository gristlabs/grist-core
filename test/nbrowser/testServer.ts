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
import * as log from 'app/server/lib/log';
import {getAppRoot} from 'app/server/lib/places';
import {makeGristConfig} from 'app/server/lib/sendAppPage';
import {exitPromise} from 'app/server/lib/serverUtils';
import {connectTestingHooks, TestingHooksClient} from 'app/server/lib/TestingHooks';
import {ChildProcess, execFileSync, spawn} from 'child_process';
import * as fse from 'fs-extra';
import {driver, IMochaServer, WebDriver} from 'mocha-webdriver';
import fetch from 'node-fetch';
import {tmpdir} from 'os';
import * as path from 'path';
import {HomeUtil} from 'test/nbrowser/homeUtil';

export class TestServerMerged implements IMochaServer {
  public testDir: string;
  public testDocDir: string;
  public testingHooks: TestingHooksClient;

  // These have been moved to HomeUtil, and get set here when HomeUtil is created.
  public simulateLogin: HomeUtil["simulateLogin"];
  public removeLogin: HomeUtil["removeLogin"];

  private _serverUrl: string;
  private _server: ChildProcess;
  private _exitPromise: Promise<number|string>;
  private _starts: number = 0;
  private _dbManager: HomeDBManager;
  private _driver: WebDriver;

  // The name is used to name the directory for server logs and data.
  constructor(private _name: string) {}

  public async start() {
    await this.restart(true);
  }

  /**
   * Restart the server.  If reset is set, the database is cleared.  If reset is not set,
   * the database is preserved, and the temporary directory is unchanged.
   */
  public async restart(reset: boolean = false) {
    if (this.isExternalServer()) { return; }
    if (this._starts > 0) {
      await this.resume();
      await this.stop();
    }
    this._starts++;
    if (reset) {
      if (process.env.TESTDIR) {
        this.testDir = process.env.TESTDIR;
      } else {
        // Create a testDir of the form grist_test_{USER}_{SERVER_NAME}, removing any previous one.
        const username = process.env.USER || "nobody";
        this.testDir = path.join(tmpdir(), `grist_test_${username}_${this._name}`);
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

    const stubCmd = '_build/stubs/app/server/server';
    const isCore = await fse.pathExists(stubCmd + '.js');
    const cmd = isCore ? stubCmd : '_build/core/app/server/devServerMain';

    // The reason we fork a process rather than start a server within the same process is mainly
    // logging. Server code uses a global logger, so it's hard to separate out (especially so if
    // we ever run different servers for different tests).
    const serverLog = process.env.VERBOSE ? 'inherit' : nodeLogFd;
    const env = {
      TYPEORM_DATABASE: this._getDatabaseFile(),
      TEST_CLEAN_DATABASE: reset ? 'true' : '',
      GRIST_DATA_DIR: this.testDocDir,
      GRIST_INST_DIR: this.testDir,
      // uses the test installed plugins folder as the user installed plugins.
      GRIST_USER_ROOT: path.resolve(getAppRoot(), 'test/fixtures/plugins/browserInstalledPlugins/'),
      GRIST_TESTING_SOCKET: testingSocket,
      // Set low limits for uploads, for testing.
      GRIST_MAX_UPLOAD_IMPORT_MB: '1',
      GRIST_MAX_UPLOAD_ATTACHMENT_MB: '2',
      // Run with HOME_PORT, STATIC_PORT, DOC_PORT, DOC_WORKER_COUNT in the environment to override.
      ...(isCore ? {
        HOME_PORT: '8095',
        STATIC_PORT: '8095',
        DOC_PORT: '8095',
        DOC_WORKER_COUNT: '1',
        PORT: '8095',
      } : {
        HOME_PORT: '8095',
        STATIC_PORT: '8096',
        DOC_PORT: '8100',
        DOC_WORKER_COUNT: '5',
        PORT: '0',
      }),
      // This skips type-checking when running server, but reduces startup time a lot.
      TS_NODE_TRANSPILE_ONLY: 'true',
      ...process.env,
    };
    if (!process.env.REDIS_URL) {
      // Multiple doc workers only possible when redis is available.
      log.warn('Running without redis and without multiple doc workers');
      delete env.DOC_WORKER_COUNT;
    }
    this._server = spawn('node', [cmd], {
      env,
      stdio: ['inherit', serverLog, serverLog],
    });
    this._exitPromise = exitPromise(this._server);

    const port = parseInt(env.HOME_PORT, 10);
    this._serverUrl = `http://localhost:${port}`;
    log.info(`Waiting for node server to respond at ${this._serverUrl}`);

    // Try to be more helpful when server exits by printing out the tail of its log.
    this._exitPromise.then((code) => {
        if (this._server.killed) { return; }
        log.error("Server died unexpectedly, with code", code);
        const output = execFileSync('tail', ['-30', nodeLogPath]);
        log.info(`\n===== BEGIN SERVER OUTPUT ====\n${output}\n===== END SERVER OUTPUT =====`);
      })
      .catch(() => undefined);

    await this.waitServerReady(60000);

    // Prepare testingHooks for certain behind-the-scenes interactions with the server.
    this.testingHooks = await connectTestingHooks(testingSocket);
  }

  public async stop() {
    if (this.isExternalServer()) { return; }
    log.info("Stopping node server");
    this._server.kill();
    if (this.testingHooks) {
      this.testingHooks.close();
    }
    await this._exitPromise;
  }

  /**
   * Set server on pause and call `callback()`. Callback must returned a promise and server will
   * resume normal activity when that promise resolves. This is useful to test behavior when a
   * request takes a long time.
   */
  public async pauseUntil(callback: () => Promise<void>) {
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
    return this._serverUrl;
  }

  public getUrl(team: string, relPath: string) {
    if (!this.isExternalServer()) {
      return `${this.getHost()}/o/${team}${relPath}`;
    }
    const state: IGristUrlState = { org: team };
    const baseDomain = parseSubdomain(new URL(this.getHost()).hostname).base;
    const gristConfig = makeGristConfig(this.getHost(), {}, baseDomain);
    const url = encodeUrl(gristConfig, state, new URL(this.getHost())).replace(/\/$/, "");
    return `${url}${relPath}`;
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
      const origTypeormDB = process.env.TYPEORM_DATABASE;
      process.env.TYPEORM_DATABASE = this._getDatabaseFile();
      this._dbManager = new HomeDBManager();
      await this._dbManager.connect();
      await this._dbManager.initializeSpecialIds();
      if (origTypeormDB) {
        process.env.TYPEORM_DATABASE = origTypeormDB;
      }
    }
    return this._dbManager;
  }

  public get driver() {
    return this._driver || driver;
  }

  // substitute a custom driver
  public setDriver(customDriver: WebDriver = driver) {
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
    return path.join(this.testDir, 'landing.db');
  }
}

export const server = new TestServerMerged("merged");
