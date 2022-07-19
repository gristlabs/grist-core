import { ApiError } from 'app/common/ApiError';
import { MapWithTTL } from 'app/common/AsyncCreate';
import { KeyedMutex } from 'app/common/KeyedMutex';
import { AccessTokenOptions } from 'app/plugin/GristAPI';
import { makeId } from 'app/server/lib/idUtils';
import * as jwt from 'jsonwebtoken';
import { RedisClient } from 'redis';

export const Deps = {
  // Signed tokens expire after this length of time.
  TOKEN_TTL_MSECS: 15 * 60 * 1000,  // 15 minutes.
  MAX_SECRETS_KEPT: 3,   // Maximum number of secrets stored per doc.
};

/**
 * Non-optional information embedded in an access token. Currently
 * access tokens are tied to an individual user and document. In
 * future, they could be used outside of the context of a single
 * document.
 *
 * Includes fields from AccessTokenOptions.
 */
export interface AccessTokenInfo extends AccessTokenOptions {
  userId: number;
  docId: string;
}

/**
 * Access token services.
 */
export interface IAccessTokens {
  /**
   * Sign the content of an access token, returning a plain jwt-format
   * string. A per-document secret will be used for signing.
   */
  sign(content: AccessTokenInfo): Promise<string>;

  /**
   * Read the content of a token, verifying its signature.
   */
  verify(token: string): Promise<AccessTokenInfo>;

  /**
   * Check how long access tokens remain valid, once minted.
   */
  getNominalTTLInMsec(): number;

  close(): Promise<void>;
}

/**
 * Implementation of access token services. Write operations should
 * be done by a doc worker responsible for the document involved.
 * Read operations can occur anywhere, such as home servers.
 * This class has caches for _reads and _writes that are kept
 * separate so that we don't have to reason about interactions
 * between them. The class could be separated into two, one just
 * for reading, and one just for writing.
 *
 * Token lifetime is handled by JWT expiration. Secret lifetime is
 * handled by maintaining a rolling list of secrets (per document)
 * that are replaced over time.
 *
 * Redis is used if available so that tokens issued by a worker will
 * be honored by its replacement (within the token's period of validity).
 *
 * Secrets may last for a while. How long they last may vary with usage.
 * A new secret is added when a local cache of signing secrets expires.
 * Older secrets rotate out. For example, if we sign a token, then don't
 * sign another until 0.9 * factor * TOKEN_TTL_MSECS later, a new token
 * will used but the older one preserved. We could do the same
 * MAX_SECRETS_KEPT-2 more times until the original secret is lost.
 * This gives an overall lifetime of about factor * TOKEN_TTL_MSECS * MAX_SECRETS_KEPT.
 * A secret could have a shorter lifetime of about factor * TOKEN_TTL_MSECS
 * if we didn't sign anything else for a bit longer. So there's quite some
 * variation, but the important thing is that secrets aren't lingering for
 * many orders of magnitude more than the lifetime of the tokens they sign.
 */
export class AccessTokens implements IAccessTokens {
  private _store: IAccessTokenSignerStore;       // a redis or in-memory "back end".
  private _reads: MapWithTTL<string, string[]>;  // a cache of recent reads.
  private _writes: MapWithTTL<string, string[]>; // a cache of recent writes.
  private _dtMsec: number;                       // the duration for which tokens must be honored.
  private _mutex = new KeyedMutex();             // logic is simpler if serialized.

  // Use redis if available. Cache reads or writes for some multiple of the duration for which
  // tokens must be honored. Cache is of a list of secrets. It is important to allow multiple
  // secrets so we can change the secret we are signing with and still honor tokens signed with
  // a previous secret.
  constructor(cli: RedisClient|null, private _factor: number = 10) {
    this._store = cli ? new RedisAccessTokenSignerStore(cli) : new InMemoryAccessTokenSignerStore();
    this._dtMsec = Deps.TOKEN_TTL_MSECS;
    this._reads = new MapWithTTL<string, string[]>(this._dtMsec * _factor * 0.5);
    this._writes = new MapWithTTL<string, string[]>(this._dtMsec * _factor * 0.5);
  }

  // Return the duration we promise to honor a token for (although we may
  // honor it for longer).
  public getNominalTTLInMsec() {
    return this._dtMsec;
  }

  // Sign a token. We use JWT, and use its built-in expiration time.
  public async sign(content: AccessTokenInfo): Promise<string> {
    const encoder = await this._getOrCreateSecret(content.docId);
    return jwt.sign(content, encoder, { expiresIn: this._dtMsec / 1000.0 });
  }

