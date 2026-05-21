import { PermissionSet } from "app/common/ACLPermissions";
import { FullUser } from "app/common/LoginSessionAPI";
import { getWeakestRole, Role, roleAtLeast } from "app/common/roles";
import { getDocScope, getScope } from "app/server/lib/requestUtils";

import type { DocScope, Scope } from "app/gen-server/lib/homedb/HomeDBManager";
import type { DocAuthResult, HomeDBDocAuth } from "app/gen-server/lib/homedb/Interfaces";
import type { RequestWithLogin } from "app/server/lib/Authorizer";

export interface AuthCredential {
  readonly identifiedUser: FullUser;

  /** Returns the max role for a target; null if it's not accessible with this credential. */
  maxRoleFor(target: AuthTarget): Role | null;

  /**
   * Returns the max permissions for any doc; undefined if permissions are unaffected. It assumes
   * that the permissions granted by this credential on accessible docs don't depend on which doc.
   * */
  permissionMask(): PermissionSet | undefined;

  // TODO add a method to filter accessible resources (e.g. an org-listing endpoint may be
  // available but return a filtered list of accessible workspaces and documents).
}

export type AuthTarget = DocTarget | WsTarget | OrgTarget;

export interface WsTarget { kind: "ws", id: number }
export interface OrgTarget { kind: "org", key: string | number }

// For a document, require info about its parents. That's used for OAuthCredentials (e.g. for
// access given to all docs in a workspace or org).
export interface DocTarget { kind: "doc", docId: string, wsId: number, orgId: number }

/**
 * Build a Scope as used for a HomeDB query, performing the credential check (if any) and
 * uplifting the user-id to the credential's bearer if it passes. Returns null if the credential
 * denies the operation.
 *
 * Endpoints that should be OAuth-reachable should call this instead of getScope/getDocScope;
 * otherwise they'll act as the anonymous user.
 *
 * [This isn't yet used but has an anticipated use.]
 */
export function getCredentialedScope(mreq: RequestWithLogin, target: WsTarget | OrgTarget, role: Role): Scope | null;
export function getCredentialedScope(mreq: RequestWithLogin, target: DocTarget, role: Role): DocScope | null;
export function getCredentialedScope(mreq: RequestWithLogin, target: AuthTarget, role: Role): Scope | null {
  const baseScope = target.kind === "doc" ? getDocScope(mreq) : getScope(mreq);
  const credential = mreq.authSession?.credential;
  if (!credential) { return baseScope; }

  const maxRole = credential.maxRoleFor(target);
  if (!roleAtLeast(maxRole, role)) {
    // maxRole is weaker than what we need: reject.
    return null;
  }

  // Uplift to the identified user, now that we've checked that the granted role is sufficient.
  return { ...baseScope, userId: credential.identifiedUser.id };
}

/**
 * Fetch DocAuth on behalf of a credential. Returns null if the credential doesn't authorize this
 * resource, and clamps the returned role if the credential restricts it.
 *
 * This is used by Authorizer, but lives here because of similarity to getCredentialedScope.
 */
export async function getCredentialedDocAuthCached(
  cred: AuthCredential, dbManager: HomeDBDocAuth, urlId: string, org: string | undefined,
): Promise<DocAuthResult | null> {
  const docAuth = await dbManager.getDocAuthCached({ urlId, userId: cred.identifiedUser.id, org });
  const doc = docAuth.cachedDoc;
  if (!docAuth.docId || !doc) { return null; }

  const wsId: number = doc.workspace.id;
  const orgId: number = doc.workspace.org.id;
  const maxRole = cred.maxRoleFor({ kind: "doc", docId: docAuth.docId, wsId, orgId });
  if (!maxRole) { return null; }

  return { ...docAuth, access: getWeakestRole(maxRole, docAuth.access) };
}
