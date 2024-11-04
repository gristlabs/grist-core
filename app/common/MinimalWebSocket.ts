/**
 * A splitter for a websocket, used in some experiments. It splits an existing websocket (or
 * similar object) into a wrapped socket called "main" and a secondary (auxiliary) one. The
 * isAux() predicate determines which messages are seen by the main socket, and which by the aux
 * one.
 *
 * The normal Grist websocket communicates using JSON-encoded messages that always start with "{".
 * By default, anything else will be available to the auxiliary socket.
 */

export interface MinimalWebSocket {
  set onmessage(cb: null | ((data: string) => void));
  set onclose(cb: null | (() => void));
  send(data: string): void;
  get bufferedAmount(): number;
}


function isNonJson(data: string) { return !data.startsWith("{"); }

export interface SplitWebSocket<WS extends MinimalWebSocket> {
  main: WS;
  aux: MinimalWebSocket;
}

export function splitOffAuxSocket<WS extends MinimalWebSocket>(socket: WS, isAux = isNonJson): SplitWebSocket<WS> {
  let mainMessageHandler: null | ((data: string) => void) = null;
  let mainCloseHandler: null | (() => void) = null;

  // main uses the given socket as the direct prototype, and only overrides its onmessage and
  // onclose setters. We use the original setters to set our own implementations below.
  const main: WS = Object.create(socket, {
    onmessage: {
      set(cb: null | ((data: string) => void)) { mainMessageHandler = cb; }
    },
    onclose: {
      set(cb: null | (() => void)) { mainCloseHandler = cb; }
    },
  });

  // This is the aux socket.
  const aux: MinimalWebSocket = {
    onmessage: null,
    onclose: null,
    send(data: string) { return socket.send(data); },
    get bufferedAmount() { return socket.bufferedAmount; },
  };

  // When we get a message, we decide which socket sees it based on isAux() function.
  socket.onmessage = (data: string) => {
    const cb = isAux(data) ? aux.onmessage : mainMessageHandler;
    cb?.(data);
  };

  // When the socket is closed, then both main and aux sockets are closed.
  socket.onclose = () => {
    aux.onclose?.();
    mainCloseHandler?.();
  };
  return {main, aux};
}
