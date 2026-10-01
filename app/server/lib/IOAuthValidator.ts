import { AuthCredential } from "app/server/lib/AuthCredential";

import { IncomingMessage } from "http";

export interface IOAuthValidator {
  getCredential(req: IncomingMessage): Promise<AuthCredential> | undefined;
}
