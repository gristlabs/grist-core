/**
 * The SafeBrowser component implementation is responsible for executing the safeBrowser component
 * of a plugin.
 *
 * A plugin's safeBrowser component is made of one main entry point (the javascript files declares
 * in the manifest), html files and any resources included by the html files (css, scripts, images
 * ...). The main script is the main entry point which uses the Grist API to render the views,
 * communicate with them en dispose them.
 *
 * The main script is executed within a WebWorker, and the html files are rendered within webviews
 * if run within electron, or iframe in case of the browser.
 *
 * Communication between the main process and the views are handle with rpc.
 *
 * If the plugins includes as well an unsafeNode component or a safePython component and if one of
 * them registers a function using the Grist Api, this function can then be called from within the
 * safeBrowser main script using the Grist API, as described in `app/plugin/Grist.ts`.
 *
 * The grist API available to safeBrowser components is implemented in `app/plugin/PluginImpl.ts`.
 *
 * All the safeBrowser's component resources, including the main script, the html files and any
 * other resources needed by the views, should be placed within one plugins' subfolder, and Grist
 * should serve only this folder. However, this is not yet implemented and is left as a TODO, as of
 * now the whole plugin's folder is served.
 *
 */
 // Todo: plugin resources should not be made available on the server by default, but only after
 // activation.

// tslint:disable:max-classes-per-file

import { ClientScope } from 'app/client/components/ClientScope';
import { get as getBrowserGlobals } from 'app/client/lib/browserGlobals';
import dom from 'app/client/lib/dom';
import * as Mousetrap from 'app/client/lib/Mousetrap';
import { ActionRouter } from 'app/common/ActionRouter';
import { BaseComponent, BaseLogger, createRpcLogger, PluginInstance, warnIfNotReady } from 'app/common/PluginInstance';
import { tbind } from 'app/common/tbind';
import { Theme } from 'app/common/ThemePrefs';
import { getOriginUrl } from 'app/common/urlUtils';
import { GristAPI, RPC_GRISTAPI_INTERFACE } from 'app/plugin/GristAPI';
import { RenderOptions, RenderTarget } from 'app/plugin/RenderOptions';
import { checkers } from 'app/plugin/TypeCheckers';
import { Computed, dom as grainjsDom, Observable } from 'grainjs';
import { IMsgCustom, IMsgRpcCall, IRpcLogger, MsgType, Rpc } from 'grain-rpc';
import { Disposable } from './dispose';
import isEqual from 'lodash/isEqual';
const G = getBrowserGlobals('document', 'window');

/**
 * The SafeBrowser component implementation. Responsible for running the script, rendering the
 * views, settings up communication channel.
 */
 // todo: it is unfortunate that SafeBrowser had to expose both `renderImpl` and `disposeImpl` which
 // really have no business outside of this module. What could be done, is to have an internal class
 // ProcessManager which will be created by SafeBrowser as a private field. It will manage the
 // client processes and among other thing will expose both renderImpl and
 // disposeImpl. ClientProcess will hold a reference to ProcessManager instead of SafeBrowser.
export class SafeBrowser extends BaseComponent {
  /**
   * Create a webview ClientProcess to render safe browser process in electron.
   */
  public static createWorker(safeBrowser: SafeBrowser, rpc: Rpc, src: string): WorkerProcess {
    return new WorkerProcess(safeBrowser, rpc, src);
  }

  /**
   * Create either an iframe or a webview ClientProcess depending on wether running electron or not.
   */
  public static createView(safeBrowser: SafeBrowser, rpc: Rpc, src: string): ViewProcess {
    return G.window.isRunningUnderElectron ?
      new WebviewProcess(safeBrowser, rpc, src) :
      new IframeProcess(safeBrowser, rpc, src);
  }

  public theme = this._options.theme;

