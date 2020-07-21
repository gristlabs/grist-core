import {OpenDocMode} from 'app/common/DocListAPI';

interface ErrorDetails {
  status?: number;
  accessMode?: OpenDocMode;
}

/**
 *
 * An error with a human-readable message and a machine-readable code.
 * Makes it easier to change the human-readable message without breaking
 * error handlers.
 *
 */
export class ErrorWithCode extends Error {
  public accessMode?: OpenDocMode;
  public status?: number;
  constructor(public code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.status = details.status;
    this.accessMode = details.accessMode;
  }
}
