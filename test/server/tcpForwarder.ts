import {Server, Socket} from 'net';
import {connect as connectSock, getAvailablePort, listenPromise} from 'app/server/lib/serverUtils';

// We'll test reconnects by making a connection through this TcpForwarder, which we'll use to
// simulate disconnects.
export class TcpForwarder {
  public port: number|null = null;
  private _connections = new Map<Socket, Socket>();
  private _server: Server|null = null;

  constructor(private _serverPort: number, private _serverHost?: string) {}

  public async pickForwarderPort(): Promise<number> {
    this.port = await getAvailablePort(5834);
    return this.port;
  }
  public async connect() {
    await this.disconnect();
    this._server = new Server((sock) => this._onConnect(sock));
    await listenPromise(this._server.listen(this.port));
  }
  public async disconnectClientSide() {
    await Promise.all(Array.from(this._connections.keys(), destroySock));
    if (this._server) {
      await new Promise((resolve) => this._server!.close(resolve));
      this._server = null;
    }
    this.cleanup();
  }
  public async disconnectServerSide() {
    await Promise.all(Array.from(this._connections.values(), destroySock));
    this.cleanup();
  }
  public async disconnect() {
    await this.disconnectClientSide();
    await this.disconnectServerSide();
  }
  public cleanup() {
    const pairs = Array.from(this._connections.entries());
    for (const [clientSock, serverSock] of pairs) {
      if (clientSock.destroyed && serverSock.destroyed) {
        this._connections.delete(clientSock);
      }
    }
  }
  private async _onConnect(clientSock: Socket) {
    const serverSock = await connectSock(this._serverPort, this._serverHost);
    clientSock.pipe(serverSock);
    serverSock.pipe(clientSock);
    clientSock.on('error', (err) => serverSock.destroy(err));
    serverSock.on('error', (err) => clientSock.destroy(err));
    this._connections.set(clientSock, serverSock);
  }
}

async function destroySock(sock: Socket): Promise<void> {
  if (!sock.destroyed) {
    await new Promise((resolve, reject) =>
      sock.on('close', resolve).destroy());
  }
}