  // All view processes. This is not used anymore to dispose all processes on deactivation (this is
  // now achieved using `this._mainProcess.autoDispose(...)`) but rather to be able to dispatch
  // events to all processes (such as doc actions which will need soon).
  private _viewProcesses: Map<number, ClientProcess> = new Map();
  private _pluginId: string;
  private _pluginRpc: Rpc;
  private _mainProcess: WorkerProcess|undefined;
  private _viewCount: number = 0;

  private _plugin = this._options.pluginInstance;
  private _clientScope = this._options.clientScope;
  private _untrustedContentOrigin = this._options.untrustedContentOrigin;
  private _mainPath = this._options.mainPath ?? '';
  private _baseLogger = this._options.baseLogger ?? console;

  constructor(private _options: {
    pluginInstance: PluginInstance,
    clientScope: ClientScope,
    untrustedContentOrigin: string,
    theme: Computed<Theme>,
    mainPath?: string,
    baseLogger?: BaseLogger,
    rpcLogger?: IRpcLogger,
  }) {
    super(
      _options.pluginInstance.definition.manifest,
      _options.rpcLogger ?? createRpcLogger(
        _options.baseLogger ?? console,
        `PLUGIN ${_options.pluginInstance.definition.id} SafeBrowser:`
      )
    );
    this._pluginId = this._plugin.definition.id;
    this._pluginRpc = this._plugin.rpc;
  }

  /**
   * Render the file at path in an iframe or webview and returns its ViewProcess.
   */
  public createViewProcess(path: string): ViewProcess {
    return this._createViewProcess(path)[0];
  }
  /**
   * `receiveAction` handles an action received from the server by forwarding it to the view processes.
   */
  public receiveAction(action: any[]) {
    for (const view of this._viewProcesses.values()) {
      view.receiveAction(action);
    }
  }


  /**
   * Renders the file at path and returns its proc id. This is the SafeBrowser implementation for
   * the GristAPI's render(...) method, more details can be found at app/plugin/GristAPI.ts.
   */
  public async renderImpl(path: string, target: RenderTarget, options: RenderOptions): Promise<number> {
    const [proc, viewId] = this._createViewProcess(path);
    const renderFunc = this._plugin.getRenderTarget(target, options);
    renderFunc(proc.element);
    if (this._mainProcess) {
      // Disposing the web worker should dispose all view processes that created using the
      // gristAPI. There is a flaw here: please read [1].
      this._mainProcess.autoDispose(proc);
    }
    return viewId;
    // [1]: When a process, which is not owned by the mainProcess (ie: a process which was created
    // using `public createViewProcess(...)'), creates a view process using the gristAPI, the
    // rendered view will be owned by the main process. This is not correct and could cause views to
    // suddently disappear from the screen. This is pretty nasty. But for following reason I think
    // it's ok to leave it for now: (1) fixing this would require (yet) another refactoring of
    // SafeBrowser and (2) at this point it is not sure wether we want to keep `render()` in the
    // future (we could as well directly register contribution using files directly in the
    // manifest), and (3) plugins are only developed by us, we only have to remember that using
    // `render()` is only supported from within the main process (which cover all our use cases so
    // far).
  }

  /**
   * Dispose the process using it's proc id. This is the SafeBrowser implementation for the
   * GristAPI's dispose(...) method, more details can be found at app/plugin/GristAPI.ts.
   */
  public async disposeImpl(procId: number): Promise<void> {
    const proc = this._viewProcesses.get(procId);
    if (proc) {
      this._viewProcesses.delete(procId);
      proc.dispose();
    }
  }

  protected doForwardCall(c: IMsgRpcCall): Promise<any> {
    if (this._mainProcess) {
      return this._mainProcess.rpc.forwardCall(c);
    }
    // should not happen.
    throw new Error("Using SafeBrowser as an IForwarder requires a main script");
  }

  protected doForwardMessage(c: IMsgCustom): Promise<any> {
    if (this._mainProcess) {
      return this._mainProcess.rpc.forwardMessage(c);
    }
    // should not happen.
    throw new Error("Using SafeBrowser as an IForwarder requires a main script");
  }

