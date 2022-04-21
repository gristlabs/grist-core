export type RowCount = number | 'hidden' | 'pending';

export type DataLimitStatus = null | 'approachingLimit' | 'gracePeriod' | 'deleteOnly';

// Ratio of the row/data size limit where we tell users that they're approaching the limit.
export const APPROACHING_LIMIT_RATIO = 0.9;
