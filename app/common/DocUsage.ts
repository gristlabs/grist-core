export interface DocumentUsage {
  rowCount?: RowCounts;
  dataSizeBytes?: number;
  attachmentsSizeBytes?: number;
}

export interface RowCounts {
  total: number;
  [tableRef: number]: number;
}

export type DataLimitStatus = 'approachingLimit' | 'gracePeriod' | 'deleteOnly' | null;

type DocUsageOrPending = {
  [Metric in keyof Required<DocumentUsage>]: Required<DocumentUsage>[Metric] | 'pending'
}

export interface DocUsageSummary extends DocUsageOrPending {
  dataLimitStatus: DataLimitStatus;
}

// Count of non-removed documents in an org, grouped by data limit status.
export type OrgUsageSummary = Record<NonNullable<DataLimitStatus>, number>;

type FilteredDocUsage = {
  [Metric in keyof DocUsageOrPending]: DocUsageOrPending[Metric] | 'hidden'
}

export interface FilteredDocUsageSummary extends FilteredDocUsage {
  dataLimitStatus: DataLimitStatus;
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
 * Returns an empty org usage summary with values initialized to 0.
 */
 export function createEmptyOrgUsageSummary(): OrgUsageSummary {
  return {
    approachingLimit: 0,
    gracePeriod: 0,
    deleteOnly: 0,
  };
}

/**
 * Returns true if `limit` is defined and is a valid, positive number.
 */
function isEnforceableLimit(limit: number | undefined): limit is number {
  return limit !== undefined && limit > 0;
}
