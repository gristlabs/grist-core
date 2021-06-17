import { GristLoadConfig } from 'app/common/gristUrls';
import { Document } from 'app/gen-server/entity/Document';
import { Organization } from 'app/gen-server/entity/Organization';
import { Workspace } from 'app/gen-server/entity/Workspace';
import { SessionUserObj } from 'app/server/lib/BrowserSession';
import * as Comm from 'app/server/lib/Comm';
import { Hosts } from 'app/server/lib/extractOrg';
import { ICreate } from 'app/server/lib/ICreate';
import { IPermitStore } from 'app/server/lib/Permit';
import { Sessions } from 'app/server/lib/Sessions';
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
  getDocUrl(docId: string): Promise<string>;
  getOrgUrl(orgKey: string|number): Promise<string>;
  getResourceUrl(resource: Organization|Workspace|Document): Promise<string>;
  getGristConfig(): GristLoadConfig;
  getPermitStore(): IPermitStore;
}

export interface GristLoginMiddleware {
  getLoginRedirectUrl(target: URL): Promise<string>;
  getSignUpRedirectUrl(target: URL): Promise<string>;
  getLogoutRedirectUrl(nextUrl: URL, userSession: SessionUserObj): Promise<string>;

  // Returns arbitrary string for log.
  addEndpoints(app: express.Express, comm: Comm, sessions: Sessions, hosts: Hosts): string;
}
