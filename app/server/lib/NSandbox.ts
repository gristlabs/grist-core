/**
 * JS controller for the pypy sandbox.
 */
import * as pidusage from '@gristlabs/pidusage';
import * as marshal from 'app/common/marshal';
import {ISandbox, ISandboxCreationOptions, ISandboxCreator} from 'app/server/lib/ISandbox';
import * as log from 'app/server/lib/log';
import * as sandboxUtil from 'app/server/lib/sandboxUtil';
import * as shutdown from 'app/server/lib/shutdown';
import {Throttle} from 'app/server/lib/Throttle';
import {ChildProcess, spawn, SpawnOptions} from 'child_process';
import * as path from 'path';
import {Stream, Writable} from 'stream';

type SandboxMethod = (...args: any[]) => any;

export interface ISandboxCommand {
  process: string;
}

export interface ISandboxOptions {
  args: string[];         // The arguments to pass to the python process.
  exports?: {[name: string]: SandboxMethod}; // Functions made available to the sandboxed process.
  logCalls?: boolean;     // (Not implemented) Whether to log all system calls from the python sandbox.
  logTimes?: boolean;     // Whether to log time taken by calls to python sandbox.
  unsilenceLog?: boolean; // Don't silence the sel_ldr logging.
  selLdrArgs?: string[];  // Arguments passed to selLdr, for instance the following sets an
                          // environment variable `{ ... selLdrArgs: ['-E', 'PYTHONPATH=grist'] ... }`.
  logMeta?: log.ILogMeta; // Log metadata (e.g. including docId) to report in all log messages.
  command?: ISandboxCommand;
}

// Options for low-level spawning of selLdr sandbox process.
export interface ISpawnOptions extends SpawnOptions {
  unsilenceLog?: boolean;  // Don't silence the sel_ldr logging.
  command?: ISandboxCommand;
}

type ResolveRejectPair = [(value?: any) => void, (reason?: unknown) => void];

// Type for basic message identifiers, available as constants in sandboxUtil.
type MsgCode = null | true | false;

export class NSandbox implements ISandbox {
  /**
   * Helper function to run the nacl sandbox. It takes care of most arguments, similarly to
   * nacl/bin/run script, but without the reliance on bash. We can't use bash when -r/-w options
   * because on Windows it doesn't pass along the open file descriptors. Bash is also unavailable
   * when installing a standalone version on Windows.
   * @param selLdrArgs: Arguments to pass to sel_ldr;
   * @param pythonArgs: Arguments to pass to python within the sandbox.
   * @param spawnOptions: extra options for child_process.spawn(), such as 'stdio'.
   */
  public static spawn(selLdrArgs: string[], pythonArgs: string[], spawnOptions: ISpawnOptions = {}): ChildProcess {
    const unsilenceLog = spawnOptions.unsilenceLog;
    delete spawnOptions.unsilenceLog;
    const command = spawnOptions.command;
    delete spawnOptions.command;

    if (command) {
      return spawn(command.process, pythonArgs,
                   {env: {PYTHONPATH: 'grist:thirdparty'},
                    cwd: path.join(process.cwd(), 'sandbox'), ...spawnOptions});
    }

    const noLog = unsilenceLog ? [] :
      (process.env.OS === 'Windows_NT' ? ['-l', 'NUL'] : ['-l', '/dev/null']);
    return spawn('sandbox/nacl/bin/sel_ldr', [
        '-B', './sandbox/nacl/lib/irt_core.nexe', '-m', './sandbox/nacl/root:/:ro',
        ...noLog,
        ...selLdrArgs,
        './sandbox/nacl/lib/runnable-ld.so',
        '--library-path', '/slib', '/python/bin/python2.7.nexe',
        ...pythonArgs
      ],
      {env: {}, ...spawnOptions},
    );
  }

  public readonly childProc: ChildProcess;
  private _logTimes: boolean;
  private _exportedFunctions: {[name: string]: SandboxMethod};
  private _marshaller = new marshal.Marshaller({stringToBuffer: true, version: 2});
  private _unmarshaller = new marshal.Unmarshaller({ bufferToString: false });

  // Members used for reading from the sandbox process.
  private _pendingReads: ResolveRejectPair[] = [];
  private _isReadClosed = false;
  private _isWriteClosed = false;

  private _logMeta: log.ILogMeta;
  private _streamToSandbox: Writable;
  private _streamFromSandbox: Stream;

  private _throttle: Throttle | undefined;

