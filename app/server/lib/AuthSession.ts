/**
 * In Grist, there are two main types of request context: one is an express.Request object (for
 * loading pages, API calls, and other HTTP requests); the other is a method call via websocket,
 * where the context is held in Client.ts and determined by the request that created the websocket.
 *
 * Various properties of the context, such as the associated user, document, session, etc, have
 * evolved separately, and there is a slew of objects and flows for representing this state, as
 * well as methods that attempt to deal with it a bit more consistency.
 *
 * Here we make an attempt to simplify the situation:
 * (1) AuthSession represents the user and session, and is available for a Request as
 *     AuthSession.fromReq(req) and for a Client as client.authSession.
 * (2) DocSession has fields specific to a particular Grist document. It is made available in
 *     Request and in Client as the member .docSession, once it's known that those requests
 *     represent a particular document.
 */

import { ApiError } from "app/common/ApiError";
import { FullUser } from "app/common/LoginSessionAPI";
import { AuthCredential } from "app/server/lib/AuthCredential";
import { ILogMeta } from "app/server/lib/log";

import moment from "moment";

import type { RequestWithLogin } from "app/server/lib/Authorizer";

export abstract class AuthSession {
  // Create AuthSession from request. (This is very cheap to create.)
  public static fromReq(req: RequestWithLogin, credential?: AuthCredential): AuthSession {
    return new AuthSessionForReq(req, credential);
  }

  public static fromUser(
    fullUser: FullUser,
    org: string,
    altSessionId?: string,
    credential?: AuthCredential,
    isApiKeyAuth: boolean = false,
  ): AuthSession {
    return new AuthSessionForUser(fullUser, org, altSessionId, credential, isApiKeyAuth);
  }

  public static unauthenticated(): AuthSession { return new UnauthenticatedAuthSession(); }

  public abstract org?: string;
  public abstract altSessionId: string | null;
  public abstract userId: number | null;
  public abstract userIsAuthorized: boolean;
  public abstract fullUser: FullUser | null;
  public abstract credential?: AuthCredential;  // Identity and permissions for a request with restrictions.
  public abstract isApiKeyAuth: boolean;

  public get normalizedEmail(): string | undefined {
    return this.identifiedUser?.loginEmail ?? this.identifiedUser?.email;
  }

  public get displayEmail(): string | undefined { return this.identifiedUser?.email; }
  public get userAgeInDays(): number | undefined { return this._userAge ?? (this._userAge = this._calcAgeInDays()); }

  // Use identifiedUser for display, audit logs, attribution, `user.*` references in access rules.
  // Do NOT use this for permission decisions: use `credential`, which is aware of restrictions.
  // (For requests without restrictions, it is the same as fullUser.)
  public get identifiedUser(): FullUser | null { return this.credential?.identifiedUser ?? this.fullUser; }

  private _userAge?: number;

  public requiredUserId(): number {
    return this.userId || apiFail("user not known", 401);
  }

  public getLogMeta(): ILogMeta {
    // Setting each field conditionally here to omit keys with undefined/null values.
    const meta: ILogMeta = {};
    const [org, email, altSessionId, age] =
      [this.org, this.normalizedEmail, this.altSessionId, this.userAgeInDays];
    const userId = this.identifiedUser?.id;
    if (org != null) { meta.org = org; }
    if (email != null) { meta.email = email; }
    if (userId != null) { meta.userId = userId; }
    if (altSessionId != null) { meta.altSessionId = altSessionId; }
    if (age != null) { meta.age = age; }
    return meta;
  }

  private _calcAgeInDays() {
    const firstLoginAt = this.fullUser?.firstLoginAt;
    return firstLoginAt ? Math.floor(moment.duration(moment().diff(firstLoginAt)).asDays()) : undefined;
  }
}

class UnauthenticatedAuthSession extends AuthSession {
  public readonly org = undefined;
  public readonly altSessionId = null;
  public readonly userId = null;
  public readonly userIsAuthorized = false;
  public readonly fullUser = null;
  public readonly credential = undefined;
  public readonly isApiKeyAuth = false;
}

class AuthSessionForReq extends AuthSession {
  constructor(private _req: RequestWithLogin, public readonly credential?: AuthCredential) { super(); }
  public get isApiKeyAuth() { return this._req.isApiKeyAuth || false; }
  public get org() { return this._req.org; }
  public get altSessionId() { return this._req.altSessionId ?? null; }
  public get userId() { return this._req.userId ?? null; }
  public get userIsAuthorized() { return this._req.userIsAuthorized || false; }
  public get fullUser() { return this._req.fullUser ?? null; }
}

class AuthSessionForUser extends AuthSession {
  constructor(
    private _fullUser: FullUser,
    private _org: string,
    private _altSessionId?: string,
    private _credential?: AuthCredential,
    private _isApiKeyAuth: boolean = false,
  ) {
    super();
  }

  public get org() { return this._org; }
  public get altSessionId() { return this._altSessionId ?? null; }
  public get userId() { return this._fullUser.id; }
  public get userIsAuthorized() { return !this._fullUser.anonymous; }
  public get fullUser() { return this._fullUser; }
  public get credential() { return this._credential; }
  public get isApiKeyAuth() { return this._isApiKeyAuth; }
}

function apiFail(errMessage: string, errStatus: number): never {
  throw new ApiError(errMessage, errStatus);
}
