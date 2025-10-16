import { getDocWorkerMap } from 'app/gen-server/lib/DocWorkerMap';
import { IMemoryLoadEstimator } from 'app/server/lib/DocManager';
import { Deps, DocWorkerLoadTracker } from 'app/server/lib/DocWorkerLoadTracker';
import { DocWorkerInfo, IDocWorkerMap } from 'app/server/lib/DocWorkerMap';

import fs from 'node:fs/promises';

import { assert } from 'chai';
import sinon from 'sinon';
import tmp from 'tmp-promise';

describe("DocWorkerLoadTracker", function () {
  let docWorkerLoadTracker: DocWorkerLoadTracker;
  let docWorkerMap: IDocWorkerMap;
  let getTotalMemoryUsedStub: sinon.SinonStub;
  const sandbox = sinon.createSandbox();
  const originalDeps = {...Deps};
  const docWorkerInfoMap: DocWorkerInfo = {
    id: 'some-id',
    internalUrl: 'http://grist-internal/dw/10.0.0.2/some-path',
    publicUrl: 'https://grist-public/some-path'
  };

  before(function () {
    docWorkerMap = getDocWorkerMap();
  });

  beforeEach(function () {
    getTotalMemoryUsedStub = sandbox.stub();
    const docManagerMock: IMemoryLoadEstimator = {
      getTotalMemoryUsedMB: getTotalMemoryUsedStub
    };

    docWorkerLoadTracker = new DocWorkerLoadTracker(
      docWorkerInfoMap,
      docWorkerMap,
      docManagerMock,
    );
    docWorkerLoadTracker.stop();
  });

  afterEach(function () {
    Object.assign(Deps, originalDeps);
    sandbox.restore();
  });

  describe('getLoad()', function () {
    let cleanupFiles: Array<() => {}> = [];
    const registerCleanup = (cleanup: () => Promise<void>) => cleanupFiles.push(cleanup);

    afterEach(function () {
      for (const cleanup of cleanupFiles) {
        cleanup();
      }
      cleanupFiles = [];
    });

    async function mockValueInFile(
      depsProperty: 'docWorkerMemoryCapacityPath'|'docWorkerMemoryUsagePath',
      value: number|string|undefined): Promise<void> {
      if (value !== undefined) {
        const {path, cleanup} = await tmp.file();
        registerCleanup(cleanup);
        Deps[depsProperty] = path;
        await fs.writeFile(path, value.toString(), 'utf-8');
      } else {
        Deps[depsProperty] = undefined;
      }
    }

    const bytesToMb = (val: number) => val * (1024 ** 2);

    for (const ctx of [{
      itMsg: 'should retrieve max memory using GRIST_DOC_WORKER_MAX_MEMORY_MB in priority',
      setup() {
        Deps.docWorkerMaxMemoryMB = 1024;
      },
      maxFromFile: bytesToMb(512),
      usedFromFile: bytesToMb(128),
      result: 128/1024
    }, {
      itMsg: 'should otherwise retrieve max memory using GRIST_DOC_WORKER_MAX_MEMORY_BYTES_PATH',
      maxFromFile: bytesToMb(512),
      usedFromFile: bytesToMb(128),
      result: 128/512,
    }, {
      itMsg: 'should consider value "max" in GRIST_DOC_WORKER_MAX_MEMORY_BYTES_PATH as Infinite',
      maxFromFile: 'max',
      usedFromFile: bytesToMb(128),
      result: 0,
    }, {
      itMsg: 'should consider having no load when no maximum is defined',
      usedFromFile: bytesToMb(128),
      result: 0,
    }, {
      itMsg: 'should let the DocManager compute an estimation of the memory used when '
        + 'GRIST_DOC_WORKER_USED_MEMORY_BYTES_PATH is not provided',
      setup() {
          getTotalMemoryUsedStub.returns(128);
      },
      maxFromFile: bytesToMb(512),
      result: 128/512
    }]) {
      it(ctx.itMsg, async function () {
        ctx.setup?.();
        await Promise.all([
          mockValueInFile('docWorkerMemoryUsagePath', ctx.usedFromFile),
          mockValueInFile('docWorkerMemoryCapacityPath', ctx.maxFromFile)
        ]);

        assert.equal(await docWorkerLoadTracker.getLoad(), ctx.result);
      });
    }

    it('should reject when the memory usage read from a file is not a number', async function () {
      await Promise.all([
        mockValueInFile('docWorkerMemoryUsagePath', 'Yikes, not a number'),
        mockValueInFile('docWorkerMemoryCapacityPath', bytesToMb(1024))
      ]);
      getTotalMemoryUsedStub.returns(512);

      await assert.isRejected(docWorkerLoadTracker.getLoad(), /Unexpected value .* found in file.*Yikes/);
    });

    it('should reject when the max memory available is specified but cannot be read', async function () {
      await mockValueInFile('docWorkerMemoryUsagePath', bytesToMb(512));
      Deps.docWorkerMemoryCapacityPath = '/this/path/leads/nowhere';

      await assert.isRejected(docWorkerLoadTracker.getLoad(), /ENOENT/);
    });
  });

  describe('interval runner', function () {
    let getLoadStub: sinon.SinonStub;
    let setWorkerLoadStub: sinon.SinonStub;
    let logErrorStub: sinon.SinonStub;
    beforeEach(function () {
      getLoadStub = sandbox.stub(docWorkerLoadTracker, 'getLoad').resolves(0);
      setWorkerLoadStub = sandbox.stub(docWorkerMap, 'setWorkerLoad').resolves(undefined);
      logErrorStub = sandbox.stub(docWorkerLoadTracker['_log'], 'error').returns(undefined);
    });

    const triggerTimer = () => docWorkerLoadTracker['_interval']['_onTimeoutTriggered']();

    it('should update the worker load when the timer is triggered', async function () {
      getLoadStub.resolves(0.42);
      await triggerTimer();
      assert.equal(setWorkerLoadStub.callCount, 1, 'setWorkerLoad should have been called to update the load value');
      assert.deepEqual(setWorkerLoadStub.firstCall.args, [docWorkerInfoMap, 0.42]);
    });

    it('should log an error when the worker load cannot be computed', async function () {
      const error = new Error('an error');
      getLoadStub.rejects(error);
      await triggerTimer();
      assert.equal(setWorkerLoadStub.callCount, 0, 'setWorkerLoad should not have been called');
      assert.include(logErrorStub.firstCall.args, error, 'the error should have been logged');
    });
  });
});
