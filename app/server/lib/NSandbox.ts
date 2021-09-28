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
import {ChildProcess, spawn} from 'child_process';
import * as path from 'path';
import {Stream, Writable} from 'stream';
import * as _ from 'lodash';
import * as fs from 'fs';
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
interface ISandboxOptions {
  command?: string;       // External program or container to call to run the sandbox.
  args: string[];         // The arguments to pass to the python process.

  preferredPythonVersion?: string;  // Mandatory for gvisor; ignored by other methods.

  // TODO: update
  // ISandboxCreationOptions to talk about directories instead of
  // mounts, since it may not be possible to remap directories as
  // mounts (e.g. for unsandboxed operation).
  importDir?: string;  // a directory containing data file(s) to import by plugins

  docUrl?: string;               // URL to the document, for SELF_HYPERLINK
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

type ResolveRejectPair = [(value?: any) => void, (reason?: unknown) => void];

// Type for basic message identifiers, available as constants in sandboxUtil.
type MsgCode = null | true | false;

// Optional root folder to store binary data sent to and from the sandbox
// See test_replay.py
const recordBuffersRoot = process.env.RECORD_SANDBOX_BUFFERS_DIR;

export class NSandbox implements ISandbox {

  public readonly childProc: ChildProcess;
  private _logTimes: boolean;
  private _exportedFunctions: {[name: string]: SandboxMethod};
  private _marshaller = new marshal.Marshaller({stringToBuffer: false, version: 2});
  private _unmarshaller = new marshal.Unmarshaller({ bufferToString: false });

  // Members used for reading from the sandbox process.
  private _pendingReads: ResolveRejectPair[] = [];
  private _isReadClosed = false;
  private _isWriteClosed = false;

  private _logMeta: log.ILogMeta;
  private _streamToSandbox: Writable;
  private _streamFromSandbox: Stream;

  private _throttle: Throttle | undefined;

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

    this.childProc = spawner(options);

    this._logMeta = {sandboxPid: this.childProc.pid, ...options.logMeta};

    if (options.minimalPipeMode) {
      log.rawDebug("3-pipe Sandbox started", this._logMeta);
      this._streamToSandbox = this.childProc.stdin;
      this._streamFromSandbox = this.childProc.stdout;
    } else {
      log.rawDebug("5-pipe Sandbox started", this._logMeta);
      this._streamToSandbox = (this.childProc.stdio as Stream[])[3] as Writable;
      this._streamFromSandbox = (this.childProc.stdio as Stream[])[4];
      this.childProc.stdout.on('data', sandboxUtil.makeLinePrefixer('Sandbox stdout: ', this._logMeta));
    }
    this.childProc.stderr.on('data', sandboxUtil.makeLinePrefixer('Sandbox stderr: ', this._logMeta));

    this.childProc.on('close', this._onExit.bind(this));
    this.childProc.on('error', this._onError.bind(this));

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
    const timeoutID = setTimeout(() => {
      log.rawWarn("Sandbox sending SIGKILL", this._logMeta);
      this.childProc.kill('SIGKILL');
    }, 1000);

