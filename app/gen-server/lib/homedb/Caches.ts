import { DocPrefs } from "app/common/Prefs";
import { PermissionData } from "app/common/UserAPI";
import { DocScope, HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { QueryResult } from "app/gen-server/lib/homedb/Interfaces";
import { PubSubCache } from "app/server/lib/PubSubCache";
import { IPubSubManager } from "app/server/lib/PubSubManager";

// Defaults for how long we'll cache the results of these calls for. If invalidations were
// perfect, we could cache indefinitely, but if we've missed cases, or if the DB is changed
// outside of the normal app code, this is how long values may remain stale.
const DocAccessCacheTTL = 5 * 60_000;
const DocPrefsCacheTTL = 5 * 60_000;
const OrgBillableMemberCountCacheTTL = 5 * 60_000;

// A hook for tests to override the default values.
export const Deps = { DocAccessCacheTTL, DocPrefsCacheTTL, OrgBillableMemberCountCacheTTL };

export class HomeDBCaches {
  private _docAccessCache: PubSubCache<string, QueryResult<PermissionData>>;
  private _docPrefsCache: PubSubCache<string, Map<number | null, DocPrefs>>;
  private _orgBillableMemberCountCache: PubSubCache<number, number>;

  constructor(
    private readonly _homeDb: HomeDBManager,
    pubSubManager: IPubSubManager,
  ) {
    this._docAccessCache = new PubSubCache<string, QueryResult<PermissionData>>({
      pubSubManager,
      fetch: this._getDocAccess.bind(this),
      getChannel: docId => `docAccessCache:${docId}`,
      ttlMs: Deps.DocAccessCacheTTL,
    });

    this._docPrefsCache = new PubSubCache<string, Map<number | null, DocPrefs>>({
      pubSubManager,
      fetch: docId => this._homeDb.getDocPrefsForUsers(docId, "any"),
      getChannel: docId => `docPrefsCache:${docId}`,
      ttlMs: Deps.DocPrefsCacheTTL,
    });

    // Cached because the count is wanted on every page load of a site whose plan caps members,
    // where the query would otherwise run per request. Invalidated by updateOrgPermissions and
    // by deleteUser, which is every path that changes who is in an org, bar SCIM. The TTL
    // covers what invalidation does not, such as a user being flagged as a consultant.
    this._orgBillableMemberCountCache = new PubSubCache<number, number>({
      pubSubManager,
      fetch: orgId => this._homeDb.getOrgBillableMemberCount(orgId),
      getChannel: orgId => `orgBillableMemberCountCache:${orgId}`,
      ttlMs: Deps.OrgBillableMemberCountCacheTTL,
    });
  }

  public getDocAccess(docId: string) { return this._docAccessCache.getValue(docId); }
  public getDocPrefs(docId: string) { return this._docPrefsCache.getValue(docId); }
  public getOrgBillableMemberCount(orgId: number) { return this._orgBillableMemberCountCache.getValue(orgId); }

  public invalidateDocAccess(docIds: string[]) { return this._docAccessCache.invalidateKeys(docIds); }
  public invalidateDocPrefs(docIds: string[]) { return this._docPrefsCache.invalidateKeys(docIds); }
  public invalidateOrgBillableMemberCount(orgIds: number[]) {
    return this._orgBillableMemberCountCache.invalidateKeys(orgIds);
  }

  // Helper to add an invalidation callback to a list of callbacks. We normally use these to queue
  // invalidations to run after a transaction is committed (to ensure that any refetches they
  // trigger in other servers see the effects of the transaction).
  public addInvalidationDocAccess(callbacks: (() => Promise<void>)[], docIds: string[]) {
    callbacks.push(this.invalidateDocAccess.bind(this, docIds));
  }

  public addInvalidationDocPrefs(callbacks: (() => Promise<void>)[], docIds: string[]) {
    callbacks.push(this.invalidateDocPrefs.bind(this, docIds));
  }

  public addInvalidationOrgBillableMemberCount(callbacks: (() => Promise<void>)[], orgIds: number[]) {
    callbacks.push(this.invalidateOrgBillableMemberCount.bind(this, orgIds));
  }

  // Clear all caches.
  public clear() {
    this._docAccessCache.clear();
    this._docPrefsCache.clear();
    this._orgBillableMemberCountCache.clear();
  }

  private _getDocAccess(docId: string): Promise<QueryResult<PermissionData>> {
    const bypassScope: DocScope = { userId: this._homeDb.getPreviewerUserId(), urlId: docId };
    return this._homeDb.getDocAccess(bypassScope, { flatten: true, excludeUsersWithoutAccess: true });
  }
}
