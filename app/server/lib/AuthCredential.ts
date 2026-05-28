import { PermissionSet } from "app/common/ACLPermissions";
import { FullUser } from "app/common/LoginSessionAPI";
import { Scope } from "app/gen-server/lib/homedb/HomeDBManager";
import { RequestWithLogin } from "app/server/lib/Authorizer";

import type { DocAuthResult, HomeDBDocAuth } from "app/gen-server/lib/homedb/Interfaces";
import type { Request } from "express";

export interface AuthCredential {
  readonly identifiedUser: FullUser;

  /**
   * Returns a scope with userId and other information extracted from the credential,
   * or undefined if the credential does not does not apply to the request. In such
   * cases, the request's own user is typically the anon user.
   *
   * Called by `getScope` when a request contains a credential to use the userId
   * and filter from the credential. (See `addCredentialScope` in
   * `app/server/lib/requestUtils`.)
   */
  scope(req: Request): Scope | undefined;

  /**
   * Returns a cached DocAuthResult for the specified urlId using the identity of the
   * credential user. The returned result may limit access to the document depending on
   * the credential used. (See `AccessTokenCredential`, which limits access to VIEWER
   * for read-only access tokens.)
   *
   * Throws an ApiError if the credential does not does not apply to the request or
   * the credential user does not have access to the document.
   *
   * Called by `getOrSetDocAuth` when a request contains a credential.
   */
  docAuth(mreq: RequestWithLogin, dbManager: HomeDBDocAuth, urlId: string): Promise<DocAuthResult>;

  /**
   * Returns the max permissions for any doc; undefined if permissions are unaffected. It assumes
   * that the permissions granted by this credential on accessible docs don't depend on which doc.
   *
   * Used by `GranularAccess` to enforce scopes in document access rules.
   */
  permissionMask(): PermissionSet | undefined;
}
