import { delay } from 'app/common/delay';
import log from 'app/server/lib/log';
import { Throttle } from 'app/server/lib/Throttle';

import pidusage from '@gristlabs/pidusage';
import * as childProcess from 'child_process';
import * as util from 'util';

const execFile = util.promisify(childProcess.execFile);

/**
 * Sandbox usage information that we log periodically (currently just memory).
 */
export interface ISandboxUsage {
  memory: number;
}

/**
 * Control interface for a sandbox. Looks like it doesn't do much, but there may be
 * background activities (specifically, throttling).
 */
export interface ISandboxControl {
  getUsage(): Promise<ISandboxUsage>;  // Poll usage information for the sandbox.
  prepareToClose(): void;              // Start shutting down (but don't wait).
  close(): Promise<void>;              // Wait for shut down.
  kill(): Promise<void>;               // Send kill signals to any related processes.
}

/**
 * Control a single process directly. A thin wrapper around the Throttle class.
 */
export class DirectProcessControl implements ISandboxControl {
  private _pid: number;
  private _throttle?: Throttle;

  constructor(private _process: childProcess.ChildProcess, logMeta?: log.ILogMeta) {
    if (!_process.pid) { throw new Error(`process identifier (PID) is undefined`); }

    this._pid = _process.pid;
    if (process.env.GRIST_THROTTLE_CPU) {
      this._throttle = new Throttle({
        pid: this._pid,
        logMeta: {...logMeta, pid: _process.pid},
      });
    }
  }

  public async close() {
    this.prepareToClose();
  }

  public prepareToClose() {
    this._throttle?.stop();
    this._throttle = undefined;
  }

  public async kill() {
    this._process.kill('SIGKILL');
  }

  public async getUsage() {
    const memory = (await pidusage(this._pid)).memory;
    return { memory };
  }
}

/**
 * Dummy control interface that does no monitoring or throttling.
 */
export class NoProcessControl implements ISandboxControl {
  constructor(private _process: childProcess.ChildProcess) {
  }

  public async close() {
  }

  public prepareToClose() {
  }

  public async kill() {
    this._process.kill('SIGKILL');
  }

  public async getUsage() {
    return { memory: Infinity };
  }
}

/**
 * Control interface when multiple processes are involved, playing different roles.
 * This is entirely conceived with gvisor's runsc in mind.
 *
 * As a process is starting up, we scan it and its children (recursively) for processes
 * that match certain "recognizers". For gvisor runsc, we'll be picking out a sandbox
 * process from its peers handling filesystem access, and a ptraced process that is
 * effectively the data engine.
 *
 * This setup is very much developed by inspection, and could have weaknesses.
 * TODO: check if more processes need to be included in memory counting.
 * TODO: check if there could be multiple ptraced processes to deal with if user were
 * to create extra processes within sandbox (which we don't yet attempt to prevent).
 *
 * The gvisor container could be configured with operating system help to limit
 * CPU usage in various ways, but I don't yet see a way to get something analogous
 * to Throttle's operation.
 */
export class SubprocessControl implements ISandboxControl {
  private _throttle?: Throttle;
  private _monitoredProcess: Promise<ProcessInfo|null>;
  private _active: boolean;
  private _foundDocker: boolean = false;

  constructor(private _options: {
    pid: number,   // pid of process opened by Grist
    recognizers: {
      sandbox: (p: ProcessInfo) => boolean,  // we will stop/start this process for throttling
      memory?: (p: ProcessInfo) => boolean,  // read memory from this process (default: sandbox)
      cpu?: (p: ProcessInfo) => boolean,     // read cpu from this process    (default: sandbox)
      traced?: (p: ProcessInfo) => boolean,  // stop this as well for throttling (default: none)
    },
    logMeta?: log.ILogMeta,
  }) {
    this._active = true;
    this._monitoredProcess = this._scan().catch(e => {
      log.rawDebug(`Subprocess control failure: ${e}`, this._options.logMeta || {});
      return null;
    });
  }

  public async close() {
    this.prepareToClose();
    await this._monitoredProcess.catch(() => null);
  }

  public prepareToClose() {
    this._active = false;
    this._throttle?.stop();
    this._throttle = undefined;
  }

  public async kill() {
    if (this._foundDocker) {
      process.kill(this._options.pid, 'SIGKILL');
      return;
    }
    for (const proc of await this._getAllProcesses()) {
      try {
        process.kill(proc.pid, 'SIGKILL');
      } catch (e) {
        // Don't worry if process is already killed.
        if (e.code !== 'ESRCH') { throw e; }
      }
    }
  }

