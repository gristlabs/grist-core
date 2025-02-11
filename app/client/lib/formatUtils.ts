/**
 * Formats a date as a string. Omitting the year if it's the current year.
 * @param timestamp A unix timestamp in milliseconds, Date object, or ISO 8601 string or null.
 * @returns A string like (depending on locale) "Jan 1" or "January 1, 2020" or "unknown".
 */
export function dateFmt(timestamp: number | null | string | Date): string {
  if (!timestamp) { return "unknown"; }
  const date = new Date(timestamp);
  if (date.getFullYear() !== new Date().getFullYear()) {
    return dateFmtFull(timestamp);
  }
  return new Date(timestamp).toLocaleDateString('default', { month: 'long', day: 'numeric' });
}

/**
 * Formats a date as a string with the full year.
 * @param timestamp A unix timestamp in milliseconds, Date object, or ISO 8601 string or null.
 * @returns A string like (depending on locale) "January 1, 2020" or "unknown".
 */
export function dateFmtFull(timestamp: number | null | string | Date): string {
  if (!timestamp) { return "unknown"; }
  return new Date(timestamp).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Formats a timestamp in milliseconds to a time string.
 */
export function timeFmt(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString('default',
    { month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' });
}
