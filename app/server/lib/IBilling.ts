import * as express from 'express';

export interface IBilling {
  addEndpoints(app: express.Express): void;
  addEventHandlers(): void;
  addWebhooks(app: express.Express): void;
  addMiddleware?(app: express.Express): Promise<void>;
  addPages(app: express.Express, middleware: express.RequestHandler[]): void;
  getActivationStatus(): ActivationStatus;
}

export interface ActivationStatus {
  inGoodStanding: boolean;
  isInTrial: boolean;
  expirationDate: string | null;
}
