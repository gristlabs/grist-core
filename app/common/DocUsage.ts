// Size metrics of a document, shown to users and checked against plan limits.
export interface DocUsageMetrics {
  rowCount?: RowCounts;
  dataSizeBytes?: number;
  attachmentsSizeBytes?: number;
}

/**
 * Facts about a document, worked out by the doc worker and cached in the home database, so
 * they are available without opening the document.
 */
export interface DocumentUsage extends DocUsageMetrics {
  acl?: AclFacts;
}

/**
 * Facts about what a document's access rules contain. These are stored, so keep them as plain
 * descriptions of the rules, and judge what they mean in code.
 */
export interface AclFacts {
  // Whether some rule written by a user denies a permission on data (read, update, create or
  // delete). Conditions aren't checked, so this says nothing about who is denied.
  hasDenyingDataRules: boolean;
  // Whether some rule written by a user limits structure editing (the SchemaEdit permission).
  hasSchemaEditRestriction: boolean;
}

/**
 * Whether Editors can bypass access rules on data, as Owners can: some rule denies access to
 * data, but Editors can still edit structure, which lets them get around it.
 */
export function editorsBypassRules(acl: AclFacts | undefined): boolean {
  return Boolean(acl && acl.hasDenyingDataRules && !acl.hasSchemaEditRestriction);
}

export interface RowCounts {
  total: number;
  [tableRef: number]: number;
}

export type DataLimitStatus = "approachingLimit" | "gracePeriod" | "deleteOnly" | null;
export interface DataLimitInfo {
  status: DataLimitStatus;
  daysRemaining?: number;
}

type DocUsageOrPending = {
  [Metric in keyof Required<DocUsageMetrics>]: Required<DocUsageMetrics>[Metric] | "pending"
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

// Api calls a site made in one month, against the limit its plan sets.
export interface ApiCallsUsage {
  used: number;
  limit: number;
  // The month being counted, as YYYY-MM in UTC. The client cannot work it out itself,
  // since the count resets in UTC and a browser may be in another time zone.
  month: string;
}

export interface UsageRecommendations {
  recommendExternal?: boolean;
}

type FilteredDocUsage = {
  [Metric in keyof DocUsageOrPending]: DocUsageOrPending[Metric] | "hidden"
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
    },
  };
}
