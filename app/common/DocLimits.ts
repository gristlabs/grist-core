import { DataLimitInfo, DataLimitStatus, DocumentUsage } from "app/common/DocUsage";
import { Features } from "app/common/Features";
import { APPROACHING_LIMIT_RATIO, getUsageRatio } from "app/common/Limits";
import { LimitStatus } from "app/common/Telemetry";

import moment from "moment-timezone";

export interface GetDataLimitStatusParams {
  docUsage: DocumentUsage | null;
  productFeatures: Features | undefined;
  gracePeriodStart: Date | null;
}

/**
 * Given a set of params that includes document usage, current product features, and
 * a grace-period start (if any), returns the data limit status of a document.
 */
export function getDataLimitInfo(params: GetDataLimitStatusParams): DataLimitInfo {
  const { docUsage, productFeatures, gracePeriodStart } = params;
  const ratio = getDataLimitRatio(docUsage, productFeatures);
  if (ratio > 1) {
    const start = gracePeriodStart;
    // In case we forgot to define a grace period, we'll default to two weeks.
    const days = productFeatures?.gracePeriodDays ?? 14;
    const daysRemaining = start && days ? days - moment().diff(moment(start), "days") : NaN;
    if (daysRemaining > 0) {
      return { status: "gracePeriod", daysRemaining };
    } else {
      return { status: "deleteOnly" };
    }
  } else if (ratio > APPROACHING_LIMIT_RATIO) {
    return { status: "approachingLimit" };
  }

  return { status: null };
}

function getDataLimitRatios(docUsage: DocumentUsage | null, productFeatures: Features | undefined) {
  const { rowCount, dataSizeBytes, attachmentsSizeBytes } = docUsage ?? {};
  return {
    rows: getUsageRatio(rowCount?.total, productFeatures?.baseMaxRowsPerDocument),
    dataSize: getUsageRatio(dataSizeBytes, productFeatures?.baseMaxDataSizePerDocument),
    attachments: getUsageRatio(attachmentsSizeBytes, productFeatures?.baseMaxAttachmentsBytesPerDocument),
  };
}

/**
 * Given `docUsage` and `productFeatures`, returns the highest usage ratio
 * across all data-related limits (currently only row count, data size and attachment size).
 */
export function getDataLimitRatio(
  docUsage: DocumentUsage | null,
  productFeatures: Features | undefined,
): number {
  return Math.max(...Object.values(getDataLimitRatios(docUsage, productFeatures)));
}

export type DataLimitFeature = "rows" | "dataSize" | "attachments";

/**
 * The data-related limit closest to being reached, or null when nothing is limited.
 */
export function getDataLimitFeature(
  docUsage: DocumentUsage | null, productFeatures: Features | undefined,
): DataLimitFeature | null {
  const ratios = getDataLimitRatios(docUsage, productFeatures);
  const [feature, ratio] = Object.entries(ratios).reduce((a, b) => (b[1] > a[1] ? b : a));
  return ratio > 0 ? feature as DataLimitFeature : null;
}

const DATA_LIMIT_STATUS_TO_LIMIT_STATUS: Record<NonNullable<DataLimitStatus>, LimitStatus> = {
  approachingLimit: "approaching",
  gracePeriod: "exceeded",
  deleteOnly: "readOnly",
};

export interface DataLimitTransition { feature: DataLimitFeature; status: LimitStatus; }

/**
 * The feature closest to its limit and its telemetry status, or null when nothing is limited.
 */
function getLimitState(params: GetDataLimitStatusParams): DataLimitTransition | null {
  const status = getDataLimitInfo(params).status;
  const feature = getDataLimitFeature(params.docUsage, params.productFeatures);
  if (status === null || feature === null) { return null; }
  return { feature, status: DATA_LIMIT_STATUS_TO_LIMIT_STATUS[status] };
}

/**
 * Tracks a document's data-limit state across checks and reports each transition once.
 */
export class DataLimitTransitions {
  // Undefined before the first update, which only records a baseline.
  private _last?: DataLimitTransition | null;

  public update(params: GetDataLimitStatusParams): DataLimitTransition | null {
    const previous = this._last;
    const current = this._last = getLimitState(params);
    if (previous === undefined) { return null; }
    if (current) { return current.status === previous?.status ? null : current; }
    return previous ? { feature: previous.feature, status: "cleared" } : null;
  }
}

/**
 * Maps `dataLimitStatus` status to an integer and returns it; larger integer
 * values indicate a more "severe" status.
 *
 * Useful for relatively comparing the severity of two DataLimitStatus values.
 */
export function getSeverity(dataLimitStatus: DataLimitStatus): number {
  switch (dataLimitStatus) {
    case null: { return 0; }
    case "approachingLimit": { return 1; }
    case "gracePeriod": { return 2; }
    case "deleteOnly": { return 3; }
  }
}
