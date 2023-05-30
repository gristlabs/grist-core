import log from 'app/server/lib/log';

/**
 * WorkCoordinator is a helper to do work serially. It takes a doWork() callback which may either
 * do some work and return a Promise, or report no work to be done by returning null. After work
 * completes, doWork() will be called again; when idle, ping() should be called to retry doWork().
 */
export class WorkCoordinator {
  private _doWorkCB: () => Promise<void>|null;
  private _tryNextStepCB: () => void;
  private _isStepRunning: boolean = false;
  private _isStepScheduled: boolean = false;

  /**
   * The doWork() callback will be called on ping() and whenever previous doWork() promise
   * succeeds. If doWork() had nothing to do, it should return null, and will not be called again
   * until the next ping().
   *
   * Note that doWork() should never fail. If it does, exceptions and rejections will be caught
   * and logged, and WorkCoordinator will not be called again until the next ping().
   */
  constructor(doWork: () => Promise<void>|null) {
    this._doWorkCB = doWork;
    this._tryNextStepCB = () => this._tryNextStep();   // bound version of _tryNextStep.
  }

  /**
   * Attempt doWork() again. If doWork() is currently running, it will be attempted again on
   * completion even if the current run fails.
   */
  public ping(): void {
    if (!this._isStepScheduled) {
      this._isStepScheduled = true;
      this._maybeSchedule();
    }
  }

  private async _tryNextStep(): Promise<void> {
    this._isStepScheduled = false;
    if (!this._isStepRunning) {
      this._isStepRunning = true;
      try {
        const work = this._doWorkCB();
        if (work) {
          await work;
          // Only schedule the next step if some work was done. If _doWorkCB() did nothing, or
          // failed, _doWorkCB() will only be called when an external ping() triggers it.
          this._isStepScheduled = true;
        }
      } catch (err) {
        // doWork() should NOT fail. If it does, we log the error here, and stop scheduling work
        // as if there is no more work to be done.
        log.error("WorkCoordinator: error in doWork()", err);
      } finally {
        this._isStepRunning = false;
        this._maybeSchedule();
      }
    }
  }

  private _maybeSchedule() {
    if (this._isStepScheduled && !this._isStepRunning) {
      try {
        setImmediate(this._tryNextStepCB);
      } catch (e) {
        // setImmediate may not be available outside node.
        setTimeout(this._tryNextStepCB, 0);
      }
    }
  }
}
