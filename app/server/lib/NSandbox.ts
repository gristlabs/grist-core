/**
 * JS controller for the pypy sandbox.
 */
import {arrayToString} from 'app/common/arrayToString';
import * as marshal from 'app/common/marshal';
import {create} from 'app/server/lib/create';
import {ISandbox, ISandboxCreationOptions, ISandboxCreator} from 'app/server/lib/ISandbox';
import log from 'app/server/lib/log';
import {getAppRoot, getAppRootFor, getUnpackedAppRoot} from 'app/server/lib/places';
import {
  DirectProcessControl,
  ISandboxControl,
  NoProcessControl,
  ProcessInfo,
  SubprocessControl
} from 'app/server/lib/SandboxControl';
import * as sandboxUtil from 'app/server/lib/sandboxUtil';
import * as shutdown from 'app/server/lib/shutdown';
import {ChildProcess, fork, spawn, SpawnOptionsWithoutStdio} from 'child_process';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import {Stream, Writable} from 'stream';
import * as which from 'which';

type SandboxMethod = (...args: any[]) => any;

/**
 *
 * A collection of options for weird and wonderful ways to run Grist.
 * The sandbox at heart is just python, but run in different ways
 * (sandbox 'flavors': pynbox, docker, gvisor, and unsandboxed).
 *
 * The "command" is an external program/container to call to run the
 * sandbox, and it depends on sandbox flavor. Pynbox is built into
 * Grist and has a hard-wired command, so the command option should be
 * empty.  For gvisor and unsandboxed, command is the path to an
 * external program to run.  For docker, it is the name of an image.
 *
 * Once python is running, ordinarily some Grist code should be
 * started by setting `useGristEntrypoint` (the only exception is
 * in tests) which runs grist/main.py.
 */
export interface ISandboxOptions {
  command?: string;       // External program or container to call to run the sandbox.
  args: string[];         // The arguments to pass to the python process.

  preferredPythonVersion?: string;  // Mandatory for gvisor; ignored by other methods.

  // TODO: update
  // ISandboxCreationOptions to talk about directories instead of
  // mounts, since it may not be possible to remap directories as
  // mounts (e.g. for unsandboxed operation).
  importDir?: string;  // a directory containing data file(s) to import by plugins

  minimalPipeMode?: boolean;     // Whether to use newer 3-pipe operation
  deterministicMode?: boolean;   // Whether to override time + randomness

  exports?: {[name: string]: SandboxMethod}; // Functions made available to the sandboxed process.
  logCalls?: boolean;     // (Not implemented) Whether to log all system calls from the python sandbox.
  logTimes?: boolean;     // Whether to log time taken by calls to python sandbox.
  unsilenceLog?: boolean; // Don't silence the sel_ldr logging (pynbox only).
  logMeta?: log.ILogMeta; // Log metadata (e.g. including docId) to report in all log messages.

  useGristEntrypoint?: boolean;  // Should be set for everything except tests, which
                                 // may want to pass arguments to python directly.
}

/**
 * We interact with sandboxes as a separate child process. Data engine work is done
 * across standard input and output streams from and to this process. We also monitor
 * and control resource utilization via a distinct control interface.
 *
 * More recently, a sandbox may not be a separate OS process, but (for
 * example) a web worker. In this case, a pair of callbacks (getData and
 * sendData) replace pipes.
 */
export interface SandboxProcess {
  child?: ChildProcess;
  control: () => ISandboxControl;
  dataToSandboxDescriptor?: number;    // override sandbox's 'stdin' for data
  dataFromSandboxDescriptor?: number;  // override sandbox's 'stdout' for data
  getData?: (cb: (data: any) => void) => void;  // use a callback instead of a pipe to get data
  sendData?: (data: any) => void;  // use a callback instead of a pipe to send data
}

type ResolveRejectPair = [(value?: any) => void, (reason?: unknown) => void];

// Type for basic message identifiers, available as constants in sandboxUtil.
type MsgCode = null | true | false;

// Optional root folder to store binary data sent to and from the sandbox
// See test_replay.py
const recordBuffersRoot = process.env.RECORD_SANDBOX_BUFFERS_DIR;

export class NSandbox implements ISandbox {

  public readonly childProc?: ChildProcess;
  private _control: ISandboxControl;
  private _logTimes: boolean;
  private _exportedFunctions: {[name: string]: SandboxMethod};
  private _marshaller = new marshal.Marshaller({stringToBuffer: false, version: 2});
  private _unmarshaller = new marshal.Unmarshaller({ bufferToString: false });

  // Members used for reading from the sandbox process.
  private _pendingReads: ResolveRejectPair[] = [];
  private _isReadClosed = false;
  private _isWriteClosed = false;

  private _logMeta: log.ILogMeta;
  private _streamToSandbox?: Writable;
  private _streamFromSandbox: Stream;
  private _dataToSandbox?: (data: any) => void;
  private _lastStderr: Uint8Array;  // Record last error line seen.

  // Create a unique subdirectory for each sandbox process so they can be replayed separately
  private _recordBuffersDir = recordBuffersRoot ? path.resolve(recordBuffersRoot, new Date().toISOString()) : null;

