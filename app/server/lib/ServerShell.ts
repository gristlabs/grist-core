/**
 * ServerShell: an outer shell that keeps the HTTP socket alive across
 * in-process restarts of the Grist server internals.
 *
 * The shell creates and owns the http.Server and the listening socket.
 * On each (re)start, it creates a new MergedServer that attaches to
 * the existing socket. The /status health-check endpoint is handled
 * directly by the shell so it stays reachable even while the inner
 * server is being torn down and rebuilt.
 *
 * When GRIST_CAN_RESTART is not set, falls back to a plain
 * MergedServer without the restart-capable shell.
 */

import { appSettings, canRestart } from "app/server/lib/AppSettings";
import { FlexServer, getGristHost, getServerFlags } from "app/server/lib/FlexServer";
import log from "app/server/lib/log";
import { listenPromise } from "app/server/lib/serverUtils";
import * as shutdown from "app/server/lib/shutdown";
import { MergedServer, ServerType } from "app/server/MergedServer";

import * as http from "http";

export const Deps = {
  testWaitBeforeReadyMs: 0,     // ms to wait before setting ready=true (for tests)
  restartTimeoutMs: 60000,      // mark unhealthy if restart takes longer than this
};

export interface ServerShellOptions {
  port: number;
  serverTypes: ServerType[];

  // Hook that runs before each MergedServer.create(), e.g. for DB setup.
  // Called on initial start and on every restart.
  beforeStart?: () => Promise<void>;

  // Hook that runs after MergedServer.run(), e.g. for testing hooks.
  afterStart?: (flexServer: FlexServer) => Promise<void>;
}

/**
 * Start a Grist server. When GRIST_CAN_RESTART is set, wraps it in
 * a shell that supports in-process restart. Otherwise does a plain
 * MergedServer start.
 */
export async function startServer(options: ServerShellOptions) {
  if (canRestart()) {
    const shell = new ServerShell(options);
    await shell.start();
    return shell;
  }
  return _startPlain(options);
}

async function _startPlain(options: ServerShellOptions) {
  const { port, serverTypes } = options;
  await options.beforeStart?.();
  const mergedServer = await MergedServer.create(port, serverTypes);
  await mergedServer.run();
  await options.afterStart?.(mergedServer.flexServer);
  return {
    flexServer: mergedServer.flexServer,
    async shutdown() { await mergedServer.close(); },
  };
}

class ServerShell {
  public flexServer: FlexServer;

  private _server: http.Server;
  private _mergedServer: MergedServer | undefined;
  private _currentApp: ((...args: any[]) => void) | undefined;
  private _healthy: boolean = true;
  private _port: number;

  constructor(private _options: ServerShellOptions) {}

  public async start() {
    const host = getGristHost();
    const flags = getServerFlags();
    this._server = http.createServer(flags);
    await listenPromise(this._server.listen(this._options.port, host));
    this._port = (this._server.address() as { port: number }).port;
    log.info(`ServerShell listening on ${host}:${this._port}`);

    this._server.on("request", (req, res) => this._handleRequest(req, res));
    shutdown.installProcessHandlers();

    await this._startGrist();
  }

  public async shutdown() {
    await this._mergedServer?.close();
    await new Promise<void>((resolve, reject) =>
      this._server.close(err => err ? reject(err) : resolve()));
  }

  // All requests pass through this handler. During restart, /status
  // is answered directly to keep liveness probes happy while there is
  // no Express app to delegate to. The restart is correct functioning
  // of the app, rather than a failure.
  //
  // /status?ready=1 is always delegated to the Express app, or returns
  // failure, since it is specifically asking if the app is operating
  // fully.
  //
  // /status/hooks is also always delegated since it too is checking for
  // something specific (test hooks).
  private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.url === "/status" || req.url?.startsWith("/status?")) {
      if (!this._healthy) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("unhealthy");
        return;
      }
      if (this._currentApp) {
        this._currentApp(req, res);
      // Simple string match is fine here -- this is our own /status
      // endpoint, not user input, and avoids URL parsing edge cases.
      } else if (req.url.includes("ready=1")) {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("not ready");
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
      }
      return;
    }
    if (!this._currentApp) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "restarting" }));
      return;
    }
    this._currentApp(req, res);
  }

  private async _startGrist() {
    this._currentApp = undefined;

    shutdown.resetCleanupHandlers();
    appSettings.reset();

    await this._options.beforeStart?.();

    this._mergedServer = await MergedServer.create(this._port, this._options.serverTypes, {
      server: this._server,
    });
    // Wire up the Express app before run(), so that /status requests
    // can reach the health-check handler during startup. This matters
    // for worker registration, which polls /status to confirm the
    // server is reachable. Non-health endpoints are still gated by
    // FlexServer's denyRequestsIfNotReady middleware until run()
    // calls setReady(true).
    this._currentApp = this._mergedServer.flexServer.app;
    if (Deps.testWaitBeforeReadyMs) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), Deps.testWaitBeforeReadyMs);
        // Don't keep the process alive for test-only delays.
        if (typeof timer === "object" && "unref" in timer) { timer.unref(); }
      });
    }
    await this._mergedServer.run();
    this.flexServer = this._mergedServer.flexServer;
    this._healthy = true;

    await this._options.afterStart?.(this.flexServer);

    this.flexServer.onRestart(() => this._doRestart());
  }

  private async _doRestart() {
    if (!this._currentApp) { return; }  // Already restarting.
    log.info("ServerShell: restart requested");
    this._currentApp = undefined;

    const timeout = setTimeout(() => {
      log.error("ServerShell: restart timed out, marking unhealthy");
      this._healthy = false;
    }, Deps.restartTimeoutMs);
    timeout.unref();

    try {
      await this._mergedServer!.close();
      await this._startGrist();
    } catch (err) {
      log.error("ServerShell: error during restart", err);
      this._healthy = false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export type ServerShellHandle = Awaited<ReturnType<typeof startServer>>;
