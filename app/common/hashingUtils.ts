import {createHash} from 'crypto';

/**
 * Returns a hash of `id` prefixed with the first 4 characters of `id`.
 *
 * Useful for situations where potentially sensitive identifiers are logged, such as
 * doc ids (like those that have public link sharing enabled). The first 4 characters
 * are included to assist with troubleshooting.
 */
export function hashId(id: string): string {
  return `${id.slice(0, 4)}:${createHash('sha256').update(id.slice(4)).digest('base64')}`;
}
