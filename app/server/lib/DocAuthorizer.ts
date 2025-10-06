import {OpenDocMode} from 'app/common/DocListAPI';
// import {Document} from 'app/gen-server/entity/Document';
import {DocAuthKey, DocAuthResult, HomeDBDocAuth} from 'app/gen-server/lib/homedb/Interfaces';
import {assertAccess} from 'app/server/lib/Authorizer';
import {AuthSession} from 'app/server/lib/AuthSession';
import {Role} from 'app/common/roles';


/**
 *
 * Handle authorization for a single document accessed by a given user.
 *
 */
export interface DocAuthorizer {
  getAuthKey(): DocAuthKey;

  // Check access, throw error if the requested level of access isn't available.
  assertAccess(role: 'viewers'|'editors'|'owners'): Promise<void>;

  // Get the lasted access information calculated for the doc.  This is useful
  // for logging - but access control itself should use assertAccess() to
  // ensure the data is fresh.
  getCachedAuth(): DocAuthResult;
}

interface DocAuthorizerOptions {
  dbManager: HomeDBDocAuth;
  urlId: string;
  openMode: OpenDocMode;
  authSession: AuthSession;
}

/**
 *
 * Handle authorization for a single document and user.
 *
 */
export class DocAuthorizerImpl implements DocAuthorizer {
  public readonly openMode: OpenDocMode;
  private _key: DocAuthKey;
  private _docAuth?: DocAuthResult;
  constructor(
    private _options: DocAuthorizerOptions
  ) {
    this.openMode = _options.openMode;
    const {dbManager, authSession} = _options;
    const userId = authSession.userId || dbManager.getAnonymousUserId();
    this._key = {urlId: _options.urlId, userId, org: authSession.org || ""};
  }

  public getAuthKey(): DocAuthKey {
    return this._key;
  }

  public async assertAccess(role: 'viewers'|'editors'|'owners'): Promise<void> {
    const docAuth = await this._options.dbManager.getDocAuthCached(this._key);
    this._docAuth = docAuth;
    assertAccess(role, docAuth, {openMode: this.openMode});
  }

  public getCachedAuth(): DocAuthResult {
    if (!this._docAuth) { throw Error('no cached authentication'); }
    return this._docAuth;
  }
}

export class DummyAuthorizer implements DocAuthorizer {
  constructor(public role: Role|null, public docId: string) {}
  public getAuthKey(): DocAuthKey { throw new Error("Not supported in standalone"); }
  public async assertAccess() { /* noop */ }
  public getCachedAuth(): DocAuthResult {
    return {
      access: this.role,
      docId: this.docId,
      removed: false,
      disabled: false,
    };
  }
}
