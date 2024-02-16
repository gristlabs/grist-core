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
  describe('onWorkerUnavailable', () => {
    const baseWorkerInfo: DocWorkerInfo = {
      id: 'workerId',
      internalUrl: 'internalUrl',
      publicUrl: 'publicUrl',
      group: undefined
    };
    let unsubscribe: () => void | undefined;
    function fixtures() {
      const sismemberAsyncStub = sinon.stub();
      const stubDocWorkerMap = {
        _log: { error: sinon.stub(), info: sinon.stub() },
        _client: { sismemberAsync: sismemberAsyncStub }
      };
      const onUnavailabilitySpy = sinon.spy();
      return { onUnavailabilitySpy, stubDocWorkerMap, sismemberAsyncStub };
    }
    afterEach(() => unsubscribe?.());

    it('should monitor worker availability regularly', async () => {
      sandbox.useFakeTimers();
      const { stubDocWorkerMap, sismemberAsyncStub, onUnavailabilitySpy } = fixtures();
      sismemberAsyncStub.resolves(true);
      unsubscribe = DocWorkerMap.prototype.onWorkerUnavailable.call(
        stubDocWorkerMap, baseWorkerInfo, onUnavailabilitySpy
      );
      expect(sismemberAsyncStub.called).to.equal(false);

      await sandbox.clock.tickAsync(DocWorkerMap.MONITOR_AVAILABILITY_INTERVAL + 1);
      expect(sismemberAsyncStub.calledOnceWith('workers-available-default', baseWorkerInfo.id)).to.equal(true);

      await sandbox.clock.tickAsync(DocWorkerMap.MONITOR_AVAILABILITY_INTERVAL + 1);
      expect(sismemberAsyncStub.callCount).to.equal(2);

      expect(onUnavailabilitySpy.called).to.equal(false);
    });

    it('should log when it cannot join Redis', async () => {
      sandbox.useFakeTimers();
      const err = new Error('Cannot join Redis');
      const { stubDocWorkerMap, sismemberAsyncStub, onUnavailabilitySpy } = fixtures();

      sismemberAsyncStub.rejects(err);
      unsubscribe = DocWorkerMap.prototype.onWorkerUnavailable.call(
        stubDocWorkerMap, baseWorkerInfo, onUnavailabilitySpy
      );

      await sandbox.clock.tickAsync(DocWorkerMap.MONITOR_AVAILABILITY_INTERVAL + 1);

      expect(
        stubDocWorkerMap._log.error.calledWithMatch(/Presence checker failed/, baseWorkerInfo.id, err)
      ).to.equal(true);
    });

    it('should trigger callback when the worker is not available anymore', async () => {
      sandbox.useFakeTimers();
      const { stubDocWorkerMap, sismemberAsyncStub, onUnavailabilitySpy } = fixtures();
      sismemberAsyncStub.resolves(true);
      unsubscribe = DocWorkerMap.prototype.onWorkerUnavailable.call(
        stubDocWorkerMap, baseWorkerInfo, onUnavailabilitySpy
      );

      await sandbox.clock.tickAsync(DocWorkerMap.MONITOR_AVAILABILITY_INTERVAL + 1);

      expect(onUnavailabilitySpy.called).to.equal(false);

      sismemberAsyncStub.resolves(false);
      await sandbox.clock.tickAsync(DocWorkerMap.MONITOR_AVAILABILITY_INTERVAL + 1);

      expect(onUnavailabilitySpy.calledOnce).to.equal(true);
    });

    it('should not run watch for unavailability after unsubscription', async () => {
      sandbox.useFakeTimers();
      const { stubDocWorkerMap, sismemberAsyncStub, onUnavailabilitySpy } = fixtures();
      sismemberAsyncStub.resolves(true);

      unsubscribe = DocWorkerMap.prototype.onWorkerUnavailable.call(
        stubDocWorkerMap, baseWorkerInfo, onUnavailabilitySpy
      );

      await sandbox.clock.tickAsync(DocWorkerMap.MONITOR_AVAILABILITY_INTERVAL + 1);

      expect(
        stubDocWorkerMap._client.sismemberAsync.calledOnce
      ).to.equal(true);
      expect(stubDocWorkerMap._log.info.called).to.equal(false);

      unsubscribe();
      expect(stubDocWorkerMap._log.info.calledWithMatch(/Clearing presence checker/, baseWorkerInfo.id)).to.equal(true);
      stubDocWorkerMap._client.sismemberAsync.resetHistory();

      await sandbox.clock.tickAsync(DocWorkerMap.MONITOR_AVAILABILITY_INTERVAL + 1);
      expect(
        stubDocWorkerMap._client.sismemberAsync.called
      ).to.equal(false);
    });
  });
});
