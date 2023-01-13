import {Organization} from 'app/common/UserAPI';

export const OWNER  = 'owners';
export const EDITOR = 'editors';
export const VIEWER = 'viewers';
export const GUEST  = 'guests';
export const MEMBER = 'members';

// Roles ordered from most to least permissive.
const roleOrder: Array<Role|null> = [OWNER, EDITOR, VIEWER, MEMBER, GUEST, null];

export type BasicRole = 'owners'|'editors'|'viewers';
export type NonMemberRole = BasicRole|'guests';
export type NonGuestRole = BasicRole|'members';
export type Role = NonMemberRole|'members';

// Returns the BasicRole (or null) with the same effective access as the given role.
export function getEffectiveRole(role: Role|null): BasicRole|null {
  if (role === GUEST || role === MEMBER) {
    return VIEWER;
  } else {
    return role;
  }
}

export function canEditAccess(role: string|null): boolean {
  return role === OWNER;
}

// Note that while canEdit has the same return value as canDelete, the functions are
// kept separate as they may diverge in the future.
export function canEdit(role: string|null): boolean {
  return role === OWNER || role === EDITOR;
}

export function canDelete(role: string|null): boolean {
  return role === OWNER || role === EDITOR;
}

export function canView(role: string|null): boolean {
  return role !== null;
}

export function isOwner(resource: {access: Role}|null): resource is {access: Role} {
  return resource?.access === OWNER;
}

export function isOwnerOrEditor(resource: {access: Role}|null): resource is {access: Role} {
  return canEdit(resource?.access ?? null);
}

export function canUpgradeOrg(org: Organization|null): org is Organization {
  // TODO: Need to consider billing managers and support user.
  return isOwner(org);
}

// Returns true if the role string is a valid role or null.
export function isValidRole(role: string|null): role is Role|null {
  return (roleOrder as Array<string|null>).includes(role);
}

// Returns true if the role string is a valid non-Guest, non-Member, non-null role.
export function isBasicRole(role: string|null): role is BasicRole {
  return Boolean(role && role !== GUEST && role !== MEMBER && isValidRole(role));
}

// Returns true if the role string is a valid non-Guest, non-null role.
export function isNonGuestRole(role: string|null): role is NonGuestRole {
  return Boolean(role && role !== GUEST && isValidRole(role));
}

/**
 * Returns out of any number of group role names the one that offers more permissions. The function
 * is overloaded so that the output type matches the specificity of the input values.
 */
export function getStrongestRole<T extends Role|null>(...args: T[]): T {
  return getFirstMatchingRole(roleOrder, args);
}

/**
 * Returns out of any number of group role names the one that offers fewer permissions. The function
 * is overloaded so that the output type matches the specificity of the input values.
 */
export function getWeakestRole<T extends Role|null>(...args: T[]): T {
  return getFirstMatchingRole(roleOrder.slice().reverse(), args);
}

// Returns which of the `anyOf` args comes first in `array`. Helper for getStrongestRole
// and getWeakestRole.
function getFirstMatchingRole<T extends Role|null>(array: Array<Role|null>, anyOf: T[]): T {
  if (anyOf.length === 0) {
    throw new Error(`getFirstMatchingRole: No roles given`);
  }
  for (const role of anyOf) {
    if (!isValidRole(role)) {
      throw new Error(`getFirstMatchingRole: Invalid role ${role}`);
    }
  }
  return array.find((item) => anyOf.includes(item as T)) as T;
}
