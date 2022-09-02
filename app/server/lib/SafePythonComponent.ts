import {LocalPlugin} from 'app/common/plugin';
import {BaseComponent, createRpcLogger} from 'app/common/PluginInstance';
import {GristServer} from 'app/server/lib/GristServer';
import {ISandbox} from 'app/server/lib/ISandbox';
import log from 'app/server/lib/log';
import {IMsgCustom, IMsgRpcCall} from 'grain-rpc';

// TODO safePython component should be able to call other components function
// TODO calling a function on safePython component with a name that was not register chould fail
// gracefully.

/**
 * The safePython component used by a PluginInstance.
 *
 * It uses `NSandbox` implementation of rpc for calling methods within the sandbox.
 */
export class SafePythonComponent extends BaseComponent {

  private _sandbox?: ISandbox;
  private _logMeta: log.ILogMeta;

  // safe python component does not need pluginInstance.rpc because it is not possible to forward
  // calls to other component from within python
  constructor(_localPlugin: LocalPlugin,
              private _tmpDir: string,
              docName: string, private _server: GristServer,
              rpcLogger = createRpcLogger(log, `PLUGIN ${_localPlugin.id} SafePython:`)) {
    super(_localPlugin.manifest, rpcLogger);
    this._logMeta = {plugin: _localPlugin.id, docId: docName};
  }

  /**
   * `SafePythonComponent` activation creates the Sandbox. Throws if the plugin has no `safePyton`
   * components.
   */
  protected async activateImplementation(): Promise<void> {
    if (!this._tmpDir) {
      throw new Error("Sanbox should have a tmpDir");
    }
    this._sandbox = this._server.create.NSandbox({
      importMount: this._tmpDir,
      logTimes: true,
      logMeta: this._logMeta,
      preferredPythonVersion: '3',
    });
  }

  protected async deactivateImplementation(): Promise<void> {
    log.info('SafePython deactivating ...');
    if (!this._sandbox) {
      log.info('  sandbox is undefined');
    }
    if (this._sandbox) {
      await this._sandbox.shutdown();
      log.info('SafePython done deactivating the sandbox');
      delete this._sandbox;
    }
  }

  protected doForwardCall(c: IMsgRpcCall): Promise<any> {
    if (!this._sandbox) { throw new Error("Component should have be activated"); }
    const {meth, iface, args} = c;
    const funcName = meth === "invoke" ? iface : iface + "." + meth;
    return this._sandbox.pyCall(funcName, ...args);
  }

  protected doForwardMessage(c: IMsgCustom): Promise<any> {
    throw new Error("Forwarding messages to python sandbox is not supported");
  }

}
