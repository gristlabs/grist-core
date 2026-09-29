// Helpers for counting api usage. They must stay out of DocApi: MCP code needs them, and
// DocApi pulls in ExportXLSX, which refuses to load inside a worker thread.

import { Document } from "app/gen-server/entity/Document";

import * as moment from "moment";

// The org a document belongs to, and the monthly limit that applies to it. The org is named
// by its billing account, which is where the limit comes from.
export interface OrgUsageLimit {
  billingAccountId: number;
  monthlyMax: number | undefined;
}

/**
 * Returns a key storing the number of API calls made across a site in the given month.
 * Named by billing account, and not by org, because a personal site is served under a
 * pseudo org whose id is zeroed out.
 */
export function billingMonthlyApiUsageKey(billingAccountId: number, m: moment.Moment) {
  return `billing-account-${billingAccountId}-monthlyApiUsage-${m.format("YYYY-MM")}`;
}

/**
 * Reads the daily per-document limit that applies to a document, from the cached
 * document of an authorized request. Undefined if the product sets no limit.
 */
export function getDailyMax(doc: Document | undefined): number | undefined {
  return doc?.workspace?.org?.billingAccount
    ?.getEffectiveFeatures().baseMaxApiUnitsPerDocumentPerDay;
}

/**
 * Reads the site and its monthly limit from the cached document of an authorized
 * request. Undefined if we have no document to read them from.
 */
export function getOrgUsageLimit(doc: Document | undefined): OrgUsageLimit | undefined {
  const org = doc?.workspace?.org;
  if (!org) { return undefined; }
  return {
    billingAccountId: org.billingAccountId,
    monthlyMax: org.billingAccount?.getEffectiveFeatures().maxApiCallsPerOrgMonth,
  };
}