  /*
   * Callers may listen to events from sandbox.childProc (a ChildProcess), e.g. 'close' and 'error'.
   * The sandbox listens for 'aboutToExit' event on the process, to properly shut down.
   *
   * Grist interacts with the sandbox via message passing through pipes to an isolated
   * process.  Some read-only shared code is made available to the sandbox.
   * For plugins, read-only data files are made available.
   *
   * At the time of writing, Grist has been using an NaCl sandbox with python2.7 compiled
   * for it for several years (pynbox), and we are now experimenting with other sandboxing
   * options.  Variants can be activated by passing in a non-default "spawner" function.
   *
   */
  constructor(options: ISandboxOptions, spawner: SpawnFn = pynbox) {
    this._logTimes = Boolean(options.logTimes || options.logCalls);
    this._exportedFunctions = options.exports || {};

    const sandboxProcess = spawner(options);
    this.childProc = sandboxProcess.child;
    this._logMeta = {sandboxPid: this.childProc?.pid, ...options.logMeta};

    // Handle childProc events early, especially the 'error' event which may lead to node exiting.
    this.childProc?.on('close', this._onExit.bind(this));
    this.childProc?.on('error', this._onError.bind(this));

    this._control = sandboxProcess.control();

    if (this.childProc) {
      if (options.minimalPipeMode) {
        this._initializeMinimalPipeMode(sandboxProcess);
      } else {
        this._initializeFivePipeMode(sandboxProcess);
      }
    } else {
      // No child process. In this case, there should be a callback for
      // receiving and sending data.
      if (!sandboxProcess.getData) {
        throw new Error('no way to get data from sandbox');
      }
      if (!sandboxProcess.sendData) {
        throw new Error('no way to send data to sandbox');
      }
      sandboxProcess.getData((data) => this._onSandboxData(data));
      this._dataToSandbox = sandboxProcess.sendData;
    }

    // On shutdown, shutdown the child process cleanly, and wait for it to exit.
    shutdown.addCleanupHandler(this, this.shutdown);

    if (this._recordBuffersDir) {
      log.rawDebug(`Recording sandbox buffers in ${this._recordBuffersDir}`, this._logMeta);
      fs.mkdirSync(this._recordBuffersDir, {recursive: true});
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
    const timeoutID = setTimeout(async () => {
      log.rawWarn("Sandbox sending SIGKILL", this._logMeta);
      await this._control.kill();
    }, 1000);

    const result = await new Promise<void>((resolve, reject) => {
      if (this._isWriteClosed) { resolve(); }
      this.childProc?.on('error', reject);
      this.childProc?.on('close', resolve);
      this.childProc?.on('exit', resolve);
      this._close();
    }).finally(() => this._control.close());

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
  public async pyCall(funcName: string, ...varArgs: unknown[]): Promise<any> {
    const startTime = Date.now();
    this._sendData(sandboxUtil.CALL, Array.from(arguments));
    const slowCallCheck = setTimeout(() => {
      // Log calls that take some time, can be a useful symptom of misconfiguration
      // (or just benign if the doc is big).
      log.rawWarn('Slow pyCall', {...this._logMeta, funcName});
    }, 10000);
    try {
      return await this._pyCallWait(funcName, startTime);
    } finally {
      clearTimeout(slowCallCheck);
    }
  }

  /**
   * Returns the RSS (resident set size) of the sandbox process, in bytes.
   */
  public async reportMemoryUsage() {
    const {memory} = await this._control.getUsage();
    log.rawDebug('Sandbox memory', {memory, ...this._logMeta});
  }

  /**
   * Get ready to communicate with a sandbox process using stdin,
   * stdout, and stderr.
   */
  private _initializeMinimalPipeMode(sandboxProcess: SandboxProcess) {
    log.rawDebug("3-pipe Sandbox started", this._logMeta);
    if (!this.childProc) {
      throw new Error('child process required');
    }
    if (sandboxProcess.dataToSandboxDescriptor) {
      this._streamToSandbox =
        (this.childProc.stdio as Stream[])[sandboxProcess.dataToSandboxDescriptor] as Writable;
    } else {
      this._streamToSandbox = this.childProc.stdin!;
    }
    if (sandboxProcess.dataFromSandboxDescriptor) {
      this._streamFromSandbox =
        (this.childProc.stdio as Stream[])[sandboxProcess.dataFromSandboxDescriptor];
    } else {
      this._streamFromSandbox = this.childProc.stdout!;
    }
    this._initializeStreamEvents();
  }

  /**
   * Get ready to communicate with a sandbox process using stdin,
   * stdout, and stderr, and two extra FDs. This was a nice way
   * to have a clean, separate data channel, when supported.
   */
  private _initializeFivePipeMode(sandboxProcess: SandboxProcess) {
    log.rawDebug("5-pipe Sandbox started", this._logMeta);
    if (!this.childProc) {
      throw new Error('child process required');
    }
    if (sandboxProcess.dataFromSandboxDescriptor || sandboxProcess.dataToSandboxDescriptor) {
      throw new Error('cannot override file descriptors in 5 pipe mode');
    }
    this._streamToSandbox = (this.childProc.stdio as Stream[])[3] as Writable;
    this._streamFromSandbox = (this.childProc.stdio as Stream[])[4];
    this.childProc.stdout!.on('data', sandboxUtil.makeLinePrefixer('Sandbox stdout: ', this._logMeta));
    this._initializeStreamEvents();
  }

  /**
   * Set up logging and events on streams to/from a sandbox.
   */
  private _initializeStreamEvents() {
    if (!this.childProc) {
      throw new Error('child process required');
    }
    if (!this._streamToSandbox) {
      throw new Error('expected streamToSandbox to be configured');
    }
    const sandboxStderrLogger = sandboxUtil.makeLogLinePrefixer('Sandbox stderr: ', this._logMeta);
    this.childProc.stderr!.on('data', data => {
      this._lastStderr = data;
      sandboxStderrLogger(data);
    });

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
  }

  private async _pyCallWait(funcName: string, startTime: number): Promise<any> {
    try {
      return await new Promise((resolve, reject) => {
        this._pendingReads.push([resolve, reject]);
      });
    } catch (e) {
      throw new sandboxUtil.SandboxError(e.message);
    } finally {
      if (this._logTimes) {
        log.rawDebug('NSandbox pyCall', {
          ...this._logMeta,
          funcName,
          loadMs: Date.now() - startTime,
        });
      }
    }
  }


  private _close() {
    this._control?.prepareToClose();    // ?. operator in case _control failed to get initialized.
    if (!this._isWriteClosed) {
      // Close the pipe to the sandbox, which should cause the sandbox to exit cleanly.
      this._streamToSandbox?.end();
      this._isWriteClosed = true;
    }
  }

  private _onExit(code: number, signal: string) {
    const expected = this._isWriteClosed;
    this._close();
    if (expected) {
      log.rawDebug(`Sandbox exited with code ${code} signal ${signal}`, this._logMeta);
    } else {
      log.rawWarn(`Sandbox unexpectedly exited with code ${code} signal ${signal}`, this._logMeta);
    }
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
      throw this._sandboxClosedError('PipeToSandbox');
    }
    this._marshaller.marshal(msgCode);
    this._marshaller.marshal(data);
    const buf = this._marshaller.dumpAsBuffer();
    if (this._recordBuffersDir) {
      fs.appendFileSync(path.resolve(this._recordBuffersDir, "input"), buf);
    }
    if (this._streamToSandbox) {
      return this._streamToSandbox.write(buf);
    } else {
      if (!this._dataToSandbox) {
        throw new Error('no way to send data to sandbox');
      }
      this._dataToSandbox(buf);
      return true;
    }
  }

  /**
   * Process a buffer of data received from the sandbox process.
   */
  private _onSandboxData(data: any) {
    this._unmarshaller.parse(data, buf => {
      const value = marshal.loads(buf, { bufferToString: true });
      if (this._recordBuffersDir) {
        fs.appendFileSync(path.resolve(this._recordBuffersDir, "output"), buf);
      }
      this._onSandboxMsg(value[0], value[1]);
    });
  }


  /**
   * Process the closing of the pipe by the sandboxed process.
   */
  private _onSandboxClose() {
    this._control.prepareToClose();
    this._isReadClosed = true;
    // Clear out all reads pending on PipeFromSandbox, rejecting them with the given error.
    const err = this._sandboxClosedError('PipeFromSandbox');

    this._pendingReads.forEach(resolvePair => resolvePair[1](err));
    this._pendingReads = [];
  }

  /**
   * Generate an error message for a pipe to the sandbox. Include the
   * last stderr line seen from the sandbox - more reliable than
   * error results send via the standard protocol.
   */
  private _sandboxClosedError(label: string) {
    const parts = [`${label} is closed`];
    if (this._lastStderr) {
      parts.push(arrayToString(this._lastStderr));
    }
    return new sandboxUtil.SandboxError(parts.join(': '));
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
          resolvePair[1](new Error(data));
        } else if (msgCode === sandboxUtil.DATA) {
          resolvePair[0](data);
        } else {
          log.rawWarn("Sandbox invalid message from sandbox", this._logMeta);
        }
      }
    }
  }
}

