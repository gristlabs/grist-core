/**
 * webpack-test-server makes possible browser tests against static fixture pages that are set up
 * to be served using webpack-dev-server with test/fixtures/projects/webpack.config.json.
 *
 * Use in a mocha test like so:
 *
 *    import {driver, useServer} from 'mocha-webdriver';
 *    import {server} from 'test/fixtures/projects/webpack-test-server';
 *    describe(..., () => {
 *      useServer(server);
 *      ...
 *      it(..., () => {
 *        await driver.get(`${server.getHost()}/MyPage`);
 *      })
 *    });
 *
 * It will start up webpack-dev-server before this suite is run, so that MyPage is available to
 * fetch using webdriver.
 */
import {exitPromise} from 'app/server/lib/serverUtils';
import {ChildProcess, spawn} from 'child_process';
import {driver, IMochaContext, IMochaServer} from 'mocha-webdriver';
import fetch from 'node-fetch';
import * as path from 'path';

const configPath = path.resolve(__dirname, 'webpack.config.js');

export class WebpackServer implements IMochaServer {
  // Fork a WebpackDevServer. See https://github.com/webpack/docs/wiki/webpack-dev-server
  //
  // It's possible to start WebpackDevServer within this same Node process, but we intentionally
  // fork a separate one to ensure that modifications to low-level modules that might be done by
  // test dependencies (e.g. cleverness for monitoring promises, or filesystem), do not affect
  // webpack. When in the same process, it seems such things happen and cause major slowdown.

  private _serverUrl: string;
  private _server: ChildProcess;
  private _exitPromise: Promise<number|string>;
  private _webpackComplete: Promise<boolean>;

  public async start(context: IMochaContext) {
    context.timeout(60000);
    logMessage("starting");

    this._server = spawn('node',
      ['node_modules/.bin/webpack-dev-server', '--config', configPath, '--no-open'], {
        stdio: ['inherit', 'pipe', 'inherit'],
      });
    this._exitPromise = exitPromise(this._server);

    // Wait for a build status to show up on stdout, to know when webpack is finished.
    this._webpackComplete = new Promise((resolve, reject) => {
      this._server.stdout!.on('data', (data) => {
        // Note that data might not in general arrive at line boundaries, but in this case, it works.
        const text = data.toString('utf8');
        if (/compiled with.*errors/i.test(text)) { reject(new Error('Webpack failed')); }
        if (/compiled successfully/i.test(text)) { resolve(true); }
      });
    });

    const config = require(configPath);
    const port = config.devServer.port;
    this._serverUrl = `http://localhost:${port}`;

    this._exitPromise
      .then(() => (this._server.killed || logMessage("webpack-dev-server died unexpectedly")))
      .catch(() => undefined);
    await this.waitServerReady(15000);
    logMessage("webpack finished compiling");
  }

  /**
   * Returns whether the server is up and responsive.
   */
  public async isServerReady(): Promise<boolean> {
    try {
      return (await fetch(this._serverUrl, {timeout: 1000})).ok;
    } catch (err) {
      return false;
    }
  }

  /**
   * Wait for the server to be up and responsitve, for up to `ms` milliseconds.
   */
  public async waitServerReady(ms: number): Promise<void> {
    await driver.wait(() => Promise.race([
      this._webpackComplete,
      this._exitPromise.then((code) => {
        throw new Error(`WebpackDevServer exited while waiting for it (exit status ${code})`);
      }),
    ]), ms);
  }

  public async stop() {
    logMessage("stopping");
    this._server.kill();
    await this._exitPromise;
  }

  public getHost(): string {
    return this._serverUrl;
  }
}

function logMessage(msg: string) {
  console.error("[webpack-test-server] " + msg);   // tslint:disable-line:no-console
}

export const server = new WebpackServer();
