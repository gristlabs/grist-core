import { DocState } from 'app/common/UserAPI';

/**
 *
 * Helper class to support a small subset of git-style references for state hashes:
 *   HEAD = the most recent state
 *   [HASH]^1 = the parent of [HASH]
 *   [HASH]~1 = the parent of [HASH]
 *   [HASH]~2 = the grandparent of [HASH]
 *   [HASH]^1^1 = the grandparent of [HASH]
 *   [HASH]~3 = the great grandparent of [HASH]
 * For git, where commits have multiple parents, "~" refers to the first parent,
 * and "^1" also refers to the first parent.  For grist, there are only first parents
 * (unless/until we start tracking history across merges).
 *
 */
export class HashUtil {

  /**
   * To construct, provide a list of states, most recent first.
   */
  constructor(private _state: DocState[]) {}

  /**
   * Find the named hash in the list of states, allowing for aliases.
   * Returns an index into the list of states provided in constructor.
   */
  public hashToOffset(hash: string): number {
    const parts = hash.split(/([~^][0-9]*)/);
    hash = parts.shift() || '';
    let offset = hash === 'HEAD' ? 0 : this._state.findIndex(state => state.h === hash);
    if (offset < 0) { throw new Error('Cannot read hash'); }
    for (const part of parts) {
      if (part === '^' || part === '^1') {
        offset++;
      } else if (part.startsWith('~')) {
        offset += parseInt(part.slice(1) || '1', 10);
      } else if (part === '') {
        // pass
      } else {
        throw new Error('cannot parse hash');
      }
    }
    return offset;
  }
}