/**
 * Functions for spawning all of the currently supported sandboxes.
 */
const spawners = {
  pynbox,             // Grist's "classic" sandbox - python2 within NaCl.
  unsandboxed,        // No sandboxing, straight to host python.
                      // This offers no protection to the host.
  docker,             // Run sandboxes in distinct docker containers.
  gvisor,             // Gvisor's runsc sandbox.
  macSandboxExec,     // Use "sandbox-exec" on Mac.
  pyodide,            // Run data engine using pyodide.
};

function isFlavor(flavor: string): flavor is keyof typeof spawners {
  return flavor in spawners;
}

/**
 * A sandbox factory.  This doesn't do very much beyond remembering a default
 * flavor of sandbox (which at the time of writing differs between hosted grist and
 * grist-core), and trying to regularize creation options a bit.
 *
 * The flavor of sandbox to use can be overridden by some environment variables:
 *   - GRIST_SANDBOX_FLAVOR: should be one of the spawners (gvisor, unsandboxed, docker,
 *     macSandboxExec, pynbox)
 *   - GRIST_SANDBOX: a program or image name to run as the sandbox.  Not needed for
 *     pynbox (it is either built in or not available).  For unsandboxed, should be an
 *     absolute path to python within a virtualenv with all requirements installed.
 *     For docker, it should be `grist-docker-sandbox` (an image built via makefile
 *     in `sandbox/docker`) or a derived image.  For gvisor, it should be the full path
 *     to `sandbox/gvisor/run.py` (if runsc available locally) or to
 *     `sandbox/gvisor/wrap_in_docker.sh` (if runsc should be run using the docker
 *     image built in that directory).
 *   - PYTHON_VERSION: for gvisor, this is mandatory, and must be set to "2" or "3".
 *     It is ignored by other flavors.
 */
