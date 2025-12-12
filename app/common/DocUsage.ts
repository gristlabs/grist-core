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
export interface DataLimitInfo {
  status: DataLimitStatus;
  daysRemaining?: number;
}

type DocUsageOrPending = {
  [Metric in keyof Required<DocumentUsage>]: Required<DocumentUsage>[Metric] | 'pending'
};

export interface DocUsageSummary extends DocUsageOrPending {
  dataLimitInfo: DataLimitInfo;
}

// Aggregate usage stats for an org.
export interface OrgUsageSummary {
  // Count of non-removed documents in an org, grouped by data limit status.
  countsByDataLimitStatus: Record<NonNullable<DataLimitStatus>, number>;
  // Stats for aggregate attachment usage.
  attachments: {
    totalBytes: number;
    limitExceeded?: boolean;
  }
}

export interface UsageRecommendations {
  recommendExternal?: boolean;
}

type FilteredDocUsage = {
  [Metric in keyof DocUsageOrPending]: DocUsageOrPending[Metric] | 'hidden'
};

export interface FilteredDocUsageSummary extends FilteredDocUsage {
  dataLimitInfo: DataLimitInfo;
  usageRecommendations: UsageRecommendations;
}

/**
 * Returns an empty org usage summary with values initialized to 0.
 */
 export function createEmptyOrgUsageSummary(): OrgUsageSummary {
   return {
     countsByDataLimitStatus: {
       approachingLimit: 0,
       gracePeriod: 0,
       deleteOnly: 0,
     },
     attachments: {
       totalBytes: 0,
     }
  };
}