  protected async activateImplementation(): Promise<void> {
    if (this._mainPath) {
      const rpc = this._createRpc(this._mainPath);
      const src = `plugins/${this._pluginId}/${this._mainPath}`;
      // This SafeBrowser object is registered with _pluginRpc as _mainPath forwarder, and
      // forwards calls to _mainProcess in doForward* methods (called from BaseComponent.forward*
      // methods). Note that those calls are what triggers component activation.
      this._mainProcess = SafeBrowser.createWorker(this, rpc, src);
    }
  }

  protected async deactivateImplementation(): Promise<void> {
    if (this._mainProcess) {
      this._mainProcess.dispose();
    }
  }

  /**
   * Creates an iframe or a webview embedding the file at path. And adds it to `this._viewProcesses`
   * using `viewId` as key, and registers it as forwarder to the `pluginRpc` using name
   * `path`. Unregister both on disposal.
   */
  private _createViewProcess(path: string): [ViewProcess, number] {
    const rpc = this._createRpc(path);
    const url = `${this._untrustedContentOrigin}/plugins/${this._plugin.definition.id}/${path}`
    + `?host=${G.window.location.origin}`;
    const viewId = this._viewCount++;
    const process = SafeBrowser.createView(this, rpc, url);
    this._viewProcesses.set(viewId, process);
    this._pluginRpc.registerForwarder(path, rpc);
    process.autoDisposeCallback(() => {
      this._pluginRpc.unregisterForwarder(path);
      this._viewProcesses.delete(viewId);
    });
    return [process, viewId];
  }

  /**
   * Create an rpc instance and set it up for communicating with a ClientProcess:
   *  - won't send any message before receiving a ready message
   *  - has the '*' forwarder set to the plugin's instance rpc
   *  - has registered an implementation of the gristAPI.
   * Returns the rpc instance.
   */
  private _createRpc(path: string): Rpc {
    const rpc = new Rpc({logger: createRpcLogger(this._baseLogger, `PLUGIN ${this._pluginId}/${path} SafeBrowser:`) });
    rpc.queueOutgoingUntilReadyMessage();
    warnIfNotReady(rpc, 3000, "Plugin isn't ready; be sure to call grist.ready() from plugin");
    rpc.registerForwarder('*', this._pluginRpc);
    // TODO: we should be able to stop serving plugins, it looks like there are some resources
    // required that should be disposed on component deactivation.
    this._clientScope.servePlugin(this._pluginId, rpc);
    return rpc;
  }


}

/**
 * Base class for any client process. `onDispose` allows to register a callback that will be
 * triggered when dispose() is called. This is for internally use.
 */
export class ClientProcess extends Disposable {
  public rpc: Rpc;

  private _safeBrowser: SafeBrowser;
  private _src: string;
  private _actionRouter: ActionRouter;

  public create(...args: any[]): void;
  public create(safeBrowser: SafeBrowser, rpc: Rpc, src: string) {
    this.rpc = rpc;
    this._safeBrowser = safeBrowser;
    this._src = src;
    this._actionRouter = new ActionRouter(this.rpc);
    const gristAPI: GristAPI = {
      subscribe:    tbind(this._actionRouter.subscribeTable, this._actionRouter),
      unsubscribe:  tbind(this._actionRouter.unsubscribeTable, this._actionRouter),
      render:       tbind(this._safeBrowser.renderImpl, this._safeBrowser),
      dispose:      tbind(this._safeBrowser.disposeImpl, this._safeBrowser),
    };
    rpc.registerImpl<GristAPI>(RPC_GRISTAPI_INTERFACE, gristAPI, checkers.GristAPI);
    this.autoDisposeCallback(() => {
      this.rpc.unregisterImpl(RPC_GRISTAPI_INTERFACE);
    });
  }

  public receiveAction(action: any[]) {
    this._actionRouter.process(action)
      // tslint:disable:no-console
      .catch((err: any) => console.warn("ClientProcess[%s] receiveAction: failed with %s", this._src, err));
  }

}

