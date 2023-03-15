import {Role} from 'app/common/roles';
import {getDocWorkerMap} from 'app/gen-server/lib/DocWorkerMap';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {DummyAuthorizer} from 'app/server/lib/Authorizer';
import {DocManager} from 'app/server/lib/DocManager';
import {DocSession, makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {DocStorageManager} from 'app/server/lib/DocStorageManager';
import {createDummyGristServer, GristServer} from 'app/server/lib/GristServer';
import {IDocStorageManager} from 'app/server/lib/IDocStorageManager';
import {getAppRoot} from 'app/server/lib/places';
import {PluginManager} from 'app/server/lib/PluginManager';
import {createTmpDir as createTmpUploadDir, FileUploadInfo, globalUploadSet} from 'app/server/lib/uploads';
import * as testUtils from 'test/server/testUtils';

import {assert} from 'chai';
import * as fse from 'fs-extra';
import {tmpdir} from 'os';
import * as path from 'path';
import * as tmp from 'tmp';

tmp.setGracefulCleanup();

// it is sometimes useful in debugging to turn off automatic cleanup of docs and workspaces.
const noCleanup = Boolean(process.env.NO_CLEANUP);

/**
 * Use from a test suite to get an object with convenient methods for creating ActiveDocs:
 *
 *  createDoc(docName): creates a new empty document.
 *  loadFixtureDoc(docName): loads a copy of a fixture document.
 *  loadDoc(docName): loads a given document, e.g. previously created with createDoc().
 *  createFakeSession(): creates a fake DocSession for use when applying user actions.
 *
 * Also available are accessors for the created "managers":
 *  getDocManager()
 *  getStorageManager()
 *  getPluginManager()
 *
 * It also takes care of cleaning up any created ActiveDocs.
 * @param persistAcrossCases Don't shut down created ActiveDocs between test cases.
 * @param useFixturePlugins Use the plugins in `test/fixtures/plugins`
 */
export function createDocTools(options: {persistAcrossCases?: boolean,
                                         useFixturePlugins?: boolean,
                                         storageManager?: IDocStorageManager,
                                         server?: () => GristServer} = {}) {
  let tmpDir: string;
  let docManager: DocManager;

  async function doBefore() {
    tmpDir = await createTmpDir();
    const pluginManager = options.useFixturePlugins ? await createFixturePluginManager() : undefined;
    docManager = await createDocManager({tmpDir, pluginManager, storageManager: options.storageManager,
                                         server: options.server?.()});
  }

  async function doAfter() {
    // Clean up at the end of the test suite (in addition to the optional per-test cleanup).
    await testUtils.captureLog('info', () => docManager.shutdownAll());
    assert.equal(docManager.numOpenDocs(), 0);
    await globalUploadSet.cleanupAll();

    // Clean up the temp directory.
    if (!noCleanup) {
      await fse.remove(tmpDir);
    }
  }

  // Allow using outside of mocha
  if (typeof before !== "undefined") {
    before(doBefore);
    after(doAfter);

    // Check after each test case that all ActiveDocs got shut down.
    afterEach(async function() {
      if (!options.persistAcrossCases) {
        await docManager.shutdownAll();
        assert.equal(docManager.numOpenDocs(), 0);
      }
    });
  }

  const systemSession = makeExceptionalDocSession('system');
  return {
    /** create a fake session for use when applying user actions to a document */
    createFakeSession(role: Role = 'editors'): DocSession {
      return {client: null, authorizer: new DummyAuthorizer(role, 'doc')} as any as DocSession;
    },

    /** create a throw-away, empty document for testing purposes */
    async createDoc(docName: string): Promise<ActiveDoc> {
      return docManager.createNewEmptyDoc(systemSession, docName);
    },

    /** load a copy of a fixture document for testing purposes */
    async loadFixtureDoc(docName: string): Promise<ActiveDoc> {
      const copiedDocName = await testUtils.useFixtureDoc(docName, docManager.storageManager);
      return this.loadDoc(copiedDocName);
    },

    /** load a copy of a local document at an arbitrary path on disk for testing purposes */
    async loadLocalDoc(srcPath: string): Promise<ActiveDoc> {
      const copiedDocName = await testUtils.useLocalDoc(srcPath, docManager.storageManager);
      return this.loadDoc(copiedDocName);
    },

    /** like `loadFixtureDoc`, but lets you rename the document on disk */
    async loadFixtureDocAs(docName: string, alias: string): Promise<ActiveDoc> {
      const copiedDocName = await testUtils.useFixtureDoc(docName, docManager.storageManager, alias);
      return this.loadDoc(copiedDocName);
    },

    /** Loads a given document, e.g. previously created with createDoc() */
    async loadDoc(docName: string): Promise<ActiveDoc> {
      return docManager.fetchDoc(systemSession, docName);
    },

    getDocManager() { return docManager; },
    getStorageManager() { return docManager.storageManager; },
    getPluginManager() { return docManager.pluginManager; },

    /** Setup that needs to be done before using the tools, typically called by mocha */
    before() { return doBefore(); },

    /** Teardown that needs to be done after using the tools, typically called by mocha */
    after() { return doAfter(); },
  };
}

/**
 * Returns a DocManager for tests, complete with a PluginManager and DocStorageManager.
 * @param options.pluginManager The PluginManager to use; defaults to using a real global singleton
 *    that loads built-in modules.
 */
export async function createDocManager(
    options: {tmpDir?: string, pluginManager?: PluginManager,
              storageManager?: IDocStorageManager,
              server?: GristServer} = {}): Promise<DocManager> {
  // Set Grist home to a temporary directory, and wipe it out on exit.
  const tmpDir = options.tmpDir || await createTmpDir();
  const docStorageManager = options.storageManager || new DocStorageManager(tmpDir);
  const pluginManager = options.pluginManager || await getGlobalPluginManager();
  const store = getDocWorkerMap();
  const internalPermitStore = store.getPermitStore('1');
  const externalPermitStore = store.getPermitStore('2');
  return new DocManager(docStorageManager, pluginManager, null, options.server || {
    ...createDummyGristServer(),
    getPermitStore() { return internalPermitStore; },
    getExternalPermitStore() { return externalPermitStore; },
    getStorageManager() { return docStorageManager; },
  });
}

export async function createTmpDir(): Promise<string> {
  const tmpRootDir = process.env.TESTDIR || tmpdir();
  await fse.mkdirs(tmpRootDir);
  return fse.realpath(await tmp.dirAsync({
    dir: tmpRootDir,
    prefix: 'grist_test_',
    unsafeCleanup: true,
    keep: noCleanup,
  }));
}

/**
 * Creates a file with the given name (and simple dummy content) in dirPath, and returns
 * FileUploadInfo for it.
 */
export async function createFile(dirPath: string, name: string): Promise<FileUploadInfo> {
  const absPath = path.join(dirPath, name);
  await fse.outputFile(absPath, `${name}:${name}\n`);
  return {
    absPath,
    origName: name,
    size: (await fse.stat(absPath)).size,
    ext: path.extname(name),
  };
}

/**
 * Creates an upload with the given filenames (containg simple dummy content), in the
 * globalUploadSet, and returns its uploadId. The upload is registered with the given accessId
 * (userId), and the same id must be used to retrieve it.
 */
export async function createUpload(fileNames: string[], accessId: string|null): Promise<number> {
  const {tmpDir, cleanupCallback} = await createTmpUploadDir({});
  const files = await Promise.all(fileNames.map((name) => createFile(tmpDir, name)));
  return globalUploadSet.registerUpload(files, tmpDir, cleanupCallback, accessId);
}


let _globalPluginManager: PluginManager|null = null;

// Helper to create a singleton PluginManager. This includes loading built-in plugins. Since most
// tests don't make any use of it, it's fine to reuse a single one. For tests that need a custom
// one, pass one into createDocManager().
export async function getGlobalPluginManager(): Promise<PluginManager> {
  if (!_globalPluginManager) {
    const appRoot = getAppRoot();
    _globalPluginManager = new PluginManager(appRoot);
    await _globalPluginManager.initialize();
  }
  return _globalPluginManager;
}

// Path to the folder where builtIn plugins leave in test/fixtures
export const builtInFolder = path.join(testUtils.fixturesRoot, 'plugins/builtInPlugins');

// Path to the folder where installed plugins leave in test/fixtures
export const installedFolder = path.join(testUtils.fixturesRoot, 'plugins/installedPlugins');

// Creates a plugin manager which loads the plugins in `test/fixtures/plugins`
async function createFixturePluginManager() {
  const p = new PluginManager(builtInFolder, installedFolder);
  p.appRoot =  getAppRoot();
  await p.initialize();
  return p;
}
