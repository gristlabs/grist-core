import { safeJsonParse } from 'app/common/gutil';
import { CellValue } from 'app/plugin/GristData';

/**
 * All possible access clauses.  In future the clauses will become more generalized.
 * The consequences of clauses are currently combined in a naive and ad-hoc way,
 * this will need systematizing.
 */
export type GranularAccessClause =
  GranularAccessDocClause |
  GranularAccessTableClause |
  GranularAccessRowClause |
  GranularAccessCharacteristicsClause;

/**
 * A clause that forbids anyone but owners from modifying the document structure.
 */
export interface GranularAccessDocClause {
  kind: 'doc';
  match: MatchSpec;
}

/**
 * A clause to control access to a specific table.
 */
export interface GranularAccessTableClause {
  kind: 'table';
  tableId: string;
  match: MatchSpec;
}

/**
 * A clause to control access to rows within a specific table.
 * If "scope" is provided, this rule is simply ignored if the scope does not match
 * the user.
 */
export interface GranularAccessRowClause {
  kind: 'row';
  tableId: string;
  match: MatchSpec;
  scope?: MatchSpec;
}

/**
 * A clause to make more information about the user/request available for access
 * control decisions.
 *   - charId specifies a property of the user (e.g. Access/Email/UserID/Name, or a
 *     property added by another clause) to use as a key.
 *   - We look for a matching record in the specified table, comparing the specified
 *     column with the charId property. Outcome is currently unspecified if there are
 *     multiple matches.
 *   - Compare using lower case for now (because of Email). Could generalize in future.
 *   - All fields from a matching record are added to the variables available for MatchSpecs.
 */
export interface GranularAccessCharacteristicsClause {
  kind: 'character';
  tableId: string;
  charId: string;       // characteristic to look up
  lookupColId: string; // column in which to look it up
}

// Type for expressing matches.
export type MatchSpec = ConstMatchSpec | TruthyMatchSpec | PairMatchSpec | NotMatchSpec;

// Invert a match.
export interface NotMatchSpec {
  kind: 'not';
  match: MatchSpec;
}

// Compare property of user with a constant.
export interface ConstMatchSpec {
  kind: 'const';
  charId: string;
  value: CellValue;
}

// Check if a table column is truthy.
export interface TruthyMatchSpec {
  kind: 'truthy';
  colId: string;
}

// Check if a property of user matches a table column.
export interface PairMatchSpec {
  kind: 'pair';
  charId: string;
  colId: string;
}

// Convert a clause to a string. Trivial, but fluid currently.
export function serializeClause(clause: GranularAccessClause) {
  return '~acl ' + JSON.stringify(clause);
}

export function decodeClause(code: string): GranularAccessClause|null {
  // TODO: be strict about format. But it isn't super-clear what to do with
  // a document if access control gets corrupted. Maybe go into an emergency
  // mode where only owners have access, and they have unrestricted access?
  // Also, format should be plain JSON once no longer stored in a random
  // reused column.
  if (code.startsWith('~acl ')) {
    return safeJsonParse(code.slice(5), null);
  }
  return null;
}