/**
 * The web worker client process, used to execute safe browser main script.
 */
class WorkerProcess extends ClientProcess  {
  public create(safeBrowser: SafeBrowser, rpc: Rpc, src: string) {
    super.create(safeBrowser, rpc, src);
    // Serve web worker script from same host as current page
    const worker = new Worker(getOriginUrl(`/${src}`));
    worker.addEventListener("message", (e: MessageEvent) => this.rpc.receiveMessage(e.data));
    this.rpc.setSendMessage(worker.postMessage.bind(worker));
    this.autoDisposeCallback(() => worker.terminate());
  }
}

export class ViewProcess extends ClientProcess {
  public element: HTMLElement;

  // Set once all of the plugin's onThemeChange handlers have been called.
  protected _themeInitialized: Observable<boolean>;
}

/**
 * The Iframe ClientProcess used to render safe browser content in the browser.
 */
class IframeProcess extends ViewProcess {
  public create(safeBrowser: SafeBrowser, rpc: Rpc, src: string) {
    super.create(safeBrowser, rpc, src);
    this._themeInitialized = Observable.create(this, false);
    const iframe = this.element = this.autoDispose(
      grainjsDom(`iframe.safe_browser_process.clipboard_focus`,
        {src},
        grainjsDom.style('visibility', use => use(this._themeInitialized) ? 'visible' : 'hidden'),
      ) as HTMLIFrameElement
    );
    const listener = async (event: MessageEvent) => {
      if (event.source === iframe.contentWindow) {
        if (event.data.mtype === MsgType.Ready) {
          await this._sendTheme({theme: safeBrowser.theme.get(), fromReady: true});
        }

        if (event.data.data?.message === 'themeInitialized') {
          this._themeInitialized.set(true);
        }

        this.rpc.receiveMessage(event.data);
      }
    };
    G.window.addEventListener('message', listener);
    this.autoDisposeCallback(() => {
      G.window.removeEventListener('message', listener);
    });
    this.rpc.setSendMessage(msg => iframe.contentWindow!.postMessage(msg, '*'));

    if (safeBrowser.theme) {
      this.autoDispose(
        safeBrowser.theme.addListener(async (newTheme, oldTheme) => {
          if (isEqual(newTheme, oldTheme)) { return; }

          await this._sendTheme({theme: newTheme});
        })
      );
    }
  }

  private async _sendTheme({theme, fromReady = false}: {theme: Theme, fromReady?: boolean}) {
    await this.rpc.postMessage({theme, fromReady});
  }
}

/**
 * The webview ClientProcess to render safe browser process in electron.
 */
class WebviewProcess extends ViewProcess {
  public create(safeBrowser: SafeBrowser, rpc: Rpc, src: string) {
    super.create(safeBrowser, rpc, src);
    const webview = this.element = this.autoDispose(dom('webview.safe_browser_process.clipboard_focus', {
      src,
      allowpopups: '',
      // Requests with this partition get an extra header (see main.js) to get access to plugin content.
      partition: 'plugins',
    }));
    // Temporaily disable "mousetrap" keyboard stealing for the duration of this webview.
    // This is acceptable since webviews are currently full-screen modals.
    // TODO: find a way for keyboard events to play nice when webviews are non-modal.
    Mousetrap.setPaused(true);
    this.autoDisposeCallback(() => Mousetrap.setPaused(false));
    webview.addEventListener('ipc-message', (event: any /* IpcMessageEvent */) => {
      // The event object passed to the listener is missing proper documentation. In the examples
      // listed in https://electronjs.org/docs/api/ipc-main the arguments should be passed to the
      // listener after the event object, but this is not happening here. Only we know it is a
      // DOMEvent with some extra porperties including a `channel` property of type `string` and an
      // `args` property of type `any[]`.
      if (event.channel === 'grist') {
        rpc.receiveMessage(event.args[0]);
      }
    });
    this.rpc.setSendMessage(msg => webview.send('grist', msg));
  }
}