    const result = await new Promise((resolve, reject) => {
      if (this._isWriteClosed) { resolve(); }
      this.childProc.on('error', reject);
      this.childProc.on('close', resolve);
      this.childProc.on('exit', resolve);
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
    const buf = this._marshaller.dumpAsBuffer();
    if (this._recordBuffersDir) {
      fs.appendFileSync(path.resolve(this._recordBuffersDir, "input"), buf);
    }
    return this._streamToSandbox.write(buf);
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

/**
 * Functions for spawning all of the currently supported sandboxes.
 */
const spawners = {
  pynbox,             // Grist's "classic" sandbox - python2 within NaCl.
  unsandboxed,        // No sandboxing, straight to host python.
                      // This offers no protection to the host.
  docker,             // Run sandboxes in distinct docker containers.
  gvisor,             // Gvisor's runsc sandbox.
};

/**
 * A sandbox factory.  This doesn't do very much beyond remembering a default
 * flavor of sandbox (which at the time of writing differs between hosted grist and
 * grist-core), and trying to regularize creation options a bit.
 *
 * The flavor of sandbox to use can be overridden by some environment variables:
 *   - GRIST_SANDBOX_FLAVOR: should be one of the spawners (pynbox, unsandboxed, docker,
 *     gvisor)
 *   - GRIST_SANDBOX: a program or image name to run as the sandbox.  Not needed for
 *     pynbox (it is either built in or not avaiable).  For unsandboxed, should be an
 *     absolute path to python within a virtualenv with all requirements installed.
 *     For docker, it should be `grist-docker-sandbox` (an image built via makefile
 *     in `sandbox/docker`) or a derived image.  For gvisor, it should be the full path
 *     to `sandbox/gvisor/run.py` (if runsc available locally) or to
 *     `sandbox/gvisor/wrap_in_docker.sh` (if runsc should be run using the docker
 *     image built in that directory).  Gvisor is not yet available in grist-core.
 *   - PYTHON_VERSION: for gvisor, this is mandatory, and must be set to "2" or "3".
 *     It is ignored by other flavors.
 */
export class NSandboxCreator implements ISandboxCreator {
  private _flavor: keyof typeof spawners;
  private _command?: string;
  private _preferredPythonVersion?: string;

  public constructor(options: {
    defaultFlavor: keyof typeof spawners,
    ignoreEnvironment?: boolean,
    command?: string,
    preferredPythonVersion?: string,
  }) {
    const flavor = (!options.ignoreEnvironment && process.env.GRIST_SANDBOX_FLAVOR) ||
      options.defaultFlavor;
    if (!Object.keys(spawners).includes(flavor)) {
      throw new Error(`Unrecognized sandbox flavor: ${flavor}`);
    }
    this._flavor = flavor as keyof typeof spawners;
    this._command = (!options.ignoreEnvironment && process.env.GRIST_SANDBOX) ||
      options.command;
    this._preferredPythonVersion = (!options.ignoreEnvironment && process.env.PYTHON_VERSION) ||
      options.preferredPythonVersion;
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
      docUrl: options.docUrl,
      args,
      logCalls: options.logCalls,
      logMeta: {flavor: this._flavor, command: this._command,
                entryPoint: options.entryPoint || '(default)',
                ...options.logMeta},
      logTimes: options.logTimes,
      command: this._command,
      preferredPythonVersion: this._preferredPythonVersion,
      useGristEntrypoint: true,
      importDir: options.importMount,
    };
    return new NSandbox(translatedOptions, spawners[this._flavor]);
  }
}

// A function that takes sandbox options and starts a sandbox process.
type SpawnFn = (options: ISandboxOptions) => ChildProcess;

/**
 * Helper function to run a nacl sandbox. It takes care of most arguments, similarly to
 * nacl/bin/run script, but without the reliance on bash. We can't use bash when -r/-w options
 * because on Windows it doesn't pass along the open file descriptors. Bash is also unavailable
 * when installing a standalone version on Windows.
 *
 * This is quite old code, with attention to Windows support that is no longer tested.
 * I've done my best to avoid changing behavior by not touching it too much.
 */
function pynbox(options: ISandboxOptions): ChildProcess {
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
  return spawn('sandbox/nacl/bin/sel_ldr', [
    '-B', './sandbox/nacl/lib/irt_core.nexe', '-m', './sandbox/nacl/root:/:ro',
    ...noLog,
    ...wrapperArgs.get(),
    './sandbox/nacl/lib/runnable-ld.so',
    '--library-path', '/slib', '/python/bin/python2.7.nexe',
    ...pythonArgs
  ], spawnOptions);
}

/**
 * Helper function to run python without sandboxing.  GRIST_SANDBOX should have
 * been set with an absolute path to a version of python within a virtualenv that
 * has all the dependencies installed (e.g. the sandbox_venv3 virtualenv created
 * by `./build python3`.  Using system python works too, if all dependencies have
 * been installed globally.
 */
function unsandboxed(options: ISandboxOptions): ChildProcess {
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
  let command = options.command;
  if (!command) {
    // No command specified.  In this case, grist-core looks for a "venv"
    // virtualenv; a python3 virtualenv would be in "sandbox_venv3".
    // TODO: rationalize this, it is a product of haphazard growth.
    for (const venv of ['sandbox_venv3', 'venv']) {
      const pythonPath = path.join(process.cwd(), venv, 'bin', 'python');
      if (fs.existsSync(pythonPath)) {
        command = pythonPath;
        break;
      }
    }
    // Fall back on system python.
    if (!command) {
      command = which.sync('python');
    }
  }
  return spawn(command, pythonArgs,
               {cwd: path.join(process.cwd(), 'sandbox'), ...spawnOptions});
}

/**
 * Helper function to run python in gvisor's runsc, with multiple
 * sandboxes run within the same container.  GRIST_SANDBOX should
 * point to `sandbox/gvisor/run.py` (to map call onto gvisor's runsc
 * directly) or `wrap_in_docker.sh` (to use runsc within a container).
 * Be sure to read setup instructions in that directory.
 */
function gvisor(options: ISandboxOptions): ChildProcess {
  const {command, args: pythonArgs} = options;
  if (!command) { throw new Error("gvisor operation requires GRIST_SANDBOX"); }
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
  return spawn(command, [...wrapperArgs.get(), `python${pythonVersion}`, '--', ...pythonArgs]);
}

/**
 * Helper function to run python in a container. Each sandbox run in a
 * distinct container.  GRIST_SANDBOX should be the name of an image where
 * `python` can be run and all Grist dependencies are installed.  See
 * `sandbox/docker` for more.
 */
function docker(options: ISandboxOptions): ChildProcess {
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
  return spawn(dockerPath, [
    'run', '--rm', '-i', '--network', 'none',
    ...wrapperArgs.get(),
    command || 'grist-docker-sandbox',  // this is the docker image to use
    ...commandParts,
    ...pythonArgs,
  ]);
}

/**
 * Collect environment variables that should end up set within the sandbox.
 */
export function getInsertedEnv(options: ISandboxOptions) {
  const env: NodeJS.ProcessEnv = {
    DOC_URL: (options.docUrl || '').replace(/[^-a-zA-Z0-9_:/?&.~]/g, ''),

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
 * directories have spaces or other idiosyncracies.  When committing to a sandbox
 * technology, for stand-alone Grist, it would be worth rethinking this.
 */
function getAbsolutePaths(options: ISandboxOptions) {
  // Get path to sandbox directory - this is a little idiosyncratic to work well
  // in grist-core.  It is important to use real paths since we may be viewing
  // the file system through a narrow window in a container.
  const sandboxDir = path.join(fs.realpathSync(path.join(process.cwd(), 'sandbox', 'grist')),
                               '..');
  // Copy plugin options, and then make them absolute.
  if (options.importDir) {
    options.importDir = fs.realpathSync(options.importDir);
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
