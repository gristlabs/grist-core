import {ErrorOrValue, freezeError, mapGetOrSet, MapWithTTL} from 'app/common/AsyncCreate';
import {ObjMetadata, ObjSnapshot, ObjSnapshotWithMetadata} from 'app/common/DocSnapshot';
import {SCHEMA_VERSION} from 'app/common/schema';
import {DocWorkerMap} from 'app/gen-server/lib/DocWorkerMap';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {create} from 'app/server/lib/create';
import {DocManager} from 'app/server/lib/DocManager';
import {makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {DELETED_TOKEN, ExternalStorage, wrapWithKeyMappedStorage} from 'app/server/lib/ExternalStorage';
import {createDummyGristServer} from 'app/server/lib/GristServer';
import {
  BackupEvent,
  backupSqliteDatabase,
  HostedStorageManager,
  HostedStorageOptions
} from 'app/server/lib/HostedStorageManager';
import log from 'app/server/lib/log';
import {SQLiteDB} from 'app/server/lib/SQLiteDB';
import * as bluebird from 'bluebird';
import {assert} from 'chai';
import * as fse from 'fs-extra';
import * as path from 'path';
import {createClient, RedisClient} from 'redis';
import * as sinon from 'sinon';
import {createInitialDb, removeConnection, setUpDB} from 'test/gen-server/seed';
import {createTmpDir, getGlobalPluginManager} from 'test/server/docTools';
import {EnvironmentSnapshot, setTmpLogLevel, useFixtureDoc} from 'test/server/testUtils';
import {waitForIt} from 'test/server/wait';
import uuidv4 from "uuid/v4";

bluebird.promisifyAll(RedisClient.prototype);

/**
 * An in-memory store, for testing.
 */
class SimpleExternalStorage implements ExternalStorage {
  protected _version = new Map<string, ObjSnapshot[]>();
  private _nextId: number = 1;
  private _memory = new Map<string, Buffer>();
  private _metadata = new Map<string, ObjSnapshotWithMetadata>();

  public constructor(public readonly label: string) {}

  public async exists(key: string, snapshotId?: string): Promise<boolean> {
    if (snapshotId) {
      // Should check snapshotId is associated with key, but don't need to be too
      // fussy this mock.
      return this._memory.has(snapshotId);
    }
    return this._version.has(key);
  }

  public async head(key: string, snapshotId?: string) {
    snapshotId = snapshotId || this._version.get(key)?.[0]?.snapshotId;
    if (!snapshotId) { return null; }
    return this._metadata.get(snapshotId) || null;
  }

  public async upload(key: string, fname: string, metadata?: ObjMetadata) {
    const data = await fse.readFile(fname);
    const id = `block-${this._nextId}`;
    this._nextId++;
    this._memory.set(id, data);
    const info: ObjSnapshotWithMetadata = {
      snapshotId: id,
      lastModified: new Date().toISOString(),
    };
    this._metadata.set(id, {...info, ...metadata && {metadata}});
    const versions = this._version.get(key) || [];
    versions.unshift(info);
    this._version.set(key, versions);
    return id;
  }

  public async remove(key: string, snapshotIds?: string[]) {
    const versions = this._version.get(key);
    if (!versions) { return; }
    if (!snapshotIds) {
      for (const version of versions) {
        this._memory.delete(version.snapshotId);
        this._metadata.delete(version.snapshotId);
      }
      this._version.delete(key);
    } else {
      for (const snapshotId of snapshotIds) {
        this._memory.delete(snapshotId);
        this._metadata.delete(snapshotId);
      }
      const blockList = new Set(snapshotIds);
      this._version.set(key, (this._version.get(key) || []).filter(v => !blockList.has(v.snapshotId)));
    }
  }

  public async download(key: string, fname: string, snapshotId?: string) {
    const versions = this._version.get(key);
    if (!versions) { throw new Error('oopsie key not found'); }
    if (snapshotId) {
      if (!versions.find(v => v.snapshotId === snapshotId)) {
        throw new Error('version not recognized');
      }
    } else {
      snapshotId = versions[0].snapshotId;
    }
    if (!snapshotId) { throw new Error('version not found'); }
    const data = this._memory.get(snapshotId);
    if (!data) { throw new Error('version data not found'); }
    await fse.writeFile(fname, data);
    return snapshotId;
  }

  public async versions(key: string) {
    return this._version.get(key) || [];
  }

  public url(key: string): string {
    return `simple://test/${this.label}/${key}`;
  }

  public isFatalError(err: any): boolean {
    return !String(err).includes('oopsie');
  }

  public async close() {
    // nothing to do
  }
}

/**
 * A wrapper around an external store, that deliberately gives stale values for the
 * `exists`, `download`, and `versions` methods.
 */
class CachedExternalStorage implements ExternalStorage {
  private _cachedExists: MapWithTTL<string, Promise<ErrorOrValue<boolean>>>;
  private _cachedHead: MapWithTTL<string, Promise<ErrorOrValue<ObjSnapshotWithMetadata|null>>>;
  private _cachedDownload: MapWithTTL<string, Promise<ErrorOrValue<[string, Buffer]>>>;
  private _cachedVersions: MapWithTTL<string, Promise<ErrorOrValue<ObjSnapshot[]>>>;

  constructor(private _ext: ExternalStorage, ttlMs: number) {
    this._cachedExists = new MapWithTTL(ttlMs);
    this._cachedHead = new MapWithTTL(ttlMs);
    this._cachedDownload = new MapWithTTL(ttlMs);
    this._cachedVersions = new MapWithTTL(ttlMs);
  }

  public async exists(key: string, snapshotId?: string) {
    const result = await mapGetOrSet(this._cachedExists, `${key}${snapshotId}`, () => {
      return freezeError(this._ext.exists(key, snapshotId));
    });
    return result.unfreeze();
  }

  public async head(key: string, snapshotId?: string) {
    const result = await mapGetOrSet(this._cachedHead, `${key}${snapshotId}`, () => {
      return freezeError(this._ext.head(key, snapshotId));
    });
    return result.unfreeze();
  }

  public async upload(key: string, fname: string, metadata?: ObjMetadata) {
    return this._ext.upload(key, fname, metadata);
  }

  public async remove(key: string, snapshotIds?: string[]) {
    return this._ext.remove(key, snapshotIds);
  }

  public async download(key: string, fname: string, snapshotId?: string): Promise<string> {
    const result = await mapGetOrSet(this._cachedDownload, `${key}${snapshotId}`, () => {
      const altFname = fname + uuidv4();
      return freezeError(
        this._ext.download(key, altFname, snapshotId).then(async (v) => {
          return [v, await fse.readFile(altFname)] as [string, Buffer];
        })
      );
    });
    try {
      const [downloadedSnapshotId, txt] = await result.unfreeze();
      await fse.writeFile(fname, txt);
      return downloadedSnapshotId;
    } catch (e) {
      await fse.writeFile(fname, 'put some junk here to simulate unclean failure');
      throw e;
    }
  }

  public async versions(key: string) {
    const result = await mapGetOrSet(this._cachedVersions, key, () => {
      return freezeError(this._ext.versions(key));
    });
    return result.unfreeze();
  }

  public url(key: string): string {
    return this._ext.url(key);
  }

  public isFatalError(err: any): boolean {
    return this._ext.isFatalError(err);
  }

  public async close() {
    // nothing to do
  }
}

/**
 * A wrapper that slows down responses from a store.
 */
class SlowExternalStorage implements ExternalStorage {
  constructor(private _ext: ExternalStorage, private _delayMs: number) {}

  public async exists(key: string, snapshotId?: string) {
    await bluebird.delay(this._delayMs);
    return this._ext.exists(key, snapshotId);
  }

  public async head(key: string, snapshotId?: string) {
    await bluebird.delay(this._delayMs);
    return this._ext.head(key, snapshotId);
  }

  public async upload(key: string, fname: string, metadata?: ObjMetadata) {
    await bluebird.delay(this._delayMs);
    return this._ext.upload(key, fname, metadata);
  }

  public async remove(key: string, snapshotIds?: string[]) {
    await bluebird.delay(this._delayMs);
    return this._ext.remove(key, snapshotIds);
  }

  public async download(key: string, fname: string, snapshotId?: string): Promise<string> {
    await bluebird.delay(this._delayMs);
    return this._ext.download(key, fname, snapshotId);
  }

  public async versions(key: string) {
    await bluebird.delay(this._delayMs);
    return this._ext.versions(key);
  }

  public url(key: string): string {
    return this._ext.url(key);
  }

  public isFatalError(err: any): boolean {
    return this._ext.isFatalError(err);
  }

  public async close() {
    // nothing to do
  }
}


/**
 * A document store representing a doc worker's local store, for testing.
 * Uses TEST_S3_BUCKET and TEST_S3_PREFIX.  Objects in test bucket should be set up
 * to be deleted after a short period.  Since we don't attempt to garbage collect
 * within the unit test.  s3://grist-docs-test/unit-tests/... is set up that way.
 */
class TestStore {
  public docManager: DocManager;
  public storageManager: HostedStorageManager;
  private _active: boolean = false;  // True if the simulated doc worker is started.
  private _extraPrefix = uuidv4();   // Extra prefix in S3 (unique to this test).

  public constructor(
    private _localDirectory: string,
    private _workerId: string,
    private _workers: DocWorkerMap,
    private _externalStorageCreate: (purpose: 'doc'|'meta', extraPrefix: string) => ExternalStorage|undefined) {
  }

  public async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.begin();
    let result;
    try {
      result = await fn();
    } finally {
      await this.end();
    }
    return result;
  }

  // Simulates doc worker startup.
  public async begin() {
    await this.end();
    this._active = true;
    const dbManager = new HomeDBManager();
    await dbManager.connect();
    await dbManager.initializeSpecialIds();
    const options: HostedStorageOptions = {
      secondsBeforePush: 0.5,
      secondsBeforeFirstRetry: 3,   // rumors online suggest delays of 10-11 secs
                                    // are not super-unusual.
      pushDocUpdateTimes: false,
      externalStorageCreator: (purpose) => {
        const result = this._externalStorageCreate(purpose, this._extraPrefix);
        if (!result) { throw new Error('no storage'); }
        return result;
      }
    };
    const storageManager = new HostedStorageManager(this._localDirectory,
                                                    this._workerId,
                                                    false,
                                                    this._workers,
                                                    dbManager,
                                                    create,
                                                    options);
    this.storageManager = storageManager;
    this.docManager = new DocManager(storageManager, await getGlobalPluginManager(),
                                     dbManager, {
                                       ...createDummyGristServer(),
                                       getStorageManager() { return storageManager; },
                                     });
  }

  // Simulates doc worker shutdown.  Closes all open documents.
  public async end() {
    if (this._active) {
      await this.docManager.shutdownAll();
    }
    this._active = false;
  }

  // Close a single doc.  The server does this for docs that are not open by
  // any client.
  public async closeDoc(doc: ActiveDoc) {
    await doc.shutdown();
  }

  // Waits for any required S3 pushes to have completed.
  public async waitForUpdates(): Promise<boolean> {
    for (let i = 0; i < 50; i++) {
      if (!this.storageManager.needsUpdate()) {
        return true;
      }
      await bluebird.delay(100);
    }
    log.error("waitForUpdates failed");
    return false;
  }

  // Wipes the doc worker's local document store.
  public async removeAll(): Promise<void> {
    const fnames = await fse.readdir(this._localDirectory);
    await Promise.all(fnames.map(fname => {
      return fse.remove(path.join(this._localDirectory, fname));
    }));
  }

  public getDocPath(docId: string) {
    return path.join(this._localDirectory, `${docId}.grist`);
  }
}


