import { Request } from "express";

/** Capabilities in these bodies must be omitted even when debug HTTP body logging is enabled. */
export function isReferenceConnectionRequest(req: Pick<Request, "path">): boolean {
  return /\/reference-connections(?:\/|$)/i.test(req.path);
}

export function getLoggableRequestBody(req: Pick<Request, "path" | "body">): unknown {
  // Defense in depth for rejected requests on other paths: capabilities are never loggable.
  if (isReferenceConnectionRequest(req) ||
    JSON.stringify(req.body)?.toLowerCase().includes("grist-reference=")) { return undefined; }
  return req.body;
}
