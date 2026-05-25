import { serveSomething, Serving } from "test/server/customUtil";

import axios from "axios";
import * as express from "express";

export class TestProxyServer {
  public static async Prepare(portNumber: number): Promise<TestProxyServer> {
    const server = new TestProxyServer(portNumber);
    await server._prepare();
    return server;
  }

  public get proxyCallCounter() { return this._proxyCallsCounter; }
  public get connectCallCounter() { return this._connectCallsCounter; }
  private _proxyCallsCounter: number = 0;
  private _connectCallsCounter: number = 0;
  private _proxyServing: Serving;

  private constructor(public readonly portNumber: number) {
  }

  public wasProxyCalled(): boolean {
    return this._proxyCallsCounter > 0;
  }

  public async dispose() {
    await this._proxyServing.shutdown();
  }

  private async _prepare() {
    this._proxyServing = await serveSomething((app) => {
      app.use(express.json());
      app.all("*", async (req: express.Request, res: express.Response) => {
        this._proxyCallsCounter += 1;
        let responseCode;
        try {
          const axiosResponse = await axios.request({
            method: req.method,
            url: req.url,
            data: req.body,
          });
          responseCode = axiosResponse.status;
        } catch (error: any) {
          responseCode = error.response.status;
        }
        res.sendStatus(responseCode);
        res.end();
      });
    }, this.portNumber);

    // Count HTTPS CONNECT tunnels (Express doesn't see them) so tests can
    // assert HTTPS went through the proxy.
    this._proxyServing.server.on("connect", (_req, socket) => {
      this._connectCallsCounter += 1;
      socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      socket.end();
    });
  }
}
