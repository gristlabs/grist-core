import {IForwarderDest, IMessage, IMsgCustom, IMsgRpcCall, IRpcLogger, MsgType, Rpc} from 'grain-rpc';
import {Checker} from "ts-interface-checker";

import {InactivityTimer} from 'app/common/InactivityTimer';
import {LocalPlugin} from 'app/common/plugin';
import {BarePlugin} from 'app/plugin/PluginManifest';

import {Implementation} from 'app/plugin/PluginManifest';
import {RenderOptions, RenderTarget} from 'app/plugin/RenderOptions';


export type ComponentKind = "safeBrowser" | "safePython" | "unsafeNode";

// Describes a function that appends some html content to `containerElement` given some
// options. Useful for provided by a plugin.
export type TargetRenderFunc = (containerElement: HTMLElement, options?: RenderOptions) => void;

/**
 * The `BaseComponent` is the base implementation for a plugins' component. It exposes methods
 * related to its activation. It provides basic features including the inactivity timer, activated
 * state for the component. A custom component must override the `deactivateImplementation`,
 * `activeImplementation` and `useRemoteAPI` methods.
 */
export abstract class BaseComponent implements IForwarderDest {

  public inactivityTimer: InactivityTimer;
  private _activated: boolean = false;

  constructor(plugin: BarePlugin, private _logger: IRpcLogger) {
    const deactivate = plugin.components.deactivate;
    const delay = (deactivate && deactivate.inactivitySec) ? deactivate.inactivitySec : 300;
    this.inactivityTimer = new InactivityTimer(() => this.deactivate(), delay * 1000);
  }

  /**
   * Wether the Component component have been activated.
   */
  public activated(): boolean {
    return this._activated;
  }

  /**
   * Activates the component.
   */
  public async activate(): Promise<void> {
    if (this._logger.info) { this._logger.info("Activating plugin component"); }
    await this.activateImplementation();
    this._activated = true;
    this.inactivityTimer.enable();
  }

  /**
   * Force deactivate the component.
   */
  public async deactivate(): Promise<void> {
    if (this._activated) {
      if (this._logger.info) { this._logger.info("Deactivating plugin component"); }
      this._activated = false;
      // Cancel the timer to ensure we don't have an unnecessary hanging timeout (in tests it will
      // prevent node from exiting, but also it's just wasteful).
      this.inactivityTimer.disable();
      try {
        await this.deactivateImplementation();
      } catch (e) {
        // If it fails, we warn and swallow the exception (or it would be an unhandled rejection).
        if (this._logger.warn) { this._logger.warn(`Deactivate failed: ${e.message}`); }
      }
    }
  }

  public async forwardCall(c: IMsgRpcCall): Promise<any> {
    if (!this._activated) { await this.activate(); }
    return await this.inactivityTimer.disableUntilFinish(this.doForwardCall(c));
  }

  public async forwardMessage(msg: IMsgCustom): Promise<any> {
    if (!this._activated) { await this.activate(); }
    this.inactivityTimer.ping();
    this.doForwardMessage(msg); // eslint-disable-line @typescript-eslint/no-floating-promises
  }

  protected abstract doForwardCall(c: IMsgRpcCall): Promise<any>;

  protected abstract doForwardMessage(msg: IMsgCustom): Promise<any>;

  protected abstract deactivateImplementation(): Promise<void>;

  protected abstract activateImplementation(): Promise<void>;
}


/**
 * Node Implementation for the PluginElement interface. A PluginInstance take care of activation of
 * the the plugins's components (activating, timing and deactivating), and create the api's for each contributions.
 *
 * Do not try to instantiate yourself, PluginManager does it for you. Instead use the
 * PluginManager.getPlugin(id) method that get instances for you.
 *
 */
export class PluginInstance {

  public rpc: Rpc;
  public safeBrowser?: BaseComponent;
  public unsafeNode?: BaseComponent;
  public safePython?: BaseComponent;

