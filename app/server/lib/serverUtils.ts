import bluebird from 'bluebird';
import { ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import { ConnectionOptions } from 'typeorm';
import uuidv4 from 'uuid/v4';
import {AbortSignal} from 'node-abort-controller';

import {EngineCode} from 'app/common/DocumentSettings';
import {TelemetryMetadataByLevel} from 'app/common/Telemetry';
import log from 'app/server/lib/log';
import {OpenMode, SQLiteDB} from 'app/server/lib/SQLiteDB';
import {getDocSessionAccessOrNull, getDocSessionUser, OptDocSession} from './DocSession';

// This method previously lived in this file. Re-export to avoid changing imports all over.
export {timeoutReached} from 'app/common/gutil';

/**
 * Promisify a node-style callback function. E.g.
 *    fromCallback(cb => someAsyncFunc(someArgs, cb));
 * This is merely a type-checked version of bluebird.fromCallback().
 * (Note that providing it using native Promises is also easy, but bluebird's big benefit is
 * support of long stack traces (when enabled for debugging).
 */
type NodeCallback<T> = (err: Error|undefined|null, value?: T) => void;
type NodeCallbackFunc<T> = (cb: NodeCallback<T>) => void;
const _fromCallback = bluebird.fromCallback;
export function fromCallback<T>(nodeFunc: NodeCallbackFunc<T>): Promise<T> {
  return _fromCallback(nodeFunc);
}


/**
 * Finds and returns a promise for the first available TCP port.
 * @param {Number} firstPort: First port number to check, defaults to 8000.
 * @param {Number} optCount: Number of ports to check, defaults to 200.
 * @returns Promise<Number>: Promise for an available port.
 */
export function getAvailablePort(firstPort: number = 8000, optCount: number = 200): Promise<number> {
  const lastPort = firstPort + optCount - 1;
  function checkNext(port: number): Promise<number> {
    if (port > lastPort) {
      throw new Error("No available ports between " + firstPort + " and " + lastPort);
    }
    return new bluebird((resolve: (p: number) => void, reject: (e: Error) => void) => {
      const server = net.createServer();
      server.on('error', reject);
      server.on('close', () => resolve(port));
      server.listen(port, 'localhost', () => server.close());
    })
    .catch(() => checkNext(port + 1));
  }
  return bluebird.try(() => checkNext(firstPort));
}

/**
 * Promisified version of net.connect(). Takes the same arguments, and returns a Promise for the
 * connected socket. (Types are specified as in @types/node.)
 */
export function connect(options: { port: number, host?: string, localAddress?: string, localPort?: string,
                                   family?: number, allowHalfOpen?: boolean; }): Promise<net.Socket>;
export function connect(port: number, host?: string): Promise<net.Socket>;
export function connect(sockPath: string): Promise<net.Socket>;
export function connect(arg: any, ...moreArgs: any[]): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(arg, ...moreArgs, () => resolve(s));
    s.on('error', reject);
  });
}

/**
 * Promisified version of net.Server.listen().
 */
export function listenPromise<T extends net.Server>(server: T): Promise<void> {
  return new Promise<void>((resolve, reject) => server.once('listening', resolve).once('error', reject));
}

/**
 * Returns whether the path `inner` is contained within the directory `outer`.
 */
export function isPathWithin(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner);
  const index = rel.indexOf(path.sep);
  const firstDir = index < 0 ? rel : rel.slice(0, index);
  return firstDir !== "..";
}


/**
 * Returns a promise that's resolved when `child` exits, or rejected if it could not be started.
 * The promise resolves to the numeric exit code, or the string signal that terminated the child.
 *
 * Note that this must be called synchronously after creating the ChildProcess, since a delay may
 * cause the 'error' or 'exit' message from the child to be missed, and the resulting exitPromise
 * would then hang forever.
 */
export function exitPromise(child: ChildProcess): Promise<number|string> {
  return new Promise((resolve, reject) => {
    // Called if process could not be spawned, or could not be killed(!), or sending a message failed.
    child.on('error', reject);
    child.on('exit', (code: number, signal: string) => resolve(signal || code));
  });
}

