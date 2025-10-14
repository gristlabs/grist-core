import { getDocWorkerMap } from 'app/gen-server/lib/DocWorkerMap';
import { IMemoryLoadEstimator } from 'app/server/lib/DocManager';
import { Deps, DocWorkerLoadTracker } from 'app/server/lib/DocWorkerLoadTracker';
import { DocWorkerInfo, IDocWorkerMap } from 'app/server/lib/DocWorkerMap';
import log from 'app/server/lib/log';

import fs from 'node:fs/promises';

import { assert } from 'chai';
import sinon from 'sinon';
import tmp from 'tmp-promise';

describe("DocWorkerLoadTracker", function () {
  let docWorkerLoadTracker: DocWorkerLoadTracker;
  let docWorkerMap: IDocWorkerMap;
  let getTotalMemoryUsedStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;
  const sandbox = sinon.createSandbox();
  const originalDeps = {...Deps};
  let cleanupFiles: Array<() => {}> = [];
  const docWorkerInfoMap: DocWorkerInfo = {
    id: 'some-id',
    internalUrl: 'http://grist-internal/dw/10.0.0.2/some-path',
    publicUrl: 'https://grist-public/some-path'
  };

  before(function () {
    docWorkerMap = getDocWorkerMap();
  });

  beforeEach(function () {
    errorStub = sandbox.stub(log, 'error');
    getTotalMemoryUsedStub = sandbox.stub();
    const docManagerMock: IMemoryLoadEstimator = {
      getTotalMemoryUsedMB: getTotalMemoryUsedStub
    };
    docWorkerLoadTracker = new DocWorkerLoadTracker(
      docWorkerInfoMap,
      docWorkerMap,
      docManagerMock,
    );
  });

  afterEach(function () {
    Object.assign(Deps, originalDeps);
    sandbox.restore();
  });

  describe('getLoad', function () {
    beforeEach(async function () {
      docWorkerLoadTracker.stop();
      const {path: max, cleanup: maxCleanup} = await tmp.file();
      const {path: used, cleanup: usedCleanup} = await tmp.file();
      cleanupFiles.push(maxCleanup, usedCleanup);
      Deps.docWorkerMemoryCapacityPath = max;
      Deps.docWorkerMemoryUsagePath = used;
    });

    afterEach(function () {
      for (const cleanup of cleanupFiles) {
        cleanup();
      }
      cleanupFiles = [];
    });

    async function mockValueInFile(
      depsProperty: 'docWorkerMemoryCapacityPath'|'docWorkerMemoryUsagePath',
      value: number|string|undefined): Promise<void> {
      if (value) {
        await fs.writeFile(Deps[depsProperty]!, value.toString(), 'utf-8');
      } else {
        Deps[depsProperty] = undefined;
      }
    }

    const bytesToMb = (val: number) => val * (1024 ** 2);

    for (const ctx of [{
      itMsg: 'should compute max memory using GRIST_DOC_WORKER_MAX_MEMORY_MB in priority',
      setup() {
        Deps.docWorkerMaxMemoryMB = 1024;
      },
      maxFromFile: bytesToMb(512),
      usedFromFile: bytesToMb(128),
      result: 128/1024
    }, {
      itMsg: 'should compute max memory using GRIST_DOC_WORKER_MAX_MEMORY_BYTES_PATH',
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
      itMsg: 'should read memory used using estimation from doc manager when '
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

    it('should permanently fallback to using the estimation from the doc manager ' +
      'when failing reading GRIST_DOC_WORKER_USED_MEMORY_BYTES_PATH', async function () {
        await Promise.all([
          mockValueInFile('docWorkerMemoryUsagePath', 'Yikes, not a number'),
          mockValueInFile('docWorkerMemoryCapacityPath', bytesToMb(1024))
        ]);
        getTotalMemoryUsedStub.returns(512);

        let val = await docWorkerLoadTracker.getLoad();

        assert.equal(val, 512/1024);
        assert.match(errorStub.firstCall.firstArg, /Unexpected value found in file/);

        errorStub.reset();
        await mockValueInFile('docWorkerMemoryUsagePath', 128);

        val = await docWorkerLoadTracker.getLoad();

        assert.equal(val, 512/1024);
        assert.isFalse(errorStub.called, "log.error should not have been called a second time");
      }
    );

    it('should permanently return a load of zero ' +
      'when failing reading GRIST_DOC_WORKER_MAX_MEMORY_BYTES_PATH', async function () {
        await mockValueInFile('docWorkerMemoryUsagePath', bytesToMb(512));
        await fs.rm(Deps.docWorkerMemoryCapacityPath!);

        let val = await docWorkerLoadTracker.getLoad();

        assert.equal(val, 0);
        assert.match(errorStub.firstCall.firstArg, /ENOENT/);

        errorStub.reset();
        await Promise.all([
          mockValueInFile('docWorkerMemoryUsagePath', bytesToMb(128)),
          mockValueInFile('docWorkerMemoryCapacityPath', bytesToMb(1024))
        ]);

        val = await docWorkerLoadTracker.getLoad();

        assert.equal(val, 0);
        assert.isFalse(errorStub.called, "log.error should not have been called a second time");
      }
    );
  });
});
