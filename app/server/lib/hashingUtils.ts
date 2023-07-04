import {createHash} from 'crypto';

/**
 * Returns a hash of `id` prefixed with the first 4 characters of `id`. The first 4
 * characters are included to assist with troubleshooting.
 *
 * Useful for situations where potentially sensitive identifiers are logged, such as
 * doc ids of docs that have public link sharing enabled.
 */
export function hashId(id: string): string {
  return `${id.slice(0, 4)}:${createHash('sha256').update(id.slice(4)).digest('base64')}`;
}