  public async getUsage() {
    try {
      const monitoredProcess = await this._monitoredProcess;
      if (!monitoredProcess) { return { memory: Infinity }; }
      const pid = monitoredProcess.pid;
      const memory = (await pidusage(pid)).memory;
      return { memory };
    } catch (e) {
      return { memory: Infinity };
    }
  }

  /**
   * Look for the desired children. Should be run once on process startup.
   * This method will check all children once per second until if finds the
   * desired ones or we are closed.
   *
   * It returns information about the child to be monitored by getUsage().
   * It also has a side effect of kicking off throttling.
   */
  private async _scan(): Promise<ProcessInfo> {
    while (this._active) {
      const processes = await this._getAllProcesses();
      const unrecognizedProcess = undefined as ProcessInfo|undefined;
      const recognizedProcesses = {
        sandbox: unrecognizedProcess,
        memory: unrecognizedProcess,
        cpu: unrecognizedProcess,
        traced: unrecognizedProcess,
      };
      let missing = false;
      for (const key of Object.keys(recognizedProcesses) as Array<keyof typeof recognizedProcesses>) {
        const recognizer = this._options.recognizers[key];
        if (!recognizer) { continue; }
        for (const proc of processes) {
          if (proc.label.includes('docker')) {
            this._foundDocker = true;
            throw new Error('docker barrier found');
          }
          if (recognizer(proc)) {
            recognizedProcesses[key] = proc;
            continue;
          }
        }
        if (!recognizedProcesses[key]) { missing = true; }
      }
      if (!missing) {
        this._configure(recognizedProcesses);
        return recognizedProcesses.memory || recognizedProcesses.sandbox!;  // sandbox recognizer is mandatory
      }
      await delay(1000);
    }
    throw new Error('not found');
  }

  /**
   * Having found the desired children, we configure ourselves here, kicking off
   * throttling if needed.
   */
  private _configure(processes: { sandbox?: ProcessInfo, cpu?: ProcessInfo,
                                  memory?: ProcessInfo, traced?: ProcessInfo }) {
    if (!processes.sandbox) { return; }
    if (process.env.GRIST_THROTTLE_CPU) {
      this._throttle = new Throttle({
        pid: processes.sandbox.pid,
        readPid: processes.cpu?.pid,
        tracedPid: processes.traced?.pid,
        logMeta: {...this._options.logMeta,
                  pid: processes.sandbox.pid,
                  otherPids: [processes.cpu?.pid,
                              processes.memory?.pid,
                              processes.traced?.pid]},
      });
    }
  }

  /**
   * Return the root process and all its (nested) children.
   */
  private _getAllProcesses(): Promise<ProcessInfo[]> {
    const rootProcess = {pid: this._options.pid, label: 'root', parentLabel: ''};
    return this._addChildren([rootProcess]);
  }

  /**
   * Take a list of processes, and add children of all those processes,
   * recursively.
   */
  private async _addChildren(processes: ProcessInfo[]): Promise<ProcessInfo[]> {
    const nestedProcesses = await Promise.all(processes.map(async proc => {
      const children = await this._getChildren(proc.pid, proc.label);
      return [proc, ...await this._addChildren(children)];
    }));
    return ([] as ProcessInfo[]).concat(...nestedProcesses);
  }

  /**
   * Figure out the direct children of a parent process.
   */
  private async _getChildren(pid: number, parentLabel: string): Promise<ProcessInfo[]> {
    // Use "pgrep" to find children of a process, in the absence of any better way.
    // This only needs to happen a few times as sandbox is starting up, so doesn't need
    // to be super-optimized.
    // This currently is only good for Linux. Mechanically, it will run on Macs too,
    // but process naming is slightly different. But this class is currently only useful
    // for gvisor's runsc, which runs on Linux only.
    const cmd =
      execFile('pgrep', ['--list-full', '--parent', String(pid)])
      .catch(() => execFile('pgrep', ['-l', '-P', String(pid)]))   // mac version of pgrep
      .catch(() => ({ stdout: '' }));
    const result = (await cmd).stdout;
    const parts = result
      .split('\n')
      .map(line => line.trim())
      .map(line => line.split(' ', 2))
      .map(part => {
        return {
          pid: parseInt(part[0], 10) || 0,
          label: part[1] || '',
          parentLabel,
        };
      });
    return parts.filter(part => part.pid !== 0);
  }
}

/**
 * The information we need about processes is their pid, some kind of label (whatever
 * pgrep reports, which is a version of their command line), and the label of the process's
 * parent (blank if it has none).
 */
export interface ProcessInfo {
  pid: number;
  label: string;
  parentLabel: string;
}
