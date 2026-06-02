/**
 * RestartShell: owns the listening TCP socket and forwards each
 * accepted connection to a forked child worker via IPC, so admin-
 * triggered restarts don't drop the port. If the child crashes
 * unexpectedly, the shell exits too -- it is not a general process
 * manager.
 */

import { isAffirmative, PromiseChain } from "app/common/gutil";
import { getGristHost } from "app/server/lib/FlexServer";
import log from "app/server/lib/log";
import { isParameterOn } from "app/server/lib/requestUtils";
import {
  isUnderRestartShell,
  ShellToWorker,
  WorkerToShell,
} from "app/server/lib/RestartShellWorker";
import { listenPromise } from "app/server/lib/serverUtils";
import * as shutdownLib from "app/server/lib/shutdown";

import * as childProcess from "child_process";
import * as http from "http";
import * as net from "net";

export interface RestartShellOptions {
  publicPort: number;
  childEntryPoint: string;
}

// Tunables exposed for tests.
export const Deps = {
  // If a spawn hasn't completed within this window, /status starts
  // reporting 500 so orchestration can react. Flips back to healthy
  // if the spawn eventually succeeds.
  unhealthyTimeoutMs: 15000,
};

// Shell lifecycle.
//   stopped    -> starting             start() called
//   starting   -> running              initial spawn succeeded
//   running    -> restarting           restart() begins
//   restarting -> running              restart succeeded
//   *          -> stopping -> stopped  shutdown()
// A failed spawn sets a non-zero exitCode and queues shutdown().
type ShellStatus =
  { kind: "starting" } |
  { kind: "running", child: childProcess.ChildProcess, exited: Promise<ExitInfo> } |
  { kind: "restarting" } |
  { kind: "stopping" } |
  { kind: "stopped" };

type SpawnResult =
  { ok: true, child: childProcess.ChildProcess, exited: Promise<ExitInfo> } |
  { ok: false, err: unknown };

interface ExitInfo { code: number | null; signal: NodeJS.Signals | null; }

interface FallbackResponse { status: number; contentType: string; body: string; }
const plain = (status: number, body: string): FallbackResponse =>
  ({ status, contentType: "text/plain", body });
const asJson = (status: number, value: unknown): FallbackResponse =>
  ({ status, contentType: "application/json", body: JSON.stringify(value) });
const RESTARTING: FallbackResponse = asJson(503, { error: "restarting" });
const STARTING: FallbackResponse = asJson(503, { error: "starting" });
const UNHEALTHY = plain(500, "Grist server is unhealthy.");
const NOT_READY = plain(500, "Grist server is unhealthy (ready not ok).");
const ALIVE = plain(200, "Grist server is alive.");

/**
 * Owns the public listening socket and forwards accepted connections
 * to a forked child worker. Construct, then `await start()`; hold onto
 * the instance to `restart()` or `shutdown()`.
 */
export class RestartShell {
  private _status: ShellStatus = { kind: "stopped" };
  private _healthy = true;

  // Serializes restart/shutdown.
  private readonly _ops = new PromiseChain<void>();

  // Sockets accepted but not yet handed off to the child. A socket
  // leaves when it closes locally or is successfully sent to the child
  // (after which the child owns it). shutdown() destroys the rest.
  private readonly _connections = new Set<net.Socket>();

  private readonly _server: net.Server;
  private readonly _fallbackServer: http.Server;
  private _actualPort = 0;

  constructor(private readonly _options: RestartShellOptions) {
    this._fallbackServer = this._createFallbackServer();
    this._server = this._createPublicServer();
  }

  /** Bind the listening socket and spawn the first child. */
  public async start(): Promise<void> {
    await this.listen();
    await this.run();
  }

  /**
   * Bind the listening socket and arm signal handlers. After this
   * returns, `port` is set and /status is reachable (answered by the
   * fallback as "starting" until run() completes).
   */
  public async listen(): Promise<void> {
    log.info("RestartShell: starting");
    this._status = { kind: "starting" };
    this._actualPort = await bindPublicSocket(this._server, this._options.publicPort);
    log.info(`RestartShell: listening on port ${this._actualPort}`);

    // Signal handling via shutdown.js -- on SIGINT/SIGTERM it runs
    // our cleanup handler (capped at 15s) and exits 128+signum, which
    // is the expected kill-by-signal contract even when Grist runs as
    // pid 1 in a container (see grist-core#830, #892).
    shutdownLib.addCleanupHandler(this, () => this.shutdown(), 15000, "RestartShell");
    shutdownLib.cleanupOnSignals("SIGINT", "SIGTERM");
  }

  /** Spawn the first child and transition to "running" once it's ready. */
  public async run(): Promise<void> {
    const result = await this._spawnOrFail();
    if (!result.ok) {
      // Shut down so the event loop drains and the process exits
      // naturally; exitCode makes that exit non-zero.
      process.exitCode = 1;
      await this.shutdown();
      throw new Error(`RestartShell: initial spawn failed: ${result.err}`);
    }
    this._status = { kind: "running", child: result.child, exited: result.exited };
  }

