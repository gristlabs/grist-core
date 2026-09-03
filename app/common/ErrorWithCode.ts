import { Memo } from "app/common/ACLPermissions";
import { OpenDocMode } from "app/common/DocListAPI";

export interface ErrorDetails {
  status?: number;
  accessMode?: OpenDocMode;
  memos?: Memo[];
}

/**
 *
 * An error with a human-readable message and a machine-readable code.
 * Makes it easier to change the human-readable message without breaking
 * error handlers.
 *
 */
export class ErrorWithCode extends Error {
  constructor(public code: string, message: string, public details: ErrorDetails = {}) {
    super(message);
  }

  public get accessMode() { return this.details?.accessMode;  }
  public get status() { return this.details?.status;  }
}

/**
 * The error for a write refused because the document is held read-only.
 */
export function readOnlyError(details: ErrorDetails = {}): ErrorWithCode {
  return new ErrorWithCode("AUTH_NO_EDIT", "No write access, document is read-only",
    { status: 403, ...details });
}
