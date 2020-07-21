/**
 * A tip for fixing an error.
 */
export interface ApiTip {
  action: 'add-members' | 'upgrade' |'ask-for-help';
  message: string;
}

/**
 * Documentation of a limit relevant to an API error.
 */
export interface ApiLimit {
  quantity: 'collaborators' | 'docs' | 'workspaces';  // what are we counting
  subquantity?: string;    // a nuance to what we are counting
  maximum: number;         // maximum allowed
  value: number;           // current value of quantity for user
  projectedValue: number;  // value of quantity expected if request had been allowed
}

/**
 * Structured details about an API error.
 */
export interface ApiErrorDetails {
  limit?: ApiLimit;

  // If set, this is the more user-friendly message to show to the user than error.message.
  userError?: string;

  // If set, contains suggestions for fixing a problem.
  tips?: ApiTip[];
}

/**
 * An error with an http status code.
 */
export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: ApiErrorDetails) {
    super(message);
  }
}