  public get port(): number { return this._actualPort; }

  public getChildPid(): number | undefined {
    return this._status.kind === "running" ? this._status.child.pid : undefined;
  }

  public restart(): Promise<void> {
    return this._ops.add(() => this._doRestart());
  }

  public shutdown(killSig: NodeJS.Signals = "SIGTERM"): Promise<void> {
    return this._ops.add(() => this._doShutdown(killSig));
  }

  private async _doRestart(): Promise<void> {
    if (this._status.kind !== "running") { return; }
    const { child: oldChild, exited: oldExited } = this._status;
    this._status = { kind: "restarting" };
    log.info("RestartShell: restart requested");
    try {
      await this._stopChild(oldChild, oldExited);
      const result = await this._spawnOrFail();
      if (result.ok) {
        this._status = { kind: "running", child: result.child, exited: result.exited };
      } else {
        log.error("RestartShell: restart failed; shutting down");
        this._failFast();
      }
    } catch (err) {
      this._failFast("restart", err);
    }
  }

  private async _doShutdown(killSig: NodeJS.Signals): Promise<void> {
    if (this._status.kind === "stopping" || this._status.kind === "stopped") { return; }
    const live = this._status.kind === "running" ? this._status : undefined;
    this._status = { kind: "stopping" };
    shutdownLib.removeCleanupHandlers(this);

    try {
      for (const conn of this._connections) { conn.destroy(); }
      this._connections.clear();
      // server.close() is not awaited: the sockets we've handed to the
      // child keep its internal count up until the child closes them,
      // which can take the full _stopChild timeout. The synchronous
      // effect (stop accepting new connections) is all we need.
      this._server.close();
      if (live) { await this._stopChild(live.child, live.exited, killSig); }
    } catch (err) {
      // Defensive: the steps above are designed not to throw. Reach
      // "stopped" anyway so the op queue isn't left broken.
      log.error("RestartShell: unexpected error in shutdown:", err);
    }
    this._status = { kind: "stopped" };
  }

  // Called when we hit an unrecoverable state (spawn failed, or an
  // "impossible" throw from _stopChild / _spawnOrFail). Set a non-zero
  // exit code and queue a shutdown so the process drains and exits.
  private _failFast(context?: string, err?: unknown): void {
    if (context) { log.error(`RestartShell: unexpected error in ${context}:`, err); }
    process.exitCode = 1;
    // void: callers run on the _ops queue, so awaiting shutdown here
    // would deadlock (it's queued behind the current op).
    void this.shutdown();
  }

  // When the child dies, `child.connected` flips to false immediately
  // but our status stays "running" until `_onChildExitAfterReady` runs
  // on the next tick. Checking both avoids sending to a dead IPC
  // channel during that window.
  private _childIfForwardable(): childProcess.ChildProcess | undefined {
    const s = this._status;
    return s.kind === "running" && s.child.connected ? s.child : undefined;
  }

  private _createPublicServer(): net.Server {
    return net.createServer({ pauseOnConnect: true }, (socket) => {
      this._connections.add(socket);
      socket.on("close", () => this._connections.delete(socket));

      const forwardTo = this._childIfForwardable();
      if (forwardTo) {
        this._forwardSocketToChild(forwardTo, socket);
      } else {
        this._fallbackServer.emit("connection", socket);
        socket.resume();
      }
    });
  }

  // An http.Server that's never bound to a port. We feed raw sockets
  // to it via emit("connection", socket) -- saves reimplementing
  // HTTP parsing just to answer /status.
  private _createFallbackServer(): http.Server {
    return http.createServer((req, res) => this._handleFallbackRequest(req, res));
  }

