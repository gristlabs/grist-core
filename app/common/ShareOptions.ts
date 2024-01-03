/**
 *
 * Options on a share, or a shared widget. This is mostly
 * a placeholder currently. The same structure is currently
 * used both for shares and for specific shared widgets, but
 * this is just to save a little time right now, and should
 * not be preserved in future work.
 *
 * The only flag that matter today is "publish".
 * The "access" flag could be stripped for now without consequences.
 *
 */
export interface ShareOptions {
  // A share or widget that does not have publish set to true
  // will not be available via the share mechanism.
  publish?: boolean;

  // Can be set to 'viewers' to label the share as readonly.
  // Half-baked, just here to exercise an aspect of homedb
  // syncing.
  access?: 'editors' | 'viewers';
}