export class NSandboxCreator implements ISandboxCreator {
  private _flavor: string;
  private _spawner: SpawnFn;
  private _command?: string;
  private _preferredPythonVersion?: string;

  public constructor(options: {
    defaultFlavor: string,
    command?: string,
    preferredPythonVersion?: string,
  }) {
    const flavor = options.defaultFlavor;
    if (!isFlavor(flavor)) {
      const variants = create.getSandboxVariants?.();
      if (!variants?.[flavor]) {
        throw new Error(`Unrecognized sandbox flavor: ${flavor}`);
      } else {
        this._spawner = variants[flavor];
      }
    } else {
      this._spawner = spawners[flavor];
    }
    this._flavor = flavor;
    this._command = options.command;
    this._preferredPythonVersion = options.preferredPythonVersion;
  }

  public create(options: ISandboxCreationOptions): ISandbox {
    const args: string[] = [];
    if (!options.entryPoint && options.comment) {
      // When using default entry point, we can add on a comment as an argument - it isn't
      // used, but will show up in `ps` output for the sandbox process.  Comment is intended
      // to be a document name/id.
      args.push(options.comment);
    }
    const translatedOptions: ISandboxOptions = {
      minimalPipeMode: true,
      deterministicMode: Boolean(process.env.LIBFAKETIME_PATH),
      args,
      logCalls: options.logCalls,
      logMeta: {flavor: this._flavor, command: this._command,
                entryPoint: options.entryPoint || '(default)',
                ...options.logMeta},
      logTimes: options.logTimes,
      command: this._command,
      preferredPythonVersion: this._preferredPythonVersion || options.preferredPythonVersion,
      useGristEntrypoint: true,
      importDir: options.importMount,
      ...options.sandboxOptions,
    };
    return new NSandbox(translatedOptions, this._spawner);
  }
}

// A function that takes sandbox options and starts a sandbox process.
export type SpawnFn = (options: ISandboxOptions) => SandboxProcess;

/**
 * Helper function to run a nacl sandbox. It takes care of most arguments, similarly to
 * nacl/bin/run script, but without the reliance on bash. We can't use bash when -r/-w options
 * because on Windows it doesn't pass along the open file descriptors. Bash is also unavailable
 * when installing a standalone version on Windows.
 *
 * This is quite old code, with attention to Windows support that is no longer tested.
 * I've done my best to avoid changing behavior by not touching it too much.
 */
function pynbox(options: ISandboxOptions): SandboxProcess {
  const {command, args: pythonArgs, unsilenceLog, importDir} = options;
  if (command) {
    throw new Error("NaCl can only run the specific python2.7 package built for it");
  }
  if (options.useGristEntrypoint) {
    pythonArgs.unshift('grist/main.pyc');
  }
  const spawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'] as 'pipe'[],
    env: getWrappingEnv(options)
  };
  const wrapperArgs = new FlagBag({env: '-E', mount: '-m'});
  if (importDir) {
    wrapperArgs.addMount(`${importDir}:/importdir:ro`);
  }

  if (!options.minimalPipeMode) {
    // add two more pipes
    spawnOptions.stdio.push('pipe', 'pipe');
    // We use these options to set up communication with the sandbox:
    // -r 3:3  to associate a file descriptor 3 on the outside of the sandbox with FD 3 on the
    //         inside, for reading from the inside. This becomes `this._streamToSandbox`.
    // -w 4:4  to associate FD 4 on the outside with FD 4 on the inside for writing from the inside.
    //         This becomes `this._streamFromSandbox`
    wrapperArgs.push('-r', '3:3', '-w', '4:4');
  }
  wrapperArgs.addAllEnv(getInsertedEnv(options));
  wrapperArgs.addEnv('PYTHONPATH', 'grist:thirdparty');

  const noLog = unsilenceLog ? [] :
    (process.env.OS === 'Windows_NT' ? ['-l', 'NUL'] : ['-l', '/dev/null']);
  const child = adjustedSpawn('sandbox/nacl/bin/sel_ldr', [
    '-B', './sandbox/nacl/lib/irt_core.nexe', '-m', './sandbox/nacl/root:/:ro',
    ...noLog,
    ...wrapperArgs.get(),
    './sandbox/nacl/lib/runnable-ld.so',
    '--library-path', '/slib', '/python/bin/python2.7.nexe',
    ...pythonArgs
  ], spawnOptions);
  return {child, control: () => new DirectProcessControl(child, options.logMeta)};
}

/**
 * Helper function to run python without sandboxing.  GRIST_SANDBOX should have
 * been set with an absolute path to a version of python within a virtualenv that
 * has all the dependencies installed (e.g. the sandbox_venv3 virtualenv created
 * by `./build python3`.  Using system python works too, if all dependencies have
 * been installed globally.
 */
