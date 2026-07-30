import { AuthCredential } from "app/server/lib/AuthCredential";

import { IncomingMessage } from "http";

import { Application } from "express";

export interface IOAuthValidator {
  addHomeApiMiddleware(app: Application): void;
  addDocApiMiddleware(app: Application): void;
  getCredential(req: IncomingMessage): Promise<AuthCredential> | undefined;
}