  private  _renderTargets: Map<RenderTarget, TargetRenderFunc> = new Map();

  private _nextRenderTargetId = 0;

  constructor(public definition: LocalPlugin, rpcLogger: IRpcLogger) {

    const rpc = this.rpc = new Rpc({logger: rpcLogger});
    rpc.setSendMessage((mssg: any) => rpc.receiveMessage(mssg));

    this._renderTargets.set("fullscreen", renderFullScreen);
  }

  /**
   * Create an instance for the implementation, this implementation is specific to node environment.
   */
  public getStub<Iface>(implementation: Implementation, checker: Checker): Iface {
    const components: any = this.definition.manifest.components;
    // the component forwarder was registered under the same relative path that was used to declare
    // it in the manifest
    const forwardName = components[implementation.component];
    return this.rpc.getStubForward<Iface>(forwardName, implementation.name, checker);
  }

  /**
   * Stop and clean up all components of this plugin.
   */
  public async shutdown(): Promise<void> {
    await Promise.all([
      this.safeBrowser && this.safeBrowser.deactivate(),
      this.safePython && this.safePython.deactivate(),
      this.unsafeNode && this.unsafeNode.deactivate(),
      ]);
  }

  /**
   * Create a render target and return its identifier. When a plugin calls `render` with `inline`
   * mode and this identifier, it will append the safe browser process to `element`.
   */
  public addRenderTarget(renderPluginContent: TargetRenderFunc): number {
    const id = this._nextRenderTargetId++;
    this._renderTargets.set(id, renderPluginContent);
    return id;
  }

  /**
   * Get the function that render an HTML element based on RenderTarget and RenderOptions.
   */
  public getRenderTarget(target: RenderTarget, options?: RenderOptions): TargetRenderFunc {
    const targetRenderPluginContent =  this._renderTargets.get(target);
    if (!targetRenderPluginContent) {
      throw new Error(`Unknown render target ${target}`);
    }
    return (containerElement, opts) => targetRenderPluginContent(containerElement, opts || options);
  }

  /**
   * Removes the render target.
   */
  public removeRenderTarget(target: RenderTarget): boolean {
    return this._renderTargets.delete(target);
  }

}

/**
 * Renders safe browser plugin in fullscreen.
 */
function renderFullScreen(element: Element) {
  element.classList.add("plugin_instance_fullscreen");
  document.body.appendChild(element);
}

// Basically the union of relevant interfaces of console and server log.
export interface BaseLogger {
  log?(message: string, ...args: any[]): void;
  debug?(message: string, ...args: any[]): void;
  warn?(message: string, ...args: any[]): void;
}

/**
 * Create IRpcLogger which logs to console or server log with the given prefix. Specifically will
 * warn using baseLog.warn, and log info using baseLog.debug or baseLog.log, as available.
 */
export function createRpcLogger(baseLog: BaseLogger, prefix: string): IRpcLogger {
  const info = baseLog.debug || baseLog.log;
  const warn = baseLog.warn;
  return {
    warn: warn && ((msg: string) => warn("%s %s", prefix, msg)),
    info: info && ((msg: string) => info("%s %s", prefix, msg)),
  };
}

/**
 * If msec milliseconds pass without receiving a Ready message, print the given message as a
 * warning.
 * TODO: I propose making it a method of rpc itself, as rpc.warnIfNotReady(msec, message). Until
 * we have that, this implements it via an ugly hack.
 */
export function warnIfNotReady(rpc: Rpc, msec: number, message: string): void {
  if (!(rpc as any)._logger.warn) { return; }
  const timer = setTimeout(() => (rpc as any)._logger.warn(message), msec);
  const origDispatch = (rpc as any)._dispatch;
  (rpc as any)._dispatch = (msg: IMessage) => {
    if (msg.mtype === MsgType.Ready) { clearTimeout(timer); }
    origDispatch.call(rpc, msg);
  };
}
