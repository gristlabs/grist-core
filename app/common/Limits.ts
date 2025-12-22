import { ApiError } from "app/common/ApiError";

/**
 * Error class indicating failure due to limits being exceeded.
 */
export class LimitExceededError extends ApiError {
  constructor(message: string) {
    super(message, 413);
  }
}

// Ratio of usage at which we start telling users that they're approaching limits.
export const APPROACHING_LIMIT_RATIO = 0.9;

/**
 * Computes a ratio of `usage` to `limit`, if possible. Returns 0 if `usage` or `limit`
 * is invalid or undefined.
 */
export function getUsageRatio(usage: number | undefined, limit: number | undefined): number {
  if (!isEnforceableLimit(limit) || usage === undefined || usage < 0) {
    // Treat undefined or invalid values as having 0 usage.
    return 0;
  }

  return usage / limit;
}

/**
 * Returns true if `limit` is defined and is a valid, positive number.
 */
function isEnforceableLimit(limit: number | undefined): limit is number {
  return limit !== undefined && limit > 0;
}
