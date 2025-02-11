import * as express from 'express';

export interface IBilling {
  addEndpoints(app: express.Express): void;
  addEventHandlers(): void;
  addWebhooks(app: express.Express): void;
  addMiddleware?(app: express.Express): void;
  addPages(app: express.Express, middleware: express.RequestHandler[]): void;
  close?(): Promise<void>;
}

export interface ActivationStatus {
  inGoodStanding: boolean;
  isInTrial: boolean;
  expirationDate: string | null;
}

export class ComposedBilling implements IBilling {
  private _billings: IBilling[];
  constructor(billings: (IBilling|null)[] = []) {
    this._billings = billings.filter(b => !!b) as IBilling[];
  }

  public async close(): Promise<void> {
    for (const billing of this._billings) {
      await billing.close?.();
    }
  }

  public addEndpoints(app: express.Express): void {
    for (const billing of this._billings) {
      billing.addEndpoints(app);
    }
  }

  public addEventHandlers(): void {
    for (const billing of this._billings) {
      billing.addEventHandlers();
    }
  }

  public addWebhooks(app: express.Express): void {
    for (const billing of this._billings) {
      billing.addWebhooks(app);
    }
  }

  public addMiddleware(app: express.Express): void {
    for (const billing of this._billings) {
      billing.addMiddleware?.(app);
    }
  }

  public addPages(app: express.Express, middleware: express.RequestHandler[]): void {
    for (const billing of this._billings) {
      billing.addPages(app, middleware);
    }
  }
}

export class EmptyBilling extends ComposedBilling {
  constructor() {
    super([]);
  }
}