/**
 * Get database url in DATABASE_URL format popularized by heroku, suitable for
 * use by psql, sqlalchemy, etc.
 */
export function getDatabaseUrl(options: ConnectionOptions, includeCredentials: boolean): string {
  if (options.type === 'sqlite') {
    return `sqlite://${options.database}`;
  } else if (options.type === 'postgres') {
    const pass = options.password ? `:${options.password}` : '';
    const creds = includeCredentials && options.username ? `${options.username}${pass}@` : '';
    const port = options.port ? `:${options.port}` : '';
    return `postgres://${creds}${options.host}${port}/${options.database}`;
  } else {
    return `${options.type}://?`;
  }
}

/**
 * Collect checks to be applied to incoming documents that are alleged to be
 * Grist documents. For now, the only check is a sqlite-level integrity check,
 * as suggested by https://www.sqlite.org/security.html#untrusted_sqlite_database_files
 */
export async function checkAllegedGristDoc(docSession: OptDocSession, fname: string) {
  const db = await SQLiteDB.openDBRaw(fname, OpenMode.OPEN_READONLY);
  try {
    const integrityCheckResults = await db.all('PRAGMA integrity_check');
    if (integrityCheckResults.length !== 1 || integrityCheckResults[0].integrity_check !== 'ok') {
      const uuid = uuidv4();
      log.info('Integrity check failure on import', {uuid, integrityCheckResults,
                                                     ...getLogMetaFromDocSession(docSession)});
      throw new Error(`Document failed integrity checks - is it corrupted? Event ID: ${uuid}`);
    }
  } finally {
    await db.close();
  }
}

/**
 * Extract access, userId, email, and client (if applicable) from session, for logging purposes.
 */
export function getLogMetaFromDocSession(docSession: OptDocSession) {
  const client = docSession.client;
  const access = getDocSessionAccessOrNull(docSession);
  const user = getDocSessionUser(docSession);
  const email = user?.loginEmail || user?.email;
  return {
    access,
    ...(user ? {userId: user.id, email} : {}),
    ...(client ? client.getLogMeta() : {}),   // Client if present will repeat and add to user info.
  };
}

/**
 * Extract telemetry metadata from session.
 */
export function getTelemetryMetaFromDocSession(docSession: OptDocSession): TelemetryMetadataByLevel {
  const client = docSession.client;
  const access = getDocSessionAccessOrNull(docSession);
  const user = getDocSessionUser(docSession);
  return {
    limited: {
      access,
    },
    full: {
      ...(user ? {userId: user.id} : {}),
      ...(client ? client.getFullTelemetryMeta() : {}),   // Client if present will repeat and add to user info.
    },
  };
}

/**
 * Only offer choices of engine on experimental deployments (staging/dev).
 */
export function getSupportedEngineChoices(): EngineCode[]|undefined {
  if (process.env.GRIST_EXPERIMENTAL_PLUGINS === '1' ||
      process.env.PYTHON_VERSION_ON_CREATION) {
    return ['python2', 'python3'];
  }
  return undefined;
}

/**
 * Returns a promise that resolves in the given number of milliseconds or rejects
 * when the given signal is raised.
 */
export async function delayAbort(msec: number, signal?: AbortSignal): Promise<void> {
  let cleanup: () => void = () => {};
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(), msec);
      signal?.addEventListener('abort', reject);
      cleanup = () => {
        // Be careful to clean up both the timer and the listener to avoid leaks.
        clearTimeout(timeout);
        signal?.removeEventListener('abort', reject);
      };
    });
  } finally {
    cleanup();
  }
}

/**
 * For a Redis URI, we expect no path component, or a path component
 * that is an integer database number. We'd like to scope pub/sub to
 * individual databases. Redis doesn't do that, so we construct a
 * key prefix to have the same effect.
 *   https://redis.io/docs/manual/pubsub/#database--scoping
 */
export function getPubSubPrefix(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) { return 'db-x'; }
  const dbNumber = new URL(redisUrl).pathname.replace(/^\//, '');
  if (dbNumber.match(/[^0-9]/)) {
    throw new Error('REDIS_URL has an unexpected structure');
  }
  return `db-${dbNumber}`;
}
