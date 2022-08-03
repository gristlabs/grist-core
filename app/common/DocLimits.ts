import {ApiError} from 'app/common/ApiError';
import {APPROACHING_LIMIT_RATIO, DataLimitStatus, DocumentUsage, getUsageRatio} from 'app/common/DocUsage';
import {Features} from 'app/common/Features';
import moment from 'moment-timezone';

/**
 * Error class indicating failure due to limits being exceeded.
 */
export class LimitExceededError extends ApiError {
  constructor(message: string) {
    super(message, 413);
  }
}

export interface GetDataLimitStatusParams {
  docUsage: DocumentUsage | null;
  productFeatures: Features | undefined;
  gracePeriodStart: Date | null;
}

/**
 * Given a set of params that includes document usage, current product features, and
 * a grace-period start (if any), returns the data limit status of a document.
 */
export function getDataLimitStatus(params: GetDataLimitStatusParams): DataLimitStatus {
  const {docUsage, productFeatures, gracePeriodStart} = params;
  const ratio = getDataLimitRatio(docUsage, productFeatures);
  if (ratio > 1) {
    const start = gracePeriodStart;
    const days = productFeatures?.gracePeriodDays;
    if (start && days && moment().diff(moment(start), 'days') >= days) {
      return 'deleteOnly';
    } else {
      return 'gracePeriod';
    }
  } else if (ratio > APPROACHING_LIMIT_RATIO) {
    return 'approachingLimit';
  } else {
    return null;
  }
}

/**
 * Given `docUsage` and `productFeatures`, returns the highest usage ratio
 * across all data-related limits (currently only row count and data size).
 */
export function getDataLimitRatio(
  docUsage: DocumentUsage | null,
  productFeatures: Features | undefined
): number {
  if (!docUsage) { return 0; }

  const {rowCount, dataSizeBytes} = docUsage;
  const maxRows = productFeatures?.baseMaxRowsPerDocument;
  const maxDataSize = productFeatures?.baseMaxDataSizePerDocument;
  const rowRatio = getUsageRatio(rowCount?.total, maxRows);
  const dataSizeRatio = getUsageRatio(dataSizeBytes, maxDataSize);
  return Math.max(rowRatio, dataSizeRatio);
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
    case 'approachingLimit': { return 1; }
    case 'gracePeriod': { return 2; }
    case 'deleteOnly': { return 3; }
  }
}