  private _handleFallbackRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Connection:close so the next request opens a fresh TCP
    // connection and routes to the new child once it's up.
    res.setHeader("Connection", "close");
    const { status, contentType, body } = this._fallbackResponse(req);
    res.writeHead(status, { "Content-Type": contentType });
    res.end(body);
  }

  private _fallbackResponse(req: http.IncomingMessage): FallbackResponse {
    const [pathname, query = ""] = (req.url || "/").split("?");
    if (pathname !== "/status") { return RESTARTING; }
    if (this._status.kind === "starting") { return STARTING; }
    if (!this._healthy) { return UNHEALTHY; }
    if (isParameterOn(new URLSearchParams(query).get("ready"))) { return NOT_READY; }
    return ALIVE;
  }

  private _forwardSocketToChild(c: childProcess.ChildProcess, socket: net.Socket): void {
    const msg: ShellToWorker = { action: "connection" };
    // Narrow race: if the child dies between our send-ack and its
    // "connection" handler running, the client's TCP connection is
    // closed by the kernel when the child's fd is reclaimed -- the
    // client sees a reset and can reconnect.
    c.send(msg, socket, (err: Error | null) => {
      if (err) {
        // Close outright -- client would otherwise hang with no reader.
        log.warn("RestartShell: failed to send socket to child:", err.message);
        socket.destroy();
      } else {
        this._connections.delete(socket);
      }
    });
  }

  /**
   * Fork a worker and return the child plus promises for its "ready"
   * signal and its eventual exit. `ready` rejects if the child exits
   * before signalling ready.
   */
  private _forkWorker(): { child: childProcess.ChildProcess; ready: Promise<void>; exited: Promise<ExitInfo> } {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GRIST_UNDER_RESTART_SHELL: "1",
      PORT: String(this._actualPort),
    };
    // Clear GRIST_RESTART_SHELL so the child can't re-detect shell mode.
    delete env.GRIST_RESTART_SHELL;

    const c = childProcess.fork(this._options.childEntryPoint, [], {
      env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    const exited = new Promise<ExitInfo>((resolve) => {
      c.once("exit", (code, signal) => resolve({ code, signal }));
      c.once("error", (err) => {
        log.error("RestartShell: child error event:", err);
        resolve({ code: null, signal: null });
      });
    });

    const ready = new Promise<void>((resolve, reject) => {
      c.on("message", (msg: WorkerToShell) => {
        switch (msg?.action) {
          case "ready": resolve(); break;
          case "restart": void this.restart(); break;
        }
      });
      void exited.then(({ code, signal }) =>
        reject(new Error(`child exited before ready code=${code} signal=${signal}`)));
    });

    return { child: c, ready, exited };
  }

  private _onChildExitAfterReady(code: number | null, signal: NodeJS.Signals | null): void {
    log.info(`RestartShell: child exited code=${code} signal=${signal}`);
    // "starting" is reachable only in the narrow sync gap between the
    // spawn resolving and start() updating status; treat as running.
    switch (this._status.kind) {
      case "restarting":
      case "stopping":
      case "stopped":
        return;
      case "starting":
      case "running":
        log.error("RestartShell: child crashed unexpectedly, shutting down");
        process.exitCode = code ?? 1;
        void this.shutdown();
    }
  }

  private async _stopChild(
    child: childProcess.ChildProcess,
    exited: Promise<ExitInfo>,
    sig: NodeJS.Signals = "SIGTERM",
    timeoutMs = 10000,
  ): Promise<void> {
    if (child.exitCode !== null) { return; }
    child.kill(sig);
    const timer = setTimeout(() => {
      log.warn("RestartShell: child did not exit in time, sending SIGKILL");
      child.kill("SIGKILL");
    }, timeoutMs);
    try { await exited; } finally { clearTimeout(timer); }
  }

  /**
   * Fork a worker, wait for ready, and arm the "unexpected exit ⇒
   * shell exits" policy. A watchdog flips `_healthy` to false if the
   * spawn stalls, so /status can report unhealthy to orchestration.
   */
  private async _spawnOrFail(): Promise<SpawnResult> {
    log.info("RestartShell: spawning child");
    const watchdog = setTimeout(() => {
      log.error(`RestartShell: spawn still running after ${Deps.unhealthyTimeoutMs}ms, marking unhealthy`);
      this._healthy = false;
    }, Deps.unhealthyTimeoutMs);
    const { child, ready, exited } = this._forkWorker();
    try {
      await ready;
      log.info("RestartShell: child ready");
      this._healthy = true;
      // Pre-ready exits reject `ready`; this only fires for post-ready.
      void exited.then(({ code, signal }) => this._onChildExitAfterReady(code, signal));
      return { ok: true, child, exited };
    } catch (err) {
      log.error("RestartShell: child failed to start:", err);
      return { ok: false, err };
    } finally {
      clearTimeout(watchdog);
    }
  }
}

/** Build and start a RestartShell. */
export async function runRestartShell(options: RestartShellOptions): Promise<RestartShell> {
  const shell = new RestartShell(options);
  await shell.start();
  return shell;
}

/**
 * GRIST_RESTART_SHELL is honored if set; otherwise defaults to true on
 * Linux under plain Node, false elsewhere -- Windows FD-passing works
 * per Node docs but is untested, and Electron has issues with forking.
 */
export function shouldRunAsRestartShell() {
  if (isUnderRestartShell()) { return false; }  // never recurse
  const explicit = process.env.GRIST_RESTART_SHELL;
  if (explicit !== undefined && explicit !== "") { return isAffirmative(explicit); }
  // Tests use SIGSTOP/SIGCONT on the spawned process to pause the server;
  // under RestartShell that only pauses the shell while the worker keeps
  // serving, breaking pauseUntil() in browser tests.
  if (process.env.GRIST_TESTING_SOCKET) { return false; }
  const isElectron = Boolean((process.versions as { electron?: string }).electron);
  return process.platform === "linux" && !isElectron;
}

/** Bind `server` to `port` on the Grist host; return the actual bound port. */
async function bindPublicSocket(server: net.Server, port: number): Promise<number> {
  server.on("error", err => log.error("RestartShell: server error:", err));
  const listening = listenPromise(server);
  server.listen(port, getGristHost());
  await listening;
  return (server.address() as net.AddressInfo).port;
}
