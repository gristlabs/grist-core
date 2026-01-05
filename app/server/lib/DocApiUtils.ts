import { ApiError } from "app/common/ApiError";
import { handleSandboxErrorOnPlatform, TableOperationsPlatform } from "app/plugin/TableOperationsImpl";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { docSessionFromRequest } from "app/server/lib/DocSession";
import log from "app/server/lib/log";

import { Request, RequestHandler, Response } from "express";
import { Checker } from "ts-interface-checker";

export type WithDocHandler = (activeDoc: ActiveDoc, req: RequestWithLogin, resp: Response) => Promise<void>;

/**
 * Middleware for validating request's body with a Checker instance.
 */
export function validate(checker: Checker): RequestHandler {
  return (req, res, next) => {
    validateCore(checker, req, req.body);
    next();
  };
}

export function validateCore(checker: Checker, req: Request, body: any) {
  try {
    checker.check(body);
  } catch (err) {
    log.warn(`Error during api call to ${req.path}: Invalid payload: ${String(err)}`);
    throw new ApiError("Invalid payload", 400, { userError: String(err) });
  }
}

export function getErrorPlatform(tableId: string): TableOperationsPlatform {
  return {
    async getTableId() { return tableId; },
    throwError(verb, text, status) {
      throw new ApiError(verb + (verb ? " " : "") + text, status);
    },
    applyUserActions() {
      throw new Error("no document");
    },
  };
}

/**
 * Handles sandbox errors for the given engine request using backend platform options.
 */
export async function handleSandboxError<T>(tableId: string, colNames: string[], p: Promise<T>): Promise<T> {
  return handleSandboxErrorOnPlatform(tableId, colNames, p, getErrorPlatform(tableId));
}

/**
 * Fetches meta tables for the active document associated with the request.
 */
export async function getMetaTables(activeDoc: ActiveDoc, req: RequestWithLogin) {
  return await handleSandboxError("", [],
    activeDoc.fetchMetaTables(docSessionFromRequest(req)));
}
