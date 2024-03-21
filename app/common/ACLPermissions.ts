/**
 * Internal and DB representation of permission bits. These may be set to on, off, or omitted.
 *
 * In DB, permission sets are represented as strings of the form '[+<bits>][-<bits>]' where <bits>
 * is a string of C,R,U,D,S characters, each appearing at most once; or the special values 'all'
 * or 'none'. Note that empty string is also valid, and corresponds to the PermissionSet {}.
 */
// tslint:disable:no-namespace

import fromPairs = require('lodash/fromPairs');
import mapValues = require('lodash/mapValues');


// A PermissionValue is the result of evaluating rules. It provides a definitive answer.
export type PermissionValue = "allow" | "deny";

// A MixedPermissionValue is the result of evaluating rules without a record. If some rules
// require a record, and some records may be allowed and some denied, the result is "mixed".
export type MixedPermissionValue = PermissionValue | "mixed";

// Similar to MixedPermissionValue, but if permission for a table depend on columns and NOT on
// rows, the result is "mixedColumns" rather than "mixed", which allows some optimizations.
export type TablePermissionValue = MixedPermissionValue | "mixedColumns";

// PartialPermissionValue is only used transiently while evaluating rules without a record.
export type PartialPermissionValue = PermissionValue | "allowSome" | "denySome" | "mixed" | "";

/**
 * Internal representation of a set of permission bits.
 */
export interface PermissionSet<T = PermissionValue> {
  read: T;
  create: T;
  update: T;
  delete: T;
  schemaEdit: T;
}

// Some shorter type aliases.
export type PartialPermissionSet = PermissionSet<PartialPermissionValue>;
export type MixedPermissionSet = PermissionSet<MixedPermissionValue>;
export type TablePermissionSet = PermissionSet<TablePermissionValue>;

// One of the strings 'read', 'update', etc.
export type PermissionKey = keyof PermissionSet;

const PERMISSION_BITS: {[letter: string]: PermissionKey} = {
  R: 'read',
  C: 'create',
  U: 'update',
  D: 'delete',
  S: 'schemaEdit',
};

const ALL_PERMISSION_BITS = "CRUDS";

export const ALL_PERMISSION_PROPS: Array<keyof PermissionSet> =
  Array.from(ALL_PERMISSION_BITS, ch => PERMISSION_BITS[ch]);

const ALIASES: {[key: string]: string} = {
  all: '+CRUDS',
  none: '-CRUDS',
};
const REVERSE_ALIASES = fromPairs(Object.entries(ALIASES).map(([alias, value]) => [value, alias]));

export const AVAILABLE_BITS_TABLES: PermissionKey[] = ['read', 'update', 'create', 'delete'];
export const AVAILABLE_BITS_COLUMNS: PermissionKey[] = ['read', 'update'];

// Comes in useful for initializing unset PermissionSets.
export function emptyPermissionSet(): PartialPermissionSet {
  return {read: "", create: "", update: "", delete: "", schemaEdit: ""};
}

/**
 * Convert a short string representation to internal.
 */
export function parsePermissions(permissionsText: string): PartialPermissionSet {
  if (ALIASES.hasOwnProperty(permissionsText)) {
    permissionsText = ALIASES[permissionsText];
  }
  const pset: PartialPermissionSet = emptyPermissionSet();
  let value: PartialPermissionValue = "";
  for (const ch of permissionsText) {
    if (ch === '+') {
      value = "allow";
    } else if (ch === '-') {
      value = "deny";
    } else if (!PERMISSION_BITS.hasOwnProperty(ch) || value === "") {
      throw new Error(`Invalid permissions specification ${JSON.stringify(permissionsText)}`);
    } else {
      const prop = PERMISSION_BITS[ch];
      pset[prop] = value;
    }
  }
  return pset;
}

/**
 * Convert an internal representation of permission bits to a short string. Note that there should
 * be no values other then "allow" and "deny", since anything else will NOT be included.
 */
export function permissionSetToText(permissionSet: Partial<PartialPermissionSet>): string {
  let add = "";
  let remove = "";
  for (const ch of ALL_PERMISSION_BITS) {
    const prop: keyof PermissionSet = PERMISSION_BITS[ch];
    const value = permissionSet[prop];
    if (value === "allow") {
      add += ch;
    } else if (value === "deny") {
      remove += ch;
    }
  }
  const perm = (add ? "+" + add : "") + (remove ? "-" + remove : "");
  return REVERSE_ALIASES[perm] || perm;
}


/**
 * Replace allow/deny with allowSome/denySome to indicate dependence on rows.
 */
export function makePartialPermissions(pset: PartialPermissionSet): PartialPermissionSet {
  return mapValues(pset, val => (val === "allow" ? "allowSome" : (val === "deny" ? "denySome" : val)));
}

