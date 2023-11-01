import { ITelemetry } from 'app/server/lib/Telemetry';

const MONITOR_PERIOD_MS = 5_000;        // take a look at memory usage this often
const MEMORY_DELTA_FRACTION = 0.1;      // fraction by which usage should change to get reported
const CPU_DELTA_FRACTION = 0.1;         // by how much cpu usage should change to get reported
const MONITOR_LOG_PERIOD_MS = 600_000;  // log usage at least this often

let _timer: NodeJS.Timeout|undefined;
let _lastTickTime: number = Date.now();
let _lastReportTime: number = 0;
let _lastReportedHeapUsed: number = 0;
let _lastCpuUsage: NodeJS.CpuUsage = {system: 0, user: 0};
let _lastReportedCpuAverage: number = 0;

/**
 * Monitor process memory (heap) and CPU usage, reporting as telemetry on an interval, and more
 * often when usage ticks up or down by a big enough delta.
 *
 * There is a single global process monitor, reporting to the `telemetry` object passed into the
 * first call to start().
 *
 * Returns a function that stops the monitor, or null if there was already a process monitor
 * running, and no new one was started.
 *
 * Reports:
 *  - heapUsedMB:   Size of JS heap in use, in MiB.
 *  - heapTotalMB:  Total heap size, in MiB, allocated for JS by v8.
 *  - cpuAverage:   Fraction between 0 and 1, cpu usage over the last MONITOR_PERIOD_MS. Note it
 *                  includes usage from all threads, so may exceed 1.
 *  - intervalMs:   Interval (in milliseconds) over which cpuAverage is reported. Being much
 *                  higher than MONITOR_PERIOD_MS is a sign of being CPU bound for that long.
 */
export function start(telemetry: ITelemetry): (() => void) | undefined {
  if (!_timer) {
    // Initialize variables needed for accurate first-tick measurement.
    _lastTickTime = Date.now();
    _lastCpuUsage = process.cpuUsage();
    _timer = setInterval(() => monitor(telemetry), MONITOR_PERIOD_MS);

    return function stop() {
      clearInterval(_timer);
      _timer = undefined;
    };
  }
}

function monitor(telemetry: ITelemetry) {
  const memoryUsage = process.memoryUsage();
  const heapUsed = memoryUsage.heapUsed;
  const cpuUsage = process.cpuUsage();
  const now = Date.now();

  const intervalMs = now - _lastTickTime;
  // Note that cpuUsage info is in microseconds, while intervalMs is milliseconds.
  const cpuAverage = (cpuUsage.system + cpuUsage.user - _lastCpuUsage.system - _lastCpuUsage.user)
    / 1000 / intervalMs;
  _lastCpuUsage = cpuUsage;
  _lastTickTime = now;

  // Report usage when:
  // (a) enough time has passed (MONITOR_LOG_PERIOD_MS)
  // (b) memory usage ticked up or down enough since the last report
  // (c) average cpu usage ticked up or down enough since the last report
  if (
    now > _lastReportTime + MONITOR_LOG_PERIOD_MS ||
    Math.abs(heapUsed - _lastReportedHeapUsed) > _lastReportedHeapUsed * MEMORY_DELTA_FRACTION ||
    Math.abs(cpuAverage - _lastReportedCpuAverage) > CPU_DELTA_FRACTION
  ) {
    telemetry.logEvent(null, 'processMonitor', {
      full: {
        heapUsedMB: Math.round(memoryUsage.heapUsed/1024/1024),
        heapTotalMB: Math.round(memoryUsage.heapTotal/1024/1024),
        cpuAverage: Math.round(cpuAverage * 100) / 100,
        intervalMs,
      },
    });
    _lastReportedHeapUsed = heapUsed;
    _lastReportedCpuAverage = cpuAverage;
    _lastReportTime = now;
  }
}
