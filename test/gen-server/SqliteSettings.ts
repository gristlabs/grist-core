import {UserAPI} from 'app/common/UserAPI';
import {assert} from 'chai';
import * as fse from 'fs-extra';
import {TestServer} from 'test/gen-server/apiUtils';
import * as testUtils from 'test/server/testUtils';
import {EnvironmentSnapshot} from 'test/server/testUtils';

describe('SqliteSettings', function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel('warn');

  let home: TestServer;
  let api: UserAPI;
  let oldEnv: EnvironmentSnapshot;

  for (const externalStorage of [true, false] as const) {

    for (const mode of ['', 'sync', 'wal'] as const) {

      describe(`mode ${mode || 'default'}, externalStorage ${externalStorage}`, function() {

        before(async function() {
          this.timeout(60000);
          oldEnv = new EnvironmentSnapshot();
          process.env.GRIST_SQLITE_MODE = mode;
          if (externalStorage && !process.env.GRIST_DOCS_MINIO_BUCKET &&
              !process.env.GRIST_DOCS_S3_PREFIX) {
            this.skip();
          }
          home = new TestServer(this);
          await home.start(['home', 'docs'], {}, {
            externalStorage,
          });
          api = await home.createHomeApi('Support', 'docs');
        });

        after(async function() {
          await home?.stop();
          oldEnv.restore();
        });

        it('has expected files', async function() {
          const wsId = await api.newWorkspace({name: 'test'}, 'current');
          const docId = await api.newDoc({name: 'test'}, wsId);
          await api.getDocAPI(docId).addRows('Table1', {
            A: ['test1', 'test2'],
          });
          assert.deepEqual((await api.getDocAPI(docId).getRows('Table1')).A,
                           ['test1', 'test2']);
          const docPath = (await home.server.getDocManager().getActiveDoc(docId))?.docStorage.docPath;
          if (!docPath) { throw new Error('doc should exist'); }
          assert.equal(await fse.pathExists(docPath), true);
          assert.equal(await fse.pathExists(docPath + '-shm'), mode === 'wal');
          assert.equal(await fse.pathExists(docPath + '-wal'), mode === 'wal');
        });

        it('forks correctly', async function() {
          const wsId = await api.newWorkspace({name: 'test'}, 'current');
          const docId = await api.newDoc({name: 'test'}, wsId);
          await api.getDocAPI(docId).addRows('Table1', {
            A: ['test1', 'test2'],
          });
          assert.deepEqual((await api.getDocAPI(docId).getRows('Table1')).A,
                           ['test1', 'test2']);
          const fork = await api.getDocAPI(docId).fork();
          assert.include(fork.docId, '~');
          assert.deepEqual((await api.getDocAPI(fork.docId).getRows('Table1')).A,
                           ['test1', 'test2']);
          const storage = home.server.getStorageManager();
          const snapshots = storage.getSnapshotProgress(docId);
          if (externalStorage) {
            assert.isAtLeast(snapshots.pushes, 1);
          }
 else {
            assert.equal(snapshots.pushes, 0);
          }
        });

        it('copies correctly', async function() {
          const wsId = await api.newWorkspace({name: 'test'}, 'current');
          const docId = await api.newDoc({name: 'test'}, wsId);
          await api.getDocAPI(docId).addRows('Table1', {
            A: ['test1', 'test2'],
          });
          assert.deepEqual((await api.getDocAPI(docId).getRows('Table1')).A,
                           ['test1', 'test2']);
          const copyDocId = await api.copyDoc(docId, wsId, {
            documentName: 'copy',
          });
          assert.notEqual(copyDocId, docId);
          assert.deepEqual((await api.getDocAPI(copyDocId).getRows('Table1')).A,
                           ['test1', 'test2']);
        });
      });
    }
  }
});