/**
 * Combine PartialPermissions. Earlier rules win. Note that allowAll|denyAll|mixed are final
 * results (further permissions can't change them), but allowSome|denySome may be changed by
 * further rules into either allowAll|denyAll or mixed.
 *
 * Note that this logic satisfies associative property: (a + b) + c == a + (b + c).
 */
function combinePartialPermission(a: PartialPermissionValue, b: PartialPermissionValue): PartialPermissionValue {
  if (!a) { return b; }
  if (!b) { return a; }
  // If the first is uncertain, the second may keep it unchanged, or make certain, or finalize as mixed.
  if (a === 'allowSome') { return (b === 'allowSome' || b === 'allow') ? b : 'mixed'; }
  if (a === 'denySome') { return (b === 'denySome' || b === 'deny') ? b : 'mixed'; }
  // If the first is certain, it's not affected by the second.
  return a;
}

/**
 * Combine PartialPermissionSets.
 */
export function mergePartialPermissions(a: PartialPermissionSet, b: PartialPermissionSet): PartialPermissionSet {
  return mergePermissions([a, b], ([_a, _b]) => combinePartialPermission(_a, _b));
}

/**
 * Returns permissions trimmed to include only the available bits, and empty for any other bits.
 */
export function trimPermissions(
  permissions: PartialPermissionSet, availableBits: PermissionKey[]
): PartialPermissionSet {
  const trimmed = emptyPermissionSet();
  for (const bit of availableBits) {
    trimmed[bit] = permissions[bit];
  }
  return trimmed;
}


/**
 * Merge a list of PermissionSets by combining individual bits.
 */
export function mergePermissions<T, U>(psets: Array<PermissionSet<T>>, combine: (bits: T[]) => U
): PermissionSet<U> {
  const result: Partial<PermissionSet<U>> = {};
  for (const prop of ALL_PERMISSION_PROPS) {
    result[prop] = combine(psets.map(p => p[prop]));
  }
  return result as PermissionSet<U>;
}

/**
 * Convert a PartialPermissionSet to MixedPermissionSet by replacing any remaining uncertain bits
 * with 'denyAll'. When rules are properly combined it should never be needed because the
 * hard-coded fallback rules should finalize all bits.
 */
export function toMixed(pset: PartialPermissionSet): MixedPermissionSet {
  return mergePermissions([pset], ([bit]) => (bit === 'allow' || bit === 'mixed' ? bit : 'deny'));
}

/**
 * Check if PermissionSet may only add permissions, only remove permissions, or may do either.
 * A rule that neither adds nor removes permissions is treated as mixed.
 */
export function summarizePermissionSet(pset: PartialPermissionSet): MixedPermissionValue {
  let sign = '';
  for (const key of Object.keys(pset) as Array<keyof PartialPermissionSet>) {
    const pWithSome = pset[key];
    // "Some" postfix is not significant for summarization.
    const p = pWithSome === 'allowSome' ? 'allow' : (pWithSome === 'denySome' ? 'deny' : pWithSome);
    if (!p || p === sign) { continue; }
    if (!sign) {
      sign = p;
      continue;
    }
    sign = 'mixed';
  }
  return (sign === 'allow' || sign === 'deny') ? sign : 'mixed';
}

/**
 * Summarize whether a set of permissions are all 'allow', all 'deny', or other ('mixed').
 */
export function summarizePermissions(perms: MixedPermissionValue[]): MixedPermissionValue {
  if (perms.length === 0) { return 'mixed'; }
  const perm = perms[0];
  return perms.some(p => p !== perm) ? 'mixed' : perm;
}


function isEmpty(permissions: PartialPermissionSet): boolean {
  return Object.values(permissions).every(v => v === "");
}


/**
 * Divide up a PartialPermissionSet into two: one containing only the 'schemaEdit' permission bit,
 * and the other containing everything else. Empty parts will be returned as undefined, except
 * when both are empty, in which case nonSchemaEdit will be returned as an empty permission set.
 */
export function splitSchemaEditPermissionSet(permissions: PartialPermissionSet):
    {schemaEdit?: PartialPermissionSet, nonSchemaEdit?: PartialPermissionSet} {

  const schemaEdit = {...emptyPermissionSet(), schemaEdit: permissions.schemaEdit};
  const nonSchemaEdit: PartialPermissionSet = {...permissions, schemaEdit: ""};
  return {
    schemaEdit: !isEmpty(schemaEdit) ? schemaEdit : undefined,
    nonSchemaEdit: !isEmpty(nonSchemaEdit) || isEmpty(schemaEdit) ? nonSchemaEdit : undefined,
  };
}