  /*
   * Callers may listen to events from sandbox.childProc (a ChildProcess), e.g. 'close' and 'error'.
   * The sandbox listens for 'aboutToExit' event on the process, to properly shut down.
   */
  constructor(options: ISandboxOptions) {
    this._logTimes = Boolean(options.logTimes || options.logCalls);
    this._exportedFunctions = options.exports || {};

    const selLdrArgs = options.selLdrArgs || [];

    // We use these options to set up communication with the sandbox:
    // -r 3:3  to associate a file descriptor 3 on the outside of the sandbox with FD 3 on the
    //         inside, for reading from the inside. This becomes `this._streamToSandbox`.
    // -w 4:4  to associate FD 4 on the outside with FD 4 on the inside for writing from the inside.
    //         This becomes `this._streamFromSandbox`
    this.childProc = NSandbox.spawn(['-r', '3:3', '-w', '4:4', ...selLdrArgs], options.args, {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
      unsilenceLog: options.unsilenceLog,
      command: options.command
    });

    this._logMeta = {sandboxPid: this.childProc.pid, ...options.logMeta};
    log.rawDebug("Sandbox started", this._logMeta);

    this._streamToSandbox = (this.childProc.stdio as Stream[])[3] as Writable;
    this._streamFromSandbox = (this.childProc.stdio as Stream[])[4];

    this.childProc.on('close', this._onExit.bind(this));
    this.childProc.on('error', this._onError.bind(this));

    this.childProc.stdout.on('data', sandboxUtil.makeLinePrefixer('Sandbox stdout: ', this._logMeta));
    this.childProc.stderr.on('data', sandboxUtil.makeLinePrefixer('Sandbox stderr: ', this._logMeta));

    this._streamFromSandbox.on('data', (data) => this._onSandboxData(data));
    this._streamFromSandbox.on('end', () => this._onSandboxClose());
    this._streamFromSandbox.on('error', (err) => {
      log.rawError(`Sandbox error reading: ${err}`, this._logMeta);
      this._onSandboxClose();
    });

    this._streamToSandbox.on('error', (err) => {
      if (!this._isWriteClosed) {
        log.rawError(`Sandbox error writing: ${err}`, this._logMeta);
      }
    });

    // On shutdown, shutdown the child process cleanly, and wait for it to exit.
    shutdown.addCleanupHandler(this, this.shutdown);

    if (process.env.GRIST_THROTTLE_CPU) {
      this._throttle = new Throttle({
        pid: this.childProc.pid,
        logMeta: this._logMeta,
      });
    }
  }

  /**
   * Shuts down the sandbox process cleanly, and wait for it to exit.
   * @return {Promise} Promise that's resolved with [code, signal] when the sandbox exits.
   */
  public async shutdown() {
    log.rawDebug("Sandbox shutdown starting", this._logMeta);
    shutdown.removeCleanupHandlers(this);

    // The signal ensures the sandbox process exits even if it's hanging in an infinite loop or
    // long computation. It doesn't get a chance to clean up, but since it is sandboxed, there is
    // nothing it needs to clean up anyway.
    const timeoutID = setTimeout(() => {
      log.rawWarn("Sandbox sending SIGKILL", this._logMeta);
      this.childProc.kill('SIGKILL');
    }, 1000);

    const result = await new Promise((resolve, reject) => {
      if (this._isWriteClosed) { resolve(); }
      this.childProc.on('error', reject);
      this.childProc.on('close', resolve);
      this._close();
    });

    // In the normal case, the kill timer is pending when the process exits, and we can clear it. If
    // the process got killed, the timer is invalid, and clearTimeout() does nothing.
    clearTimeout(timeoutID);
    return result;
  }

  /**
   * Makes a call to the python process implementing our calling convention on stdin/stdout.
   * @param funcName The name of the python RPC function to call.
   * @param args Arguments to pass to the given function.
   * @returns A promise for the return value from the Python function.
   */
  public pyCall(funcName: string, ...varArgs: unknown[]): Promise<any> {
    const startTime = Date.now();
    this._sendData(sandboxUtil.CALL, Array.from(arguments));
    return this._pyCallWait(funcName, startTime);
  }

  /**
   * Returns the RSS (resident set size) of the sandbox process, in bytes.
   */
  public async reportMemoryUsage() {
    const memory = (await pidusage(this.childProc.pid)).memory;
    log.rawDebug('Sandbox memory', {memory, ...this._logMeta});
  }

  private async _pyCallWait(funcName: string, startTime: number): Promise<any> {
    try {
      return await new Promise((resolve, reject) => {
        this._pendingReads.push([resolve, reject]);
      });
    } finally {
      if (this._logTimes) {
        log.rawDebug(`Sandbox pyCall[${funcName}] took ${Date.now() - startTime} ms`, this._logMeta);
      }
    }
  }