function unsandboxed(options: ISandboxOptions): SandboxProcess {
  const {args: pythonArgs, importDir} = options;
  const paths = getAbsolutePaths(options);
  if (options.useGristEntrypoint) {
    pythonArgs.unshift(paths.main);
  }
  const spawnOptions = {
    stdio: ['pipe', 'pipe', 'pipe'] as 'pipe'[],
    env: {
      PYTHONPATH: paths.engine,
      IMPORTDIR: importDir,
      ...getInsertedEnv(options),
      ...getWrappingEnv(options),
    }
  };
  if (!options.minimalPipeMode) {
    spawnOptions.stdio.push('pipe', 'pipe');
  }
  const command = findPython(options.command, options.preferredPythonVersion);
  const child = adjustedSpawn(command, pythonArgs,
                      {cwd: path.join(process.cwd(), 'sandbox'), ...spawnOptions});
  return {child, control: () => new DirectProcessControl(child, options.logMeta)};
}

function pyodide(options: ISandboxOptions): SandboxProcess {
  const paths = getAbsolutePaths(options);
  // We will fork with three regular pipes (stdin, stdout, stderr), then
  // ipc (mandatory for calling fork), and a replacement pipe for stdin
  // and for stdout.
  // The regular stdin always opens non-blocking in node, which is a pain
  // in this case, so we just use a different pipe. There's a different
  // problem with stdout, with the same solution.
  const spawnOptions = {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc', 'pipe', 'pipe'] as Array<'pipe'|'ipc'>,
    env: {
      PYTHONPATH: paths.engine,
      IMPORTDIR: options.importDir,
      ...getInsertedEnv(options),
      ...getWrappingEnv(options),
    }
  };
  const base = getUnpackedAppRoot();
  const child = fork(path.join(base, 'sandbox', 'pyodide', 'pipe.js'),
                     {cwd: path.join(process.cwd(), 'sandbox'), ...spawnOptions});
  return {
    child,
    control: () => new DirectProcessControl(child, options.logMeta),
    dataToSandboxDescriptor: 4,  // Cannot use normal descriptor, node
    // makes it non-blocking. Can be worked around in linux and osx, but
    // for windows just using a different file descriptor seems simplest.
    // In the sandbox, calling async methods from emscripten code is
    // possible but would require more changes to the data engine code
    // than seems reasonable at this time. The top level sandbox.run
    // can be tweaked to step operations, which actually works for a
    // lot of things, but not for cases where the sandbox calls back
    // into node (e.g. for column type guessing). TLDR: just switching
    // to FD 4 and reading synchronously is more practical solution.
    dataFromSandboxDescriptor: 5, // There's an equally long but different
    // story about why stdout is a bit messed up under pyodide right now.
  };
}

/**
 * Helper function to run python in gvisor's runsc, with multiple
 * sandboxes run within the same container.  GRIST_SANDBOX should
 * point to `sandbox/gvisor/run.py` (to map call onto gvisor's runsc
 * directly) or `wrap_in_docker.sh` (to use runsc within a container).
 * Be sure to read setup instructions in that directory.
 */
function gvisor(options: ISandboxOptions): SandboxProcess {
  const {args: pythonArgs} = options;
  let command = options.command;
  if (!command) {
    try {
      // If runsc is available directly on the host, use the wrapper
      // utility in sandbox/gvisor/run.py to run it.
      which.sync('runsc');
      command = 'sandbox/gvisor/run.py';
    } catch(e) {
      // Otherwise, don't try any heroics, user will need to
      // explicitly set the command.
      throw new Error('runsc not found');
    }
  }
  if (!options.minimalPipeMode) {
    throw new Error("gvisor only supports 3-pipe operation");
  }
  const paths = getAbsolutePaths(options);
  const wrapperArgs = new FlagBag({env: '-E', mount: '-m'});
  wrapperArgs.addEnv('PYTHONPATH', paths.engine);
  wrapperArgs.addAllEnv(getInsertedEnv(options));
  wrapperArgs.addMount(paths.sandboxDir);
  if (paths.importDir) {
    wrapperArgs.addMount(paths.importDir);
    wrapperArgs.addEnv('IMPORTDIR', paths.importDir);
  }
  if (options.useGristEntrypoint) {
    pythonArgs.unshift(paths.main);
  }
  if (options.deterministicMode) {
    wrapperArgs.push('--faketime', FAKETIME);
  }
  const pythonVersion = options.preferredPythonVersion;
  if (pythonVersion !== '2' && pythonVersion !== '3') {
    throw new Error("PYTHON_VERSION must be set to 2 or 3");
  }

  // Check for local virtual environments created with core's
  // install:python2 or install:python3 targets. They'll need
  // some extra sharing to make available in the sandbox.
  const venv = path.join(getAppRootFor(getAppRoot(), 'sandbox'),
                         pythonVersion === '2' ? 'venv' : 'sandbox_venv3');
  if (fs.existsSync(venv)) {
    wrapperArgs.addMount(venv);
    wrapperArgs.push('-s', path.join(venv, 'bin', 'python'));
  }

  // For a regular sandbox not being used for importing, if GRIST_CHECKPOINT is set
  // try to restore from it. If GRIST_CHECKPOINT_MAKE is set, try to recreate the
  // checkpoint (this is an awkward place to do it, but avoids mismatches
  // between the checkpoint and how it gets used later).
  // If a sandbox is being used for import, it will have a special mount we can't
  // deal with easily right now. Should be possible to do in future if desired.
  if (options.useGristEntrypoint && pythonVersion === '3' && process.env.GRIST_CHECKPOINT && !paths.importDir) {
    if (process.env.GRIST_CHECKPOINT_MAKE) {
      const child =
        adjustedSpawn(command, [...wrapperArgs.get(), '--checkpoint', process.env.GRIST_CHECKPOINT!,
                        `python${pythonVersion}`, '--', ...pythonArgs]);
      // We don't want process control for this.
      return {child, control: () => new NoProcessControl(child)};
    }
    wrapperArgs.push('--restore');
    wrapperArgs.push(process.env.GRIST_CHECKPOINT!);
  }
  const child = adjustedSpawn(command, [...wrapperArgs.get(), `python${pythonVersion}`, '--', ...pythonArgs]);
  const childPid = child.pid;
  if (!childPid) {
    throw new Error(`failed to spawn python${pythonVersion}`);
  }

  // For gvisor under ptrace, main work is done by a traced process identifiable as
  // being labeled "exe" and having a parent also labeled "exe".
  const recognizeTracedProcess = (p: ProcessInfo) => {
    return p.label.includes('exe') && p.parentLabel.includes('exe');
  };
  // The traced process is managed by a regular process called "runsc-sandbox"
  const recognizeSandboxProcess = (p: ProcessInfo) => {
    return p.label.includes('runsc-sandbox');
  };
  // If docker is in use, this process control will log a warning message and do nothing.
  return {child, control: () => new SubprocessControl({
    pid: childPid,
    recognizers: {
      sandbox: recognizeSandboxProcess,   // this process we start and stop
      memory: recognizeTracedProcess,     // measure memory for the ptraced process
      cpu: recognizeTracedProcess,        // measure cpu for the ptraced process
      traced: recognizeTracedProcess,     // the ptraced process
    },
    logMeta: options.logMeta
  })};
}

