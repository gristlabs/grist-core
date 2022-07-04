import { ActionRouter } from 'app/common/ActionRouter';
import { LocalPlugin } from 'app/common/plugin';
import { BaseComponent, createRpcLogger, warnIfNotReady } from 'app/common/PluginInstance';
import { GristAPI, RPC_GRISTAPI_INTERFACE } from 'app/plugin/GristAPI';
import log from 'app/server/lib/log';
import { getAppPathTo } from 'app/server/lib/places';
import { makeLinePrefixer } from 'app/server/lib/sandboxUtil';
import { exitPromise, timeoutReached } from 'app/server/lib/serverUtils';
import { ChildProcess, fork, ForkOptions } from 'child_process';
import * as fse from 'fs-extra';
import { IMessage, IMsgCustom, IMsgRpcCall, Rpc } from 'grain-rpc';
import * as path from 'path';

// Error for not yet implemented api.
class NotImplemented extends Error {
  constructor(name: string) {
    super(`calling ${name} from UnsafeNode is not yet implemented`);
  }
}

/**
 * The unsafeNode component used by a PluginInstance.
 *
 */
export class UnsafeNodeComponent extends BaseComponent {
  private _child?: ChildProcess;   /* plugin node code will run as separate process */
  private _exited: Promise<void>;  /* fulfulled when process has completed */
  private _rpc: Rpc;
  private _pluginPath: string;
  private _pluginId: string;
  private _actionRouter: ActionRouter;

  private _gristAPI: GristAPI = {
    render() { throw new NotImplemented('render'); },
    dispose() { throw new NotImplemented('dispose'); },
    subscribe: (tableId: string) => this._actionRouter.subscribeTable(tableId),
    unsubscribe: (tableId: string) => this._actionRouter.unsubscribeTable(tableId),
  };

  /**
   *
   * @arg parent: the plugin instance this component is part of
   * @arg _mainPath: main script file to run
   * @arg appRoot: root path for application (important for setting a good NODE_PATH)
   * @arg _gristDocPath: path to the current Grist doc (to which this plugin applies).
   *
   */
  constructor(plugin: LocalPlugin, pluginRpc: Rpc, private _mainPath: string, public appRoot: string,
              private _gristDocPath: string,
              rpcLogger = createRpcLogger(log, `PLUGIN ${plugin.id}/${_mainPath} UnsafeNode:`)) {
    super(plugin.manifest, rpcLogger);
    this._pluginPath = plugin.path;
    this._pluginId = plugin.id;
    this._rpc = new Rpc({
      sendMessage: (msg) => this.sendMessage(msg),
      logger: rpcLogger,
    });
    this._rpc.registerForwarder('*', pluginRpc);
    this._rpc.registerImpl<GristAPI>(RPC_GRISTAPI_INTERFACE, this._gristAPI);
    this._actionRouter = new ActionRouter(this._rpc);
  }

  public async sendMessage(data: IMessage): Promise<void> {
    if (!this._child) {
      await this.activateImplementation();
    }
    this._child!.send(data);
    return Promise.resolve();
  }

  public receiveAction(action: any[]) {
    this._actionRouter.process(action)
      .catch((err: any) => log.warn('unsafeNode[%s] receiveAction failed with %s',
        this._child ? this._child.pid : "NULL", err));
  }

  /**
   *
   * Create the child node process needed for this component.
   *
   */
  protected async activateImplementation(): Promise<void> {
    log.info(`unsafeNode operating in ${this._pluginPath}`);
    const base = this._pluginPath;
    const script = path.resolve(base, this._mainPath);
    await fse.access(script, fse.constants.R_OK);
    // Time to set up the node search path the client will see.
    // We take our own, via Module.globalPaths, a poorly documented
    // method listing the search path for the active node program
    // https://github.com/nodejs/node/blob/master/test/parallel/test-module-globalpaths-nodepath.js
    const paths = require('module').globalPaths.slice().concat([
      // add the path to the plugin itself
      path.resolve(base),
      // add the path to grist's public api
      getAppPathTo(this.appRoot, 'public-api'),
      // add the path to the node_modules packaged with grist, in electron form
      getAppPathTo(this.appRoot, 'node_modules')
    ]);
    const env = Object.assign({}, process.env, {
      NODE_PATH: paths.join(path.delimiter),
      GRIST_PLUGIN_PATH: `${this._pluginId}/${this._mainPath}`,
      GRIST_DOC_PATH: this._gristDocPath,
    });
    const electronVersion: string = (process.versions as any).electron;
    if (electronVersion) {
      // Pass along the fact that we are running under an electron-ified node, for the purposes of
      // finding binaries (sqlite3 in particular).
      env.ELECTRON_VERSION = electronVersion;
    }
    const child = this._child = fork(script, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    } as ForkOptions);  // Explicit cast only because node-6 typings mistakenly omit stdio property

    log.info("unsafeNode[%s] started %s", child.pid, script);

    // Important to use exitPromise() before events from child may be received, so don't call
    // yield or await between fork and here.
    this._exited = exitPromise(child)
    .then(code => log.info("unsafeNode[%s] exited with %s", child.pid, code))
    .catch(err => log.warn("unsafeNode[%s] failed with %s", child.pid, err))
    .then(() => { this._child = undefined; });

    child.stdout!.on('data', makeLinePrefixer('PLUGIN stdout: '));
    child.stderr!.on('data', makeLinePrefixer('PLUGIN stderr: '));

    warnIfNotReady(this._rpc, 3000, "Plugin isn't ready; be sure to call grist.ready() from plugin");
    child.on('message', this._rpc.receiveMessage.bind(this._rpc));
  }

  /**
   *
   * Remove the child node process needed for this component.
   *
   */
  protected async deactivateImplementation(): Promise<void> {
    if (!this._child) {
      log.info('unsafeNode deactivating: no child process');
    } else {
      log.info('unsafeNode[%s] deactivate: disconnecting child', this._child.pid);
      this._child.disconnect();
      if (await timeoutReached(2000, this._exited)) {
        log.info("unsafeNode[%s] deactivate: sending SIGTERM", this._child.pid);
        this._child.kill('SIGTERM');
      }
      if (await timeoutReached(5000, this._exited)) {
        log.warn("unsafeNode[%s] deactivate: child still has not exited", this._child.pid);
      } else {
        log.info("unsafeNode deactivate: child exited");
      }
    }
  }

  protected doForwardCall(c: IMsgRpcCall): Promise<any> {
    return this._rpc.forwardCall({...c, mdest: ''});
  }

  protected async doForwardMessage(c: IMsgCustom): Promise<any> {
    return this._rpc.forwardMessage({...c, mdest: ''});
  }
}
