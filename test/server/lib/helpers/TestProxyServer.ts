import { serveSomething, Serving } from "test/server/customUtil";

import * as net from "net";

import axios from "axios";
import * as express from "express";

export class TestProxyServer {
  public static async Prepare(portNumber = 0): Promise<TestProxyServer> {
    const server = new TestProxyServer();
    await server._prepare(portNumber);
    return server;
  }

  public get proxyCallCounter() { return this._proxyCallsCounter; }
  public get connectCallCounter() { return this._connectCallsCounter; }
  public get port() { return (this._proxyServing.server.address() as net.AddressInfo).port; }
  private _proxyCallsCounter: number = 0;
  private _connectCallsCounter: number = 0;
  private _proxyServing: Serving;
  // Simulated DNS: maps hostname → localhost:port for CONNECT tunneling.
  private _hostMap = new Map<string, number>();

  public wasProxyCalled(): boolean {
    return this._proxyCallsCounter > 0;
  }

  /** Route CONNECT requests for `hostname` to `localhost:localPort`. */
  public mapDomain(hostname: string, localPort: number) {
    this._hostMap.set(hostname, localPort);
  }

  public async dispose() {
    await this._proxyServing.shutdown();
  }

  private async _prepare(portNumber: number) {
    this._proxyServing = await serveSomething((app) => {
      app.use(express.json());
      app.all("*", async (req: express.Request, res: express.Response) => {
        this._proxyCallsCounter += 1;
        try {
          const axiosResponse = await axios.request({
            method: req.method,
            url: req.url,
            data: req.body,
            // Prevent axios from throwing on non-2xx so we can forward every status.
            validateStatus: () => true,
          });
          res.status(axiosResponse.status);
          for (const [key, value] of Object.entries(axiosResponse.headers)) {
            if (value !== undefined && key !== "transfer-encoding") {
              res.setHeader(key, value as string);
            }
          }
          res.send(axiosResponse.data);
        } catch (error: any) {
          res.sendStatus(error.response?.status ?? 502);
        }
      });
    }, portNumber);

    // Tunnel HTTPS CONNECT requests to the upstream server.
    this._proxyServing.server.on("connect", (req, clientSocket) => {
      this._connectCallsCounter += 1;
      const target = req.url ?? "";
      const [host, portStr] = target.split(":");
      const port = this._hostMap.get(host) ?? (parseInt(portStr, 10) || 443);
      const connectHost = this._hostMap.has(host) ? "localhost" : host;

      const upstream = net.connect(port, connectHost, () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on("error", () => {
        clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        clientSocket.destroy();
      });
      clientSocket.on("error", () => upstream.destroy());
    });
  }
}