/**
 * Helper function to run python in a container. Each sandbox run in a
 * distinct container.  GRIST_SANDBOX should be the name of an image where
 * `python` can be run and all Grist dependencies are installed.  See
 * `sandbox/docker` for more.
 */
function docker(options: ISandboxOptions): SandboxProcess {
  const {args: pythonArgs, command} = options;
  if (options.useGristEntrypoint) {
    pythonArgs.unshift('grist/main.py');
  }
  if (!options.minimalPipeMode) {
    throw new Error("docker only supports 3-pipe operation (although runc has --preserve-file-descriptors)");
  }
  const paths = getAbsolutePaths(options);
  const wrapperArgs = new FlagBag({env: '--env', mount: '-v'});
  if (paths.importDir) {
    wrapperArgs.addMount(`${paths.importDir}:/importdir:ro`);
  }
  wrapperArgs.addMount(`${paths.engine}:/grist:ro`);
  wrapperArgs.addAllEnv(getInsertedEnv(options));
  wrapperArgs.addEnv('PYTHONPATH', 'grist:thirdparty');
  const commandParts: string[] = ['python'];
  if (options.deterministicMode) {
    // DETERMINISTIC_MODE is already set by getInsertedEnv().  We also take
    // responsibility here for running faketime around python.
    commandParts.unshift('faketime', '-f', FAKETIME);
  }
  const dockerPath = which.sync('docker');
  const child = spawn(dockerPath, [
    'run', '--rm', '-i', '--network', 'none',
    ...wrapperArgs.get(),
    command || 'grist-docker-sandbox',  // this is the docker image to use
    ...commandParts,
    ...pythonArgs,
  ]);
  log.rawDebug("cannot do process control via docker yet", {...options.logMeta});
  return {child, control: () => new NoProcessControl(child)};
}

/**
 * Helper function to run python using the sandbox-exec command
 * available on MacOS.  This command is a bit shady - not much public
 * documentation for it, and what there is has been marked deprecated
 * for a few releases.  But mac sandboxing seems to rely heavily on
 * the infrastructure this command is a thin wrapper around, and there's
 * no obvious native sandboxing alternative.
 */
