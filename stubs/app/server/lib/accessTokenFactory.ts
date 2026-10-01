import { ApiError } from "app/common/ApiError";
import { FullUser } from "app/common/LoginSessionAPI";
import { AccessTokenCredential } from "app/server/lib/AccessTokenCredential";
import { AccessTokenInfo } from "app/server/lib/AccessTokens";
import { AuthCredential } from "app/server/lib/AuthCredential";

export function createAccessTokenCredential(user: FullUser, token: AccessTokenInfo): AuthCredential {
  if (token.oauth) {
    throw new ApiError("Access token not supported by this build of Grist", 401);
  }
  return new AccessTokenCredential(user, token);
}
