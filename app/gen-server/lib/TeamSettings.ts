import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import { IBilling } from "app/server/lib/IBilling";

import * as express from "express";

/**
 * Implements IBilling for grist-core, serving the site-settings page
 * for team site configuration (name, domain, logo).
 */
export class TeamSettings implements IBilling {
  constructor(private _gristServer: GristServer) {}

  public addEndpoints(_app: express.Express): void {}
  public addEventHandlers(): void {}
  public addWebhooks(_app: express.Express): void {}

  public addPages(app: express.Express, middleware: express.RequestHandler[]): void {
    app.get("/site-settings", ...middleware, expressWrap(async (req, resp) => {
      return this._gristServer.sendAppPage(req, resp, { path: "app.html", status: 200, config: {} });
    }));
  }
}