function macSandboxExec(options: ISandboxOptions): SandboxProcess {
  const {args: pythonArgs} = options;
  if (!options.minimalPipeMode) {
    throw new Error("macSandboxExec flavor only supports 3-pipe operation");
  }
  const paths = getAbsolutePaths(options);
  if (options.useGristEntrypoint) {
    pythonArgs.unshift(paths.main);
  }
  const env = {
    PYTHONPATH: paths.engine,
    IMPORTDIR: paths.importDir,
    ...getInsertedEnv(options),
    ...getWrappingEnv(options),
  };
  const command = findPython(options.command, options.preferredPythonVersion);
  const realPath = realpathSync(command);
  log.rawDebug("macSandboxExec found a python", {...options.logMeta, command: realPath});

  // Prepare sandbox profile
  const profile: string[] = [];

  // Deny everything by default, including network
  profile.push('(version 1)', '(deny default)');

  // Allow execution of the command, either by name provided or ultimate symlink if different
  profile.push(`(allow process-exec (literal ${JSON.stringify(command)}))`);
  profile.push(`(allow process-exec (literal ${JSON.stringify(realPath)}))`);

  // There are now a series of extra read and execute permissions added, to deal with the
  // twisted maze of symlinks around python on a mac.

  // For python symlinks to work, we need to allow reading all the intermediate directories
  // (this is determined experimentally, perhaps it can be more precise).
  const intermediatePaths = new Set<string>();
  for (const target of [command, realPath]) {
    const parts = path.dirname(target).split(path.sep);
    for (let i = 1; i < parts.length; i++) {
      const p = path.join('/', ...parts.slice(0, i));
      intermediatePaths.add(p);
    }
  }
  for (const p of intermediatePaths) {
    profile.push(`(allow file-read* (literal ${JSON.stringify(p)}))`);
  }

  // Grant read access to everything within an enclosing bin directory of original command.
  if (path.dirname(command).split(path.sep).pop() === 'bin') {
    const p = path.join(path.dirname(command), '..');
    profile.push(`(allow file-read* (subpath ${JSON.stringify(p)}))`);
  }

  // Grant read+execute access to everything within an enclosing bin directory of final target.
  if (path.dirname(realPath).split(path.sep).pop() === 'bin') {
    const p = path.join(path.dirname(realPath), '..');
    profile.push(`(allow file-read* (subpath ${JSON.stringify(p)}))`);
    profile.push(`(allow process-exec (subpath ${JSON.stringify(p)}))`);
  }

  // Sundry extra permissions that proved necessary. These work at the time of writing for
  // python versions installed by brew. Other arrangements could need tweaking.
  profile.push(`(allow file-read* (subpath "/usr/local/"))`);
  profile.push('(allow sysctl-read)');  // needed for os.uname()
  // From another python installation variant.
  profile.push(`(allow file-read* (subpath "/usr/lib/"))`);
  profile.push(`(allow file-read* (subpath "/System/Library/Frameworks/"))`);
  profile.push(`(allow file-read* (subpath "/Library/Apple/usr/libexec/oah/"))`);

  // Give access to Grist material.
  const cwd = path.join(process.cwd(), 'sandbox');
  profile.push(`(allow file-read* (subpath ${JSON.stringify(paths.sandboxDir)}))`);
  profile.push(`(allow file-read* (subpath ${JSON.stringify(cwd)}))`);
  if (options.importDir) {
    profile.push(`(allow file-read* (subpath ${JSON.stringify(paths.importDir)}))`);
  }

  const profileString = profile.join('\n');
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profileString, command, ...pythonArgs],
                      {cwd, env});
  return {child, control: () => new DirectProcessControl(child, options.logMeta)};
}

/**
 * Collect environment variables that should end up set within the sandbox.
 */
export function getInsertedEnv(options: ISandboxOptions) {
  const env: NodeJS.ProcessEnv = {
    // use stdin/stdout/stderr only.
    PIPE_MODE: options.minimalPipeMode ? 'minimal' : 'classic',
  };

  if (options.deterministicMode) {
    // Making time and randomness act deterministically for testing purposes.
    // See test/utils/recordPyCalls.ts
    // tells python to seed the random module
    env.DETERMINISTIC_MODE = '1';
  }
  return env;
}

/**
 * Collect environment variables to activate faketime if needed.  The paths
 * here only make sense for unsandboxed operation, or for pynbox.  For gvisor,
 * faketime doesn't work, and must be done inside the sandbox.  For docker,
 * likewise wrapping doesn't make sense.  In those cases, LIBFAKETIME_PATH can
 * just be set to ON to activate faketime in a sandbox dependent manner.
 */
function getWrappingEnv(options: ISandboxOptions) {
  const env: NodeJS.ProcessEnv = options.deterministicMode ? {
    // Making time and randomness act deterministically for testing purposes.
    // See test/utils/recordPyCalls.ts
    FAKETIME,  // setting for libfaketime
    // For Linux
    LD_PRELOAD: process.env.LIBFAKETIME_PATH,

    // For Mac (https://github.com/wolfcw/libfaketime/blob/master/README.OSX)
    DYLD_INSERT_LIBRARIES: process.env.LIBFAKETIME_PATH,
    DYLD_FORCE_FLAT_NAMESPACE: '1',
  } : {};
  return env;
}

/**
 * Extract absolute paths from options.  By sticking with the directory
 * structure on the host rather than remapping, we can simplify nesting
 * wrappers, or cases where remapping isn't possible.  It does leak the names
 * of the host directories though, and there could be silly complications if the
 * directories have spaces or other idiosyncrasies.  When committing to a sandbox
 * technology, for stand-alone Grist, it would be worth rethinking this.
 */
function getAbsolutePaths(options: ISandboxOptions) {
  // Get path to sandbox directory - this is a little idiosyncratic to work well
  // in grist-core.  It is important to use real paths since we may be viewing
  // the file system through a narrow window in a container.
  const sandboxDir = path.join(realpathSync(path.join(process.cwd(), 'sandbox', 'grist')),
                               '..');
  // Copy plugin options, and then make them absolute.
  if (options.importDir) {
    options.importDir = realpathSync(options.importDir);
  }
  return {
    sandboxDir,
    importDir: options.importDir,
    main: path.join(sandboxDir, 'grist/main.py'),
    engine: path.join(sandboxDir, 'grist'),
  };
}

