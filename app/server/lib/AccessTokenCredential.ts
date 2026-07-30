import { ApiError } from "app/common/ApiError";
import { FullUser } from "app/common/LoginSessionAPI";
import * as roles from "app/common/roles";
import { getWeakestRole } from "app/common/roles";
import { AccessTokenInfo } from "app/server/lib/AccessTokens";
import { AuthCredential } from "app/server/lib/AuthCredential";
import { RequestWithLogin } from "app/server/lib/Authorizer";

import type { DocAuthResult, HomeDBDocAuth } from "app/gen-server/lib/homedb/Interfaces";

export class AccessTokenCredential implements AuthCredential {
  constructor(
    public readonly identifiedUser: FullUser,
    private readonly _accessToken: AccessTokenInfo,
  ) {}

  public scope() { return undefined; }

  public async docAuth(
    mreq: RequestWithLogin, dbManager: HomeDBDocAuth, urlId: string,
  ): Promise<DocAuthResult> {
    const docAuth = await dbManager.getDocAuthCached({
      urlId, userId: this.identifiedUser.id, org: mreq.org,
    });
    const doc = docAuth.cachedDoc;
    if (!doc || doc.id !== this._accessToken.docId) {
      throw new ApiError("Document access denied", 403);
    }

    const maxRole = this._accessToken.readOnly ? roles.VIEWER : roles.OWNER;
    return { ...docAuth, access: getWeakestRole(maxRole, docAuth.access) };
  }

  public permissionMask() { return undefined; }
}
