/**
 *
 * Simple CPU throttling implementation.
 *
 * For this setup, a sandbox attempting to use 100% of cpu over an
 * extended period will end up throttled, in the steady-state, to
 * 10% of cpu.
 *
 * Very simple mechanism to begin with.  "ctime" is measured for the
 * sandbox, being the cumulative time charged to the user (directly or
 * indirectly) by the OS for that process.  If the average increase in
 * ctime over a time period is over 10% (targetRate) of that time period,
 * throttling kicks in, and the process will be paused/unpaused via
 * signals on a duty cycle.
 *
 * Left for future work: more careful shaping of CPU throttling, and
 * factoring in a team-site level credit system or similar.
 *
 */

import * as pidusage from '@gristlabs/pidusage';
import * as log from 'app/server/lib/log';

/**
 * Parameters related to throttling.
 */
export interface ThrottleTiming {
  dutyCyclePositiveMs: number;        // when throttling, how much uninterrupted time to give
                                      // the process before pausing it.  The length of the
                                      // non-positive cycle is chosen to achieve the desired
                                      // cpu usage.
  samplePeriodMs: number;             // how often to sample cpu usage and update throttling
  targetAveragingPeriodMs: number;    // (rough) time span to average cpu usage over.
  minimumAveragingPeriodMs: number;   // minimum time span before throttling is considered.
                                      // No throttling will occur before a process has run
                                      // for at least this length of time.
  minimumLogPeriodMs: number;         // minimum time between log messages about throttling.
  targetRate: number;                 // when throttling, aim for this fraction of cpu usage
                                      // per unit time.
  maxThrottle: number;                // maximum ratio of negative duty cycle phases to
                                      // positive.
}

/**
 * Some parameters that seem reasonable defaults.
 */
const defaultThrottleTiming: ThrottleTiming = {
  dutyCyclePositiveMs: 50,
  samplePeriodMs: 1000,
  targetAveragingPeriodMs: 20000,
  minimumAveragingPeriodMs: 6000,
  minimumLogPeriodMs: 10000,
  targetRate: 0.25,
  maxThrottle: 10,
};

/**
 * A sample of cpu usage.
 */
interface MeterSample {
  time: number;           // time at which sample was made (as reported by Date.now())
  cpuDuration: number;    // accumulated "ctime" measured by pidusage
  offDuration: number;    // accumulated clock time for which process was paused (approximately)
}

/**
 * A throttling implementation for a process.  Supply a pid, and it will try to keep that
 * process from consuming too much cpu until stop() is called.
 */
export class Throttle {
  private _timing: ThrottleTiming;                         // overall timing parameters
  private _meteringInterval: NodeJS.Timeout | undefined;   // timer for cpu measurements
  private _dutyCycleTimeout: NodeJS.Timeout | undefined;   // driver for throttle duty cycle
  private _throttleFactor: number = 0;                     // relative length of paused phase
  private _sample: MeterSample | undefined;                // latest measurement.
  private _anchor: MeterSample | undefined;                // sample from past for averaging
  private _nextAnchor: MeterSample | undefined;            // upcoming replacement for _anchor
  private _lastLogTime: number | undefined;                // time of last throttle log message
  private _offDuration: number = 0;                        // cumulative time spent paused
  private _stopped: boolean = false;                       // set when stop has been called

  /**
   * Start monitoring the given process and throttle as needed.
   */
  constructor(private readonly _options: {
    pid: number,
    logMeta: log.ILogMeta,
    timing?: ThrottleTiming
  }) {
    this._timing = this._options.timing || defaultThrottleTiming;
    this._meteringInterval = setInterval(() => this._update(), this._timing.samplePeriodMs);
  }

  /**
   * Stop all activity.
   */
  public stop() {
    this._stopped = true;
    this._stopMetering();
    this._stopThrottling();
  }

  /**
   * Read the last cpu usage sample made, for test purposes.
   */
  public get testStats(): MeterSample|undefined {
    return this._sample;
  }