/**
 * A tiny abstraction to make code setting up command line arguments a bit
 * easier to read.  The sandboxes are quite similar in spirit, but differ
 * a bit in exact flags used.
 */
class FlagBag {
  private _args: string[] = [];

  constructor(private _options: {env: '--env'|'-E', mount: '-m'|'-v'}) {
  }

  // channel env variables for sandbox via -E / --env
  public addEnv(key: string, value: string|undefined) {
    this._args.push(this._options.env, key + '=' + (value || ''));
  }

  // Channel all of the supplied env variables
  public addAllEnv(env: NodeJS.ProcessEnv) {
    for (const [key, value] of _.toPairs(env)) {
      this.addEnv(key, value);
    }
  }

  // channel shared directory for sandbox via -m / -v
  public addMount(share: string) {
    this._args.push(this._options.mount, share);
  }

  // add some ad-hoc arguments
  public push(...args: string[]) {
    this._args.push(...args);
  }

  // get the final list of arguments
  public get() { return this._args; }
}

// Standard time to default to if faking time.
const FAKETIME = '2020-01-01 00:00:00';

/**
 * Find a plausible version of python to run, if none provided.
 * The preferred version is only used if command is not specified.
 */
function findPython(command: string|undefined, preferredVersion?: string): string {
  if (command) { return command; }
  // No command specified.  In this case, grist-core looks for a "venv"
  // virtualenv; a python3 virtualenv would be in "sandbox_venv3".
  // TODO: rationalize this, it is a product of haphazard growth.
  const prefs = preferredVersion === '2' ? ['venv', 'sandbox_venv3'] : ['sandbox_venv3', 'venv'];
  for (const venv of prefs) {
    const base = getUnpackedAppRoot();
    // Try a battery of possible python executable paths when python is installed
    // in a standalone directory.
    // This battery of possibilities comes from Electron packaging, where python
    // is bundled with Grist. Not all the possibilities are needed (there are
    // multiple popular python bundles per OS).
    for (const possiblePath of [['bin', 'python'], ['bin', 'python3'],
                                ['Scripts', 'python.exe'], ['python.exe']] as const) {
      const pythonPath = path.join(base, venv, ...possiblePath);
      if (fs.existsSync(pythonPath)) {
        return pythonPath;
      }
    }
  }
  // Fall back on system python.
  const systemPrefs = preferredVersion === '2' ? ['2.7', '2', ''] : ['3.11', '3.10', '3.9', '3', ''];
  for (const version of systemPrefs) {
    const pythonPath = which.sync(`python${version}`, {nothrow: true});
    if (pythonPath) {
      return pythonPath;
    }
  }
  throw new Error('Cannot find Python');
}

/**
 * Create a sandbox. The defaultFlavorSpec is a guide to which sandbox
 * to create, based on the desired python version. Examples:
 *   unsandboxed               # no sandboxing
 *   2:pynbox,gvisor           # run python2 in pynbox, anything else in gvisor
 *   3:macSandboxExec,docker   # run python3 with sandbox-exec, anything else in docker
 * If no particular python version is desired, the first sandbox listed will be used.
 * The defaultFlavorSpec can be overridden by GRIST_SANDBOX_FLAVOR.
 * The commands run can be overridden by GRIST_SANDBOX2 (for python2), GRIST_SANDBOX3 (for python3),
 * or GRIST_SANDBOX (for either, if more specific variable is not specified).
 * For documents with no preferred python version specified,
 * PYTHON_VERSION_ON_CREATION or PYTHON_VERSION is used.
 */
export function createSandbox(defaultFlavorSpec: string, options: ISandboxCreationOptions): ISandbox {
  const flavors = (process.env.GRIST_SANDBOX_FLAVOR || defaultFlavorSpec).split(',');
  const preferredPythonVersion = options.preferredPythonVersion ||
    process.env.PYTHON_VERSION_ON_CREATION ||
    process.env.PYTHON_VERSION;
  for (const flavorAndVersion of flavors) {
    const parts = flavorAndVersion.trim().split(':', 2);
    const flavor = parts[parts.length - 1];
    const version = parts.length === 2 ? parts[0] : '*';
    if (preferredPythonVersion === version || version === '*' || !preferredPythonVersion) {
      const creator = new NSandboxCreator({
        defaultFlavor: flavor,
        command: process.env['GRIST_SANDBOX' + (preferredPythonVersion||'')] ||
          process.env['GRIST_SANDBOX'],
        preferredPythonVersion,
      });
      return creator.create(options);
    }
  }
  throw new Error('Failed to create a sandbox');
}

/**
 * The realpath function may not be available, just return the
 * path unchanged if it is not. Specifically, this happens when
 * compiled for use in a browser environment.
 */
function realpathSync(src: string) {
  try {
    return fs.realpathSync(src);
  } catch (e) {
    return src;
  }
}

function adjustedSpawn(cmd: string, args: string[], options?: SpawnOptionsWithoutStdio) {
  const oomScoreAdj = process.env.GRIST_SANDBOX_OOM_SCORE_ADJ;
  if (oomScoreAdj) {
    return spawn('choom', ['-n', oomScoreAdj, '--', cmd, ...args], options);
  } else {
    return spawn(cmd, args, options);
  }
}
