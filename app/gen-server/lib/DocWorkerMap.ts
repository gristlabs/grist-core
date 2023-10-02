import {MapWithTTL} from 'app/common/AsyncCreate';
import * as version from 'app/common/version';
import {DocStatus, DocWorkerInfo, IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import log from 'app/server/lib/log';
import {checkPermitKey, formatPermitKey, IPermitStore, Permit} from 'app/server/lib/Permit';
import {promisifyAll} from 'bluebird';
import mapValues = require('lodash/mapValues');
import {createClient, Multi, RedisClient} from 'redis';
import Redlock from 'redlock';
import uuidv4 from 'uuid/v4';

promisifyAll(RedisClient.prototype);
promisifyAll(Multi.prototype);

// Max time for which we will hold a lock, by default.  In milliseconds.
const LOCK_TIMEOUT = 3000;

// How long do checksums stored in redis last.  In milliseconds.
// Should be long enough to allow S3 to reach consistency with very high probability.
// Consistency failures shorter than this interval will be detectable, failures longer
// than this interval will not be detectable.
const CHECKSUM_TTL_MSEC = 24 * 60 * 60 * 1000;  // 24 hours

// How long do permits stored in redis last, in milliseconds.
const PERMIT_TTL_MSEC = 1 * 60 * 1000;  // 1 minute

class DummyDocWorkerMap implements IDocWorkerMap {
  private _worker?: DocWorkerInfo;
  private _available: boolean = false;
  private _elections = new MapWithTTL<string, string>(1);  // default ttl never used
  private _permitStores = new Map<string, IPermitStore>();

  public async getDocWorker(docId: string) {
    if (!this._worker) { throw new Error('no workers'); }
    return {docMD5: 'unknown', docWorker: this._worker, isActive: true};
  }

  public async assignDocWorker(docId: string) {
    if (!this._worker || !this._available) { throw new Error('no workers'); }
    return {docMD5: 'unknown', docWorker: this._worker, isActive: true};
  }

  public async getDocWorkerOrAssign(docId: string, workerId: string): Promise<DocStatus> {
    if (!this._worker || !this._available) { throw new Error('no workers'); }
    if (this._worker.id !== workerId) { throw new Error('worker not known'); }
    return {docMD5: 'unknown', docWorker: this._worker, isActive: true};
  }

  public async updateDocStatus(docId: string, checksum: string) {
    // nothing to do
  }

  public async addWorker(info: DocWorkerInfo): Promise<void> {
    this._worker = info;
  }

  public async removeWorker(workerId: string): Promise<void> {
    this._worker = undefined;
  }

  public async setWorkerAvailability(workerId: string, available: boolean): Promise<void> {
    this._available = available;
  }

  public async releaseAssignment(workerId: string, docId: string): Promise<void> {
    // nothing to do
  }

  public async getAssignments(workerId: string): Promise<string[]> {
    return [];
  }

  public getPermitStore(prefix: string, defaultTtlMs?: number): IPermitStore {
    let store = this._permitStores.get(prefix);
    if (store) { return store; }
    const _permits = new MapWithTTL<string, string>(defaultTtlMs || PERMIT_TTL_MSEC);
    store = {
      async setPermit(permit: Permit, ttlMs?: number): Promise<string> {
        const key = formatPermitKey(uuidv4(), prefix);
        if (ttlMs) {
          _permits.setWithCustomTTL(key, JSON.stringify(permit), ttlMs);
        } else {
          _permits.set(key, JSON.stringify(permit));
        }
        return key;
      },
      async getPermit(key: string): Promise<Permit> {
        const result = _permits.get(key);
        return result ? JSON.parse(result) : null;
      },
      async removePermit(key: string): Promise<void> {
        _permits.delete(key);
      },
      async close(): Promise<void> {
        _permits.clear();
      },
      getKeyPrefix() {
        return formatPermitKey('', prefix);
      }
    };
    this._permitStores.set(prefix, store);
    return store;
  }

  public async close(): Promise<void> {
    await Promise.all([...this._permitStores.values()].map(store => store.close()));
    this._permitStores.clear();
    this._elections.clear();
  }

  public async getElection(name: string, durationInMs: number): Promise<string|null> {
    if (this._elections.get(name)) { return null; }
    const key = uuidv4();
    this._elections.setWithCustomTTL(name, key, durationInMs);
    return key;
  }

  public async removeElection(name: string, electionKey: string): Promise<void> {
    if (this._elections.get(name) === electionKey) {
      this._elections.delete(name);
    }
  }

  public async updateChecksum(family: string, key: string, checksum: string) {
    // nothing to do
  }

  public async getChecksum(family: string, key: string) {
    return null;
  }

  public async getWorkerGroup(workerId: string): Promise<string|null> {
    return null;
  }

  public async getDocGroup(docId: string): Promise<string|null> {
    return null;
  }

  public async updateDocGroup(docId: string, docGroup: string): Promise<void> {
    // nothing to do
  }

  public async removeDocGroup(docId: string): Promise<void> {
    // nothing to do
  }

  public getRedisClient() {
    return null;
  }
}

/**
 * Manage the relationship between document and workers.  Backed by Redis.
 * Can also assign workers to "groups" for serving particular documents.
 * Keys used:
 *   workers - the set of known active workers, identified by workerId
 *   workers-available - the set of workers available for assignment (a subset of the workers set)
 *   workers-available-{group} - the set of workers available for a given group
 *   worker-{workerId} - a hash of contact information for a worker
 *   worker-{workerId}-docs - a set of docs assigned to a worker, identified by docId
 *   worker-{workerId}-group - if set, marks the worker as serving a particular group
 *   doc-${docId} - a hash containing (JSON serialized) DocStatus fields, other than docMD5.
 *   doc-${docId}-checksum - the docs docMD5, or 'null' if docMD5 is null
 *   doc-${docId}-group - if set, marks the doc as to be served by workers in a given group
 *   workers-lock - a lock used when working with the list of workers
 *   groups - a hash from groupIds (arbitrary strings) to desired number of workers in group
 *   elections-${deployment} - a hash, from groupId to a (serialized json) list of worker ids
 *
 * Assignments of documents to workers can end abruptly at any time.  Clients
 * should be prepared to retry if a worker is not responding or denies that a document
 * is assigned to it.
 *
 * If the groups key is set, workers assign themselves to groupIds to
 * fill the counts specified in groups (in order of groupIds), and
 * once those are exhausted, get assigned to the special group
 * "default".
 */
export class DocWorkerMap implements IDocWorkerMap {
  private _client: RedisClient;
  private _clients: RedisClient[];
  private _redlock: Redlock;

  // Optional deploymentKey argument supplies a key unique to the deployment (this is important
  // for maintaining groups across redeployments only)
  constructor(_clients?: RedisClient[], private _deploymentKey?: string, private _options?: {
    permitMsec?: number
  }) {
    this._deploymentKey = this._deploymentKey || version.version;
    this._clients = _clients || [createClient(process.env.REDIS_URL)];
    this._redlock = new Redlock(this._clients);
    this._client = this._clients[0]!;
    this._client.on('error', (err) => log.warn(`DocWorkerMap: redisClient error`, String(err)));
    this._client.on('end', () => log.warn(`DocWorkerMap: redisClient connection closed`));
    this._client.on('reconnecting', () => log.warn(`DocWorkerMap: redisClient reconnecting`));
  }

  public async addWorker(info: DocWorkerInfo): Promise<void> {
    log.info(`DocWorkerMap.addWorker ${info.id}`);
    const lock = await this._redlock.lock('workers-lock', LOCK_TIMEOUT);
    try {
      // Make a worker-{workerId} key with contact info.
      await this._client.hmsetAsync(`worker-${info.id}`, info);
      // Add this worker to set of workers (but don't make it available for work yet).
      await this._client.saddAsync('workers', info.id);

      if (info.group) {
        // Accept work only for a specific group.
        // Do not accept work not associated with the specified group.
        await this._client.setAsync(`worker-${info.id}-group`, info.group);
      } else {
        // Figure out if worker should belong to a group via elections.
        // Be careful: elections happen within a single deployment, so are somewhat
        // unintuitive in behavior. For example, if a document is assigned to a group
        // but there is no worker available for that group, it may open on any worker.
        // And if a worker is assigned to a group, it may still end up assigned work
        // not associated with that group if it is the only worker available.
        const groups = await this._client.hgetallAsync('groups');
        if (groups) {
          const elections = await this._client.hgetallAsync(`elections-${this._deploymentKey}`) || {};
          for (const group of Object.keys(groups).sort()) {
            const count = parseInt(groups[group], 10) || 0;
            if (count < 1) { continue; }
            const elected: string[] = JSON.parse(elections[group] || '[]');
            if (elected.length >= count) { continue; }
            elected.push(info.id);
            await this._client.setAsync(`worker-${info.id}-group`, group);
            await this._client.hsetAsync(`elections-${this._deploymentKey}`, group, JSON.stringify(elected));
            break;
          }
        }
      }
    } finally {
      await lock.unlock();
    }
  }

  public async removeWorker(workerId: string): Promise<void> {
    log.info(`DocWorkerMap.removeWorker ${workerId}`);
    const lock = await this._redlock.lock('workers-lock', LOCK_TIMEOUT);
    try {
      // Drop out of available set first.
      await this._client.sremAsync('workers-available', workerId);
      const group = await this._client.getAsync(`worker-${workerId}-group`) || 'default';
      await this._client.sremAsync(`workers-available-${group}`, workerId);
      // At this point, this worker should no longer be receiving new doc assignments, though
      // clients may still be directed to the worker.

      // If we were elected for anything, back out.
      const elections = await this._client.hgetallAsync(`elections-${this._deploymentKey}`);
      if (elections) {
        if (group in elections) {
          const elected: string[] = JSON.parse(elections[group]);
          const newElected = elected.filter(worker => worker !== workerId);
          if (elected.length !== newElected.length) {
            if (newElected.length > 0) {
              await this._client.hsetAsync(`elections-${this._deploymentKey}`, group,
                                           JSON.stringify(newElected));
            } else {
              await this._client.hdelAsync(`elections-${this._deploymentKey}`, group);
              delete elections[group];
            }
          }
          // We're the last one involved in elections - remove the key entirely.
          if (Object.keys(elected).length === 0) {
            await this._client.delAsync(`elections-${this._deploymentKey}`);
          }
        }
      }

      // Now, we start removing the assignments.
      const assignments = await this._client.smembersAsync(`worker-${workerId}-docs`);
      if (assignments) {
        const op = this._client.multi();
        for (const doc of assignments) { op.del(`doc-${doc}`); }
        await op.execAsync();
      }

      // Now remove worker-{workerId}* keys.
      await this._client.delAsync(`worker-${workerId}-docs`);
      await this._client.delAsync(`worker-${workerId}-group`);
      await this._client.delAsync(`worker-${workerId}`);

      // Forget about this worker completely.
      await this._client.sremAsync('workers', workerId);
    } finally {
      await lock.unlock();
    }
  }

  public async setWorkerAvailability(workerId: string, available: boolean): Promise<void> {
    log.info(`DocWorkerMap.setWorkerAvailability ${workerId} ${available}`);
    const group = await this._client.getAsync(`worker-${workerId}-group`) || 'default';
    if (available) {
      const docWorker = await this._client.hgetallAsync(`worker-${workerId}`) as DocWorkerInfo|null;
      if (!docWorker) { throw new Error('no doc worker contact info available'); }
      await this._client.saddAsync(`workers-available-${group}`, workerId);
      // If we're not assigned exclusively to a group, add this worker also to the general
      // pool of workers.
      if (!docWorker.group) {
        await this._client.saddAsync('workers-available', workerId);
      }
    } else {
      await this._client.sremAsync('workers-available', workerId);
      await this._client.sremAsync(`workers-available-${group}`, workerId);
    }
  }

  public async releaseAssignment(workerId: string, docId: string): Promise<void> {
    const op = this._client.multi();
    op.del(`doc-${docId}`);
    op.srem(`worker-${workerId}-docs`, docId);
    await op.execAsync();
  }

  public async getAssignments(workerId: string): Promise<string[]> {
    return this._client.smembersAsync(`worker-${workerId}-docs`);
  }

  /**
   * Defined by IDocWorkerMap.
   *
   * Looks up which DocWorker is responsible for this docId.
   * Responsibility could change at any time after this call, so it
   * should be treated as a hint, and clients should be prepared to be
   * refused and need to retry.
   */
  public async getDocWorker(docId: string): Promise<DocStatus|null> {
    const {doc} = await this._getDocAndChecksum(docId);
    return doc;
  }

  /**
   *
   * Defined by IDocWorkerMap.
   *
   * Assigns a DocWorker to this docId if one is not yet assigned.
   * Note that the assignment could be unmade at any time after this
   * call if the worker dies, is brought down, or for other potential
   * reasons in the future such as migration of individual documents
   * between workers.
   *
   * A preferred doc worker can be specified, which will be assigned
   * if no assignment is already made.
   *
   * For the special docId "import", return a potential assignment.
   * It will be up to the doc worker to assign the eventually
   * created document, if desired.
   *
   */
  public async assignDocWorker(docId: string, workerId?: string): Promise<DocStatus> {
    if (docId === 'import') {
      const lock = await this._redlock.lock(`workers-lock`, LOCK_TIMEOUT);
      try {
        const _workerId = await this._client.srandmemberAsync(`workers-available-default`);
        if (!_workerId) { throw new Error('no doc worker available'); }
        const docWorker = await this._client.hgetallAsync(`worker-${_workerId}`) as DocWorkerInfo|null;
        if (!docWorker) { throw new Error('no doc worker contact info available'); }
        return {
          docMD5: null,
          docWorker,
          isActive: false
        };
      } finally {
        await lock.unlock();
      }
    }

    // Check if a DocWorker is already assigned; if so return result immediately
    // without locking.
    let docStatus = await this.getDocWorker(docId);
    if (docStatus) { return docStatus; }

    // No assignment yet, so let's lock and set an assignment up.
    const lock = await this._redlock.lock(`workers-lock`, LOCK_TIMEOUT);

    try {
      // Now that we've locked, recheck that the worker hasn't been reassigned
      // in the meantime.  Return immediately if it has.
      const docAndChecksum = await this._getDocAndChecksum(docId);
      docStatus = docAndChecksum.doc;
      if (docStatus) { return docStatus; }

      if (!workerId) {
        // Check if document has a preferred worker group set.
        const group = await this._client.getAsync(`doc-${docId}-group`) || 'default';

        // Let's start off by assigning documents to available workers randomly.
        // TODO: use a smarter algorithm.
        workerId = await this._client.srandmemberAsync(`workers-available-${group}`) || undefined;
        if (!workerId) {
          // No workers available in the desired worker group.  Rather than refusing to
          // open the document, we fall back on assigning a worker from any of the workers
          // available, regardless of grouping.
          // This limits the impact of operational misconfiguration (bad redis setup,
          // or not starting enough workers).  It has the downside of potentially disguising
          // problems, so we log a warning.
          log.warn(`DocWorkerMap.assignDocWorker ${docId} found no workers for group ${group}`);
          workerId = await this._client.srandmemberAsync('workers-available') || undefined;
        }
        if (!workerId) { throw new Error('no doc workers available'); }
      }  else {
        if (!await this._client.sismemberAsync('workers-available', workerId)) {
          throw new Error(`worker ${workerId} not known or not available`);
        }
      }

      // Look up how to contact the worker.
      const docWorker = await this._client.hgetallAsync(`worker-${workerId}`) as DocWorkerInfo|null;
      if (!docWorker) { throw new Error('no doc worker contact info available'); }

      // We can now construct a DocStatus, preserving any existing checksum.
      const checksum = docAndChecksum.checksum;
      const newDocStatus = {docMD5: checksum, docWorker, isActive: true};

      // We add the assignment to worker-{workerId}-docs and save doc-{docId}.
      const result = await this._client.multi()
        .sadd(`worker-${workerId}-docs`, docId)
        .hmset(`doc-${docId}`, {
          docWorker: JSON.stringify(docWorker),  // redis can't store nested objects, strings only
          isActive: JSON.stringify(true)         // redis can't store booleans, strings only
        })
        .setex(`doc-${docId}-checksum`, CHECKSUM_TTL_MSEC / 1000.0, checksum || 'null')
        .execAsync();
      if (!result) { throw new Error('failed to store new assignment'); }
      return newDocStatus;
    } finally {
      await lock.unlock();
    }
  }

  /**
   *
   * Defined by IDocWorkerMap.
   *
   * Assigns a specific DocWorker to this docId if one is not yet assigned.
   *
   */
  public async getDocWorkerOrAssign(docId: string, workerId: string): Promise<DocStatus> {
    return this.assignDocWorker(docId, workerId);
  }

  public async updateDocStatus(docId: string, checksum: string): Promise<void> {
    return this.updateChecksum('doc', docId, checksum);
  }

  public async updateChecksum(family: string, key: string, checksum: string) {
    await this._client.setexAsync(`${family}-${key}-checksum`, CHECKSUM_TTL_MSEC / 1000.0, checksum);
  }

  public async getChecksum(family: string, key: string) {
    const checksum = await this._client.getAsync(`${family}-${key}-checksum`);
    return checksum === 'null' ? null : checksum;
  }

  public getPermitStore(prefix: string, defaultTtlMs?: number): IPermitStore {
    const permitMsec = defaultTtlMs || (this._options && this._options.permitMsec) || PERMIT_TTL_MSEC;
    const client = this._client;
    return {
      async setPermit(permit: Permit, ttlMs?: number): Promise<string> {
        const key = formatPermitKey(uuidv4(), prefix);
        // seems like only integer seconds are supported?
        const duration = ttlMs || permitMsec;
        await client.setexAsync(key, Math.ceil(duration / 1000.0), JSON.stringify(permit));
        return key;
      },
      async getPermit(key: string): Promise<Permit|null> {
        if (!checkPermitKey(key, prefix)) { throw new Error('permit could not be read'); }
        const result = await client.getAsync(key);
        return result && JSON.parse(result);
      },
      async removePermit(key: string): Promise<void> {
        if (!checkPermitKey(key, prefix)) { throw new Error('permit could not be read'); }
        await client.delAsync(key);
      },
      async close() {
        // nothing to do
      },
      getKeyPrefix() {
        return formatPermitKey('', prefix);
      }
    };
  }

  public async close(): Promise<void> {
    for (const cli of this._clients || []) {
      await cli.quitAsync();
    }
  }

  public async getElection(name: string, durationInMs: number): Promise<string|null> {
    // Could use "set nx" for election, but redis docs don't encourage that any more,
    // favoring redlock:
    //   https://redis.io/commands/setnx#design-pattern-locking-with-codesetnxcode
    const redisKey = `nomination-${name}`;
    const lock = await this._redlock.lock(`${redisKey}-lock`, LOCK_TIMEOUT);
    try {
      if (await this._client.getAsync(redisKey) !== null) { return null; }
      const electionKey = uuidv4();
      // seems like only integer seconds are supported?
      await this._client.setexAsync(redisKey, Math.ceil(durationInMs / 1000.0), electionKey);
      return electionKey;
    } finally {
      await lock.unlock();
    }
  }

  public async removeElection(name: string, electionKey: string): Promise<void> {
    const redisKey = `nomination-${name}`;
    const lock = await this._redlock.lock(`${redisKey}-lock`, LOCK_TIMEOUT);
    try {
      const current = await this._client.getAsync(redisKey);
      if (current === electionKey) {
        await this._client.delAsync(redisKey);
      } else if (current !== null) {
        throw new Error('could not remove election');
      }
    } finally {
      await lock.unlock();
    }
  }

  public async getWorkerGroup(workerId: string): Promise<string|null> {
    return this._client.getAsync(`worker-${workerId}-group`);
  }

  public async getDocGroup(docId: string): Promise<string|null> {
    return this._client.getAsync(`doc-${docId}-group`);
  }

  public async updateDocGroup(docId: string, docGroup: string): Promise<void> {
    await this._client.setAsync(`doc-${docId}-group`, docGroup);
  }

  public async removeDocGroup(docId: string): Promise<void> {
    await this._client.delAsync(`doc-${docId}-group`);
  }

  public getRedisClient(): RedisClient {
    return this._client;
  }

  /**
   * Fetch the doc-<docId> hash and doc-<docId>-checksum key from redis.
   * Return as a decoded DocStatus and a checksum.
   */
  private async _getDocAndChecksum(docId: string): Promise<{
    doc: DocStatus|null,
    checksum: string|null,
  }> {
    // Fetch the various elements that go into making a DocStatus
    const props = await this._client.multi()
      .hgetall(`doc-${docId}`)
      .get(`doc-${docId}-checksum`)
      .execAsync() as [{[key: string]: any}|null, string|null]|null;
    // Fields are JSON encoded since redis cannot store them directly.
    const doc = props?.[0] ? mapValues(props[0], (val) => JSON.parse(val)) as DocStatus : null;
    // Redis cannot store a null value, so we encode it as 'null', which does
    // not match any possible MD5.
    const checksum = (props?.[1] === 'null' ? null : props?.[1]) || null;
    if (doc) { doc.docMD5 = checksum; }  // the checksum goes in the DocStatus too.
    return {doc, checksum};
  }
}

// If we don't have redis available and use a DummyDocWorker, it should be a singleton.
let dummyDocWorkerMap: DummyDocWorkerMap|null = null;

export function getDocWorkerMap(): IDocWorkerMap {
  if (process.env.REDIS_URL) {
    return new DocWorkerMap();
  } else {
    dummyDocWorkerMap = dummyDocWorkerMap || new DummyDocWorkerMap();
    return dummyDocWorkerMap;
  }
}
