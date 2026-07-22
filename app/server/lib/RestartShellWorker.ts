/**
 * Helpers that run in a RestartShell worker process (the forked child).
 * Everything flows to the shell via IPC. Split from RestartShell so
 * it's physically obvious which code runs in which process.
 */

import { delay } from "app/common/delay";
import { isAffirmative } from "app/common/gutil";
import { getServerFlags } from "app/server/lib/FlexServer";

import * as http from "http";

// IPC messages exchanged between shell and worker.
export interface ShellToWorker { action: "connection"; }
export interface WorkerToShell { action: "ready" | "restart" | "busy"; }

export function isUnderRestartShell(): boolean {
  return isAffirmative(process.env.GRIST_UNDER_RESTART_SHELL);
}

/**
 * Create an http.Server that receives connections from the parent
 * RestartShell via IPC rather than binding a port itself. Passed into
 * MergedServer via its `server` option.
 */
export function createRestartShellWorkerServer(): http.Server {
  // Unref IPC so it alone doesn't keep the worker alive: on a failed
  // boot, handles drain and the process exits, matching pre-shell
  // Grist where a dead listen socket meant a dead process.
  process.channel?.unref();

  const server = http.createServer(getServerFlags());
  process.on("message", (msg: ShellToWorker, socket: any) => {
    if (msg?.action === "connection" && socket) {
      server.emit("connection", socket);
      socket.resume();
    }
  });
  return server;
}

/**
 * Tell the parent RestartShell that this worker is ready to accept
 * forwarded connections. Caller must wait until the server is fully
 * set up (including any testing hooks tests will probe for).
 */
export async function signalRestartShellReady(): Promise<void> {
  if (process.env.GRIST_TEST_RESTART_SHELL_READY_DELAY) {
    const busyInterval = Number(process.env.GRIST_TEST_RESTART_SHELL_BUSY_INTERVAL) || 0;
    const busyTimeout = busyInterval ? setInterval(signalRestartShellBusy, busyInterval) : undefined;
    await delay(Number(process.env.GRIST_TEST_RESTART_SHELL_READY_DELAY));
    if (busyTimeout) { clearInterval(busyTimeout); }
  }
  const ready: WorkerToShell = { action: "ready" };
  process.send?.(ready);
}

/**
 * Tell the parent RestartShell to reset the unhealthy timeout. Caller must
 * invoke this function continuously while the server is busy doing asynchronous
 * work during startup (e.g. downloading the full edition of Grist).
 */
export function signalRestartShellBusy(): void {
  const busy: WorkerToShell = { action: "busy" };
  process.send?.(busy);
}