  private _close() {
    if (this._throttle) { this._throttle.stop(); }
    if (!this._isWriteClosed) {
      // Close the pipe to the sandbox, which should cause the sandbox to exit cleanly.
      this._streamToSandbox.end();
      this._isWriteClosed = true;
    }
  }

  private _onExit(code: number, signal: string) {
    this._close();
    log.rawDebug(`Sandbox exited with code ${code} signal ${signal}`, this._logMeta);
  }


  private _onError(err: Error) {
    this._close();
    log.rawWarn(`Sandbox could not be spawned: ${err}`, this._logMeta);
  }


  /**
   * Send a message to the sandbox process with the given message code and data.
   */
  private _sendData(msgCode: MsgCode, data: any) {
    if (this._isReadClosed) {
      throw new sandboxUtil.SandboxError("PipeToSandbox is closed");
    }
    this._marshaller.marshal(msgCode);
    this._marshaller.marshal(data);
    return this._streamToSandbox.write(this._marshaller.dumpAsBuffer());
  }


  /**
   * Process a buffer of data received from the sandbox process.
   */
  private _onSandboxData(data: any) {
    this._unmarshaller.parse(data, buf => {
      const value = marshal.loads(buf, { bufferToString: true });
      this._onSandboxMsg(value[0], value[1]);
    });
  }


  /**
   * Process the closing of the pipe by the sandboxed process.
   */
  private _onSandboxClose() {
    if (this._throttle) { this._throttle.stop(); }
    this._isReadClosed = true;
    // Clear out all reads pending on PipeFromSandbox, rejecting them with the given error.
    const err = new sandboxUtil.SandboxError("PipeFromSandbox is closed");
    this._pendingReads.forEach(resolvePair => resolvePair[1](err));
    this._pendingReads = [];
  }


  /**
   * Process a parsed message from the sandboxed process.
   */
  private _onSandboxMsg(msgCode: MsgCode, data: any) {
    if (msgCode === sandboxUtil.CALL) {
      // Handle calls FROM the sandbox.
      if (!Array.isArray(data) || data.length === 0) {
        log.rawWarn("Sandbox invalid call from the sandbox", this._logMeta);
      } else {
        const fname = data[0];
        const args = data.slice(1);
        log.rawDebug(`Sandbox got call to ${fname} (${args.length} args)`, this._logMeta);
        Promise.resolve()
        .then(() => {
          const func = this._exportedFunctions[fname];
          if (!func) { throw new Error("No such exported function: " + fname); }
          return func(...args);
        })
        .then((ret) => {
          this._sendData(sandboxUtil.DATA, ret);
        }, (err) => {
          this._sendData(sandboxUtil.EXC, err.toString());
        })
        .catch((err) => {
          log.rawDebug(`Sandbox sending response failed: ${err}`, this._logMeta);
        });
      }
    } else {
      // Handle return values for calls made to the sandbox.
      const resolvePair = this._pendingReads.shift();
      if (resolvePair) {
        if (msgCode === sandboxUtil.EXC) {
          resolvePair[1](new sandboxUtil.SandboxError(data));
        } else if (msgCode === sandboxUtil.DATA) {
          resolvePair[0](data);
        } else {
          log.rawWarn("Sandbox invalid message from sandbox", this._logMeta);
        }
      }
    }
  }
}

export class NSandboxCreator implements ISandboxCreator {
  public constructor(private _flavor: 'pynbox' | 'unsandboxed') {
  }

  public create(options: ISandboxCreationOptions): ISandbox {
    const defaultEntryPoint = this._flavor === 'pynbox' ? 'grist/main.pyc' : 'grist/main.py';
    const args = [options.entryPoint || defaultEntryPoint];
    if (!options.entryPoint && options.comment) {
      // When using default entry point, we can add on a comment as an argument - it isn't
      // used, but will show up in `ps` output for the sandbox process.  Comment is intended
      // to be a document name/id.
      args.push(options.comment);
    }
    const selLdrArgs: string[] = [];
    if (options.sandboxMount) {
      selLdrArgs.push(
        // TODO: Only modules that we share with plugins should be mounted. They could be gathered in
        // a "$APPROOT/sandbox/plugin" folder, only which get mounted.
        '-E', 'PYTHONPATH=grist:thirdparty',
        '-m', `${options.sandboxMount}:/sandbox:ro`);
    }
    if (options.importMount) {
      selLdrArgs.push('-m', `${options.importMount}:/importdir:ro`);
    }
    return new NSandbox({
      args,
      logCalls: options.logCalls,
      logMeta: options.logMeta,
      logTimes: options.logTimes,
      selLdrArgs,
      ...(this._flavor === 'pynbox' ? {} : {
        command: {
          process: "python2.7"
        }
      })
    });
  }
}
