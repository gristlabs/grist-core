import { DataLimitInfo, DataLimitStatus, DocumentUsage } from "app/common/DocUsage";
import { Features } from "app/common/Features";
import { APPROACHING_LIMIT_RATIO, getUsageRatio } from "app/common/Limits";

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
    }
    else {
      return { status: "deleteOnly" };
    }
  }
  else if (ratio > APPROACHING_LIMIT_RATIO) {
    return { status: "approachingLimit" };
  }

  return { status: null };
}

/**
 * Given `docUsage` and `productFeatures`, returns the highest usage ratio
 * across all data-related limits (currently only row count, data size and attachment size).
 */
export function getDataLimitRatio(
  docUsage: DocumentUsage | null,
  productFeatures: Features | undefined,
): number {
  if (!docUsage) { return 0; }

  const { rowCount, dataSizeBytes, attachmentsSizeBytes } = docUsage;
  const maxRows = productFeatures?.baseMaxRowsPerDocument;
  const maxDataSize = productFeatures?.baseMaxDataSizePerDocument;
  const maxAttachmentsSizeBytes = productFeatures?.baseMaxAttachmentsBytesPerDocument;
  const rowRatio = getUsageRatio(rowCount?.total, maxRows);
  const dataSizeRatio = getUsageRatio(dataSizeBytes, maxDataSize);
  const attachmentSizeRatio = getUsageRatio(attachmentsSizeBytes, maxAttachmentsSizeBytes);
  return Math.max(rowRatio, dataSizeRatio, attachmentSizeRatio);
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
