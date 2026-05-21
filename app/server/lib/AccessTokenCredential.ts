import { FullUser } from "app/common/LoginSessionAPI";
import * as roles from "app/common/roles";
import { AccessTokenInfo } from "app/server/lib/AccessTokens";
import { AuthCredential, AuthTarget } from "app/server/lib/AuthCredential";

export class AccessTokenCredential implements AuthCredential {
  constructor(
    public readonly identifiedUser: FullUser,
    private _accessToken: AccessTokenInfo,
  ) {}

  public maxRoleFor(target: AuthTarget): roles.Role | null {
    // These kinds of access tokens only give permissions on one particular doc.
    if (target.kind === "doc" && this._accessToken.docId === target.docId) {
      return this._accessToken.readOnly ? roles.VIEWER : roles.OWNER;
    }
    return null;
  }

  public permissionMask() { return undefined; }
}
