import { version as installedVersion } from "app/common/version";
import { getAppRoot } from "app/server/lib/places";
import { fromCallback, listenPromise } from "app/server/lib/serverUtils";
import { fixturesRoot } from "test/server/testUtils";

import * as http from "http";
import { AddressInfo, Socket } from "net";
import * as path from "path";

import express from "express";

// An alternative domain for localhost, to test links that look external. We have a record for
// localtest.datagrist.com set up to point to localhost.
const TEST_GRIST_HOST = "localtest.datagrist.com";

export interface Serving {
  url: string;
  shutdown: () => Promise<void>;
}

// Adds static files from a directory.
// By default exposes /fixture/sites
export function addStatic(app: express.Express, rootDir?: string) {
  // mix in a copy of the plugin api
  app.use(/^\/(grist-plugin-api.js)$/, (req, res) =>
    res.sendFile(req.params[0], { root:
                                        path.resolve(getAppRoot(), "static") }));
  app.use(express.static(rootDir || path.resolve(fixturesRoot, "sites"), {
    setHeaders: (res: express.Response) => {
      res.set("Access-Control-Allow-Origin", "*");
    },
  }));
}

// Serve from a directory.
export async function serveStatic(rootDir: string): Promise<Serving> {
  return serveSomething(app => addStatic(app, rootDir));
}

// Serve a string of html.
export async function serveSinglePage(html: string): Promise<Serving> {
  return serveSomething((app) => {
    app.get("", (req, res) => res.send(html));
  });
}

export function serveCustomViews(): Promise<Serving> {
  return serveStatic(path.resolve(fixturesRoot, "sites"));
}

export async function serveSomething(setup: (app: express.Express) => void, port = 0): Promise<Serving> {
  const app = express();
  const server = http.createServer(app);
  await listenPromise(server.listen(port));

  const connections = new Set<Socket>();
  server.on("connection", (conn) => {
    connections.add(conn);
    conn.on("close", () => connections.delete(conn));
  });

  async function shutdown() {
    for (const conn of connections) { conn.destroy(); }
    await fromCallback(cb => server.close(cb));
  }

  port = (server.address() as AddressInfo).port;
  app.set("port", port);
  setup(app);
  const url = `http://localhost:${port}`;
  return { url, shutdown };
}

/**
 * Creates a promise like object that can be resolved from outside.
 */
export class Defer {
  private _resolve!: () => void;
  private _reject!: (err: any) => void;
  private _promise: Promise<void>;

  constructor() {
    this._promise = new Promise<void>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  public get then() {
    return this._promise.then.bind(this._promise);
  }

  public resolve() {
    this._resolve();
  }

  public reject(err: any) {
    this._reject(err);
  }
}

export async function startFakeUpdateServer() {
  let mutex: Defer | null = null;
  const API: FakeUpdateServer = {
    latestVersion: bumpVersion(installedVersion),
    isCritical: false,
    failNext: false,
    payload: null,
    close: async () => {
      mutex?.resolve();
      mutex = null;
      await server?.shutdown();
      server = null;
    },
    pause: () => {
      mutex = new Defer();
    },
    resume: () => {
      mutex?.resolve();
      mutex = null;
    },
    url: () => {
      return server!.url;
    },
    bumpVersion: () => {
      API.latestVersion = bumpVersion(API.latestVersion);
    },
  };

  let server: Serving | null = await serveSomething((app) => {
    app.use(express.json());
    app.post("/version", async (req, res, next) => {
      API.payload = req.body;
      try {
        await mutex;
        if (API.failNext) {
          res.status(500).json({ error: "some error" });
          API.failNext = false;
          return;
        }
        res.json({
          latestVersion: API.latestVersion,
          isCritical: API.isCritical,
        });
      }
      catch (ex) {
        next(ex);
      }
    });
  });

  return API;
}

function bumpVersion(version: string) {
  const parts = version.split(".").map((part) => {
    return Number(part.replace(/\D/g, ""));
  });
  parts[parts.length - 1] += 1;
  return parts.join(".");
}

export interface FakeUpdateServer {
  latestVersion: string;
  isCritical: boolean;
  failNext: boolean;
  payload: any;
  close: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  url: () => string;
  bumpVersion: () => void;
}

/**
 * Call this in describe() to set up before/after hooks to serve some content on a non-Grist URL,
 * just so we can reliably open such URLs. (When we used "example.com", it was occasionally
 * unresponsive, causing tests to fail.)
 *
 * Any request just returns the provided content.
 */
export function setupExternalSite(content: string) {
  let serving: Serving;
  let servingUrl: URL;
  before(async function() {
    serving = await serveSinglePage("Dolphins are cool.");
    servingUrl = new URL(serving.url);
    servingUrl.hostname = TEST_GRIST_HOST;
  });
  after(async function() {
    if (serving) { await serving.shutdown(); }
  });
  return {
    getUrl() { return servingUrl; },
  };
}
