// Test for DocWorkerMap.ts

import { DocWorkerMap } from 'app/gen-server/lib/DocWorkerMap';
import { DocWorkerInfo } from 'app/server/lib/DocWorkerMap';
import {expect} from 'chai';
import sinon from 'sinon';

describe('DocWorkerMap', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => {
    sandbox.restore();
  });

  describe('isWorkerRegistered', () => {
    const baseWorkerInfo: DocWorkerInfo = {
      id: 'workerId',
      internalUrl: 'internalUrl',
      publicUrl: 'publicUrl',
      group: undefined
    };

    [
      {
        itMsg: 'should check if worker is registered',
        sisMemberAsyncResolves: 1,
        expectedResult: true,
        expectedKey: 'workers-available-default'
      },
      {
        itMsg: 'should check if worker is registered in a certain group',
        sisMemberAsyncResolves: 1,
        group: 'dummygroup',
        expectedResult: true,
        expectedKey: 'workers-available-dummygroup'
      },
      {
        itMsg: 'should return false if worker is not registered',
        sisMemberAsyncResolves: 0,
        expectedResult: false,
        expectedKey: 'workers-available-default'
      }
    ].forEach(ctx => {
      it(ctx.itMsg, async () => {
        const sismemberAsyncStub = sinon.stub().resolves(ctx.sisMemberAsyncResolves);
        const stubDocWorkerMap = {
          _client: { sismemberAsync: sismemberAsyncStub }
        };
        const result = await DocWorkerMap.prototype.isWorkerRegistered.call(
          stubDocWorkerMap, {...baseWorkerInfo, group: ctx.group }
        );
        expect(result).to.equal(ctx.expectedResult);
        expect(sismemberAsyncStub.calledOnceWith(ctx.expectedKey, baseWorkerInfo.id)).to.equal(true);
      });
    });
  });
});
