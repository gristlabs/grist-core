import WS from 'ws';
import { Socket as EIOSocket } from 'engine.io-client';

export interface GristClientSocketOptions {
  headers?: Record<string, string>;
}

export class GristClientSocket {
  // Exactly one of _wsSocket and _eioSocket will be set at any one time.
  private _wsSocket: WS.WebSocket | WebSocket | undefined;
  private _eioSocket: EIOSocket | undefined;

  // Set to true if a WebSocket connection (in _wsSocket) was succesfully
  // established. Errors from the underlying WebSocket are not forwarded to
  // the client until that point, in case we end up downgrading to Engine.IO.
  private _wsConnected: boolean = false;

  private _messageHandler: null | ((data: string) => void);
  private _openHandler: null | (() => void);
  private _errorHandler: null | ((err: Error) => void);
  private _closeHandler: null | (() => void);

  constructor(private _url: string, private _options?: GristClientSocketOptions) {
    this._createWSSocket();
  }

  public set onmessage(cb: null | ((data: string) => void)) {
    this._messageHandler = cb;
  }

  public set onopen(cb: null | (() => void)) {
    this._openHandler = cb;
  }

  public set onerror(cb: null | ((err: Error) => void)) {
    this._errorHandler = cb;
  }

  public set onclose(cb: null | (() => void)) {
    this._closeHandler = cb;
  }

  public close() {
    if (this._wsSocket) {
      this._wsSocket.close();
    } else {
      this._eioSocket!.close();
    }
  }

  public send(data: string) {
    if (this._wsSocket) {
      this._wsSocket.send(data);
    } else {
      this._eioSocket!.send(data);
    }
  }

  // pause() and resume() are used for tests and assume a WS.WebSocket transport
  public pause() {
    (this._wsSocket as WS.WebSocket)?.pause();
  }

  public resume() {
    (this._wsSocket as WS.WebSocket)?.resume();
  }

  private _createWSSocket() {
    if (typeof WebSocket !== 'undefined') {
      this._wsSocket = new WebSocket(this._url);
    } else {
      this._wsSocket = new WS(this._url, undefined, this._options);
    }
    this._wsSocket.onmessage = this._onWSMessage.bind(this);
    this._wsSocket.onopen = this._onWSOpen.bind(this);
    this._wsSocket.onerror = this._onWSError.bind(this);
    this._wsSocket.onclose = this._onWSClose.bind(this);
  }

  private _destroyWSSocket() {
    if (this._wsSocket) {
      this._wsSocket.onmessage = null;
      this._wsSocket.onopen = null;
      this._wsSocket.onerror = null;
      this._wsSocket.onclose = null;
      this._wsSocket = undefined;
    }
  }

  private _onWSMessage(event: WS.MessageEvent | MessageEvent<any>) {
    // event.data is guaranteed to be a string here because we only send text frames.
    // https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/message_event#event_properties
    this._messageHandler?.(event.data);
  }

  private _onWSOpen() {
    // The connection was established successfully. Any future events can now
    // be forwarded to the client.
    this._wsConnected = true;
    this._openHandler?.();
  }

  private _onWSError(ev: Event) {
    if (!this._wsConnected) {
      // The WebSocket connection attempt failed. Switch to Engine.IO.
      this._destroyWSSocket();
      this._createEIOSocket();
      return;
    }

    // WebSocket error events are deliberately void of information,
    // see https://websockets.spec.whatwg.org/#eventdef-websocket-error,
    // so we ignore the incoming event.
    this._errorHandler?.(new Error("WebSocket error"));
  }

  private _onWSClose() {
    this._closeHandler?.();
  }

  private _createEIOSocket() {
    this._eioSocket = new EIOSocket(this._url, {
      path: new URL(this._url).pathname,
      addTrailingSlash: false,
      transports: ['polling'],
      upgrade: false,
      extraHeaders: this._options?.headers,
      withCredentials: true,
    });

    this._eioSocket.on('message', this._onEIOMessage.bind(this));
    this._eioSocket.on('open', this._onEIOOpen.bind(this));
    this._eioSocket.on('error', this._onEIOError.bind(this));
    this._eioSocket.on('close', this._onEIOClose.bind(this));
  }

  private _onEIOMessage(data: string) {
    this._messageHandler?.(data);
  }

  private _onEIOOpen() {
    this._openHandler?.();
  }

  private _onEIOError(err: string | Error) {
    this._errorHandler?.(typeof err === "string" ? new Error(err) : err);
  }

  private _onEIOClose() {
    this._closeHandler?.();
  }
}