describe('HostedStorageManager', function() {

  setTmpLogLevel('info');  // allow info messages for this test since failures are hard to replicate
  this.timeout(60000);     // s3 can be slow

  const docSession = makeExceptionalDocSession('system');

  before(async function() {
    setUpDB(this);
    await createInitialDb();
  });

  after(async function() {
    await removeConnection();
  });

  for (const storage of ['azure', 's3', 'minio', 'cached'] as const) {
    describe(storage, function() {

      const sandbox = sinon.createSandbox();
      let oldEnv: EnvironmentSnapshot;

      const workerId = 'dw17';
      let cli: RedisClient;
      let store: TestStore;
      let workers: DocWorkerMap;
      let tmpDir: string;

      before(async function() {
        if (!process.env.TEST_REDIS_URL) { this.skip(); return; }
        cli = createClient(process.env.TEST_REDIS_URL);
        oldEnv = new EnvironmentSnapshot();
        await cli.flushdbAsync();
        workers = new DocWorkerMap([cli]);
        await workers.addWorker({
          id: workerId,
          publicUrl: 'notset',
          internalUrl: 'notset',
        });
        await workers.setWorkerAvailability(workerId, true);

        await workers.assignDocWorker('Hello');
        await workers.assignDocWorker('Hello2');

        tmpDir = await createTmpDir();

        let externalStorageCreate: (purpose: 'doc'|'meta', extraPrefix: string) => ExternalStorage|undefined;
        function requireStorage<T>(storage: T|undefined): T {
          if (storage === undefined) { throw new Error('storage not found'); }
          return storage;
        }
        switch (storage) {
          case 'cached': {
            // Make an in-memory store that is slow and aggressively cached.
            // This tickles a lot of cases that occasionally happen with s3.
            let ext: ExternalStorage = new SimpleExternalStorage("bucket");
            ext = new CachedExternalStorage(ext, 1000);
            ext = new SlowExternalStorage(ext, 250);
            // Everything is stored in fields of these objects, so the tests mustn't recreate them repeatedly.
            externalStorageCreate = (purpose) => wrapWithKeyMappedStorage(ext, {purpose, basePrefix: 'prefix'});
            break;
          }
          case 'azure':
            if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
              this.skip();
            }
            externalStorageCreate = requireStorage(create.getStorageOptions?.('azure')?.create);
            break;
          case 'minio':
            if (!process.env.GRIST_DOCS_MINIO_ACCESS_KEY) {
              this.skip();
            }
            externalStorageCreate = requireStorage(create.getStorageOptions?.('minio')?.create);
            break;
          case 's3':
            if (!process.env.TEST_S3_BUCKET) {
              this.skip();
            }
            externalStorageCreate = requireStorage(create.getStorageOptions?.('s3')?.create);
            break;
        }
        store = new TestStore(tmpDir, workerId, workers, externalStorageCreate);
      });

      after(async function() {
        await store?.storageManager.testStopOperations();
        await workers?.removeWorker(workerId);
        await cli?.quitAsync();
      });

      beforeEach(function() {
        sandbox.spy(HostedStorageManager.prototype, 'markAsChanged');
      });

      afterEach(async function() {
        oldEnv.restore();
        sandbox.restore();
        if (store) {
          await store.end();
          await store.removeAll();
        }
      });

      async function getRedisChecksum(docId: string): Promise<string> {
        return (await cli.getAsync(`doc-${docId}-checksum`)) || '';
      }

      async function setRedisChecksum(docId: string, checksum: string): Promise<'OK'> {
        return cli.setAsync(`doc-${docId}-checksum`, checksum);
      }

      async function dropAllChecksums() {
        // `keys` is a potentially slow, unrecommended operation - but ok in test scenario
        // against a test instance of redis.
        for (const key of await cli.keysAsync('*-checksum')) {
          await cli.delAsync(key);
        }
      }

      it('can create a fresh empty document', async function() {
        const docId = `create-${uuidv4()}`;
        await workers.assignDocWorker(docId);
        assert.equal(await getRedisChecksum(docId), 'null');

        // Create an empty document when checksum in redis is 'null'.
        const checksum = await store.run(async () => {
          await store.docManager.fetchDoc(docSession, docId);
          assert(await store.waitForUpdates());
          const checksum = await getRedisChecksum(docId);
          assert.notEqual(checksum, 'null');
          return checksum;
        });

        // Check what happens when we nobble the expected checksum.
        await setRedisChecksum(docId, 'nobble');
        await store.removeAll();

        // With GRIST_SKIP_REDIS_CHECKSUM_MISMATCH set, the fetch should work
        process.env.GRIST_SKIP_REDIS_CHECKSUM_MISMATCH = 'true';
        await store.run(async () => {
          await assert.isFulfilled(store.docManager.fetchDoc(docSession, docId));
        });

        // By default, the fetch should eventually errors.
        delete process.env.GRIST_SKIP_REDIS_CHECKSUM_MISMATCH;
        await store.run(async () => {
          await assert.isRejected(store.docManager.fetchDoc(docSession, docId),
                                  /operation failed to become consistent/);
        });

        // Check we get the document back on fresh start if checksum is correct.
        await setRedisChecksum(docId, checksum);
        await store.removeAll();
        await store.run(async () => {
          await store.docManager.fetchDoc(docSession, docId);
        });
      });

      it('can save modifications', async function() {
        await store.run(async () => {
          await workers.assignDocWorker('Hello');
          await useFixtureDoc('Hello.grist', store.storageManager);

          await workers.assignDocWorker('Hello2');

          const doc = await store.docManager.fetchDoc(docSession, 'Hello');
          const doc2 = await store.docManager.fetchDoc(docSession, 'Hello2');
          await doc.docStorage.exec("update Table1 set A = 'magic_word' where id = 1");
          await doc2.docStorage.exec("insert into Table1(id) values(42)");
          return { doc, doc2 };
        });

        await store.removeAll();

        await store.run(async () => {
          const doc = await store.docManager.fetchDoc(docSession, 'Hello');
          let result = await doc.docStorage.get("select A from Table1 where id = 1");
          assert.equal(result!.A, 'magic_word');
          const doc2 = await store.docManager.fetchDoc(docSession, 'Hello2');
          result = await doc2.docStorage.get("select id from Table1");
          assert.equal(result!.id, 42);
        });
      });

      it('can save modifications with interfering backup file', async function() {
        await store.run(async () => {
          // There was a bug where if a corrupt/truncated backup file was created, all future
          // backups would fail.  This tickles the condition and makes sure backups now succeed.
          await fse.writeFile(path.join(tmpDir, 'Hello.grist-backup'), 'not a sqlite file');

          await workers.assignDocWorker('Hello');
          await useFixtureDoc('Hello.grist', store.storageManager);

          const doc = await store.docManager.fetchDoc(docSession, 'Hello');
          await doc.docStorage.exec("update Table1 set A = 'magic_word2' where id = 1");
        });

        // S3 should have happened after store.run()

        await store.removeAll();
        await store.run(async () => {
          const doc = await store.docManager.fetchDoc(docSession, 'Hello');
          const result = await doc.docStorage.get("select A from Table1 where id = 1");
          assert.equal(result!.A, 'magic_word2');
        });
      });

      it('survives if there is a doc marked dirty that turns out to be clean', async function() {
        await store.run(async () => {
          await workers.assignDocWorker('Hello');
          await useFixtureDoc('Hello.grist', store.storageManager);

          const doc = await store.docManager.fetchDoc(docSession, 'Hello');
          await doc.docStorage.exec("update Table1 set A = 'magic_word' where id = 1");
        });

        await store.removeAll();

        await store.run(async () => {
          const doc = await store.docManager.fetchDoc(docSession, 'Hello');
          const result = await doc.docStorage.get("select A from Table1 where id = 1");
          assert.equal(result!.A, 'magic_word');
          store.docManager.markAsChanged(doc);
        });

        // The real test is whether this test manages to complete.
      });

      it('serializes parallel opening of same document', async function() {
        await workers.assignDocWorker('Hello');

        // put a doc in s3
        await store.run(async () => {
          await useFixtureDoc('Hello.grist', store.storageManager);
          const doc = await store.docManager.fetchDoc(docSession, 'Hello');
          await doc.docStorage.exec("update Table1 set A = 'parallel' where id = 1");
        });

        // now open it many times in parallel
        await store.removeAll();
        await store.run(async () => {
          const docs = Promise.all([
            store.docManager.fetchDoc(docSession, 'Hello'),
            store.docManager.fetchDoc(docSession, 'Hello'),
            store.docManager.fetchDoc(docSession, 'Hello'),
            store.docManager.fetchDoc(docSession, 'Hello'),
          ]);
          await assert.isFulfilled(docs);
          const doc = (await docs)[0];
          const result = await doc.docStorage.get("select A from Table1 where id = 1");
          assert.equal(result!.A, 'parallel');
        });

        // To be sure we are checking something, let's call prepareLocalDoc directly
        // on storage manager and make sure it fails.
        await store.removeAll();
        await store.run(async () => {
          const preps = Promise.all([
            store.storageManager.prepareLocalDoc('Hello'),
            store.storageManager.prepareLocalDoc('Hello'),
            store.storageManager.prepareLocalDoc('Hello'),
            store.storageManager.prepareLocalDoc('Hello')
          ]);
          await assert.isRejected(preps, /in parallel/);
        });
      });

      it ('can delete a document', async function() {
        const docId = `create-${uuidv4()}`;
        await workers.assignDocWorker(docId);

        // Create a document
        await store.run(async () => {
          const doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.docStorage.exec("insert into Table1(id) values(42)");
        });

        const docPath = store.getDocPath(docId);
        const ext = store.storageManager.testGetExternalStorage();

        // Check that the document exists on filesystem and in external store.
        await store.run(async () => {
          const doc = await store.docManager.fetchDoc(docSession, docId);
          assert.equal(await fse.pathExists(docPath), true);
          assert.equal(await fse.pathExists(docPath + '-hash-doc'), true);
          await waitForIt(async () => assert.equal(await ext.exists(docId), true), 20000);
          await doc.docStorage.exec("insert into Table1(id) values(43)");

          // Now delete the document, and check it no longer exists on filesystem or external store.
          await store.docManager.deleteDoc(null, docId, true);
          assert.equal(await fse.pathExists(docPath), false);
          assert.equal(await fse.pathExists(docPath + '-hash-doc'), false);
          assert.equal(await getRedisChecksum(docId), DELETED_TOKEN);
          await waitForIt(async () => assert.equal(await ext.exists(docId), false), 20000);
        });

        // As far as the underlying storage is concerned it should be
        // possible to recreate a doc with the same id after deletion.
        // This should not happen in Grist, since in order to open a
        // document it must exist in the db - however we'll need to watch
        // out for caching.
        // TODO: it could be worth tweaking fetchDoc so creation is explicit.
        await store.run(async () => {
          const doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.docStorage.exec("insert into Table1(id) values(42)");
        });

        await store.run(async () => {
          await store.docManager.fetchDoc(docSession, docId);
          assert.equal(await fse.pathExists(docPath), true);
          assert.equal(await fse.pathExists(docPath + '-hash-doc'), true);
        });
      });

      it('individual document close is orderly', async function() {
        const docId = `create-${uuidv4()}`;
        await workers.assignDocWorker(docId);

        await store.run(async () => {
          let doc = await store.docManager.fetchDoc(docSession, docId);
          await store.closeDoc(doc);
          const checksum1 = await getRedisChecksum(docId);
          assert.notEqual(checksum1, 'null');

          doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.docStorage.exec("insert into Table1(id) values(42)");

          // Add an attachment file with no corresponding metadata. It should be deleted when shutting down.
          await doc.docStorage.exec("insert into _gristsys_Files(id, ident) values(23, 'foo')");
          let files = await doc.docStorage.all("select * from _gristsys_Files");
          assert.isNotEmpty(files);

          await store.closeDoc(doc);
          const checksum2 = await getRedisChecksum(docId);
          assert.notEqual(checksum1, checksum2);

          doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.docStorage.exec("insert into Table1(id) values(43)");

          // Attachment file should have been deleted on previous close.
          files = await doc.docStorage.all("select * from _gristsys_Files");
          assert.isEmpty(files);

          const asyncClose = store.closeDoc(doc);  // this time, don't explicitly wait for closeDoc.
          doc = await store.docManager.fetchDoc(docSession, docId);
          const checksum3 = await getRedisChecksum(docId);
          assert.notEqual(checksum2, checksum3);
          await asyncClose;
        });
      });

      // Viewing a document should not mark it as changed (unless a document-level migration
      // needed to run).
      it('viewing a document does not generally change it', async function() {
        const docId = `create-${uuidv4()}`;
        await workers.assignDocWorker(docId);

        await store.run(async () => {
          const markAsChanged: {callCount: number} = store.storageManager.markAsChanged as any;

          const changesInitial = markAsChanged.callCount;
          let doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.waitForInitialization();
          await store.closeDoc(doc);
          const changesAfterCreation = markAsChanged.callCount;
          assert.isAbove(changesAfterCreation, changesInitial);

          doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.waitForInitialization();
          await store.closeDoc(doc);
          const changesAfterViewing = markAsChanged.callCount;
          assert.equal(changesAfterViewing, changesAfterCreation);
        });
      });

      it('can fork documents', async function() {
        const docId = `create-${uuidv4()}`;
        const forkId = `${docId}~fork1`;
        await workers.assignDocWorker(docId);
        await workers.assignDocWorker(forkId);

        await store.run(async () => {
          await useFixtureDoc('Hello.grist', store.storageManager, `${docId}.grist`);
          const doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.docStorage.exec("update Table1 set A = 'trunk' where id = 1");
        });

        await store.run(async () => {
          await store.docManager.storageManager.prepareFork(docId, forkId);
          const doc = await store.docManager.fetchDoc(docSession, forkId);
          assert.equal('trunk', (await doc.docStorage.get("select A from Table1 where id = 1"))!.A);
          await doc.docStorage.exec("update Table1 set A = 'fork' where id = 1");
        });

        await store.removeAll();

        await store.run(async () => {
          let doc = await store.docManager.fetchDoc(docSession, docId);
          assert.equal('trunk', (await doc.docStorage.get("select A from Table1 where id = 1"))!.A);
          doc = await store.docManager.fetchDoc(docSession, forkId);
          assert.equal('fork', (await doc.docStorage.get("select A from Table1 where id = 1"))!.A);
        });

        // Check that the trunk can be replaced by a fork
        await store.removeAll();
        await store.run(async () => {
          await store.storageManager.replace(docId, {sourceDocId: forkId});
          const doc = await store.docManager.fetchDoc(docSession, docId);
          assert.equal('fork', (await doc.docStorage.get("select A from Table1 where id = 1"))!.A);
        });
      });

      it('can persist a fork with no modifications', async function() {
        const docId = `create-${uuidv4()}`;
        const forkId = `${docId}~fork1`;
        await workers.assignDocWorker(docId);
        await workers.assignDocWorker(forkId);

        // Create a document.
        await store.run(async () => {
          await useFixtureDoc('Hello.grist', store.storageManager, `${docId}.grist`);
          const doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.docStorage.exec("update Table1 set A = 'trunk' where id = 1");
        });

        // Create a fork with no modifications.
        await store.run(async () => {
          await store.docManager.storageManager.prepareFork(docId, forkId);
        });
        await store.waitForUpdates();
        await store.removeAll();

        // Zap local copy of fork.
        await fse.remove(store.getDocPath(docId));

        // Make sure opening the fork works as expected.
        await store.run(async () => {
          const doc = await store.docManager.fetchDoc(docSession, forkId);
          assert.equal('trunk', (await doc.docStorage.get("select A from Table1 where id = 1"))!.A);
        });
        await store.removeAll();
      });

      it('can access snapshots', async function() {
        // Keep number of forks less than 5 so pruning doesn't kick in.
        const forks = 4;

        const docId = `create-${uuidv4()}`;
        const forkId1 = `${docId}~fork1`;
        const forkId2 = `${docId}~fork2`;
        const forkId3 = `${docId}~fork3`;
        await workers.assignDocWorker(docId);
        await workers.assignDocWorker(forkId1);
        await workers.assignDocWorker(forkId2);
        await workers.assignDocWorker(forkId3);

        const doc = await store.run(async () => {
          await useFixtureDoc('Hello.grist', store.storageManager, `${docId}.grist`);
          const doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.waitForInitialization();
          for (let i = 0; i < forks; i++) {
            await doc.docStorage.exec(`update Table1 set A = 'v${i}' where id = 1`);
            await doc.testKeepOpen();
            await store.waitForUpdates();
          }
          return doc;
        });

        const {snapshots} = await store.storageManager.getSnapshots(doc.docName);
        assert.isAtLeast(snapshots.length, forks + 1);  // May be 1 greater depending on how long
        // it takes to run initial migrations.
        await store.run(async () => {
          for (let i = forks - 1; i >= 0; i--) {
            const snapshot = snapshots.shift()!;
            const forkId = snapshot.docId;
            await workers.assignDocWorker(forkId);
            const doc = await store.docManager.fetchDoc(docSession, forkId);
            assert.equal(`v${i}`, (await doc.docStorage.get("select A from Table1 where id = 1"))!.A);
          }
        });
      });

      it('can access snapshots with old schema versions', async function() {
        const snapshotId = `World~v=1`;
        await workers.assignDocWorker(snapshotId);
        await store.run(async () => {
          // Pretend we have a snapshot of World-v33.grist and fetch/load it.
          await useFixtureDoc('World-v33.grist', store.storageManager, `${snapshotId}.grist`);
          const doc = await store.docManager.fetchDoc(docSession, snapshotId);

          // Check that the snapshot isn't broken.
          assert.doesNotThrow(async () => await doc.waitForInitialization());

          // Check that the snapshot was migrated to the latest schema version.
          assert.equal(
            SCHEMA_VERSION,
            (await doc.docStorage.get("select schemaVersion from _grist_DocInfo where id = 1"))!.schemaVersion
          );

          // Check that the document is actually a snapshot.
          await assert.isRejected(doc.replace(docSession, {sourceDocId: 'docId'}),
            /Snapshots cannot be replaced/);
          await assert.isRejected(doc.applyUserActions(docSession, [['AddTable', 'NewTable', [{id: 'A'}]]]),
            /pyCall is not available in snapshots/);
        });
      });

      it('can prune snapshots', async function() {
        const versions = 8;

        const docId = `create-${uuidv4()}`;
        const doc = await store.run(async () => {
          await useFixtureDoc('Hello.grist', store.storageManager, `${docId}.grist`);
          const doc = await store.docManager.fetchDoc(docSession, docId);
          for (let i = 0; i < versions; i++) {
            await doc.docStorage.exec(`update Table1 set A = 'v${i}' where id = 1`);
            await doc.testKeepOpen();
            await store.waitForUpdates();
          }
          await store.storageManager.testWaitForPrunes();
          return doc;
        });
        await waitForIt(async () => {
          const {snapshots} = await store.storageManager.getSnapshots(doc.docName);
          // Should be keeping at least five, and then maybe 1 more if the hour changed
          // during the test.
          assert.isAtMost(snapshots.length, 6);
          assert.isAtLeast(snapshots.length, 5);
        }, 20000);
        await waitForIt(async () => {
          // Double check with external store directly.
          const snapshots = await store.storageManager.testGetExternalStorage().versions(doc.docName);
          assert.isAtMost(snapshots.length, 6);
          assert.isAtLeast(snapshots.length, 5);
        }, 20000);
      });

      for (const wipeLocal of [false, true]) {
        it (`can lose checksums without disruption with${wipeLocal ? '' : 'out'} local file wipe`, async function() {
          const docId = `create-${uuidv4()}`;
          await workers.assignDocWorker(docId);

          // Create a series of versions of a document, and fetch them sequentially
          // so that they are potentially available as stale values.
          await store.run(async () => {
            await useFixtureDoc('Hello.grist', store.storageManager, `${docId}.grist`);
            await store.docManager.fetchDoc(docSession, docId);
          });
          for (let i = 0; i < 3; i++) {
            await store.removeAll();
            await store.run(async () => {
              const doc = await store.docManager.fetchDoc(docSession, docId);
              if (i > 0) {
                const prev = await doc.docStorage.get("select A from Table1 where id = 1");
                assert.equal(prev!.A, `magic_word${i - 1}`);
              }
              await doc.docStorage.exec(`update Table1 set A = 'magic_word${i}' where id = 1`);
            });
          }

          // Wipe all checksums and make sure (1) we don't get any errors and (2) the
          // right version of the document shows up after a while.
          let result: string | undefined;
          await waitForIt(async () => {
            await dropAllChecksums();
            if (wipeLocal) {
              // Optionally wipe all local files.
              await store.removeAll();
            }
            await store.run(async () => {
              const doc = await store.docManager.fetchDoc(docSession, docId);
              result = (await doc.docStorage.get("select A from Table1 where id = 1"))?.A;
            });
            if (result !== 'magic_word2') {
              throw new Error(`inconsistent result: ${result}`);
            }
          }, 20000);
          assert.equal(result, 'magic_word2');
        });
      }

      it('can access metadata', async function() {
        const docId = `create-${uuidv4()}`;
        const { tz, h, doc } = await store.run(async () => {
          // Use a doc that's up-to-date on storage migrations, but needs a python schema migration.
          await useFixtureDoc('BlobMigrationV8.grist', store.storageManager, `${docId}.grist`);
          const doc = await store.docManager.fetchDoc(docSession, docId);
          await doc.waitForInitialization();
          const rec = await doc.fetchTable(makeExceptionalDocSession('system'), '_grist_DocInfo');
          const tz = rec.tableData[3].timezone[0];
          const h = (await doc.getRecentStates(makeExceptionalDocSession('system')))[0].h;
          await store.docManager.makeBackup(doc, 'hello');
          return { tz, h, doc };
        });
        const {snapshots} = await store.storageManager.getSnapshots(doc.docName);
        assert.equal(snapshots[0]?.metadata?.label, 'hello');
        // There can be extra snapshots, depending on timing.
        const prevSnapshotWithLabel = snapshots.find((s, idx) => idx > 0 && s.metadata?.label);
        assert.match(String(prevSnapshotWithLabel?.metadata?.label), /migrate-schema/);
        assert.equal(snapshots[0]?.metadata?.tz, String(tz));
        assert.equal(snapshots[0]?.metadata?.h, h);
      });
    });
  }
});