  /**
   * Check a token is valid. Since the secret used to sign it is dependent
   * on the docId, we decode the token first to see what document it is claiming
   * to be for. Then we try to verify the token with all the secrets known for
   * that doc. Upon failure, we make sure the secret list is up to date and try
   * again. There is room for optimizing here!
   */
  public async verify(token: string): Promise<AccessTokenInfo> {
    const content = jwt.decode(token);
    if (typeof content !== 'object') {
      throw new ApiError('Broken token', 401);
    }
    const docId = content?.docId as string;
    if (typeof docId !== 'string' || !docId) {
      throw new ApiError('Broken token', 401);
    }
    try {
      // Try to verify with the secrets we already know about.
      return await this._verifyWithGivenDoc(docId, token);
    } catch (e) {
      // Retry with up-to-date secrets.
      await this._refreshSecrets(docId);
      return await this._verifyWithGivenDoc(docId, token);
    }
  }

  public async close() {
    await this._store.close();
    this._reads.clear();
    this._writes.clear();
  }

  private async _verifyWithGivenDoc(docId: string, token: string): Promise<AccessTokenInfo> {
    const secrets = this._reads.get(docId) || [];
    for (const secret of secrets) {
      try {
        return this._verifyWithGivenSecret(secret, token);
      } catch (e) {
        if (String(e).match(/Token has expired/)) {
          // Give specific error about token expiration.
          throw e;
        }
        // continue, to try another secret.
      }
    }
    throw new ApiError('Cannot verify token', 401);
  }

  private _verifyWithGivenSecret(secret: string, token: string): AccessTokenInfo {
    try {
      const content: any = jwt.verify(token, secret);
      if (typeof content !== 'object') {
        throw new ApiError('Token mismatch', 401);
      }
      const userId = content.userId;
      const docId = content.docId;
      if (!userId) { throw new ApiError('no userId in access token', 401); }
      if (!docId) { throw new ApiError('no docId in access token', 401); }
      return content as AccessTokenInfo;
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        throw new ApiError('Token has expired', 401);
      }
      throw new ApiError('Cannot verify token', 401);
    }
  }

  /**
   * Get a secret to sign with. The secret needs to be
   * valid for longer than dtMsec, so it is available
   * for verifying the signed token throughout its
   * lifetime.
   *
   * We maintain a truncated list of secrets, signing
   * with the most recent, and verifying against any.
   *
   */
  private async _getOrCreateSecret(docId: string): Promise<string> {
    return this._mutex.runExclusive(docId, async () => {
      let secrets = this._writes.get(docId);
      if (secrets && secrets.length >= 1) {
        return secrets[0];
      }
      // Our local cache of secrets to sign with is empty.
      secrets = await this._store.getSigners(docId);
      secrets.unshift(this._mintSecret());
      secrets.splice(Deps.MAX_SECRETS_KEPT);
      this._writes.set(docId, secrets);
      await this._store.setSigners(docId, secrets, this._dtMsec * this._factor);
      return secrets[0];
    });
  }

  private async _refreshSecrets(docId: string): Promise<void> {
    const inv = await this._store.getSigners(docId);
    this._reads.set(docId, inv);
  }

  private _mintSecret(): string {
    return makeId() + makeId();
  }
}

/**
 * Store a list of signing secrets globally. Light wrapper over redis or memory.
 */
export interface IAccessTokenSignerStore {
  getSigners(docId: string): Promise<string[]>;
  setSigners(docId: string, secret: string[], ttlMsec: number): Promise<void>;
  close(): Promise<void>;
}

// In-memory implementation of IAccessTokenSignerStore, usable for single-process Grist.
// One limitation is that restarted processes won't honor tokens created by predecessor.
export class InMemoryAccessTokenSignerStore implements IAccessTokenSignerStore {
  private static _keys = new MapWithTTL<string, string[]>(Deps.TOKEN_TTL_MSECS);
  private static _refCount: number = 0;

  public constructor() {
    InMemoryAccessTokenSignerStore._refCount++;
  }

  public async getSigners(docId: string): Promise<string[]> {
    return InMemoryAccessTokenSignerStore._keys.get(docId) || [];
  }

  public async setSigners(docId: string, secrets: string[], ttlMsec: number): Promise<void> {
    InMemoryAccessTokenSignerStore._keys.setWithCustomTTL(docId, secrets, ttlMsec);
  }

  public async close() {
    InMemoryAccessTokenSignerStore._refCount--;
    if (InMemoryAccessTokenSignerStore._refCount <= 0) {
      InMemoryAccessTokenSignerStore._keys.clear();
    }
  }
}

// Redis based implementation of IAccessTokenSignerStore, for multi process/instance
// Grist.
export class RedisAccessTokenSignerStore implements IAccessTokenSignerStore {
  constructor(private _cli: RedisClient) { }

  public async getSigners(docId: string): Promise<string[]> {
    const keys = await this._cli.getAsync(this._getKey(docId));
    return keys?.split(',') || [];
  }

  public async setSigners(docId: string, secrets: string[], ttlMsec: number): Promise<void> {
    await this._cli.setexAsync(this._getKey(docId), ttlMsec, secrets.join(','));
  }

  public async close() {
  }

  private _getKey(docId: string) {
    return `token-doc-decoder-${docId}`;
  }
}
