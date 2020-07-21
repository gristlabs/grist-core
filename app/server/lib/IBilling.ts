import * as express from 'express';

export interface IBilling {
  addEndpoints(app: express.Express): void;
  addEventHandlers(): void;
  addWebhooks(app: express.Express): void;
}
