import moment from 'moment';

/**
 * Given a UTC Date ISO 8601 string (the doc updatedAt string), gives a reader-friendly
 * relative time to now - e.g. 'yesterday', '2 days ago'.
 */
export function getTimeFromNow(utcDateISO: string): string {
  const time = moment.utc(utcDateISO);
  const now = moment();
  const diff = now.diff(time, 's');
  if (diff < 0 && diff > -60) {
    // If the time appears to be in the future, but less than a minute
    // in the future, chalk it up to a difference in time
    // synchronization and don't claim the resource will be changed in
    // the future.  For larger differences, just report them
    // literally, there's a more serious problem or lack of
    // synchronization.
    return now.fromNow();
  }
  return time.fromNow();
}
