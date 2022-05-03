import {ApiError} from 'app/common/ApiError';

export interface DocUsage {
  dataLimitStatus: DataLimitStatus;
  rowCount: RowCount;
  dataSizeBytes: DataSize;
  attachmentsSizeBytes: AttachmentsSize;
}

type NumberOrStatus = number | 'hidden' | 'pending';

export type RowCount = NumberOrStatus;

export type DataSize = NumberOrStatus;

export type AttachmentsSize = NumberOrStatus;

export type DataLimitStatus = 'approachingLimit' | 'gracePeriod' | 'deleteOnly' | null;

export type NonHidden<T> = Exclude<T, 'hidden'>;

// Ratio of usage at which we start telling users that they're approaching limits.
export const APPROACHING_LIMIT_RATIO = 0.9;

export class LimitExceededError extends ApiError {
  constructor(message: string) {
    super(message, 413);
  }
}
