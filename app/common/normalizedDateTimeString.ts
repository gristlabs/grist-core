import moment from 'moment-timezone';

/**
 * Output an ISO8601 format datetime string, with timezone.
 * Any string fed in without timezone is expected to be in UTC.
 *
 * When connected to postgres, dates will be extracted as Date objects,
 * with timezone information. The normalization done here is not
 * really needed in this case.
 *
 * Timestamps in SQLite are stored as UTC, and read as strings
 * (without timezone information). The normalization here is
 * pretty important in this case.
 */
export function normalizedDateTimeString(dateTime: any): string {
  if (!dateTime) { return dateTime; }
  if (dateTime instanceof Date) {
    return moment(dateTime).toISOString();
  }
  if (typeof dateTime === 'string' || typeof dateTime === 'number') {
    // When SQLite returns a string, it will be in UTC.
    // Need to make sure it actually have timezone info in it
    // (will not by default).
    return moment.utc(dateTime).toISOString();
  }
  throw new Error(`normalizedDateTimeString cannot handle ${dateTime}`);
}