  /**
   * Measure cpu usage and update whether and how much we are throttling the process.
   */
  private async _update() {
    // Measure cpu usage to date.
    let cpuDuration: number;
    try {
      cpuDuration = (await pidusage(this._options.pid)).ctime;
    } catch (e) {
      // process may have disappeared.
      log.rawDebug(`Throttle measurement error: ${e}`, this._options.logMeta);
      return;
    }
    const now = Date.now();
    const current: MeterSample = { time: now, cpuDuration, offDuration: this._offDuration };
    this._sample = current;

    // Measuring cpu usage was an async operation, so check that we haven't been stopped
    // in the meantime.  Otherwise we could sneak in and restart a throttle duty cycle.
    if (this._stopped) { return; }

    // We keep a reference point in the past called the "anchor".  Whenever the anchor
    // becomes sufficiently old, we replace it with something newer.
    if (!this._anchor) { this._anchor = current; }
    if (this._nextAnchor && now - this._anchor.time > this._timing.targetAveragingPeriodMs * 2) {
      this._anchor = this._nextAnchor;
      this._nextAnchor = undefined;
    }
    // Keep a replacement for the current anchor in mind.
    if (!this._nextAnchor && now - this._anchor.time > this._timing.targetAveragingPeriodMs) {
      this._nextAnchor = current;
    }
    // Check if the anchor is sufficiently old for averages to be meaningful enough
    // to support throttling.
    const dt = current.time - this._anchor.time;
    if (dt < this._timing.minimumAveragingPeriodMs) { return; }

    // Calculate the average cpu use per second since the anchor.
    const rate = (current.cpuDuration - this._anchor.cpuDuration) / dt;

    // If that rate is less than our target rate, don't bother throttling.
    const targetRate = this._timing.targetRate;
    if (rate <= targetRate) {
      this._updateThrottle(0);
      return;
    }

    // Calculate how much time the sandbox was paused since the anchor.  This is
    // approximate, since we don't line up duty cycles with this update function,
    // but it should be good enough for throttling purposes.
    const off = current.offDuration - this._anchor.offDuration;
    // If the sandbox was never allowed to run, wait a bit longer for a duty cycle to complete.
    // This should never happen unless time constants are set too tight relative to the
    // maximum length of duty cycle.
    const on = dt - off;
    if (on <= 0) { return; }

    // Calculate the average cpu use per second while the sandbox is unpaused.
    const rateWithoutThrottling = (current.cpuDuration - this._anchor.cpuDuration) / on;

    // Now pick a throttle level such that, if the sandbox continues using cpu
    // at rateWithoutThrottling when it is unpaused, the overall rate matches
    // the targetRate.
    //   one duty cycle lasts: quantum * (1 + throttleFactor)
    //      (positive cycle lasts 1 quantum; non-positive cycle duration is that of
    //       positive cycle scaled by throttleFactor)
    //   cpu use for this cycle is: quantum * rateWithoutThrottling
    //   cpu use per second is therefore: rateWithoutThrottling / (1 + throttleFactor)
    //   so: throttleFactor = (rateWithoutThrottling / targetRate) - 1
    const throttleFactor = rateWithoutThrottling / targetRate - 1;

    // Apply the throttle.  Place a cap on it so the duty cycle does not get too long.
    // This cap means that low targetRates could be unobtainable.
    this._updateThrottle(Math.min(throttleFactor, this._timing.maxThrottle));

    if (!this._lastLogTime || now - this._lastLogTime > this._timing.minimumLogPeriodMs) {
      this._lastLogTime = now;
      log.rawDebug('throttle', {...this._options.logMeta,
                                throttle: Math.round(this._throttleFactor),
                                throttledRate: Math.round(rate * 100),
                                rate: Math.round(rateWithoutThrottling * 100)});
    }
  }

  /**
   * Start/stop the throttling duty cycle as necessary.
   */
  private _updateThrottle(factor: number) {
    // For small factors, let the process run continuously.
    if (factor < 0.001) {
      if (this._dutyCycleTimeout) { this._stopThrottling(); }
      this._throttleFactor = 0;
      return;
    }
    // Set the throttle factor to apply and make sure the duty cycle is running.
    this._throttleFactor = factor;
    if (!this._dutyCycleTimeout) { this._throttle(true); }
  }

  /**
   * Send CONTinue or STOP signal to process.
   */
  private _letProcessRun(on: boolean) {
    try {
      process.kill(this._options.pid, on ? 'SIGCONT' : 'SIGSTOP');
    } catch (e) {
      // process may have disappeared
      log.rawDebug(`Throttle error: ${e}`, this._options.logMeta);
    }
  }

  /**
   * Send CONTinue or STOP signal to process, and schedule next step
   * in duty cycle.
   */
  private _throttle(on: boolean) {
    this._letProcessRun(on);
    const dt = this._timing.dutyCyclePositiveMs * (on ? 1.0 : this._throttleFactor);
    if (!on) { this._offDuration += dt; }
    this._dutyCycleTimeout = setTimeout(() => this._throttle(!on), dt);
  }

  /**
   * Make sure measurement of cpu is stopped.
   */
  private _stopMetering() {
    if (this._meteringInterval) {
      clearInterval(this._meteringInterval);
      this._meteringInterval = undefined;
    }
  }

  /**
   * Make sure duty cycle is stopped and process is left in running state.
   */
  private _stopThrottling() {
    if (this._dutyCycleTimeout) {
      clearTimeout(this._dutyCycleTimeout);
      this._dutyCycleTimeout = undefined;
      this._letProcessRun(true);
    }
  }
}
