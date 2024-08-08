import { StringUnion } from 'app/common/StringUnion';
import { SessionOIDCInfo } from 'app/server/lib/BrowserSession';
import { AuthorizationParameters, generators, OpenIDCallbackChecks } from 'openid-client';

export const EnabledProtection = StringUnion(
  "STATE",
  "NONCE",
  "PKCE",
);
export type EnabledProtectionString = typeof EnabledProtection.type;

interface Protection {
  generateSessionInfo(): SessionOIDCInfo;
  forgeAuthUrlParams(sessionInfo: SessionOIDCInfo): AuthorizationParameters;
  getCallbackChecks(sessionInfo: SessionOIDCInfo): OpenIDCallbackChecks;
}

function checkIsSet(value: string|undefined, message: string): string {
  if (!value) { throw new Error(message); }
  return value;
}

class PKCEProtection implements Protection {
  public generateSessionInfo(): SessionOIDCInfo {
    return {
      code_verifier: generators.codeVerifier()
    };
  }
  public forgeAuthUrlParams(sessionInfo: SessionOIDCInfo): AuthorizationParameters {
    return {
      code_challenge: generators.codeChallenge(checkIsSet(sessionInfo.code_verifier, "Login is stale")),
      code_challenge_method: 'S256'
    };
  }
  public getCallbackChecks(sessionInfo: SessionOIDCInfo): OpenIDCallbackChecks {
    return {
      code_verifier: checkIsSet(sessionInfo.code_verifier, "Login is stale")
    };
  }
}

class NonceProtection implements Protection {
  public generateSessionInfo(): SessionOIDCInfo {
    return {
      nonce: generators.nonce()
    };
  }
  public forgeAuthUrlParams(sessionInfo: SessionOIDCInfo): AuthorizationParameters {
    return {
      nonce: sessionInfo.nonce
    };
  }
  public getCallbackChecks(sessionInfo: SessionOIDCInfo): OpenIDCallbackChecks {
    return {
      nonce: checkIsSet(sessionInfo.nonce, "Login is stale")
    };
  }
}

class StateProtection implements Protection {
  public generateSessionInfo(): SessionOIDCInfo {
    return {
      state: generators.state()
    };
  }
  public forgeAuthUrlParams(sessionInfo: SessionOIDCInfo): AuthorizationParameters {
    return {
      state: sessionInfo.state
    };
  }
  public getCallbackChecks(sessionInfo: SessionOIDCInfo): OpenIDCallbackChecks {
    return {
      state: checkIsSet(sessionInfo.state, "Login or logout failed to complete")
    };
  }
}

export class ProtectionsManager implements Protection {
  private _protections: Protection[] = [];

  constructor(private _enabledProtections: Set<EnabledProtectionString>) {
    if (this._enabledProtections.has('STATE')) {
      this._protections.push(new StateProtection());
    }
    if (this._enabledProtections.has('NONCE')) {
      this._protections.push(new NonceProtection());
    }
    if (this._enabledProtections.has('PKCE')) {
      this._protections.push(new PKCEProtection());
    }
  }

  public generateSessionInfo(): SessionOIDCInfo {
    const sessionInfo: SessionOIDCInfo = {};
    for (const protection of this._protections) {
      Object.assign(sessionInfo, protection.generateSessionInfo());
    }
    return sessionInfo;
  }

  public forgeAuthUrlParams(sessionInfo: SessionOIDCInfo): AuthorizationParameters {
    const authParams: AuthorizationParameters = {};
    for (const protection of this._protections) {
      Object.assign(authParams, protection.forgeAuthUrlParams(sessionInfo));
    }
    return authParams;
  }

  public getCallbackChecks(sessionInfo: SessionOIDCInfo): OpenIDCallbackChecks {
    const checks: OpenIDCallbackChecks = {};
    for (const protection of this._protections) {
      Object.assign(checks, protection.getCallbackChecks(sessionInfo));
    }
    return checks;
  }

  public supportsProtection(protection: EnabledProtectionString) {
    return this._enabledProtections.has(protection);
  }
}

