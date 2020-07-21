import {SessionUserObj} from 'app/server/lib/BrowserSession';
import * as Comm from 'app/server/lib/Comm';
import {Hosts} from 'app/server/lib/extractOrg';
import {ICreate} from 'app/server/lib/ICreate';
import {Sessions} from 'app/server/lib/Sessions';
import * as express from 'express';

/**
 * Basic information about a Grist server.  Accessible in many
 * contexts, including request handlers and ActiveDoc methods.
 */
export interface GristServer {
  readonly create: ICreate;
  getHost(): string;
  getHomeUrl(req: express.Request, relPath?: string): string;
  getHomeUrlByDocId(docId: string, relPath?: string): Promise<string>;
}

export interface GristLoginMiddleware {
  getLoginRedirectUrl(target: URL): Promise<string>;
  getSignUpRedirectUrl(target: URL): Promise<string>;
  getLogoutRedirectUrl(nextUrl: URL, userSession: SessionUserObj): Promise<string>;

  // Returns arbitrary string for log.
  addEndpoints(app: express.Express, comm: Comm, sessions: Sessions, hosts: Hosts): string;
}
