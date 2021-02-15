import {OpenDocMode} from 'app/common/DocListAPI';

interface ErrorDetails {
  status?: number;
  accessMode?: OpenDocMode;
  memos?: string[];
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
