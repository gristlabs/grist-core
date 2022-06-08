import * as express from 'express';
import {GristServer} from 'app/server/lib/GristServer';

export interface IBilling {
  addEndpoints(app: express.Express, server: GristServer): void;
  addEventHandlers(): void;
  addWebhooks(app: express.Express): void;
  addMiddleware?(app: express.Express): Promise<void>;
}
