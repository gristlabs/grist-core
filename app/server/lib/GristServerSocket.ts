import * as WS from 'ws';
import * as EIO from 'engine.io';

export abstract class GristServerSocket {
  public abstract set onerror(handler: (err: Error) => void);
  public abstract set onclose(handler: () => void);
  public abstract set onmessage(handler: (data: string) => void);
  public abstract removeAllListeners(): void;
  public abstract close(): void;
  public abstract terminate(): void;
  public abstract get isOpen(): boolean;
  public abstract send(data: string, cb?: (err?: Error) => void): void;
}

export class GristServerSocketEIO extends GristServerSocket {
  private _eventHandlers: Array<{ event: string, handler: (...args: any[]) => void }> = [];
  private _messageCounter = 0;

  // Engine.IO only invokes send() callbacks on success. We keep a map of
  // send callbacks for messages in flight so that we can invoke them for
  // any messages still unsent upon receiving a "close" event.
  private _messageCallbacks: Map<number, (err: Error) => void> = new Map();

  constructor(private _socket: EIO.Socket) { super(); }

  public set onerror(handler: (err: Error) => void) {
    // Note that as far as I can tell, Engine.IO sockets never emit "error"
    // but instead include error information in the "close" event.
    this._socket.on('error', handler);
    this._eventHandlers.push({ event: 'error', handler });
  }

  public set onclose(handler: () => void) {
    const wrappedHandler = (reason: string, description: any) => {
      // In practice, when available, description has more error details,
      // possibly in the form of an Error object.
      const maybeErr = description ?? reason;
      const err = maybeErr instanceof Error ? maybeErr : new Error(maybeErr);
      for (const cb of this._messageCallbacks.values()) {
        cb(err);
      }
      this._messageCallbacks.clear();

      handler();
    };
    this._socket.on('close', wrappedHandler);
    this._eventHandlers.push({ event: 'close', handler: wrappedHandler });
  }

  public set onmessage(handler: (data: string) => void) {
    const wrappedHandler = (msg: Buffer) => {
      handler(msg.toString());
    };
    this._socket.on('message', wrappedHandler);
    this._eventHandlers.push({ event: 'message', handler: wrappedHandler });
  }

  public removeAllListeners() {
    for (const { event, handler } of this._eventHandlers) {
      this._socket.off(event, handler);
    }
    this._eventHandlers = [];
  }

  public close() {
    this._socket.close();
  }

  // Terminates the connection without waiting for the client to close its own side.
  public terminate() {
    // Trigger a normal close. For the polling transport, this is sufficient and instantaneous.
    this._socket.close(/* discard */ true);
  }

  public get isOpen() {
    return this._socket.readyState === 'open';
  }

  public send(data: string, cb?: (err?: Error) => void) {
    const msgNum = this._messageCounter++;
    if (cb) {
      this._messageCallbacks.set(msgNum, cb);
    }
    this._socket.send(data, {}, () => {
      if (cb && this._messageCallbacks.delete(msgNum)) {
        // send was successful: pass no Error to callback
        cb();
      }
    });
  }
}

export class GristServerSocketWS extends GristServerSocket {
  private _eventHandlers: Array<{ event: string, handler: (...args: any[]) => void }> = [];

  constructor(private _ws: WS.WebSocket) { super(); }

  public set onerror(handler: (err: Error) => void) {
    this._ws.on('error', handler);
    this._eventHandlers.push({ event: 'error', handler });
  }

  public set onclose(handler: () => void) {
    this._ws.on('close', handler);
    this._eventHandlers.push({ event: 'close', handler });
  }

  public set onmessage(handler: (data: string) => void) {
    const wrappedHandler = (msg: Buffer) => handler(msg.toString());
    this._ws.on('message', wrappedHandler);
    this._eventHandlers.push({ event: 'message', handler: wrappedHandler });
  }

  public removeAllListeners() {
    // Avoiding websocket.removeAllListeners() because WS.Server registers listeners
    // internally for websockets it keeps track of, and we should not accidentally remove those.
    for (const { event, handler } of this._eventHandlers) {
      this._ws.off(event, handler);
    }
    this._eventHandlers = [];
  }

  public close() {
    this._ws.close();
  }

  public terminate() {
    this._ws.terminate();
  }

  public get isOpen() {
    return this._ws.readyState === WS.OPEN;
  }

  public send(data: string, cb?: (err?: Error) => void) {
    this._ws.send(data, cb);
  }
}