// This is a performance test, to check if the backup settings are plausible.
describe('backupSqliteDatabase', async function() {
  it('backups are robust to locking', async function() {
    // Takes some time to create large db and play with it.
    this.timeout(20000);

    const tmpDir = await createTmpDir();
    const src = path.join(tmpDir, "src.db");
    const dest = path.join(tmpDir, "dest.db");
    const db = await SQLiteDB.openDBRaw(src);
    await db.run("create table data(x,y,z)");
    await db.execTransaction(async () => {
      const stmt = await db.prepare("INSERT INTO data VALUES (?,?,?)");
      for (let i = 0; i < 10000; i++) {
        // Silly code to make a long random string to insert.
        // We can make a big db faster this way.
        const str = (new Array(100)).fill(1).map((_: any) => Math.random().toString(2)).join();
        await stmt.run(str, str, str);
      }
      await stmt.finalize();
    });
    const stat = await fse.stat(src);
    assert(stat.size > 150 * 1000 * 1000);
    let done: boolean = false;
    let eventStart: number = 0;
    let eventAction: string = "";
    let eventCount: number = 0;
    function progress(event: BackupEvent) {
      if (event.phase === 'after') {
        // Duration of backup action should never approach the default node-sqlite3 busy_timeout of 1s.
        // If it does, then user actions could be blocked.
        assert.equal(event.action, eventAction);
        assert.isBelow(Date.now() - eventStart, 100);
        eventCount++;
      } else if (event.phase === 'before') {
        eventStart = Date.now();
        eventAction = event.action;
      }
    }
    let backupError: Error|undefined;
    const act = backupSqliteDatabase(src, dest, progress).then(() => done = true)
      .catch((e) => { done = true; backupError = e; });
    assert(!done);
    // Try a series of insertions, to check that db never appears locked to us.
    for (let i = 0; i < 100; i++) {
      await bluebird.delay(10);
      try {
        await db.exec('INSERT INTO data VALUES (1,2,3)');
      } catch (e) {
        log.error('insertion failed, that is bad news, the db was locked for too long');
        throw e;
      }
    }
    assert(!done);

    // Lock the db up completely for a while.
    await db.exec('PRAGMA locking_mode = EXCLUSIVE');
    await db.exec('BEGIN EXCLUSIVE');
    await bluebird.delay(500);
    await db.exec('COMMIT');
    await db.exec('PRAGMA locking_mode = NORMAL');

    assert(!done);
    while (!done) {
      // Make sure regular queries don't get in the way of backup completing
      await db.all('select * from data limit 100');
      await bluebird.delay(100);
    }
    await act;
    if (backupError) { throw backupError; }

    // Make sure we are receiving backup events and checking their timing.
    assert.isAbove(eventCount, 100);

    // Finally, check the backup looks sane.
    const db2 = await SQLiteDB.openDBRaw(dest);
    assert.lengthOf(await db2.all('select rowid from data'), 10000 + 100);
  });
});
