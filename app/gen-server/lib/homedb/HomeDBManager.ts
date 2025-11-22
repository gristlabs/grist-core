import {ShareInfo} from 'app/common/ActiveDocAPI';
import {ApiError, LimitType} from 'app/common/ApiError';
import {mapGetOrSet, mapSetOrClear, MapWithTTL} from 'app/common/AsyncCreate';
import {ConfigKey, ConfigValue} from 'app/common/Config';
import {getDataLimitInfo} from 'app/common/DocLimits';
import {DocStateComparison} from 'app/common/DocState';
import {createEmptyOrgUsageSummary, DocumentUsage, OrgUsageSummary} from 'app/common/DocUsage';
import {normalizeEmail} from 'app/common/emails';
import {
  ANONYMOUS_PLAN,
  canAddOrgMembers,
  Features,
  isFreePlan,
  mergedFeatures,
  PERSONAL_FREE_PLAN
} from 'app/common/Features';
import {buildUrlId, MIN_URLID_PREFIX_LENGTH, parseUrlId} from 'app/common/gristUrls';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {checkSubdomainValidity} from 'app/common/orgNameUtils';
import {DocPrefs, FullDocPrefs} from 'app/common/Prefs';
import * as roles from 'app/common/roles';
import {UserType} from 'app/common/User';
import {
  ANONYMOUS_USER_EMAIL,
  Proposal as ApiProposal,
  DocumentProperties,
  EVERYONE_EMAIL,
  getRealAccess,
  ManagerDelta,
  NEW_DOCUMENT_CODE,
  OrganizationProperties,
  Organization as OrgInfo,
  PermissionData,
  PermissionDelta,
  PREVIEWER_EMAIL,
  ProposalStatus,
  UserAccessData,
  UserOptions,
  WorkspaceProperties,
} from 'app/common/UserAPI';
import {AclRule, AclRuleDoc, AclRuleOrg, AclRuleWs} from 'app/gen-server/entity/AclRule';
import {Alias} from 'app/gen-server/entity/Alias';
import {BillingAccount} from 'app/gen-server/entity/BillingAccount';
import {BillingAccountManager} from 'app/gen-server/entity/BillingAccountManager';
import {Config} from 'app/gen-server/entity/Config';
import {DocPref} from 'app/gen-server/entity/DocPref';
import {Document, FilteredDocument} from 'app/gen-server/entity/Document';
import {Group} from 'app/gen-server/entity/Group';
import {Limit} from 'app/gen-server/entity/Limit';
import {AccessOption, AccessOptionWithRole, Organization} from 'app/gen-server/entity/Organization';
import {Pref} from 'app/gen-server/entity/Pref';
import {
  getAnonymousFeatures,
  getDefaultProductNames,
  personalFreeFeatures,
  Product
} from 'app/gen-server/entity/Product';
import {Proposal} from 'app/gen-server/entity/Proposal';
import {Secret} from 'app/gen-server/entity/Secret';
import {ServiceAccount} from 'app/gen-server/entity/ServiceAccount';
import {Share} from 'app/gen-server/entity/Share';
import {User} from 'app/gen-server/entity/User';
import {Workspace} from 'app/gen-server/entity/Workspace';
import {HomeDBCaches} from 'app/gen-server/lib/homedb/Caches';
import {GroupsManager, GroupTypes} from 'app/gen-server/lib/homedb/GroupsManager';
import {
  AvailableUsers,
  DocAuthKey,
  DocAuthResult,
  DocumentAccessChanges,
  GetUserOptions,
  GroupWithMembersDescriptor,
  HomeDBAuth,
  NonGuestGroup,
  OrgAccessChanges,
  PreviousAndCurrent,
  QueryResult,
  Resource,
  RoleGroupDescriptor,
  ServiceAccountProperties,
  UserProfileChange,
  WorkspaceAccessChanges
} from 'app/gen-server/lib/homedb/Interfaces';
import {SUPPORT_EMAIL, UsersManager} from 'app/gen-server/lib/homedb/UsersManager';
import {ServiceAccountsManager} from 'app/gen-server/lib/homedb/ServiceAccountsManager';
import {Permissions} from 'app/gen-server/lib/Permissions';
import {scrubUserFromOrg} from 'app/gen-server/lib/scrubUserFromOrg';
import {applyPatch, maybePrepareStatement} from 'app/gen-server/lib/TypeORMPatches';
import {
  bitOr,
  getRawAndEntities,
  hasAtLeastOneOfTheseIds,
  hasOnlyTheseIdsOrNull,
  makeJsonArray,
  now,
  readJson
} from 'app/gen-server/sqlUtils';
import {appSettings} from 'app/server/lib/AppSettings';
import {getOrCreateConnection} from 'app/server/lib/dbUtils';
import {StorageCoordinator} from 'app/server/lib/GristServer';
import {makeId} from 'app/server/lib/idUtils';
import {EmitNotifier, INotifier} from 'app/server/lib/INotifier';
import log from 'app/server/lib/log';
import {Permit} from 'app/server/lib/Permit';
import {IPubSubManager} from 'app/server/lib/PubSubManager';
import {getScope} from 'app/server/lib/requestUtils';
import {expectedResetDate} from 'app/server/lib/serverUtils';
import {WebHookSecret} from 'app/server/lib/Triggers';
import {Request} from 'express';
import {flatten, pick, size} from 'lodash';
import moment from 'moment';
import {
  Brackets,
  DatabaseType,
  DataSource,
  EntityManager,
  ObjectLiteral,
  SelectQueryBuilder,
  WhereExpressionBuilder
} from 'typeorm';
import {v4 as uuidv4} from 'uuid';

// Support transactions in Sqlite in async code.  This is a monkey patch, affecting
// the prototypes of various TypeORM classes.
// TODO: remove this patch if the issue is ever accepted as a problem in TypeORM and
// fixed.  See https://github.com/typeorm/typeorm/issues/1884#issuecomment-380767213
applyPatch();

export { SUPPORT_EMAIL };

export const Deps = {
  defaultMaxNewUserInvitesPerOrg: {
    value: appSettings.section('features')
      .flag('maxNewUserInvitesPerOrg')
      .readInt({
        envVar: 'GRIST_MAX_NEW_USER_INVITES_PER_ORG',
        minValue: 1
      }),
    // Check over the last 24 hours.
    durationMs: 24 * 60 * 60 * 1000,
  },
  defaultMaxBillingManagersPerOrg: {
    value: appSettings.section('features')
      .flag('maxBillingManagersPerOrg')
      .readInt({
        envVar: 'GRIST_MAX_BILLING_MANAGERS_PER_ORG',
        minValue: 1,
      }),
  },
  usePreparedStatements: appSettings.section('db').section('postgres').flag('usePreparedStatements')
    .readBool({
      envVar: 'GRIST_POSTGRES_USE_PREPARED_STATEMENTS',
      defaultValue: false
    }),
};

// Name of a special workspace with examples in it.
export const EXAMPLE_WORKSPACE_NAME = 'Examples & Templates';

// Flag controlling whether sites that are publicly accessible should be listed
// to the anonymous user. Defaults to not listing such sites.
const listPublicSites = appSettings.section('access').flag('listPublicSites').readBool({
  envVar: 'GRIST_LIST_PUBLIC_SITES',
  defaultValue: false,
});

// A TTL in milliseconds for caching the result of looking up access level for a doc,
// which is a burden under heavy traffic.
const DOC_AUTH_CACHE_TTL = appSettings.section('access').flag('docAuthCacheTTL').requireInt({
  envVar: 'GRIST_TEST_DOC_AUTH_CACHE_TTL',
  defaultValue: 5000,
});

// Maps from userId to group name, or null to inherit.
export interface UserIdDelta {
  [userId: string]: roles.NonGuestRole|null;
}

// A collection of fun facts derived from a PermissionDelta (used to describe
// a change of users) and a user.
export interface PermissionDeltaAnalysis {
  // Deltas for existing Grist users.
  foundUserDelta: UserIdDelta | null;
  // Users from foundUserDelta.
  foundUsers: User[];
  // Deltas for emails not matching any Grist user.
  notFoundUserDelta: { [email: string]: roles.NonGuestRole; } | null;
  // The permissions needed to make the change.
  // Usually Permissions.ACL_EDIT, but Permissions.ACL_VIEW is enough for
  // a user to remove themselves.
  permissionThreshold: Permissions;
  // Flags if the user making the change would be affected by the change.
  affectsSelf: boolean;
}

// Options for certain create query helpers private to this file.
interface QueryOptions {
  manager?: EntityManager;
  markPermissions?: Permissions;
  needRealOrg?: boolean;  // Set if pseudo-org should be collapsed to user's personal org
  allowSpecialPermit?: boolean;  // Set if specialPermit in Scope object should be respected,
                                 // potentially overriding markPermissions.
}

interface DocQueryOptions extends QueryOptions {
  // Override AccessStyle (defaults to 'open'). E.g. 'openNoPublic' ignores public access.
  accessStyle?: AccessStyle;
}

// Information about a change in billable users.
export interface UserChange {
  userId: number;            // who initiated the change
  org: Organization;         // organization changed
  customerId: string|null;   // stripe customer id
  countBefore: number;       // billable users before change
  countAfter: number;        // billable users after change
  membersBefore: Map<roles.NonGuestRole, User[]>;
  membersAfter: Map<roles.NonGuestRole, User[]>;
}

// The context in which a query is being made.  Includes what we know
// about the user, and for requests made from pages, the active organization.
export interface Scope {
  userId: number;                // The ID of the user for authentication purposes.
  org?: string;                  // Org identified in request.
  urlId?: string;                // Set when accessing a document.  May be a docId.
  users?: AvailableUsers;        // Set if available identities.
  includeSupport?: boolean;      // When set, include sample resources shared by support to scope.
  showRemoved?: boolean;         // When set, query is scoped to removed workspaces/docs.
  showAll?: boolean;             // When set, return both removed and regular resources.
  specialPermit?: Permit;        // When set, extra rights are granted on a specific resource.
}

// Flag for whether we are listing resources or opening them.  This makes a difference
// for public resources, which we allow users to open but not necessarily list.
// 'openNoPublic' is like open, but ignores public shares, i.e. only allows users who are listed
// as collaborators, either directly or by inheriting access.
type AccessStyle = 'list' | 'open' | 'openNoPublic';

// A Scope for documents, with mandatory urlId.
export interface DocScope extends Scope {
  urlId: string;
}

// Represent a DocAuthKey as a string.  The format is "<urlId>:<org> <userId>".
// flushSingleDocAuthCache() depends on this format.
function stringifyDocAuthKey(key: DocAuthKey): string {
  return stringifyUrlIdOrg(key.urlId, key.org) + ` ${key.userId}`;
}

function stringifyUrlIdOrg(urlId: string, org?: string): string {
  return `${urlId}:${org}`;
}

export interface DocumentMetadata {
  // ISO 8601 UTC date (e.g. the output of new Date().toISOString()).
  updatedAt?: string;
  usage?: DocumentUsage|null;
}

interface CreateWorkspaceOptions {
  org: Organization,
  props: Partial<WorkspaceProperties>,
  ownerId?: number
}

/**
 * Available options for creating a new org with a new billing account.
 * It serves only as a way to remove all foreign keys from the entity.
 */
export type BillingOptions = Partial<Pick<BillingAccount,
  'stripeCustomerId' |
  'stripeSubscriptionId' |
  'stripePlanId' |
  'externalId' |
  'externalOptions' |
  'inGoodStanding' |
  'status' |
  'paymentLink' |
  'features'
>>;

/**
 * HomeDBManager handles interaction between the ApiServer and the Home database,
 * encapsulating the typeorm logic.
 */
export class HomeDBManager implements HomeDBAuth {
  public caches: HomeDBCaches|null;
  private _usersManager = new UsersManager(this, this.runInTransaction.bind(this));
  private _groupsManager = new GroupsManager(this._usersManager, this.runInTransaction.bind(this));
  private _serviceAccountsManager = new ServiceAccountsManager(
    this, this.runInTransaction.bind(this)
  );
  private _connection: DataSource;
  private _exampleWorkspaceId: number;
  private _exampleOrgId: number;
  private _idPrefix: string = "";  // Place this before ids in subdomains, used in routing to
                                   // deployments on same subdomain.

  private _docAuthCache = new MapWithTTL<string, Promise<DocAuthResult>>(DOC_AUTH_CACHE_TTL);
  private _readonly: boolean = false;


  private get _dbType(): DatabaseType {
    return this._connection.driver.options.type;
  }

  public constructor(
    public storageCoordinator?: StorageCoordinator,
    private _notifier: INotifier = new EmitNotifier(),
    pubSubManager?: IPubSubManager,
  ) {
    this.caches = pubSubManager ? new HomeDBCaches(this, pubSubManager) : null;
  }

  public usersManager() {
    return this._usersManager;
  }

  public get defaultGroups(): RoleGroupDescriptor[] {
    return this._groupsManager.defaultGroups;
  }

  public get defaultBasicGroups(): RoleGroupDescriptor[] {
    return this._groupsManager.defaultBasicGroups;
  }

  public get defaultCommonGroups(): RoleGroupDescriptor[] {
    return this._groupsManager.defaultCommonGroups;
  }

  public get defaultGroupNames(): roles.Role[] {
    return this._groupsManager.defaultGroupNames;
  }

  public get defaultBasicGroupNames(): roles.BasicRole[] {
    return this._groupsManager.defaultBasicGroupNames;
  }

  public get defaultNonGuestGroupNames(): roles.NonGuestRole[] {
    return this._groupsManager.defaultNonGuestGroupNames;
  }

  public get defaultCommonGroupNames(): roles.NonMemberRole[] {
    return this.defaultCommonGroups
      .map(_grpDesc => _grpDesc.name) as roles.NonMemberRole[];
  }

  /**
   * Returns the application settings object.
   * Currently returns the global appSettings, but in the future this could be enhanced
   * to return settings from the database.
   */
  public getAppSettings() {
    return appSettings;
  }

  public setPrefix(prefix: string) {
    this._idPrefix = prefix;
  }

  public setReadonly(readonly = true) {
    if (this._readonly !== readonly) {
      this._readonly = readonly;
      this.flushDocAuthCache();
    }
  }

  public isReadonly() {
    return this._readonly;
  }

  public async connect(): Promise<void> {
    this._connection = await getOrCreateConnection();
  }

  public connectTo(connection: DataSource) {
    this._connection = connection;
  }

  // make sure special users and workspaces are available
  public async initializeSpecialIds(options?: {
    skipWorkspaces?: boolean  // if set, skip setting example workspace.
  }) {
    await this._usersManager.initializeSpecialIds();

    if (!options?.skipWorkspaces) {
      // Find the example workspace.  If there isn't one named just right, take the first workspace
      // belonging to the support user.  This shouldn't happen in deployments but could happen
      // in tests.
      // TODO: it should now be possible to remove all this; the only remaining
      // issue is what workspace to associate with documents created by
      // anonymous users.
      const supportWorkspaces = await this._workspaces()
        .leftJoinAndSelect('workspaces.org', 'orgs')
        .where('orgs.owner_id = :userId', { userId: this._usersManager.getSupportUserId() })
        .orderBy('workspaces.created_at')
        .getMany();
      const exampleWorkspace = supportWorkspaces.find(ws => ws.name === EXAMPLE_WORKSPACE_NAME) || supportWorkspaces[0];
      if (!exampleWorkspace) { throw new Error('No example workspace available'); }
      if (exampleWorkspace.name !== EXAMPLE_WORKSPACE_NAME) {
        log.warn('did not find an appropriately named example workspace in deployment');
      }
      this._exampleWorkspaceId = exampleWorkspace.id;
      this._exampleOrgId = exampleWorkspace.org.id;
    }
  }

  public get connection() {
    return this._connection;
  }

  public async testQuery(sql: string, args: any[]): Promise<any> {
    return this._connection.query(sql, args);
  }

  /**
   * Maps from the name of an entity to its id, for the purposes of
   * unit tests only.  It relies on test entities being named
   * distinctly.  It just runs through each model in turn by brute
   * force, and returns the id of this first match it finds.
   */
  public async testGetId(name: string): Promise<number|string> {
    const org = await Organization.findOne({where: {name}});
    if (org) { return org.id; }
    const ws = await Workspace.findOne({where: {name}});
    if (ws) { return ws.id; }
    const doc = await Document.findOne({where: {name}});
    if (doc) { return doc.id; }
    const user = await User.findOne({where: {name}});
    if (user) { return user.id; }
    const product = await Product.findOne({where: {name}});
    if (product) { return product.id; }
    throw new Error(`Cannot testGetId(${name})`);
  }

  /**
   * For tests only. Get user's unique reference by name.
   */
  public async testGetRef(name: string): Promise<string> {
    const user = await User.findOne({where: {name}});
    if (user) { return user.ref; }
    throw new Error(`Cannot testGetRef(${name})`);
  }

  /**
   * For use in tests.
   * @see UsersManager.prototype.testClearUserPrefs
   */
  public async testClearUserPrefs(emails: string[]) {
    return this._usersManager.testClearUserPrefs(emails);
  }

  public async getUserByKey(apiKey: string): Promise<User|undefined> {
    return this._usersManager.getUserByKey(apiKey);
  }

  public async getUserByRef(ref: string): Promise<User|undefined> {
    return this._usersManager.getUserByRef(ref);
  }

  public async getUser(userId: number, options: {includePrefs?: boolean} = {}) {
    return this._usersManager.getUser(userId, options);
  }

  public async getUsers() {
    return this._usersManager.getUsers();
  }

  public async getFullUser(userId: number) {
    return this._usersManager.getFullUser(userId);
  }

  public async getUserAndEnsureUnsubscribeKey(userId: number) {
    return this._usersManager.getUserAndEnsureUnsubscribeKey(userId);
  }

  /**
   * @see UsersManager.prototype.makeFullUser
   */
  public makeFullUser(user: User) {
    return this._usersManager.makeFullUser(user);
  }

  /**
   * @see UsersManager.prototype.ensureExternalUser
   */
  public async ensureExternalUser(profile: UserProfile) {
    return await this._usersManager.ensureExternalUser(profile);
  }

  /**
   * @see UsersManager.prototype.updateUser
   */
  public async updateUser(
    userId: number,
    props: UserProfileChange
  ): Promise<PreviousAndCurrent<User>> {
    const {previous, current, isWelcomed} = await this._usersManager.updateUser(userId, props);
    if (current && isWelcomed) {
      await this._notifier.firstLogin(this.makeFullUser(current));
    }
    return {previous, current};
  }

  public async updateUserOptions(userId: number, props: Partial<UserOptions>) {
    return this._usersManager.updateUserOptions(userId, props);
  }

  /**
   * @see UsersManager.prototype.getUserByLoginWithRetry
   */
  public async getUserByLoginWithRetry(email: string, options: GetUserOptions = {}): Promise<User> {
    return this._usersManager.getUserByLoginWithRetry(email, options);
  }

  /**
   * @see UsersManager.prototype.getUserByLogin
   */
  public async getUserByLogin(email: string, options: GetUserOptions = {}, type: UserType = 'login'): Promise<User> {
    return this._usersManager.getUserByLogin(email, options, type);
  }

  /**
   * @see UsersManager.prototype.getExistingUserByLogin
   * Find a user by email. Don't create the user if it doesn't already exist.
   */
  public async getExistingUserByLogin(email: string, manager?: EntityManager): Promise<User|undefined> {
    return await this._usersManager.getExistingUserByLogin(email, manager);
  }

  /**
   * @see UsersManager.prototype.getExistingUsersByLogin
   * Find users by emails.
   */
  public async getExistingUsersByLogin(emails: string[], manager?: EntityManager): Promise<User[]> {
    return await this._usersManager.getExistingUsersByLogin(emails, manager);
  }

  public async createGroup(groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager) {
    return this._groupsManager.createGroup(groupDescriptor, optManager);
  }

  public async overwriteTeamGroup(
    id: number, groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager
  ) {
    return this._groupsManager.overwriteTeamGroup(id, groupDescriptor, optManager);
  }

  public async overwriteRoleGroup(
    id: number, groupDescriptor: GroupWithMembersDescriptor, optManager?: EntityManager
  ) {
    return this._groupsManager.overwriteRoleGroup(id, groupDescriptor, optManager);
  }

  public async deleteGroup(id: number, expectedType?: GroupTypes, optManager?: EntityManager) {
    return this._groupsManager.deleteGroup(id, expectedType, optManager);
  }

  public getGroupsWithMembers(manager?: EntityManager): Promise<Group[]> {
    return this._groupsManager.getGroupsWithMembers(manager);
  }

  public getGroupsWithMembersByType(
    type: GroupTypes, opts?: {aclRule?: boolean}, manager?: EntityManager): Promise<Group[]> {
    return this._groupsManager.getGroupsWithMembersByType(type, opts, manager);
  }

  public getGroupWithMembersById(id: number, opts?: {aclRule: boolean}, manager?: EntityManager): Promise<Group|null> {
    return this._groupsManager.getGroupWithMembersById(id, opts, manager);
  }

  /**
   * Returns true if the given domain string is available, and false if it is not available.
   * NOTE that the endpoint only checks if the domain string is taken in the database, it does
   * not check whether the string contains invalid characters.
   */
  public async isDomainAvailable(domain: string): Promise<boolean> {
    let qb = this._orgs();
    qb = this._whereOrg(qb, domain);
    const results = await qb.getRawAndEntities();
    return results.entities.length === 0;
  }

  /**
   * Returns the number of users in any non-guest role in the given org.
   * Note that this does not require permissions and should not be exposed to the client.
   *
   * If an Organization is provided, all of orgs.acl_rules, orgs.acl_rules.group,
   * and orgs.acl_rules.group.memberUsers should be included.
   */
  public async getOrgMemberCount(org: string|number|Organization): Promise<number> {
    return (await this._getOrgMembers(org)).length;
  }

  /**
   * Returns the number of billable users in the given org.
   */
  public async getOrgBillableMemberCount(org: string|number|Organization): Promise<number> {
    return (await this._getOrgMembers(org))
              .filter(u => !u.options?.isConsultant) // remove consultants.
              .filter(u => !this._usersManager.getExcludedUserIds().includes(u.id)) // remove support user and other
              .length;
  }

  /**
   * @see UsersManager.prototype.deleteUser
   */
  public async deleteUser(scope: Scope, userIdToDelete: number,
                          name?: string): Promise<QueryResult<User>> {
    return this._usersManager.deleteUser(scope, userIdToDelete, name);
  }

  public async overwriteUser(userId: number, props: UserProfile) {
    return this._usersManager.overwriteUser(userId, props);
  }

  /**
   * Returns a QueryResult for the given organization.  The orgKey
   * can be a string (the domain from url) or the id of an org.  If it is
   * null, the user's personal organization is returned.
   */
  public async getOrg(scope: Scope, orgKey: string|number|null,
                      transaction?: EntityManager, options?: {
                        requirePermissions: Permissions,
                      }): Promise<QueryResult<Organization>> {
    const {userId} = scope;
    // Anonymous access to the merged org is a special case.  We return an
    // empty organization, not backed by the database, and which can contain
    // nothing but the example documents always added to the merged org.
    if (this.isMergedOrg(orgKey) && userId === this._usersManager.getAnonymousUserId()) {
      const anonOrg: OrgInfo = {
        id: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        domain: this.mergedOrgDomain(),
        name: 'Anonymous',
        owner: this.makeFullUser(this._usersManager.getAnonymousUser()),
        access: 'viewers',
        billingAccount: {
          id: 0,
          individual: true,
          product: {
            name: ANONYMOUS_PLAN,
            features: personalFreeFeatures,
          },
          stripePlanId: '',
          isManager: false,
          inGoodStanding: true,
          features: {},
        },
        host: null
      };
      return { status: 200, data: anonOrg as any };
    }
    let qb = this.org(scope, orgKey, {
      ...(options?.requirePermissions ? {
        markPermissions: options.requirePermissions,
      } : undefined),
      manager: transaction,
      needRealOrg: true
    });
    qb = this._addBillingAccount(qb, scope.userId);
    let effectiveUserId = scope.userId;
    if (scope.specialPermit && scope.specialPermit.org === orgKey) {
      effectiveUserId = this._usersManager.getPreviewerUserId();
    }
    qb = this._withAccess(qb, effectiveUserId, 'orgs');
    qb = qb.leftJoinAndSelect('orgs.owner', 'owner');
    // Add preference information that will be relevant for presentation of the org.
    // That includes preference information specific to the site and the user,
    // or specific just to the site, or specific just to the user.
    qb = qb.leftJoinAndMapMany('orgs.prefs', Pref, 'prefs',
                               '(prefs.org_id = orgs.id or prefs.org_id IS NULL) AND ' +
                               '(prefs.user_id = :userId or prefs.user_id IS NULL)',
                               {userId});
    // Apply a particular order (user+org first if present, then org, then user).
    // Slightly round-about syntax because Sqlite and Postgres disagree about NULL
    // ordering (Sqlite does support NULL LAST syntax now, but not on our fork yet).
    qb = qb.addOrderBy('coalesce(prefs.org_id, 0)', 'DESC');
    qb = qb.addOrderBy('coalesce(prefs.user_id, 0)', 'DESC');
    const result: QueryResult<any> = await this._verifyAclPermissions(qb, {
      markedPermissions: options?.requirePermissions !== undefined
    });
    if (result.status === 200) {
      // Return the only org.
      result.data = result.data[0];
      if (this.isMergedOrg(orgKey)) {
        // The merged psuedo-organization is almost, but not quite, the user's personal
        // org.  We give it a distinct domain and id.
        result.data.id = 0;
        result.data.domain = this.mergedOrgDomain();
      }
    }
    return result;
  }

  /**
   * Gets the billing account for the specified org.  Will throw errors if the org
   * is not found, or if the user does not have access to its billing account.
   *
   * The special previewer user is given access to billing account information.
   *
   * The billing account includes fields such as stripeCustomerId.
   * To include `managers` and `orgs` fields listing all billing account managers
   * and organizations linked to the account, set `includeOrgsAndManagers`.
   */
  public async getBillingAccount(scope: Scope, orgKey: string|number,
                                 includeOrgsAndManagers: boolean,
                                 transaction?: EntityManager): Promise<BillingAccount> {
    const org = this.unwrapQueryResult(await this.getOrg(scope, orgKey, transaction));

    if (!org.billingAccount.isManager && scope.userId !== this._usersManager.getPreviewerUserId() &&
      // The special permit (used for the support user) allows access to the billing account.
      scope.specialPermit?.org !== orgKey) {
      throw new ApiError('User does not have access to billing account', 401);
    }
    if (!includeOrgsAndManagers) { return org.billingAccount; }

    // For full billing account information including all managers
    // (for team accounts) and orgs (for individual accounts), we need
    // to make a different query since what we've got so far is
    // filtered by org and by user for authorization purposes.
    // Also, filling out user information linked to orgs and managers
    // requires a few extra joins.
    return this.getFullBillingAccount(org.billingAccount.id, transaction);
  }

  /**
   * Gets all information about a billing account, without permission check.
   */
  public getFullBillingAccount(billingAccountId: number, transaction?: EntityManager): Promise<BillingAccount> {
    return this.runInTransaction(transaction, async tr => {
      let qb = tr.createQueryBuilder()
        .select('billing_accounts')
        .from(BillingAccount, 'billing_accounts')
        .leftJoinAndSelect('billing_accounts.product', 'products')
        .leftJoinAndSelect('billing_accounts.managers', 'managers')
        .leftJoinAndSelect('managers.user', 'manager_users')
        .leftJoinAndSelect('manager_users.logins', 'manager_logins')
        .leftJoinAndSelect('billing_accounts.orgs', 'orgs')
        .leftJoinAndSelect('orgs.owner', 'org_users')
        .leftJoinAndSelect('org_users.logins', 'org_logins')
        .where('billing_accounts.id = :billingAccountId', {billingAccountId});
      qb = this._addBillingAccountCalculatedFields(qb);
      // TODO: should reconcile with isManager field that stripped down results have.
      const results = await qb.getRawAndEntities();
      const resources = this._normalizeQueryResults(results.entities);
      if (!resources[0]) {
        throw new ApiError('Cannot find billing account', 500);
      }
      return resources[0];
    });
  }

  /**
   * Look up an org by an external id.  External IDs are used in integrations, and
   * simply offer an alternate way to identify an org.
   */
  public async getOrgByExternalId(externalId: string): Promise<Organization|undefined> {
    const query = this._orgs()
      .leftJoinAndSelect('orgs.billingAccount', 'billing_accounts')
      .leftJoinAndSelect('billing_accounts.product', 'products')
      .where('external_id = :externalId', {externalId});
    return await query.getOne() || undefined;
  }

  /**
   * Returns a QueryResult for an organization with nested workspaces.
   */
  public async getOrgWorkspaces(scope: Scope, orgKey: string|number,
                                options: QueryOptions = {}): Promise<QueryResult<Workspace[]>> {
    const query = this._orgWorkspaces(scope, orgKey, options);
    // Allow an empty result for the merged org for the anonymous user.  The anonymous user
    // has no home org or workspace.  For all other situations, expect at least one workspace.
    const emptyAllowed = this.isMergedOrg(orgKey) && scope.userId === this._usersManager.getAnonymousUserId();
    const result: QueryResult<any> = await this._verifyAclPermissions(query, { scope, emptyAllowed });
    // Return the workspaces, not the org(s).
    if (result.status === 200) {
      // Place ownership information in workspaces, available for the merged org.
      for (const o of result.data) {
        for (const ws of o.workspaces) {
          ws.owner = o.owner;
          // Include the org's domain so that the UI can build doc URLs that include the org.
          ws.orgDomain = o.domain;
        }
      }
      // For org-specific requests, we still have the org's workspaces, plus the Samples workspace
      // from the support org.
      result.data = [].concat(...result.data.map((o: Organization) => o.workspaces));
    }
    return result;
  }

  /**
   * Returns a QueryResult for the workspace with the given workspace id. The workspace
   * includes nested Docs.
   */
  public async getWorkspace(
    scope: Scope,
    wsId: number,
    transaction?: EntityManager,
    options?: {
      requirePermissions: Permissions,
    },
  ): Promise<QueryResult<Workspace>> {
    const {userId} = scope;
    if (scope.specialPermit && scope.specialPermit.workspaceId === wsId) {
      const effectiveUserId = this._usersManager.getPreviewerUserId();
      scope = {...scope};
      scope.userId = effectiveUserId;
      delete scope.users;
      options = {
        ...options,
        requirePermissions: Permissions.VIEW,
      };
    }
    let queryBuilder = this._workspace(scope, wsId, {
      manager: transaction,
      ...(options?.requirePermissions ? {
        markPermissions: options.requirePermissions,
        allowSpecialPermit: true,
      } : undefined),
    })
      // Nest the docs within the workspace object
      .leftJoinAndSelect('workspaces.docs', 'docs', this._onDoc(scope))
      .leftJoinAndSelect('workspaces.org', 'orgs')
      .leftJoinAndSelect('orgs.owner', 'owner')
      // Define some order (spec doesn't promise anything though)
      .orderBy('workspaces.created_at')
      .addOrderBy('docs.created_at');
    queryBuilder = this._addIsSupportWorkspace(userId, queryBuilder, 'orgs', 'workspaces');
    // Add access information and query limits
    // TODO: allow generic org limit once sample/support workspace is done differently
    queryBuilder = this._applyLimit(queryBuilder, {...scope, org: undefined}, ['workspaces', 'docs'], 'list');
    const result: QueryResult<any> = await this._verifyAclPermissions(queryBuilder, {
      scope,
      markedPermissions: options?.requirePermissions !== undefined,
    });
    // Return a single workspace.
    if (result.status === 200) {
      result.data = result.data[0];
    }
    return result;
  }

  /**
   * Returns an organization's usage summary (e.g. count of documents that are approaching or exceeding
   * limits).
   */
  public async getOrgUsageSummary(scope: Scope, orgKey: string|number): Promise<OrgUsageSummary> {
    // Check that an owner of the org is making the request.
    const markPermissions = Permissions.OWNER;
    let orgQuery = this.org(scope, orgKey, {
      markPermissions,
      needRealOrg: true
    });
    orgQuery = this._addFeatures(orgQuery);
    const orgQueryResult = await verifyEntity(orgQuery);
    const org: Organization = this.unwrapQueryResult(orgQueryResult);
    const productFeatures = org.billingAccount.getFeatures();

    // Grab all the non-removed documents in the org.
    let docsQuery = this._docs()
      .innerJoin('docs.workspace', 'workspaces')
      .innerJoin('workspaces.org', 'orgs')
      .where('docs.workspace_id = workspaces.id')
      .andWhere('workspaces.removed_at IS NULL AND docs.removed_at IS NULL');
    docsQuery = this._whereOrg(docsQuery, orgKey);
    if (this.isMergedOrg(orgKey)) {
      docsQuery = docsQuery.andWhere('orgs.owner_id = :userId', {userId: scope.userId});
    }
    const docsQueryResult = await this._verifyAclPermissions(docsQuery, { scope, emptyAllowed: true });
    const docs: Document[] = this.unwrapQueryResult(docsQueryResult);

    // Return an aggregate count of documents, grouped by data limit status.
    const summary = createEmptyOrgUsageSummary();
    let totalAttachmentsSizeBytes = 0;
    for (const {usage: docUsage, gracePeriodStart} of docs) {
      const dataLimitStatus = getDataLimitInfo({docUsage, gracePeriodStart, productFeatures}).status;
      totalAttachmentsSizeBytes += docUsage?.attachmentsSizeBytes ?? 0;
      if (dataLimitStatus) { summary.countsByDataLimitStatus[dataLimitStatus] += 1; }
    }
    const maxAttachmentsBytesPerOrg = productFeatures.maxAttachmentsBytesPerOrg;
    summary.attachments = {
      totalBytes: totalAttachmentsSizeBytes,
    };
    if (maxAttachmentsBytesPerOrg && totalAttachmentsSizeBytes > maxAttachmentsBytesPerOrg) {
      summary.attachments.limitExceeded = true;
    }
    return summary;
  }

  /**
   * Compute the best access option for an organization, from the
   * users available to the client.  If none of the options can access
   * the organization, returns null.  If there are equally good
   * options, an arbitrary one is returned.
   *
   * Comparison is made between roles rather than fine-grained
   * permissions, since otherwise the result would not be well defined
   * (permissions could in general overlap without one being a
   * superset of the other).  For the acl rules we've used so far,
   * this problem does not arise and reasoning at the level of a
   * hierarchy of roles is adequate.
   */
  public async getBestUserForOrg(users: AvailableUsers, org: number|string): Promise<AccessOptionWithRole|null> {
    if (this.isMergedOrg(org)) {
      // Don't try to pick a best user for the merged personal org.
      // If this changes in future, be sure to call this._filterByOrgGroups on the query
      // below, otherwise it will include every users' personal org which is wasteful
      // and parsing/mapping the results in TypeORM is slow.
      return null;
    }
    let qb = this._orgs();
    qb = this._whereOrg(qb, org);
    qb = this._withAccess(qb, users, 'orgs');
    const result = await this._verifyAclPermissions(qb, {emptyAllowed: true});
    if (!result.data) {
      throw new ApiError(result.errMessage || 'failed to select user', result.status);
    }
    if (!result.data.length) { return null; }
    const options: AccessOptionWithRole[] = result.data[0].accessOptions!;
    if (!options.length) { return null; }
    const role = roles.getStrongestRole(...options.map(option => option.access));
    return options.find(option => option.access === role) || null;
  }

  /**
   * Returns a SelectQueryBuilder which gives an array of orgs already filtered by
   * the given user' (or users') access.
   * If a domain is specified, only an org matching that domain and accessible by
   * the user or users is returned.
   * The anonymous user is treated specially, to avoid advertising organizations
   * with anonymous access.
   */
  public async getOrgs(users: AvailableUsers, domain: string|null,
                       options?: {ignoreEveryoneShares?: boolean}): Promise<QueryResult<Organization[]>> {
    let queryBuilder = this._orgs()
      .leftJoinAndSelect('orgs.owner', 'users', 'orgs.owner_id = users.id');
    if (UsersManager.isSingleUser(users)) {
      // When querying with a single user in mind, we keep our api promise
      // of returning their personal org first in the list.
      queryBuilder = queryBuilder
        .orderBy('(coalesce(users.id,0) = :userId)', 'DESC')
        .setParameter('userId', users);
    }
    queryBuilder = queryBuilder
      .addOrderBy('users.name')
      .addOrderBy('orgs.name');
    queryBuilder = this._withAccess(queryBuilder, users, 'orgs');
    // Add a direct, efficient filter to remove irrelevant personal orgs from consideration.
    queryBuilder = this._filterByOrgGroups(queryBuilder, users, domain, options);
    if (this._usersManager.isAnonymousUser(users) && !listPublicSites) {
      // The anonymous user is a special case.  It may have access to potentially
      // many orgs, but listing them all would be kind of a misfeature.  but reporting
      // nothing would complicate the client.  We compromise, and report at most
      // the org of the site the user is on (or nothing when the api is accessed
      // via a url that is unrelated to any particular org).
      // This special processing is only needed for the isSingleUser case.  Multiple
      // users can only be presented when the user has proven login access to each.
      if (domain && !this.isMergedOrg(domain)) {
        queryBuilder = this._whereOrg(queryBuilder, domain);
      } else {
        return {status: 200, data: []};
      }
    }
    return this._verifyAclPermissions(queryBuilder, {emptyAllowed: true});
  }

  // As for getOrgs, but all personal orgs are merged into a single entry.
  public async getMergedOrgs(userId: number, users: AvailableUsers,
                             domain: string|null): Promise<QueryResult<Organization[]>> {
    const result = await this.getOrgs(users, domain);
    if (result.status === 200) {
      return {status: 200, data: this._mergePersonalOrgs(userId, result.data!)};
    }
    return result;
  }

  // Returns the doc with access information for the calling user only.
  // TODO: The return type of this function includes the workspace and org with the owner
  // properties set, as documented in app/common/UserAPI. The return type of this function
  // should reflect that.
  public async getDocImpl(key: DocAuthKey, transaction?: EntityManager): Promise<Document> {
    const {userId} = key;
    // Doc permissions of forks are based on the "trunk" document, so make sure
    // we look up permissions of trunk if we are on a fork (we'll fix the permissions
    // up for the fork immediately afterwards).
    const {trunkId, forkId, forkUserId, snapshotId,
           shareKey} = parseUrlId(key.urlId);
    let doc: Document;
    if (shareKey) {
      const res = await (transaction || this._connection).createQueryBuilder()
        .select('shares')
        .from(Share, 'shares')
        .leftJoinAndSelect('shares.doc', 'doc')
        .leftJoinAndSelect('doc.workspace', 'workspace')
        .leftJoinAndSelect('workspace.org', 'org')
        .leftJoinAndSelect('org.billingAccount', 'billing_account')
        .leftJoinAndSelect('billing_account.product', 'product')
        .where('key = :key', {key: shareKey})
        .andWhere('doc.removed_at IS NULL')
        .getOne();
      if (!res) {
        throw new ApiError('Share not known', 404);
      }
      doc = {
        name: res.doc?.name,
        id: res.docId,
        linkId: res.linkId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        removedAt: res.doc?.removedAt || null,
        disabledAt: res.doc?.disabledAt || null,
        isPinned: false,
        urlId: key.urlId,
        workspace: res.doc.workspace,
        aliases: [],
        access: 'editors',  // a share may have view/edit access,
                            // need to check at granular level
      } as any;

      return doc;
    }
    const urlId = trunkId;
    if (forkId || snapshotId) { key = {...key, urlId}; }
    if (urlId === NEW_DOCUMENT_CODE) {
      if (!forkId) { throw new ApiError('invalid document identifier', 400); }
      // We imagine current user owning trunk if there is no embedded userId, or
      // the embedded userId matches the current user.
      const access = (forkUserId === undefined || forkUserId === userId) ? 'owners' :
        (userId === this._usersManager.getPreviewerUserId() ? 'viewers' : null);
      if (!access) { throw new ApiError("access denied", 403); }
      doc = {
        name: 'Untitled',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        id: 'new',
        isPinned: false,
        urlId: null,
        workspace: this.unwrapQueryResult<Workspace>(
          await this.getWorkspace({userId: this._usersManager.getSupportUserId()},
                                   this._exampleWorkspaceId, transaction)),
        aliases: [],
        access
      } as any;

      // Use free personal account features for documents opened this way.
      doc.workspace.org.billingAccount = patch(new BillingAccount(), {
        features: getAnonymousFeatures(),
        product: patch(new Product(), {name: PERSONAL_FREE_PLAN})
      });
    } else {
      // We can't delegate filtering of removed documents to the db, since we'll be
      // caching authentication.  But we also don't need to delegate filtering, since
      // it is very simple at the single-document level.  So we direct the db to include
      // everything with showAll flag, and let the getDoc() wrapper deal with the remaining
      // work.
      let qb = this._doc({...key, showAll: true}, {manager: transaction})
        .leftJoinAndSelect('orgs.owner', 'org_users');
      if (userId !== this._usersManager.getAnonymousUserId()) {
        qb = this._addForks(userId, qb);
      }
      qb = this._addIsSupportWorkspace(userId, qb, 'orgs', 'workspaces');
      qb = this._addFeatures(qb);  // add features to determine whether we've gone readonly

      // We need to check if the current user is disabled or not. In
      // order to avoid another DB round trip, we piggyback with an
      // unconditional table join here.
      //
      // Note that we only run this check here because this method is
      // used for websocket communication. There's no danger currently
      // in other HomeDB methods of leaking access to disabled users,
      // so we keep this unusual join localised here, in order to
      // minimise the cost of the DB query.
      qb = qb.leftJoin(User, 'users', 'users.id = :userId', {userId});
      qb = qb.addSelect('users.disabled_at', 'users_disabled_at');

      const docs = this.unwrapQueryResult<Document[]>(await this._verifyAclPermissions(qb, {checkDisabledUser: true}));
      if (docs.length === 0) { throw new ApiError('document not found', 404); }
      if (docs.length > 1) { throw new ApiError('ambiguous document request', 400); }
      doc = docs[0];
      const features = doc.workspace.org.billingAccount?.getFeatures() || {};
      if (features.readOnlyDocs || this.isReadonly()) {
        // Don't allow any access to docs that is stronger than "viewers".
        doc.access = roles.getWeakestRole('viewers', doc.access);
      }
      // Place ownership information in the doc's workspace.
      (doc.workspace as any).owner = doc.workspace.org.owner;
    }
    if (forkId || snapshotId) {
      doc.trunkId = doc.id;

      // Fix up our reply to be correct for the fork, rather than the trunk.
      // The "id" and "urlId" fields need updating.
      doc.id = buildUrlId({trunkId: doc.id, forkId, forkUserId, snapshotId});
      if (doc.urlId) {
        doc.urlId = buildUrlId({trunkId: doc.urlId, forkId, forkUserId, snapshotId});
      }

      // Set trunkAccess field.
      doc.trunkAccess = doc.access;

      // Update access for fork.
      if (forkId) { this._setForkAccess(doc, {userId, forkUserId}, doc); }
      if (!doc.access) {
        throw new ApiError('access denied', 403);
      }
    }
    return doc;
  }

  // Calls getDocImpl() and returns the Document from that, caching a fresh DocAuthResult along
  // the way. Note that we only cache the access level, not Document itself.
  public async getDoc(reqOrScope: Request | Scope, transaction?: EntityManager): Promise<Document> {
    const scope = "params" in reqOrScope ? getScope(reqOrScope) : reqOrScope;
    const key = getDocAuthKeyFromScope(scope);
    const promise = this.getDocImpl(key, transaction);
    await mapSetOrClear(this._docAuthCache, stringifyDocAuthKey(key), makeDocAuthResult(promise));
    const doc = await promise;
    // Filter the result for removed / non-removed documents.
    if (!scope.showAll && scope.showRemoved ?
        (doc.removedAt === null && doc.workspace.removedAt === null) :
        (doc.removedAt || doc.workspace.removedAt)) {
      throw new ApiError('document not found', 404);
    }
    return doc;
  }

  public async getAllDocs() {
    return this.connection.getRepository(Document).find();
  }

  public async getRawDocById(docId: string, transaction?: EntityManager) {
    return await this.getDoc({
      urlId: docId,
      userId: this._usersManager.getPreviewerUserId(),
      showAll: true
    }, transaction);
  }

  // Returns access info for the given doc and user, caching the results for DOC_AUTH_CACHE_TTL
  // ms. This helps reduce database load created by liberal authorization requests.
  public async getDocAuthCached(key: DocAuthKey): Promise<DocAuthResult> {
    return mapGetOrSet(this._docAuthCache, stringifyDocAuthKey(key),
      () => makeDocAuthResult(this.getDocImpl(key)));
  }

  // Used in tests, and to clear all timeouts when exiting.
  public flushDocAuthCache() {
    this._docAuthCache.clear();
  }

  // Clear all caches. This is used, in particular, on server exit.
  public clearCaches() {
    this.flushDocAuthCache();
    this.caches?.clear();
  }

  // Flush cached access information about a specific document
  // (identified specifically by a docId, not a urlId).  Any cached
  // information under an alias will also be flushed.
  // TODO: make a more efficient implementation if needed.
  public async flushSingleDocAuthCache(scope: DocScope, docId: string) {
    // Get all aliases of this document.
    const aliases = await this._connection.manager.find(Alias, {where: {docId}});
    // Construct a set of possible prefixes for cache keys.
    const names = new Set(aliases.map(a => stringifyUrlIdOrg(a.urlId, scope.org)));
    names.add(stringifyUrlIdOrg(docId, scope.org));
    // Remove any cache keys that start with any of the prefixes.
    for (const key of this._docAuthCache.keys()) {
      const name = key.split(' ', 1)[0];
      if (names.has(name)) { this._docAuthCache.delete(key); }
    }
  }

  // Find a document by name.  Limit name search to a specific organization.
  // It is possible to hit ambiguities, e.g. with the same name of a doc
  // in multiple workspaces, so this is not a general-purpose method.  It
  // is here to facilitate V0 -> V1 migration, so existing links to docs continue
  // to work.
  public async getDocByName(userId: number, orgId: number, docName: string): Promise<QueryResult<Document>> {
    let qb = this._docs()
      .innerJoin('docs.workspace', 'workspace')
      .innerJoin('workspace.org', 'org')
      .where('docs.name = :docName', {docName})
      .andWhere('org.id = :orgId', {orgId});
    qb = this._withAccess(qb, userId, 'docs');
    return this._single(await this._verifyAclPermissions(qb));
  }

  /**
   * Gets a list of all forks whose trunk is `docId`.
   *
   * NOTE: This is not a part of the API. It should only be called by the DocApi when
   * deleting a document.
   */
  public async getDocForks(docId: string): Promise<Document[]> {
    return this._connection.createQueryBuilder()
      .select('forks')
      .from(Document, 'forks')
      .where('forks.trunk_id = :docId', {docId})
      .getMany();
  }

  /**
   *
   * Adds an org with the given name. Returns a query result with the added org.
   *
   * @param user: user doing the adding
   * @param name: desired org name
   * @param domain: desired org domain, or null not to set a domain
   * @param setUserAsOwner: if this is the user's personal org (they will be made an
   *   owner in the ACL sense in any case)
   * @param useNewPlan: by default, the individual billing account associated with the
   *   user's personal org will be used for all other orgs they create.  Set useNewPlan
   *   to force a distinct non-individual billing account to be used for this org.
   *   NOTE: Currently it is always a true - billing account is one to one with org.
   * @param product: if set, controls the type of plan used for the org. Only
   *   meaningful for team sites currently, where it defaults to the plan in GRIST_DEFAULT_PRODUCT
   *   env variable, or else STUB_PLAN.
   * @param billing: if set, controls the billing account settings for the org.
   */
  public async addOrg(
    user: User,
    props: Partial<OrganizationProperties>,
    options: {
      setUserAsOwner: boolean,
      useNewPlan: boolean,
      product?: string,
      billing?: BillingOptions
    },
    transaction?: EntityManager
  ): Promise<QueryResult<Organization>> {
    const notifications: Array<() => Promise<void>> = [];
    const name = props.name;
    const domain = props.domain;
    if (!name) {
      return {
        status: 400,
        errMessage: 'Bad request: name required'
      };
    }
    const orgResult = await this.runInTransaction(transaction, async manager => {
      if (domain) {
        try {
          checkSubdomainValidity(domain);
        } catch (e) {
          return {
            status: 400,
            errMessage: `Domain is not permitted: ${e.message}`
          };
        }
      }
      // Create or find a billing account to associate with this org.
      const billingAccountEntities = [];
      let billingAccount;
      if (options.useNewPlan) { // use separate billing account (currently yes)
        const productNames = getDefaultProductNames();
        const product =
          // For personal site use personal product always (ignoring options.product)
          options.setUserAsOwner ? productNames.personal :
          // For team site use the product from options if given
          options.product ? options.product :
          // If we are support user, use team product
          // A bit fragile: this is called during creation of support@ user, before
          // getSupportUserId() is available, but with setUserAsOwner of true.
          user.id === this._usersManager.getSupportUserId() ? productNames.team :
          // Otherwise use teamInitial product (a stub).
          productNames.teamInitial;

        billingAccount = new BillingAccount();
        billingAccount.individual = options.setUserAsOwner;
        const dbProduct = await manager.findOne(Product, {where: {name: product}});
        if (!dbProduct) {
          throw new Error('Cannot find product for new organization');
        }
        billingAccount.product = dbProduct;
        billingAccountEntities.push(billingAccount);
        const billingAccountManager = new BillingAccountManager();
        billingAccountManager.user = user;
        billingAccountManager.billingAccount = billingAccount;
        billingAccountEntities.push(billingAccountManager);
        // Apply billing settings if requested, but not all of them.
        if (options.billing) {
          const billing = options.billing;
          // If we have features but it is empty object, just remove it
          if (billing.features && typeof billing.features === 'object' && Object.keys(billing.features).length === 0) {
            delete billing.features;
          }
          const allowedKeys: Array<keyof BillingOptions> = [
            'stripeCustomerId',
            'stripeSubscriptionId',
            'stripePlanId',
            'features',
            // save will fail if externalId is a duplicate.
            'externalId',
            'externalOptions',
            'inGoodStanding',
            'status',
            'paymentLink'
          ];
          Object.keys(billing).forEach(key => {
            if (!allowedKeys.includes(key as any)) {
              delete (billing as any)[key];
            }
          });
          Object.assign(billingAccount, billing);
        }
      } else {
        log.warn("Creating org with shared billing account");
        // Use the billing account from the user's personal org to start with.
        billingAccount = await manager.createQueryBuilder()
          .select('billing_accounts')
          .from(BillingAccount, 'billing_accounts')
          .leftJoinAndSelect('billing_accounts.orgs', 'orgs')
          .where('orgs.owner_id = :userId', {userId: user.id})
          .getOne();
        if (options.billing?.externalId && billingAccount?.externalId !== options.billing?.externalId) {
          throw new ApiError('Conflicting external identifier', 400);
        }
        if (!billingAccount) {
          throw new ApiError('Cannot find an initial plan for organization', 500);
        }
      }
      // Create a new org.
      const org = new Organization();
      org.checkProperties(props);
      org.updateFromProperties(props);
      org.billingAccount = billingAccount;
      if (domain) {
        org.domain = domain;
      }
      if (options.setUserAsOwner) {
        org.owner = user;
      }
      // Create the special initial permission groups for the new org.
      const groupMap = this._groupsManager.createGroups();
      org.aclRules = this.defaultGroups.map(_grpDesc => {
        // Get the special group with the name needed for this ACL Rule
        const group = groupMap[_grpDesc.name];
        // Note that the user is added to the owners group of an org when it is created.
        if (_grpDesc.name === roles.OWNER) {
          group.memberUsers = [user];
        }
        // Add each of the special groups to the new workspace.
        const aclRuleOrg = new AclRuleOrg();
        aclRuleOrg.permissions = _grpDesc.permissions;
        aclRuleOrg.group = group;
        aclRuleOrg.organization = org;
        return aclRuleOrg;
      });
      // Saves the workspace as well as its new ACL Rules and Group.
      const groups = org.aclRules.map(rule => rule.group);
      let savedOrg: Organization;
      try {
        const result = await manager.save([org, ...org.aclRules, ...groups, ...billingAccountEntities]);
        savedOrg = result[0] as Organization;
      } catch (e) {
        if (e.name === 'QueryFailedError' && e.message &&
            e.message.match(/unique constraint/i)) {
          throw new ApiError('Domain already in use', 400);
        }
        throw e;
      }
      // Add a starter workspace to the org.  Any limits on org workspace
      // count are not checked, this will succeed unconditionally.
      await this._doAddWorkspace({org: savedOrg, props: {name: 'Home'}}, manager);

      if (!options.setUserAsOwner) {
        // This user just made a team site (once this transaction is applied).
        // Emit a notification.
        notifications.push(this._teamCreatorNotification(user.id));
      }
      return {status: 200, data: savedOrg};
    });
    for (const notification of notifications) { await notification(); }
    return orgResult;
  }

  /**
   * Updates the properties of the specified org.
   *
   * - If setting anything more than prefs:
   *     - Checks that the user has UPDATE permissions to the given org. If
   *       not, throws an error.
   * - For setting userPrefs or userOrgPrefs:
   *     - These are user-specific setting, so are allowed with VIEW access
   *       (that includes guests). Prefs are replaced in their entirety, not
   *       merged.
   * - For setting orgPrefs:
   *     - These are not user-specific, so require UPDATE permissions.
   *
   * Returns a query result with status 200 and the previous and current
   * versions of the org on success.
   */
  public async updateOrg(
    scope: Scope,
    orgKey: string|number,
    props: Partial<OrganizationProperties>,
    transaction?: EntityManager,
  ): Promise<QueryResult<PreviousAndCurrent<Organization>>> {

    // Check the scope of the modifications.
    let markPermissions: number = Permissions.VIEW;
    let modifyOrg: boolean = false;
    let modifyPrefs: boolean = false;
    for (const key of Object.keys(props)) {
      if (key === 'orgPrefs') {
        // If setting orgPrefs, make sure we have UPDATE rights since this
        // will affect other users.
        markPermissions = Permissions.UPDATE;
        modifyPrefs = true;
      } else if (key === 'userPrefs' || key === 'userOrgPrefs') {
        // These keys only affect the current user.
        modifyPrefs = true;
      } else {
        markPermissions = Permissions.UPDATE;
        modifyOrg = true;
      }
    }

    // TODO: Unsetting a domain will likely have to be supported; also possibly prefs.
    return await this.runInTransaction(transaction, async manager => {
      const orgQuery = this.org(scope, orgKey, {
        manager,
        markPermissions,
        needRealOrg: true
      });
      const queryResult = await verifyEntity(orgQuery);
      if (queryResult.status !== 200) {
        // If the query for the org failed, return the failure result.
        return queryResult;
      }
      // Update the fields and save.
      const org: Organization = queryResult.data;
      const previous = structuredClone(org);
      org.checkProperties(props);
      if (modifyOrg) {
        if (props.domain) {
          if (org.owner) {
            throw new ApiError('Cannot set a domain for a personal organization', 400);
          }
          try {
            checkSubdomainValidity(props.domain);
          } catch (e) {
            return {
              status: 400,
              errMessage: `Domain is not permitted: ${e.message}`
            };
          }
        }
        org.updateFromProperties(props);
        await manager.save(org);
      }
      if (modifyPrefs) {
        for (const flavor of ['orgPrefs', 'userOrgPrefs', 'userPrefs'] as const) {
          const prefs = props[flavor];
          if (prefs === undefined) { continue; }
          const orgId = ['orgPrefs', 'userOrgPrefs'].includes(flavor) ? org.id : null;
          const userId = ['userOrgPrefs', 'userPrefs'].includes(flavor) ? scope.userId : null;
          await manager.createQueryBuilder()
            .insert()
          // if pref flavor has been set before, update it
            .onConflict('(COALESCE(org_id,0), COALESCE(user_id,0)) DO UPDATE SET prefs = :prefs')
          // TypeORM muddles JSON handling a bit here
            .setParameters({prefs: JSON.stringify(prefs)})
            .into(Pref)
            .values({orgId, userId, prefs})
            .execute();
        }
      }
      return {status: 200, data: {previous, current: org}};
    });
  }

  // Checks that the user has REMOVE permissions to the given org. If not, throws an
  // error. Otherwise deletes the given org. Returns a query result with status 200
  // on success.
  //
  // This method only cleans up the database, and not any documents associated
  // with the site. So it shouldn't be made available directly to users.
  // Instead use Doom.deleteOrg which is aware of the world outside the
  // database.
  public async deleteOrg(
    scope: Scope,
    orgKey: string|number,
    transaction?: EntityManager
  ): Promise<QueryResult<Organization>> {
    return await this.runInTransaction(transaction, async manager => {
      const orgQuery = this.org(scope, orgKey, {
        manager,
        markPermissions: Permissions.REMOVE,
        allowSpecialPermit: true
      })
      // Join the org's workspaces (with ACLs and groups), docs (with ACLs and groups)
      // and ACLs and groups so we can remove them.
      .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'groups')
      .leftJoinAndSelect('orgs.workspaces', 'workspaces')
      .leftJoinAndSelect('workspaces.aclRules', 'workspace_acl_rules')
      .leftJoinAndSelect('workspace_acl_rules.group', 'workspace_group')
      .leftJoinAndSelect('workspaces.docs', 'docs')
      .leftJoinAndSelect('docs.aclRules', 'doc_acl_rules')
      .leftJoinAndSelect('doc_acl_rules.group', 'doc_group')
      .leftJoinAndSelect('orgs.billingAccount', 'billing_accounts');
      const queryResult = await verifyEntity(orgQuery);
      if (queryResult.status !== 200) {
        // If the query for the org failed, return the failure result.
        return queryResult;
      }
      const org: Organization = queryResult.data;
      const deletedOrg = structuredClone(org);
      // Delete the org, org ACLs/groups, workspaces, workspace ACLs/groups, workspace docs
      // and doc ACLs/groups.
      const orgGroups = org.aclRules.map(orgAcl => orgAcl.group);
      const wsAcls = ([] as AclRule[]).concat(...org.workspaces.map(ws => ws.aclRules));
      const wsGroups = wsAcls.map(wsAcl => wsAcl.group);
      const docs = ([] as Document[]).concat(...org.workspaces.map(ws => ws.docs));
      const docAcls = ([] as AclRule[]).concat(...docs.map(doc => doc.aclRules));
      const docGroups = docAcls.map(docAcl => docAcl.group);
      await manager.remove([org, ...org.aclRules, ...orgGroups, ...org.workspaces,
        ...wsAcls, ...wsGroups, ...docs, ...docAcls, ...docGroups]);

      // Delete billing account if this was the last org using it.
      const billingAccount = await manager.findOne(BillingAccount, {
        where: {id: org.billingAccountId},
        relations: ['orgs'],
      });
      if (billingAccount && billingAccount.orgs.length === 0) {
        await manager.remove([billingAccount]);
      }
      return {status: 200, data: deletedOrg};
    });
  }

  // Checks that the user has ADD permissions to the given org. If not, throws an error.
  // Otherwise adds a workspace with the given name. Returns a query result with the
  // added workspace.
  public async addWorkspace(
    scope: Scope,
    orgKey: string|number,
    props: Partial<WorkspaceProperties>
  ): Promise<QueryResult<Workspace>> {
    const name = props.name;
    if (!name) {
      return {
        status: 400,
        errMessage: 'Bad request: name required'
      };
    }
    return await this._connection.transaction(async manager => {
      let orgQuery = this.org(scope, orgKey, {
        manager,
        markPermissions: Permissions.ADD,
        needRealOrg: true
      })
      // Join the org's ACL rules (with 1st level groups listed) so we can include them in the
      // workspace.
      .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'org_group')
      .leftJoinAndSelect('orgs.workspaces', 'workspaces');  // we may want to count workspaces.
      orgQuery = this._addFeatures(orgQuery);  // add features to access optional workspace limit.
      const queryResult = await verifyEntity(orgQuery);
      if (queryResult.status !== 200) {
        // If the query for the organization failed, return the failure result.
        return queryResult;
      }
      const org: Organization = queryResult.data;
      const features = org.billingAccount.getFeatures();
      if (features.maxWorkspacesPerOrg !== undefined) {
        // we need to count how many workspaces are in the current org, and if we
        // are already at or above the limit, then fail.
        const count = org.workspaces.length;
        if (count >= features.maxWorkspacesPerOrg) {
          throw new ApiError('No more workspaces permitted', 403, {
            limit: {
              quantity: 'workspaces',
              maximum: features.maxWorkspacesPerOrg,
              value: count,
              projectedValue: count + 1
            }
          });
        }
      }
      const workspace = await this._doAddWorkspace({org, props, ownerId: scope.userId}, manager);
      return {status: 200, data: workspace};
    });
  }

  /**
   * Checks that the user has UPDATE permissions to the given workspace. If
   * not, throws an error. Otherwise updates the given workspace with the given
   * name.
   *
   * Returns a query result with status 200 and the previous and current
   * versions of the workspace, on success.
   */
  public async updateWorkspace(
    scope: Scope,
    wsId: number,
    props: Partial<WorkspaceProperties>
  ): Promise<QueryResult<PreviousAndCurrent<Workspace>>> {
    return await this._connection.transaction(async manager => {
      const wsQuery = this._workspace(scope, wsId, {
        manager,
        markPermissions: Permissions.UPDATE
      })
      .leftJoinAndSelect('workspaces.org', 'orgs');
      const queryResult = await verifyEntity(wsQuery);
      if (queryResult.status !== 200) {
        // If the query for the workspace failed, return the failure result.
        return queryResult;
      }
      // Update the name and save.
      const workspace: Workspace = queryResult.data;
      const previous = structuredClone(workspace);
      workspace.checkProperties(props);
      workspace.updateFromProperties(props);
      await manager.save(workspace);
      return {status: 200, data: {previous, current: workspace}};
    });
  }

  /**
   * Checks that the user has REMOVE permissions to the given workspace. If not, throws an
   * error. Otherwise deletes the given workspace. Returns a query result with status 200
   * and the deleted workspace on success.
   */
  public async deleteWorkspace(scope: Scope, wsId: number): Promise<QueryResult<Workspace>> {
    return await this._connection.transaction(async manager => {
      const wsQuery = this._workspace(scope, wsId, {
        manager,
        markPermissions: Permissions.REMOVE,
        allowSpecialPermit: true
      })
      // Join the workspace's docs (with ACLs and groups) and ACLs and groups so we can
      // remove them. Also join the org to get the orgId.
      .leftJoinAndSelect('workspaces.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'groups')
      .leftJoinAndSelect('workspaces.docs', 'docs')
      .leftJoinAndSelect('docs.aclRules', 'doc_acl_rules')
      .leftJoinAndSelect('doc_acl_rules.group', 'doc_groups')
      .leftJoinAndSelect('workspaces.org', 'orgs');
      const queryResult = await verifyEntity(wsQuery);
      if (queryResult.status !== 200) {
        // If the query for the workspace failed, return the failure result.
        return queryResult;
      }
      const workspace: Workspace = queryResult.data;
      const deletedWorkspace = structuredClone(workspace);
      // Delete the workspace, workspace docs, doc ACLs/groups and workspace ACLs/groups.
      const wsGroups = workspace.aclRules.map(wsAcl => wsAcl.group);
      const docAcls = ([] as AclRule[]).concat(...workspace.docs.map(doc => doc.aclRules));
      const docGroups = docAcls.map(docAcl => docAcl.group);
      await manager.remove([workspace, ...wsGroups, ...docAcls, ...workspace.docs,
        ...workspace.aclRules, ...docGroups]);
      // Update the guests in the org after removing this workspace.
      await this._repairOrgGuests(scope, workspace.org.id, manager);
      return {status: 200, data: deletedWorkspace};
    });
  }

  public softDeleteWorkspace(scope: Scope, wsId: number): Promise<QueryResult<Workspace>> {
    return this._setWorkspaceRemovedAt(scope, wsId, new Date());
  }

  public async undeleteWorkspace(scope: Scope, wsId: number): Promise<QueryResult<Workspace>> {
    return this._setWorkspaceRemovedAt(scope, wsId, null);
  }

  // Checks that the user has ADD permissions to the given workspace. If not, throws an
  // error. Otherwise adds a doc with the given name. Returns a query result with the id
  // of the added doc.
  // The desired docId may be passed in.  If passed in, it should have been generated
  // by makeId().  The client should not be given control of the choice of docId.
  // This option is used during imports, where it is convenient not to add a row to the
  // document database until the document has actually been imported.
  public async addDocument(
    scope: Scope,
    wsId: number,
    props: Partial<DocumentProperties>,
    docId?: string
  ): Promise<QueryResult<Document>> {
    const name = props.name;
    if (!name) {
      return {
        status: 400,
        errMessage: 'Bad request: name required'
      };
    }
    return await this._connection.transaction(async manager => {
      let wsQuery = this._workspace(scope, wsId, {
        manager,
        markPermissions: Permissions.ADD
      })
      .leftJoinAndSelect('workspaces.org', 'orgs')
      // Join the workspaces's ACL rules (with 1st level groups listed) so we can include
      // them in the doc.
      .leftJoinAndSelect('workspaces.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'workspace_group');
      wsQuery = this._addFeatures(wsQuery);
      const queryResult = await verifyEntity(wsQuery);
      if (queryResult.status !== 200) {
        // If the query for the organization failed, return the failure result.
        return queryResult;
      }
      const workspace: Workspace = queryResult.data;
      if (workspace.removedAt) {
        throw new ApiError('Cannot add document to a deleted workspace', 400);
      }
      await this._checkRoomForAnotherDoc(workspace, manager);
      // Create a new document.
      const doc = new Document();
      doc.id = docId || makeId();
      doc.checkProperties(props);
      doc.updateFromProperties(props);
      // For some reason, isPinned defaulting to null, not false,
      // for some typeorm/postgres combination? That causes a
      // constraint violation.
      if (!doc.isPinned) {
        doc.isPinned = false;
      }
      // By default, assign a urlId that is a prefix of the docId.
      // The urlId should be unique across all existing documents.
      if (!doc.urlId) {
        for (let i = MIN_URLID_PREFIX_LENGTH; i <= doc.id.length; i++) {
          const candidate = doc.id.substr(0, i);
          if (!await manager.findOne(Alias, {where: {urlId: candidate}})) {
            doc.urlId = candidate;
            break;
          }
        }
        if (!doc.urlId) {
          // This should happen only if UUIDs collide.
          throw new Error('Could not find a free identifier for document');
        }
      }
      if (doc.urlId) {
        await this._checkForUrlIdConflict(manager, workspace.org, doc.urlId);
        const alias = new Alias();
        doc.aliases = [alias];
        alias.urlId = doc.urlId;
        alias.orgId = workspace.org.id;
      } else {
        doc.aliases = [];
      }
      doc.workspace = workspace;
      doc.createdBy = scope.userId;
      // Create the special initial permission groups for the new workspace.
      const groupMap = this._groupsManager.createGroups(workspace, scope.userId);
      doc.aclRules = this.defaultCommonGroups.map(_grpDesc => {
        // Get the special group with the name needed for this ACL Rule
        const group = groupMap[_grpDesc.name];
        // Add each of the special groups to the new doc.
        const aclRuleDoc = new AclRuleDoc();
        aclRuleDoc.permissions = _grpDesc.permissions;
        aclRuleDoc.group = group;
        aclRuleDoc.document = doc;
        return aclRuleDoc;
      });
      // Saves the document as well as its new ACL Rules and Group.
      const groups = doc.aclRules.map(rule => rule.group);
      const [data] = await manager.save<[Document, ...(AclRuleDoc|Alias|Group)[]]>([
        doc,
        ...doc.aclRules,
        ...doc.aliases,
        ...groups,
      ]);
      // Ensure that the creator is in the ws and org's guests group. Creator already has
      // access to the workspace (he is at least an editor), but we need to be sure that
      // even if he is removed from the workspace, he will still have access to this doc.
      // Guest groups are updated after any access is changed, so even if we won't add creator
      // now, he will be added later. NOTE: those functions would normally fail in transaction
      // as those groups might by already fixed (when there is another doc created in the same
      // time), but they are ignoring any unique constraints errors.
      await this._repairWorkspaceGuests(scope, workspace.id, manager);
      await this._repairOrgGuests(scope, workspace.org.id, manager);
      return {status: 200, data};
    });
  }

  public addSecret(value: string, docId: string): Promise<Secret> {
    return this._connection.transaction(async manager => {
      const secret = new Secret();
      secret.id = uuidv4();
      secret.value = value;
      secret.doc = {id: docId} as any;
      await manager.save([secret]);
      return secret;
    });
  }

  // Updates the secret matching id and docId, to the new value.
  public async updateSecret(id: string, docId: string, value: string, manager?: EntityManager): Promise<void> {
    const res = await (manager || this._connection).createQueryBuilder()
      .update(Secret)
      .set({value})
      .where("id = :id AND doc_id = :docId", {id, docId})
      .execute();
    if (res.affected !== 1) {
      throw new ApiError('secret with given id not found or nothing was updated', 404);
    }
  }

  public async getSecret(id: string, docId: string, manager?: EntityManager): Promise<string | undefined> {
    const secret = await (manager || this._connection).createQueryBuilder()
      .select('secrets')
      .from(Secret, 'secrets')
      .where('id = :id AND doc_id = :docId', {id, docId})
      .getOne();
    return secret?.value;
  }

  // Update the webhook url in the webhook's corresponding secret (note: the webhook identifier is
  // its secret identifier).
  public async updateWebhookUrlAndAuth(
    props: {
      id: string,
      docId: string,
      url: string | undefined,
      auth: string | undefined,
      outerManager?: EntityManager}
    ) {
    const {id, docId, url, auth, outerManager} = props;
    return await this.runInTransaction(outerManager, async manager => {
      if (url === undefined && auth === undefined) {
        throw new ApiError('None of the Webhook url and auth are defined', 404);
      }
      const value = await this.getSecret(id, docId, manager);
      if (!value) {
        throw new ApiError('Webhook with given id not found', 404);
      }
      const webhookSecret = JSON.parse(value);
      // As we want to patch the webhookSecret object, only set the url and the authorization when they are defined.
      // When the user wants to empty the value, we are expected to receive empty strings.
      if (url !== undefined) {
        webhookSecret.url = url;
      }
      if (auth !== undefined) {
        webhookSecret.authorization = auth;
      }
      await this.updateSecret(id, docId, JSON.stringify(webhookSecret), manager);
    });
  }

  public async removeWebhook(id: string, docId: string, unsubscribeKey: string, checkKey: boolean): Promise<void> {
    if (!id) {
      throw new ApiError('Bad request: id required', 400);
    }
    if (!unsubscribeKey && checkKey) {
      throw new ApiError('Bad request: unsubscribeKey required', 400);
    }
    return await this._connection.transaction(async manager => {
      if (checkKey) {
        const secret = await this.getSecret(id, docId, manager);
        if (!secret) {
          throw new ApiError('Webhook with given id not found', 404);
        }
        const webhook = JSON.parse(secret) as WebHookSecret;
        if (webhook.unsubscribeKey !== unsubscribeKey) {
          throw new ApiError('Wrong unsubscribeKey', 401);
        }
      }
      await manager.createQueryBuilder()
        .delete()
        .from(Secret)
        .where('id = :id AND doc_id = :docId', {id, docId})
        .execute();
    });
  }

  /**
   * Checks that the user has SCHEMA_EDIT permissions to the given doc. If not,
   * throws an error. Otherwise updates the given doc with the given name.
   *
   * Returns a query result with status 200 and the previous and current
   * versions of the doc on success.
   *
   * NOTE: This does not update the updateAt date indicating the last modified
   * time of the doc. We may want to make it do so.
   */
  public async updateDocument(
    scope: DocScope,
    props: Partial<DocumentProperties>,
    transaction?: EntityManager,
    options?: {
      allowSpecialPermit?: boolean,
    }
  ): Promise<QueryResult<PreviousAndCurrent<Document>>> {
    const notifications: Array<() => Promise<void>> = [];
    const markPermissions = Permissions.SCHEMA_EDIT;
    const result = await this.runInTransaction(transaction, async (manager) => {
      const {forkId} = parseUrlId(scope.urlId);
      let query: SelectQueryBuilder<Document>;
      if (forkId) {
        query = this._fork(scope, {
          manager,
          allowSpecialPermit: options?.allowSpecialPermit,
        });
      } else {
        query = this._doc(scope, {
          manager,
          markPermissions,
          allowSpecialPermit: options?.allowSpecialPermit,
        });
      }
      const queryResult = await verifyEntity(query);
      if (queryResult.status !== 200) {
        // If the query for the doc or fork failed, return the failure result.
        return queryResult;
      }
      // Update the name and save.
      const doc = getDocResult(queryResult);
      // Disabled docs can't be modified.
      if (doc.disabledAt) {
        return {status: 403, errMessage: 'Document is disabled'};
      }
      const previous = structuredClone(doc);
      doc.checkProperties(props);
      doc.updateFromProperties(props);
      if (forkId) {
        await manager.save(doc);
        return {status: 200};
      }

      // Forcibly remove the aliases relation from the document object, so that TypeORM
      // doesn't try to save it.  It isn't safe to do that because it was filtered by
      // a where clause.
      // TODO: refactor to avoid using TypeORM's save method.
      doc.aliases = undefined as any;
      // TODO: if pinning does anything special in future, like triggering thumbnail
      // processing, then we should probably call pinDoc.
      await manager.save(doc);
      if (props.urlId) {
        // We accumulate old urlIds in order to correctly redirect them, so we need
        // to do some extra bookwork when a doc's urlId is changed.  First, throw
        // an error if urlId is already in use by this org.
        await this._checkForUrlIdConflict(manager, doc.workspace.org, props.urlId, doc.id);
        // Otherwise, add an alias entry for this document.
        await manager.createQueryBuilder()
          .insert()
          // if urlId has been used before, update it
          .onConflict(`(org_id, url_id) DO UPDATE SET doc_id = :docId, created_at = ${now(this._dbType)}`)
          .setParameter('docId', doc.id)
          .into(Alias)
          .values({orgId: doc.workspace.org.id, urlId: props.urlId, doc})
          .execute();
        // TODO: we could limit the max number of aliases stored per document.
      }
      // Slightly strange but doc metadata may affect doc-access results because docs of type
      // 'tutorial' adjust returned access differently from other docs (which may not be ideal).
      // The callback approach is to publish the invalidation after the transaction commits.
      this.caches?.addInvalidationDocAccess(notifications, [doc.id]);
      return {status: 200, data: {previous, current: doc}};
    });
    for (const notification of notifications) { await notification(); }
    return result;
  }

  // Checks that the user has REMOVE permissions to the given document. If not, throws an
  // error. Otherwise deletes the given document. Returns a query result with status 200
  // and the deleted document on success.
  public async deleteDocument(scope: DocScope): Promise<QueryResult<Document>> {
    return await this._connection.transaction(async manager => {
      const {forkId} = parseUrlId(scope.urlId);
      if (forkId) {
        const forkQuery = this._fork(scope, {
          manager,
          allowSpecialPermit: true,
        });
        const queryResult = await verifyEntity(forkQuery);
        if (queryResult.status !== 200) {
          // If the query for the fork failed, return the failure result.
          return queryResult;
        }
        const fork = getDocResult(queryResult);
        const data = structuredClone(fork);
        await manager.remove(fork);
        return {status: 200, data};
      } else {
        const docQuery = this._doc(scope, {
          manager,
          markPermissions: Permissions.REMOVE | Permissions.SCHEMA_EDIT,
          allowSpecialPermit: true
        })
        // Join the docs's ACLs and groups so we can remove them.
        // Join the workspace and org to get their ids.
        .leftJoinAndSelect('docs.aclRules', 'acl_rules')
        .leftJoinAndSelect('acl_rules.group', 'groups');
        const queryResult = await verifyEntity(docQuery);
        if (queryResult.status !== 200) {
          // If the query for the doc failed, return the failure result.
          return queryResult;
        }
        const doc = getDocResult(queryResult);
        const data = structuredClone(doc);
        const docGroups = doc.aclRules.map(docAcl => docAcl.group);
        // Delete the doc and doc ACLs/groups.
        await manager.remove([doc, ...docGroups, ...doc.aclRules]);
        // Update guests of the workspace and org after removing this doc.
        await this._repairWorkspaceGuests(scope, doc.workspace.id, manager);
        await this._repairOrgGuests(scope, doc.workspace.org.id, manager);
        return {status: 200, data};
      }
    });
  }

  public softDeleteDocument(scope: DocScope): Promise<QueryResult<Document>> {
    return this._setDocumentRemovedAt(scope, new Date());
  }

  public async undeleteDocument(scope: DocScope): Promise<QueryResult<Document>> {
    return this._setDocumentRemovedAt(scope, null);
  }

  public toggleDisableDocument(action: 'enable'|'disable', scope: DocScope): Promise<QueryResult<Document>> {
    return this._setDocumentDisabledAt(scope, action === 'disable' ? new Date() : null);
  }

  // Fetches and provides a callback with the billingAccount so it may be updated within
  // a transaction. The billingAccount is saved after any changes applied in the callback.
  // Will throw an error if the user does not have access to the org's billingAccount.
  //
  // Only certain properties of the billingAccount may be changed:
  // 'inGoodStanding', 'status', 'stripeCustomerId','stripeSubscriptionId', 'stripePlanId'
  //
  // Returns an empty query result with status 200 on success.
  public async updateBillingAccount(
    scopeOrUser: number|Scope,
    orgKey: string|number,
    callback: (billingAccount: BillingAccount, transaction: EntityManager) => void|Promise<void>
  ): Promise<QueryResult<void>>  {
    return await this._connection.transaction(async transaction => {
      const scope = typeof scopeOrUser === 'number' ? {userId: scopeOrUser} : scopeOrUser;
      const billingAccount = await this.getBillingAccount(scope, orgKey, false, transaction);
      const billingAccountCopy = Object.assign({}, billingAccount);
      await callback(billingAccountCopy, transaction);
      // Pick out properties that are allowed to be changed, to prevent accidental updating
      // of other information.
      const updated = pick(billingAccountCopy, 'inGoodStanding', 'status', 'stripeCustomerId',
                           'stripeSubscriptionId', 'stripePlanId', 'product', 'externalId',
                           'externalOptions', 'paymentLink',
                           'features');
      billingAccount.paid = undefined;  // workaround for a typeorm bug fixed upstream in
                                        // https://github.com/typeorm/typeorm/pull/4035
      await transaction.save(Object.assign(billingAccount, updated));
      return { status: 200 };
    });
  }

  // Updates the managers of a billing account.  Returns an empty query result with
  // status 200 on success.
  public async updateBillingAccountManagers(userId: number, orgKey: string|number,
                                            delta: ManagerDelta): Promise<QueryResult<void>> {
    const notifications: Array<() => Promise<void>> = [];
    // Translate our ManagerDelta to a PermissionDelta so that we can reuse existing
    // methods for normalizing/merging emails and finding the user ids.
    const permissionDelta: PermissionDelta = {users: {}};
    for (const key of Object.keys(delta.users)) {
      const target = delta.users[key];
      if (target !== null && target !== 'managers') {
        throw new ApiError("Only valid settings for billing account managers are 'managers' or null", 400);
      }
      permissionDelta.users![key] = delta.users[key] ? 'owners' : null;
    }

    return await this._connection.transaction(async transaction => {
      const billingAccount = await this.getBillingAccount({userId}, orgKey, true, transaction);
      // At this point, we'll have thrown an error if userId is not a billing account manager.
      // Now check if the billing account has mutable managers (individual account does not).
      if (billingAccount.individual) {
        throw new ApiError('billing account managers cannot be added/removed for individual billing accounts', 400);
      }
      // Get the ids of users to update.
      const billingAccountId = billingAccount.id;
      const analysis = await this._usersManager.verifyAndLookupDeltaEmails(userId, permissionDelta, true, transaction);
      this._failIfPowerfulAndChangingSelf(analysis);
      this._failIfTooManyBillingManagers({
        analysis,
        billingAccount,
      });
      const {userIdDelta} = await this._createNotFoundUsers({
        analysis,
        transaction,
      });
      if (!userIdDelta) { throw new ApiError('No userIdDelta', 500); }
      // Any duplicated emails have been merged, and userIdDelta is now keyed by user ids.
      // Now we iterate over users and add/remove them as managers.
      for (const memberUserIdStr of Object.keys(userIdDelta)) {
        const memberUserId = parseInt(memberUserIdStr, 10);
        const add = Boolean(userIdDelta[memberUserIdStr]);
        const manager = await transaction.findOne(BillingAccountManager, {where: {userId: memberUserId,
                                                                                  billingAccountId}});
        if (add) {
          // Skip adding user if they are already a manager.
          if (!manager) {
            const newManager = new BillingAccountManager();
            newManager.userId = memberUserId;
            newManager.billingAccountId = billingAccountId;
            await transaction.save(newManager);
            notifications.push(this._billingManagerNotification(userId, memberUserId,
                                                                billingAccount.orgs));
          }
        } else {
          if (manager) {
            // Don't allow a user to remove themselves as a manager, to be consistent
            // with ACL behavior.
            if (memberUserId === userId) {
              throw new ApiError('Users cannot remove themselves as billing managers', 400);
            }
            await transaction.remove(manager);
          }
        }
      }
      for (const notification of notifications) { await notification(); }
      return { status: 200 };
    });
  }

  // Updates the permissions of users on the given org according to the PermissionDelta.
  public async updateOrgPermissions(
    scope: Scope,
    orgKey: string|number,
    delta: PermissionDelta
  ): Promise<QueryResult<OrgAccessChanges>> {
    const {userId} = scope;
    const notifications: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async manager => {
      const analysis = await this._usersManager.verifyAndLookupDeltaEmails(userId, delta, true, manager);
      let orgQuery = this.org(scope, orgKey, {
        manager,
        markPermissions: analysis.permissionThreshold,
        needRealOrg: true
      })
      // Join the org's ACL rules (with 1st level groups/users listed) so we can edit them.
      .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'org_groups')
      .leftJoinAndSelect('org_groups.memberUsers', 'org_member_users');
      orgQuery = this._addFeatures(orgQuery);
      orgQuery = this._withAccess(orgQuery, userId, 'orgs');
      const queryResult = await verifyEntity(orgQuery);
      if (queryResult.status !== 200) {
        // If the query for the organization failed, return the failure result.
        return queryResult;
      }
      this._failIfPowerfulAndChangingSelf(analysis, queryResult);
      const org: Organization = queryResult.data;
      await this._failIfTooManyNewUserInvites({
        orgKey,
        analysis,
        billingAccount: org.billingAccount,
        manager,
      });
      const {userIdDelta, users} = await this._createNotFoundUsers({
        analysis,
        transaction: manager,
      });
      const groups = getNonGuestGroups(org);
      if (userIdDelta) {
        const membersBefore = UsersManager.getUsersWithRole(groups, this._usersManager.getExcludedUserIds());
        const countBefore = removeRole(membersBefore).length;
        await this._updateUserPermissions(groups, userIdDelta, manager);
        this._checkUserChangeAllowed(userId, groups);
        await manager.save(groups);
        // Fully remove any users being removed from the org.
        for (const deltaUser in userIdDelta) {
          // Any users removed from the org should be removed from everything in the org.
          if (userIdDelta[deltaUser] === null) {
            await scrubUserFromOrg(org.id, parseInt(deltaUser, 10), userId, manager);
          }
        }

        // Get docIds to invalidate, but publish the invalidation once the transaction commits.
        this.caches?.addInvalidationDocAccess(notifications,
          await this._getDocsInheritingFrom(manager, {orgId: org.id}));

        // Emit an event if the number of org users is changing.
        const membersAfter = UsersManager.getUsersWithRole(groups, this._usersManager.getExcludedUserIds());
        const countAfter = removeRole(membersAfter).length;
        notifications.push(this._userChangeNotification(userId, org, countBefore, countAfter,
                                                        membersBefore, membersAfter));
        // Notify any added users that they've been added to this resource.
        notifications.push(this._inviteNotification(userId, org, userIdDelta, membersBefore));
      }
      return {
        status: 200,
        data: {
          org,
          accessChanges: {
            users: getUserAccessChanges({users, userIdDelta}),
          },
        },
      };
    });
    for (const notification of notifications) { await notification(); }
    return result;
  }

  // Updates the permissions of users on the given workspace according to the PermissionDelta.
  public async updateWorkspacePermissions(
    scope: Scope,
    wsId: number,
    delta: PermissionDelta
  ): Promise<QueryResult<WorkspaceAccessChanges>> {
    const {userId} = scope;
    const notifications: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async manager => {
      const analysis = await this._usersManager.verifyAndLookupDeltaEmails(userId, delta, false, manager);
      const options = {
        manager,
        markPermissions: analysis.permissionThreshold,
      };
      let wsQuery = this._buildWorkspaceWithACLRules(scope, wsId, options);
      wsQuery = this._withAccess(wsQuery, userId, 'workspaces');
      const wsQueryResult = await verifyEntity(wsQuery);

      if (wsQueryResult.status !== 200) {
        // If the query for the workspace failed, return the failure result.
        return wsQueryResult;
      }
      this._failIfPowerfulAndChangingSelf(analysis, wsQueryResult);
      const ws: Workspace = wsQueryResult.data;
      const orgId = ws.org.id;
      let orgQuery = this._buildOrgWithACLRulesQuery(scope, orgId, options);
      orgQuery = this._addFeatures(orgQuery);
      const orgQueryResult = await orgQuery.getRawAndEntities();
      const org: Organization = orgQueryResult.entities[0];
      await this._failIfTooManyNewUserInvites({
        orgKey: org.id,
        analysis,
        billingAccount: org.billingAccount,
        manager,
      });
      const deltaAndUsers = await this._createNotFoundUsers({
        analysis,
        transaction: manager,
      });
      let {userIdDelta} = deltaAndUsers;
      const {users} = deltaAndUsers;
      // Get all the non-guest groups on the org.
      const orgGroups = getNonGuestGroups(org);
      // Get all the non-guest groups to be updated by the delta.
      const groups = getNonGuestGroups(ws);
      if ('maxInheritedRole' in delta) {
        // Honor the maxInheritedGroups delta setting.
        this._moveInheritedGroups(groups, orgGroups, delta.maxInheritedRole);
        if (delta.maxInheritedRole !== roles.OWNER) {
          // If the maxInheritedRole was lowered from 'owners', add the calling user
          // back as an owner so that their acl edit access is not revoked.
          userIdDelta = userIdDelta || {};
          userIdDelta[userId] = roles.OWNER;
        }
      }
      const membersBefore = this._usersManager.withoutExcludedUsers(
        new Map(groups.map(grp => [grp.name, grp.memberUsers]))
      );
      if (userIdDelta) {
        // To check limits on shares, we track group members before and after call
        // to _updateUserPermissions.  Careful, that method mutates groups.
        const nonOrgMembersBefore = this._usersManager.getUserDifference(groups, orgGroups);
        await this._updateUserPermissions(groups, userIdDelta, manager);
        this._checkUserChangeAllowed(userId, groups);
        const nonOrgMembersAfter = this._usersManager.getUserDifference(groups, orgGroups);
        const features = org.billingAccount.getFeatures();
        const limit = features.maxSharesPerWorkspace;
        if (limit !== undefined) {
          this._restrictShares(null, limit, removeRole(nonOrgMembersBefore),
                               removeRole(nonOrgMembersAfter), true, 'workspace', features);
        }
      }
      await manager.save(groups);
      // If the users in workspace were changed, make a call to repair the guests in the org.
      if (userIdDelta) {
        await this._repairOrgGuests(scope, orgId, manager);
        // Get docIds to invalidate, but publish the invalidation once the transaction commits.
        this.caches?.addInvalidationDocAccess(notifications,
          await this._getDocsInheritingFrom(manager, {wsId: ws.id}));
        notifications.push(this._inviteNotification(userId, ws, userIdDelta, membersBefore));
      }
      return {
        status: 200,
        data: {
          workspace: ws,
          accessChanges: {
            maxInheritedAccess: delta.maxInheritedRole,
            users: getUserAccessChanges({users, userIdDelta}),
          },
        },
      };
    });
    for (const notification of notifications) { await notification(); }
    return result;
  }

  // Updates the permissions of users on the given doc according to the PermissionDelta.
  public async updateDocPermissions(
    scope: DocScope,
    delta: PermissionDelta
  ): Promise<QueryResult<DocumentAccessChanges>> {
    const notifications: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async manager => {
      const {userId} = scope;
      const analysis = await this._usersManager.verifyAndLookupDeltaEmails(userId, delta, false, manager);
      const doc = await this._loadDocAccess(scope, analysis.permissionThreshold, manager);
      this._failIfPowerfulAndChangingSelf(analysis, {data: doc, status: 200});
      await this._failIfTooManyNewUserInvites({
        orgKey: doc.workspace.org.id,
        analysis,
        billingAccount: doc.workspace.org.billingAccount,
        manager,
      });
      const deltaAndUsers = await this._createNotFoundUsers({
        analysis,
        transaction: manager,
      });
      let {userIdDelta} = deltaAndUsers;
      const {users} = deltaAndUsers;
      // Get all the non-guest doc groups to be updated by the delta.
      const groups = getNonGuestGroups(doc);
      if ('maxInheritedRole' in delta) {
        const wsGroups = getNonGuestGroups(doc.workspace);
        // Honor the maxInheritedGroups delta setting.
        this._moveInheritedGroups(groups, wsGroups, delta.maxInheritedRole);
        if (delta.maxInheritedRole !== roles.OWNER) {
          // If the maxInheritedRole was lowered from 'owners', add the calling user
          // back as an owner so that their acl edit access is not revoked.
          userIdDelta = userIdDelta || {};
          userIdDelta[userId] = roles.OWNER;
        }
      }
      const membersBefore = new Map(groups.map(grp => [grp.name, grp.memberUsers]));
      if (userIdDelta) {
        // To check limits on shares, we track group members before and after call
        // to _updateUserPermissions.  Careful, that method mutates groups.
        const org = doc.workspace.org;
        const orgGroups = getNonGuestGroups(org);
        const nonOrgMembersBefore = this._usersManager.getUserDifference(groups, orgGroups);
        await this._updateUserPermissions(groups, userIdDelta, manager);
        this._checkUserChangeAllowed(userId, groups);
        const nonOrgMembersAfter = this._usersManager.getUserDifference(groups, orgGroups);
        const features = org.billingAccount.getFeatures();
        this._restrictAllDocShares(features, nonOrgMembersBefore, nonOrgMembersAfter);
      }
      await manager.save(groups);
      if (userIdDelta) {
        // If the users in the doc were changed, make calls to repair workspace then org guests.
        await this._repairWorkspaceGuests(scope, doc.workspace.id, manager);
        await this._repairOrgGuests(scope, doc.workspace.org.id, manager);
        // The callback approach is to publish the invalidation after the transaction commits.
        this.caches?.addInvalidationDocAccess(notifications, [doc.id]);
        notifications.push(this._inviteNotification(userId, doc, userIdDelta, membersBefore));
      }
      return {
        status: 200,
        data: {
          document: doc,
          accessChanges: {
            publicAccess: userIdDelta?.[this.getEveryoneUserId()],
            maxInheritedAccess: delta.maxInheritedRole,
            users: getUserAccessChanges({users, userIdDelta}),
          },
        },
      };
    });
    for (const notification of notifications) { await notification(); }
    return result;
  }

  // Returns UserAccessData for all users with any permissions on the org.
  public async getOrgAccess(scope: Scope, orgKey: string|number): Promise<QueryResult<PermissionData>> {
    const queryResult = await this._getOrgWithACLRules(scope, orgKey);
    if (queryResult.status !== 200) {
      // If the query for the doc failed, return the failure result.
      return queryResult;
    }
    const org: Organization = queryResult.data;
    const userRoleMap = GroupsManager.getMemberUserRoles(org, this.defaultGroupNames);
    const users = UsersManager.getResourceUsers(org).filter(u => userRoleMap[u.id]).map(u => {
      const access = userRoleMap[u.id];
      return {
        ...this.makeFullUser(u),
        loginEmail: undefined,    // Not part of PermissionData.
        access,
        isMember: access !== 'guests',
      };
    });
    const personal = this._filterAccessData(scope, users, null);
    return {
      status: 200,
      data: {
        ...personal,
        users
      }
    };
  }

  // Returns UserAccessData for all users with any permissions on the ORG, as well as the
  // maxInheritedRole set on the workspace. Note that information for all users in the org
  // is given to indicate which users have access to the org but not to this particular workspace.
  public async getWorkspaceAccess(scope: Scope, wsId: number): Promise<QueryResult<PermissionData>> {
    // Run the query for the workspace and org in a transaction. This brings some isolation protection
    // against changes to the workspace or org while we are querying.
    const { workspace, org, queryFailure } = await this._connection.transaction(async manager => {
      const wsQueryResult = await this._getWorkspaceWithACLRules(scope, wsId, { manager });
      if (wsQueryResult.status !== 200) {
        // If the query for the workspace failed, return the failure result.
        return { queryFailure: wsQueryResult };
      }

      const orgQuery = this._buildOrgWithACLRulesQuery(scope, wsQueryResult.data.org.id, { manager });
      const orgQueryResult = await verifyEntity(orgQuery, { skipPermissionCheck: true });
      if (orgQueryResult.status !== 200) {
        // If the query for the org failed, return the failure result.
        return { queryFailure: orgQueryResult };
      }

      return {
        workspace: wsQueryResult.data,
        org: orgQueryResult.data
      };
    });
    if (queryFailure) {
      return queryFailure;
    }

    const wsMap = GroupsManager.getMemberUserRoles(workspace, this.defaultCommonGroupNames);

    // Also fetch the organization ACLs so we can determine inherited rights.

    // The orgMap gives the org access inherited by each user.
    const orgMap = GroupsManager.getMemberUserRoles(org, this.defaultBasicGroupNames);
    const orgMapWithMembership = GroupsManager.getMemberUserRoles(org, this.defaultGroupNames);
    // Iterate through the org since all users will be in the org.

    const users: UserAccessData[] = UsersManager.getResourceUsers([workspace, org]).map(u => {
      const orgAccess = orgMapWithMembership[u.id] || null;
      return {
        ...this.makeFullUser(u),
        loginEmail: undefined,    // Not part of PermissionData.
        access: wsMap[u.id] || null,
        parentAccess: roles.getEffectiveRole(orgMap[u.id] || null),
        isMember: orgAccess && orgAccess !== 'guests',
      };
    });
    const maxInheritedRole = this._groupsManager.getMaxInheritedRole(workspace);
    const personal = this._filterAccessData(scope, users, maxInheritedRole);
    return {
      status: 200,
      data: {
        ...personal,
        maxInheritedRole,
        users
      }
    };
  }

  // Returns UserAccessData for all users with any permissions on the ORG, as well as the
  // maxInheritedRole set on the doc. Note that information for all users in the org is given
  // to indicate which users have access to the org but not to this particular doc.
  // TODO: Consider updating to traverse through the doc groups and their nested groups for
  // a more straightforward way of determining inheritance. The difficulty here is that all users
  // in the org and their logins are needed for inclusion in the result, which would require an
  // extra lookup step when traversing from the doc.
  //
  // If the user is not an owner of the document, only that user (at most) will be mentioned
  // in the result.
  //
  // Optionally, the results can be flattened, removing all information about inheritance and
  // parents, and just giving the effective access level of each user (frankly, the default
  // output of this method is quite confusing).
  //
  // Optionally, users without access to the document can be removed from the results
  // (I believe they are included in order to one day facilitate auto-completion in the client?).
  public async getDocAccess(scope: DocScope, options?: {
    flatten?: boolean,
    excludeUsersWithoutAccess?: boolean,
  }): Promise<QueryResult<PermissionData>> {
    // Doc permissions of forks are based on the "trunk" document, so make sure
    // we look up permissions of trunk if we are on a fork (we'll fix the permissions
    // up for the fork immediately afterwards).
    const {trunkId, forkId, forkUserId, snapshotId} = parseUrlId(scope.urlId);

    // Unsaved documents don't live in the database and don't
    // have access control. Anyone with the URL can access them.
    // In the absence of anything better, we'll just echo back
    // the current user to confirm their ownership.
    if (trunkId === NEW_DOCUMENT_CODE) {
      const user = await this.getUser(scope.userId);
      return {
        status: 200,
        data: {
          users: [{
            ...this.makeFullUser(user || this.getAnonymousUser()),
            access: 'owners',
          }],
        },
      };
    }

    const doc = await this._loadDocAccess({...scope, urlId: trunkId}, Permissions.VIEW);
    // The docMap gives the doc access of the user. It maps user to owners/editors/viewers/guests (member is org only),
    // but since, doc is a leaf resource, in practice we won't have the guests group here.
    const docMap = GroupsManager.getMemberUserRoles(doc, this.defaultCommonGroupNames);
    // The wsMap gives the ws access that can be inherited by each user (owners, editors, viewers)
    const wsMap = GroupsManager.getMemberUserRoles(doc.workspace, this.defaultBasicGroupNames);
    // The wsMapWithMembership gives the ws access that users have to the workspace. Includes all groups.
    const wsMapWithMembership = GroupsManager.getMemberUserRoles(doc.workspace, this.defaultGroupNames);
    // The orgMap gives the org access that can be inherited by each user (owners, editors, viewers).
    const orgMap = GroupsManager.getMemberUserRoles(doc.workspace.org, this.defaultBasicGroupNames);
    // The orgMapWithMembership gives the full access to the org for each user, including
    // the "members" level, which grants no default inheritable access but allows the user
    // to be added freely to workspaces and documents.
    const orgMapWithMembership = GroupsManager.getMemberUserRoles(doc.workspace.org, this.defaultGroupNames);
    const wsMaxInheritedRole = this._groupsManager.getMaxInheritedRole(doc.workspace);
    // Iterate through the org since all users will be in the org.
    let users: UserAccessData[] = UsersManager.getResourceUsers([doc, doc.workspace, doc.workspace.org]).map(u => {
      // Merge the strongest roles from the resource and parent resources. Note that the parent
      // resource access levels must be tempered by the maxInheritedRole values of their children.
      const inheritFromOrg = roles.getWeakestRole(orgMap[u.id] || null, wsMaxInheritedRole);
      const orgAccess = orgMapWithMembership[u.id] || null;
      return {
        ...this.makeFullUser(u),
        firstLoginAt: undefined, // Not part of PermissionData.
        loginEmail: undefined,    // Not part of PermissionData.
        access: docMap[u.id] || null,
        parentAccess: roles.getEffectiveRole(
          roles.getStrongestRole(wsMap[u.id] || null, inheritFromOrg)
        ),
        isMember: orgAccess && orgAccess !== 'guests',
      };
    });
    let maxInheritedRole = this._groupsManager.getMaxInheritedRole(doc);

    const thisUser = users.find(user => user.id === scope.userId);
    const docRealAccess = thisUser ? getRealAccess(thisUser, {maxInheritedRole}) : null;
    const canViewDoc = (user: UserAccessData) => roles.canView(getRealAccess(user, {maxInheritedRole}));
    const personalMetadata: Pick<PermissionData, 'public'|'personal'> = {};

    // Unlike other resources, documents rule for seeing other users are a little bit different.
    // The simple rule is as follows:
    // - If user is at least editor on the document (but not a public editor), then we return all users
    //   who can see the document.
    // - If such user is also an owner of a parent resource (workspace or org), then we include all users on
    //   that resource, including guest users.

    // Previewer user can see everyone on the list.
    if (scope.userId === this._usersManager.getPreviewerUserId()) {
      // No need to filter users, just return all of them.
    } else {
      const isPublic = !thisUser || thisUser.anonymous || !docRealAccess;
      if (!isPublic && roles.canEdit(docRealAccess)) {
        if (roles.canEditAccess(orgMap[scope.userId] ?? null)) {
          // If this user is an org owner, return all users unfiltered.
        } else if (roles.canEditAccess(thisUser?.parentAccess ?? null)) {
          const canViewWorkspace = (user: UserAccessData) => roles.canView(getRealAccess({
            // Figure out the access level on workspace (including inherited access from org).
            access: wsMapWithMembership[user.id] || null,
            parentAccess: orgMap[user.id] || null,
          }, {maxInheritedRole: wsMaxInheritedRole}));
          // If user is owner of the workspace, return all users on the workspace and on the document.
          users = users.filter(user => canViewDoc(user) || canViewWorkspace(user));
        } else {
          // For any other editor/owner non-public user, we return all users who can see the document.
          users = users.filter(user => canViewDoc(user));
        }

        // If user can't change access on the document, instruct UI to just show user's role.
        if (!roles.canEditAccess(getRealAccess(thisUser, {maxInheritedRole}) ?? null)) {
          personalMetadata.public = false;
          personalMetadata.personal = true;
        }
      } else {
        users = thisUser ? [thisUser] : [];
        personalMetadata.public = isPublic;
        personalMetadata.personal = true;
      }
    }

    if (options?.excludeUsersWithoutAccess) {
      users = users.filter(canViewDoc);
    }

    if (forkId || snapshotId || options?.flatten) {
      for (const user of users) {
        const access = getRealAccess(user, {maxInheritedRole});
        user.access = access;
        user.parentAccess = undefined;
      }
      maxInheritedRole = null;
    }

    // If we are on a fork, make any access changes needed. Assumes results
    // have been flattened.
    if (forkId) {
      for (const user of users) {
        this._setForkAccess(doc, {userId: user.id, forkUserId}, user);
      }
    }

    return {
      status: 200,
      data: {
        ...personalMetadata,
        maxInheritedRole: maxInheritedRole,
        users
      }
    };
  }

  /**
   * Moves the doc to the specified workspace.
   *
   * Returns a query result with status 200 and the previous and current
   * versions of the doc on success.
   */
  public async moveDoc(
    scope: DocScope,
    wsId: number
  ): Promise<QueryResult<PreviousAndCurrent<Document>>> {
    const notifications: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async manager => {
      // Get the doc
      const doc = await this._loadDocAccess(scope, Permissions.OWNER, manager);
      // Disabled docs can't be moved
      if (doc.disabledAt) {
        return {
          status: 403,
          errMessage: 'Document is disabled'
        };
      }
      const previous = structuredClone(doc);
      if (doc.workspace.id === wsId) {
        return {
          status: 400,
          errMessage: `Bad request: doc is already in destination workspace`
        };
      }
      // Get the destination workspace
      let wsQuery = this._workspace(scope, wsId, {
        manager,
        markPermissions: Permissions.ADD
      })
      // Join the workspaces's ACL rules (with 1st level groups listed) so we can include
      // them in the doc.
      .leftJoinAndSelect('workspaces.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'workspace_groups')
      .leftJoinAndSelect('workspace_groups.memberUsers', 'workspace_users')
      .leftJoinAndSelect('workspaces.org', 'orgs')
      .leftJoinAndSelect('orgs.aclRules', 'org_acl_rules')
      .leftJoinAndSelect('org_acl_rules.group', 'org_groups')
      .leftJoinAndSelect('org_groups.memberUsers', 'org_users');
      wsQuery = this._addFeatures(wsQuery);
      const wsQueryResult = await verifyEntity(wsQuery);
      if (wsQueryResult.status !== 200) {
        // If the query for the organization failed, return the failure result.
        return wsQueryResult;
      }
      const workspace: Workspace = wsQueryResult.data;
      // Collect all first-level users of the doc being moved.
      const firstLevelUsers = UsersManager.getResourceUsers(doc);
      const docGroups = doc.aclRules.map(rule => rule.group);
      if (doc.workspace.org.id !== workspace.org.id) {
        // Doc is going to a new org.  Check that there is room for it there.
        await this._checkRoomForAnotherDoc(workspace, manager);
        // Check also that doc doesn't have too many shares.
        if (firstLevelUsers.length > 0) {
          const sourceOrg = doc.workspace.org;
          const sourceOrgGroups = getNonGuestGroups(sourceOrg);
          const destOrg = workspace.org;
          const destOrgGroups = getNonGuestGroups(destOrg);
          const nonOrgMembersBefore = this._usersManager.getUserDifference(docGroups, sourceOrgGroups);
          const nonOrgMembersAfter = this._usersManager.getUserDifference(docGroups, destOrgGroups);
          const features = destOrg.billingAccount.getFeatures();
          this._restrictAllDocShares(features, nonOrgMembersBefore, nonOrgMembersAfter, false);
        }
      }
      // Update the doc workspace.
      const oldWs = doc.workspace;
      doc.workspace = workspace;
      // The doc should have groups which properly inherit the permissions of the
      // new workspace after it is moved.
      // Update the doc groups to inherit the groups in the new workspace/org.
      // Any previously custom added members remain in the doc groups.
      doc.aclRules.forEach(aclRule => {
        this._groupsManager.setInheritance(aclRule.group, workspace);
      });
      // If the org is changing, remove all urlIds for this doc, since there could be
      // conflicts in the new org.
      // TODO: could try recreating/keeping the urlIds in the new org if there is in fact
      // no conflict.  Be careful about the merged personal org.
      if (oldWs.org.id !== doc.workspace.org.id) {
        doc.urlId = null;
        await manager.delete(Alias, { doc: doc.id });
      }
      // Forcibly remove the aliases relation from the document object, so that TypeORM
      // doesn't try to save it.  It isn't safe to do that because it was filtered by
      // a where clause.
      doc.aliases = undefined as any;
      // Saves the document as well as its new ACL Rules and Groups and the
      // updated guest group in the workspace.
      const [current] = await manager.save<[Document, ...(AclRuleDoc|Group)[]]>([
        doc,
        ...doc.aclRules,
        ...docGroups,
      ]);
      if (firstLevelUsers.length > 0) {
        // If the doc has first-level users, update the source and destination workspaces.
        await this._repairWorkspaceGuests(scope, oldWs.id, manager);
        await this._repairWorkspaceGuests(scope, doc.workspace.id, manager);
        if (oldWs.org.id !== doc.workspace.org.id) {
          // Also if the org changed, update the source and destination org guest groups.
          await this._repairOrgGuests(scope, oldWs.org.id, manager);
          await this._repairOrgGuests(scope, doc.workspace.org.id, manager);
        }
      }
      // The callback approach is to publish the invalidation after the transaction commits.
      this.caches?.addInvalidationDocAccess(notifications, [doc.id]);
      return {status: 200, data: {previous, current}};
    });
    for (const notification of notifications) { await notification(); }
    return result;
  }

  // Pin or unpin a doc.
  public async pinDoc(
    scope: DocScope,
    setPinned: boolean
  ): Promise<QueryResult<Document>> {
    return await this._connection.transaction(async manager => {
      // Find the doc to assert that it exists. Assert that the user has edit access to the
      // parent org.
      const permissions = Permissions.EDITOR;
      const docQuery = this._doc(scope, {
        manager
      })
      .addSelect(this._markIsPermitted('orgs', scope.userId, 'open', permissions), 'is_permitted');
      const docQueryResult = await verifyEntity(docQuery);
      if (docQueryResult.status !== 200) {
        // If the query for the doc failed, return the failure result.
        return docQueryResult;
      }
      const doc = getDocResult(docQueryResult);
      if (doc.isPinned !== setPinned) {
        doc.isPinned = setPinned;
        // Forcibly remove the aliases relation from the document object, so that TypeORM
        // doesn't try to save it.  It isn't safe to do that because it was filtered by
        // a where clause.
        doc.aliases = undefined as any;
        // Save and return success status.
        await manager.save(doc);
      }
      return {status: 200, data: doc};
    });
  }

  /**
   * Creates a fork of `doc`, using the specified `forkId`.
   *
   * NOTE: This is not a part of the API. It should only be called by the ActiveDoc when
   * a new fork is initiated.
   */
  public async forkDoc(
    userId: number,
    doc: Document,
    forkId: string,
  ): Promise<QueryResult<string>> {
    return await this._connection.transaction(async manager => {
      const fork = new Document();
      fork.id = forkId;
      fork.name = doc.name;
      fork.createdBy = userId;
      fork.trunkId = doc.trunkId || doc.id;
      const result = await manager.save([fork]);
      return {
        status: 200,
        data: result[0].id,
      };
    });
  }

  /**
   * Updates the updatedAt and usage values for several docs. Takes a map where each entry maps
   * a docId to a metadata object containing the updatedAt and/or usage values. This is not a part
   * of the API, it should be called only by the HostedMetadataManager when a change is made to a
   * doc.
   */
  public async setDocsMetadata(
    docUpdateMap: {[docId: string]: DocumentMetadata}
  ): Promise<QueryResult<void>> {
    if (!docUpdateMap || Object.keys(docUpdateMap).length === 0) {
      return {
        status: 400,
        errMessage: `Bad request: missing argument`
      };
    }
    const docIds = Object.keys(docUpdateMap);
    return this._connection.transaction(async manager => {
      const updateTasks = docIds.map(docId => {
        return manager.createQueryBuilder()
          .update(Document)
          .set(docUpdateMap[docId])
          .where("id = :docId", {docId})
          .execute();
      });
      await Promise.all(updateTasks);
      return { status: 200 };
    });
  }

  public async setDocGracePeriodStart(docId: string, gracePeriodStart: Date | null) {
    return await this._connection.createQueryBuilder()
      .update(Document)
      .set({gracePeriodStart})
      .where({id: docId})
      .execute();
  }

  public async getProduct(name: string): Promise<Product | undefined> {
    return await this._connection.createQueryBuilder()
      .select('product')
      .from(Product, 'product')
      .where('name = :name', {name})
      .getOne() || undefined;
  }

  public async getDocFeatures(docId: string, transaction?: EntityManager): Promise<Features | undefined> {
    const billingAccount = await (transaction || this._connection).createQueryBuilder()
      .select('account')
      .from(BillingAccount, 'account')
      .leftJoinAndSelect('account.product', 'product')
      .leftJoinAndSelect('account.orgs', 'org')
      .leftJoinAndSelect('org.workspaces', 'workspace')
      .leftJoinAndSelect('workspace.docs', 'doc')
      .where('doc.id = :docId', {docId})
      .getOne() || undefined;

    if (!billingAccount) {
      return undefined;
    }

    return mergedFeatures(billingAccount.features, billingAccount.product.features);
  }

  public async getDocProduct(docId: string): Promise<Product | undefined> {
    return await this._connection.createQueryBuilder()
      .select('product')
      .from(Product, 'product')
      .leftJoinAndSelect('product.accounts', 'account')
      .leftJoinAndSelect('account.orgs', 'org')
      .leftJoinAndSelect('org.workspaces', 'workspace')
      .leftJoinAndSelect('workspace.docs', 'doc')
      .where('doc.id = :docId', {docId})
      .getOne() || undefined;
  }

  public getAnonymousUser() {
    return this._usersManager.getAnonymousUser();
  }

  public getSpecialUserIds() {
    return this._usersManager.getSpecialUserIds();
  }

  public getAnonymousUserId() {
    return this._usersManager.getAnonymousUserId();
  }

  public getPreviewerUserId() {
    return this._usersManager.getPreviewerUserId();
  }

  public getEveryoneUserId() {
    return this._usersManager.getEveryoneUserId();
  }

  public getSupportUserId() {
    return this._usersManager.getSupportUserId();
  }

  /**
   * @see UsersManager.prototype.completeProfiles
   */
  public async completeProfiles(profiles: UserProfile[]) {
    return this._usersManager.completeProfiles(profiles);
  }

  /**
   * Calculate the public-facing subdomain for an org.
   *
   * If the domain is a personal org, the public-facing subdomain will
   * be docs/docs-s (if `mergePersonalOrgs` is set), or docs-[s]NNN where NNN
   * is the user id (if `mergePersonalOrgs` is not set).
   *
   * If a domain is set in the database, and `suppressDomain` is not
   * set, we report that domain verbatim.  The `suppressDomain` may
   * be set in some key endpoints in order to enforce a `vanityDomain`
   * feature flag.
   *
   * Otherwise, we report o-NNN (or o-sNNN in staging) where NNN is
   * the org id.
   */
  public normalizeOrgDomain(orgId: number, domain: string|null,
                            ownerId: number|undefined, mergePersonalOrgs: boolean = true,
                            suppressDomain: boolean = false): string {
    if (ownerId) {
      // An org with an ownerId set is a personal org.  Historically, those orgs
      // have a subdomain like docs-NN where NN is the user ID.
      const personalDomain = `docs-${this._idPrefix}${ownerId}`;
      // In most cases now we pool all personal orgs as a single virtual org.
      // So when mergePersonalOrgs is on, and the subdomain is either not set
      // (as it is in the database for personal orgs) or set to something
      // like docs-NN (as it is in the API), normalization should just return the
      // single merged org ("docs" or "docs-s").
      if (mergePersonalOrgs && (!domain || domain === personalDomain)) {
        domain = this.mergedOrgDomain();
      }
      if (!domain) {
        domain = personalDomain;
      }
    } else if (suppressDomain || !domain) {
      // If no subdomain is set, or custom subdomains or forbidden, return something
      // uninspiring but unique, like o-NN where NN is the org ID.
      domain = `o-${this._idPrefix}${orgId}`;
    }
    return domain;
  }

  // Throw an error for query results that represent errors or have no data; otherwise unwrap
  // the valid result it contains.
  public unwrapQueryResult<T>(qr: QueryResult<T>): T {
    if (qr.data) { return qr.data; }
    throw new ApiError(qr.errMessage || 'an error occurred', qr.status);
  }

  // Throw an error for query results that represent errors
  public checkQueryResult<T>(qr: QueryResult<T>) {
    if (qr.status !== 200) {
      throw new ApiError(qr.errMessage || 'an error occurred', qr.status);
    }
  }

  // Get the domain name for the merged organization.  In production, this is 'docs',
  // in staging, it is 'docs-s'.
  public mergedOrgDomain() {
    if (this._idPrefix) {
      return `docs-${this._idPrefix}`;
    }
    return 'docs';
  }

  // The merged organization is a special pseudo-organization
  // patched together from all the material a given user has access
  // to.  The result is approximately, but not exactly, an organization,
  // and so it treated a bit differently.
  public isMergedOrg(orgKey: string|number|null) {
    return orgKey === this.mergedOrgDomain() || orgKey === 0;
  }

  /**
   * Construct a QueryBuilder for a select query on a specific org given by orgId.
   * Provides options for running in a transaction and adding permission info.
   * See QueryOptions documentation above.
   */
  public org(scope: Scope, org: string|number|null,
             options: QueryOptions = {}): SelectQueryBuilder<Organization> {
    return this._org(scope, scope.includeSupport || false, org, options);
  }

  public async getLimits(accountId: number): Promise<Limit[]> {
    const result = this._connection.transaction(async manager => {
      return await manager.createQueryBuilder()
        .select('limit')
        .from(Limit, 'limit')
        .innerJoin('limit.billingAccount', 'account')
        .where('account.id = :accountId', {accountId})
        .getMany();
    });
    return result;
  }

  public async getLimit(accountId: number, limitType: LimitType): Promise<Limit|null> {
    return await this._getOrCreateLimitAndReset(accountId, limitType, true);
  }

  public async peekLimit(accountId: number, limitType: LimitType): Promise<Limit|null> {
    return await this._getOrCreateLimitAndReset(accountId, limitType, false);
  }

  public async removeLimit(scope: Scope, limitType: LimitType): Promise<void> {
    await this._connection.transaction(async manager => {
      const org = await this._org(scope, false, scope.org ?? null, {manager, needRealOrg: true})
        .innerJoinAndSelect('orgs.billingAccount', 'billing_account')
        .innerJoinAndSelect('billing_account.product', 'product')
        .leftJoinAndSelect('billing_account.limits', 'limit', 'limit.type = :limitType', {limitType})
        .getOne();
      const existing = org?.billingAccount?.limits?.[0];
      if (existing) {
        await manager.remove(existing);
      }
    });
  }

  /**
   * Increases the usage of a limit for a given org, and returns it.
   *
   * If a limit doesn't exist, but the product associated with the org
   * has limits for the given `limitType`, one will be created.
   *
   * Pass `dryRun: true` to check if a limit can be increased without
   * actually increasing it.
   */
  public async increaseUsage(scope: Scope, limitType: LimitType, options: {
    delta: number,
    dryRun?: boolean,
  }, transaction?: EntityManager): Promise<Limit|null> {
    const limitOrError: Limit|ApiError|null = await this.runInTransaction(transaction, async manager => {
      const org = await this._org(scope, false, scope.org ?? null, {manager, needRealOrg: true})
        .innerJoinAndSelect('orgs.billingAccount', 'billing_account')
        .innerJoinAndSelect('billing_account.product', 'product')
        .getOne();
      // If the org doesn't exists, or is a fake one (like for anonymous users), don't do anything.
      if (!org || org.id === 0) {
        // This API shouldn't be called, it should be checked first if the org is valid.
        throw new ApiError(`Can't create a limit for non-existing organization`, 500);
      }
      const features = org?.billingAccount?.getFeatures();
      if (!features) {
        throw new ApiError(`No product found for org ${org.id}`, 500);
      }
      if (features.baseMaxAssistantCalls === undefined) {
        // If the product has no assistantLimit, then it is not billable yet, and we don't need to
        // track usage as it is basically unlimited.
        return null;
      }
      const existing = await this._getOrCreateLimitAndReset(org.billingAccountId, limitType, true, manager);
      if (!existing) {
        throw new ApiError(
          `Can't create a limit for non-existing organization`,
          500,
        );
      }
      const limitLess = existing.limit === -1; // -1 means no limit, it is not possible to do in stripe.
      const projectedValue = existing.usage + options.delta;
      if (!limitLess && projectedValue > existing.limit) {
        return new ApiError(
          `Your ${limitType} limit has been reached. Please upgrade your plan to increase your limit.`,
          429,
          {
            limit: {
              maximum: existing.limit,
              projectedValue,
              quantity: limitType,
              value: existing.usage,
            },
            tips: [{
              // For non-billable accounts, suggest getting a plan, otherwise suggest visiting the billing page.
              action: org?.billingAccount?.stripeCustomerId ? 'manage' : 'upgrade',
              message: `Upgrade to a paid plan to increase your ${limitType} limit.`,
            }],
          }
        );
      }
      existing.usage += options.delta;
      existing.usedAt = new Date();
      if (!options.dryRun) {
        await manager.save(existing);
      }
      return existing;
    });
    if (limitOrError instanceof ApiError) {
      throw limitOrError;
    }

    return limitOrError;
  }

  public async syncShares(docId: string, shares: ShareInfo[]) {
    return this._connection.transaction(async manager => {
      for (const share of shares) {
        const key = makeId();
        await manager.createQueryBuilder()
          .insert()
        // if urlId has been used before, update it
          .onConflict(`(doc_id, link_id) DO UPDATE SET options = :options`)
          .setParameter('options', share.options)
          .into(Share)
          .values({
            linkId: share.linkId,
            docId,
            options: JSON.parse(share.options),
            key,
          })
          .execute();
      }
      const dbShares = await manager.createQueryBuilder()
        .select('shares')
        .from(Share, 'shares')
        .where('doc_id = :docId', {docId})
        .getMany();
      const activeLinkIds = new Set(shares.map(share => share.linkId));
      const oldShares = dbShares.filter(share => !activeLinkIds.has(share.linkId));
      if (oldShares.length > 0) {
        await manager.createQueryBuilder()
          .delete()
          .from('shares')
          .whereInIds(oldShares.map(share => share.id))
          .execute();
      }
    });
  }

  public async getShareByKey(key: string) {
    return this._connection.createQueryBuilder()
      .select('shares')
      .from(Share, 'shares')
      .where('shares.key = :key', {key})
      .getOne();
  }

  public async getShareByLinkId(docId: string, linkId: string) {
    return this._connection.createQueryBuilder()
      .select('shares')
      .from(Share, 'shares')
      .where('shares.doc_id = :docId and shares.link_id = :linkId', {docId, linkId})
      .getOne();
  }

  /**
   * Gets the config with the specified `key`.
   *
   * Returns a query result with status 200 and the config on success.
   *
   * Fails if a config with the specified `key` does not exist.
   */
  public async getInstallConfig(
    key: ConfigKey,
    { transaction }: { transaction?: EntityManager } = {}
  ): Promise<QueryResult<Config>> {
    return this.runInTransaction(transaction, (manager) => {
      const query = this._installConfig(key, {
        manager,
      });
      return verifyEntity(query, { skipPermissionCheck: true });
    });
  }

  /**
   * Updates the value of the config with the specified `key`.
   *
   * If a config with the specified `key` does not exist, returns a query
   * result with status 201 and a new config on success.
   *
   * Otherwise, returns a query result with status 200 and the previous and
   * current versions of the config on success.
   */
  public async updateInstallConfig(
    key: ConfigKey,
    value: ConfigValue
  ): Promise<QueryResult<Config|PreviousAndCurrent<Config>>> {
    const events: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async (manager) => {
      const queryResult = await this.getInstallConfig(key, {
        transaction: manager,
      });
      if (queryResult.status === 404) {
        const config: Config = new Config();
        config.key = key;
        config.value = value;
        await manager.save(config);
        events.push(this._streamingDestinationsChange());
        return {
          status: 201,
          data: config,
        };
      } else {
        const config: Config = this.unwrapQueryResult(queryResult);
        const previous = structuredClone(config);
        config.value = value;
        await manager.save(config);
        events.push(this._streamingDestinationsChange());
        return {
          status: 200,
          data: { previous, current: config },
        };
      }
    });
    for (const event of events) {
      await event();
    }
    return result;
  }

  /**
   * Deletes the config with the specified `key`.
   *
   * Returns a query result with status 200 and the deleted config on success.
   *
   * Fails if a config with the specified `key` does not exist.
   */
  public async deleteInstallConfig(key: ConfigKey): Promise<QueryResult<Config>> {
    const events: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async (manager) => {
      const queryResult = await this.getInstallConfig(key, {
        transaction: manager,
      });
      const config: Config = this.unwrapQueryResult(queryResult);
      const deletedConfig = structuredClone(config);
      await manager.remove(config);
      events.push(this._streamingDestinationsChange());
      return {
        status: 200,
        data: deletedConfig,
      };
    });
    for (const event of events) {
      await event();
    }
    return result;
  }

  /**
   * Gets the config scoped to a particular `org` with the specified `key`.
   *
   * Returns a query result with status 200 and the config on success.
   *
   * Fails if the scoped user is not an owner of the org, or a config with
   * the specified `key` does not exist for the org.
   */
  public async getOrgConfig(
    scope: Scope,
    org: string|number,
    key: ConfigKey,
    options: { manager?: EntityManager } = {}
  ): Promise<QueryResult<Config>> {
    return this.runInTransaction(options.manager, (manager) => {
      const query = this._orgConfig(scope, org, key, {
        manager,
      });
      return verifyEntity(query);
    });
  }

  /**
   * Updates the value of the config scoped to a particular `org` with the
   * specified `key`.
   *
   * If a config with the specified `key` does not exist, returns a query
   * result with status 201 and a new config on success.
   *
   * Otherwise, returns a query result with status 200 and the previous and
   * current versions of the config on success.
   *
   * Fails if the user is not an owner of the org.
   */
  public async updateOrgConfig(
    scope: Scope,
    orgKey: string|number,
    key: ConfigKey,
    value: ConfigValue
  ): Promise<QueryResult<Config|PreviousAndCurrent<Config>>> {
    const eventsWithArgs: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async (manager) => {
      const orgQuery = this.org(scope, orgKey, {
        markPermissions: Permissions.OWNER,
        needRealOrg: true,
        manager,
      });
      const orgQueryResult = await verifyEntity(orgQuery);
      const org: Organization = this.unwrapQueryResult(orgQueryResult);
      const configQueryResult = await this.getOrgConfig(scope, orgKey, key, {
        manager,
      });
      if (configQueryResult.status === 404) {
        const config: Config = new Config();
        config.key = key;
        config.value = value;
        config.org = org;
        await manager.save(config);
        eventsWithArgs.push(this._streamingDestinationsChange(org.id));
        return {
          status: 201,
          data: config,
        };
      } else {
        const config: Config = this.unwrapQueryResult(configQueryResult);
        const previous = structuredClone(config);
        config.value = value;
        await manager.save(config);
        eventsWithArgs.push(this._streamingDestinationsChange(org.id));
        return {
          status: 200,
          data: { previous, current: config },
        };
      }
    });
    for (const eventWithArgs of eventsWithArgs) {
      await eventWithArgs();
    }
    return result;
  }

  /**
   * Deletes the config scoped to a particular `org` with the specified `key`.
   *
   * Returns a query result with status 200 and the deleted config on success.
   *
   * Fails if the scoped user is not an owner of the org, or a config with
   * the specified `key` does not exist for the org.
   */
  public async deleteOrgConfig(
    scope: Scope,
    org: string|number,
    key: ConfigKey
  ): Promise<QueryResult<Config>> {
    const eventsWithArgs: Array<() => Promise<void>> = [];
    const result = await this._connection.transaction(async (manager) => {
      const query = this._orgConfig(scope, org, key, {
        manager,
      });
      const queryResult = await verifyEntity(query);
      const config: Config = this.unwrapQueryResult(queryResult);
      const deletedConfig = structuredClone(config);
      await manager.remove(config);
      eventsWithArgs.push(this._streamingDestinationsChange(deletedConfig.org!.id));
      return {
        status: 200,
        data: deletedConfig,
      };
    });
    for (const eventWithArgs of eventsWithArgs) {
      await eventWithArgs();
    }
    return result;
  }

  /**
   * Gets the config with the specified `key` and `orgId`.
   *
   * Returns `null` if no matching config is found.
   */
  public async getConfigByKeyAndOrgId(
    key: ConfigKey,
    orgId: number|null = null,
    { manager }: { manager?: EntityManager } = {}
  ) {
    let query = this._configs(manager).where("configs.key = :key", { key });
    if (orgId !== null) {
      query = query
        .leftJoinAndSelect("configs.org", "orgs")
        .andWhere("configs.org_id = :orgId", { orgId });
      query = this._addFeatures(query);
    } else {
      query = query.andWhere("configs.org_id IS NULL");
    }
    return query.getOne();
  }

  public async getNewUserInvitesCount(
    org: string | number,
    options: {
      createdSince?: Date;
      excludedUserIds?: number[];
      transaction?: EntityManager;
    } = {}
  ): Promise<number> {
    const { createdSince, excludedUserIds = [], transaction } = options;
    return this.runInTransaction(transaction, async (manager) => {
      const { count } = await this._orgMembers(org, manager)
        // Postgres returns a string representation of a bigint unless we cast.
        .select("CAST(COUNT(*) AS INTEGER)", "count")
        .andWhere("org_member_users.is_first_time_user = true")
        .andWhere("org_member_users.id NOT IN (:...excludedUserIds)", {
          excludedUserIds: [
            ...this._usersManager.getExcludedUserIds(),
            ...excludedUserIds,
          ],
        })
        .chain((qb) =>
          createdSince
            ? qb.andWhere("org_member_users.created_at >= :createdSince", {
                createdSince,
              })
            : qb
        )
        .getRawOne();
      return count;
    });
  }

  public async getDocPrefs(scope: DocScope): Promise<FullDocPrefs> {
    return await this.runInTransaction<FullDocPrefs>(undefined, async (manager) => {
      const [, prefs] = await this._doGetDocPrefs(scope, manager);
      return prefs;
    });
  }

  public async setDocPrefs(scope: DocScope, newPrefs: Partial<FullDocPrefs>): Promise<void> {
    const {urlId: docId, userId} = scope;
    const notifications: Array<() => Promise<void>> = [];
    await this.runInTransaction(undefined, async (manager) => {
      const [doc, origPrefs] = await this._doGetDocPrefs(scope, manager);
      const updates = [];
      if (newPrefs.docDefaults) {
        if (doc.access !== roles.OWNER) {
          throw new ApiError('Only document owners may update document prefs', 403);
        }
        const prefs = {...origPrefs.docDefaults, ...newPrefs.docDefaults};
        updates.push({docId, userId: null, prefs});
      }
      if (newPrefs.currentUser) {
        const prefs = {...origPrefs.currentUser, ...newPrefs.currentUser};
        updates.push({docId, userId, prefs});
      }
      await manager.createQueryBuilder()
        .insert().into(DocPref)
        .values(updates)
        .onConflict(`(doc_id, COALESCE(user_id, 0)) DO UPDATE SET prefs = EXCLUDED.prefs`)
        .execute();

      this.caches?.addInvalidationDocPrefs(notifications, [docId]);
    });
    for (const notification of notifications) { await notification(); }
  }

  /**
   * Combines default and per-user DocPrefs. Does not check access.
   */
  public async getDocPrefsForUsers(docId: string, userIds: number[]|'any'): Promise<Map<number|null, DocPrefs>> {
    const records = await this._connection.createQueryBuilder()
      .select('doc_pref')
      .from(DocPref, 'doc_pref')
      .where('doc_id = :docId', {docId})
      .chain(qb => (
        userIds === 'any' ? qb :
        qb.andWhere('(user_id IS NULL OR user_id IN (:...userIds))', {userIds})
      ))
      .getMany();
    return new Map<number|null, DocPrefs>(records.map(r => [r.userId, r.prefs]));
  }

  public setProposal(options: {
    srcDocId: string,
    destDocId: string,
    comparison: DocStateComparison
    retracted?: boolean
  }) {
    return this._connection.transaction(async manager => {
      const maxRow = await manager.createQueryBuilder()
        .from(Proposal, 'proposals')
        .select("MAX(proposals.short_id)", "max")
        .where("proposals.dest_doc_id = :docId", { docId: options.destDocId })
        .getRawOne<{ max: number }>();
      const shortId = (maxRow?.max || 0) + 1;
      const status: ProposalStatus = options?.retracted ? { status: 'retracted' } : {};
      await manager.createQueryBuilder()
        .insert()
        .into(Proposal, ['srcDocId', 'destDocId', 'comparison', 'shortId', 'status', 'updatedAt', 'appliedAt'])
        .values({
          srcDocId: options.srcDocId,
          destDocId: options.destDocId,
          comparison: {comparison: options.comparison},
          status,
          appliedAt: null,
          shortId,
        })
        .orUpdate(['comparison', 'status', 'updated_at', 'applied_at'], ['src_doc_id', 'dest_doc_id'])
        .execute();
      this.unwrapQueryResult(await this.updateDocument({
        urlId: options.destDocId,
        userId: this.getPreviewerUserId(),
        specialPermit: {
          docId: options.destDocId,
        }
      }, {
        options: {
          proposedChanges: {
            mayHaveProposals: true,
          },
        },
      }, manager, {
        allowSpecialPermit: true,
      }));
      const proposal = await manager.createQueryBuilder()
        .from(Proposal, 'proposals')
        .select('proposals')
        .where("proposals.dest_doc_id = :destDocId", { destDocId: options.destDocId })
        .andWhere("proposals.src_doc_id = :srcDocId", { srcDocId: options.srcDocId })
        .getOneOrFail();
      return this._normalizeQueryResults(proposal);
    });
  }

  public async updateProposalStatus(destDocId: string, shortId: number,
                              status: ProposalStatus) {
    const timestamp = new Date();
    const result = await this._connection.createQueryBuilder()
      .update(Proposal)
      .set({
        status,
        updatedAt: timestamp,
        ...(status.status === 'applied') ? {
          appliedAt: timestamp
        } : {}
      })
      .where('shortId = :shortId', {shortId})
      .andWhere('destDocId = :destDocId', {destDocId})
      .execute();
    return result;
  }

  public async getProposals(options: {
    srcDocId?: string,
    destDocId?: string,
    shortId?: number,
  }): Promise<ApiProposal[]> {
    const result = await this._connection.createQueryBuilder()
      .select('proposals')
      .from(Proposal, 'proposals')
      .leftJoinAndSelect('proposals.srcDoc', 'src_doc')
      .leftJoinAndSelect('src_doc.creator', 'src_creator')
      .leftJoinAndSelect('src_creator.logins', 'src_logins')
      .leftJoinAndSelect('proposals.destDoc', 'dest_doc')
      .leftJoinAndSelect('dest_doc.creator', 'dest_creator')
      .leftJoinAndSelect('dest_creator.logins', 'dest_logins')
      .where(options)
      .orderBy('proposals.short_id', 'DESC')
      .getMany();
    return this._normalizeQueryResults(result);
  }

  public async getProposal(destDocId: string, shortId: number,
                           transaction?: EntityManager): Promise<ApiProposal> {
    const result = await (transaction || this._connection).createQueryBuilder()
      .select('proposals')
      .from(Proposal, 'proposals')
      .leftJoinAndSelect('proposals.srcDoc', 'src_doc')
      .leftJoinAndSelect('src_doc.creator', 'src_creator')
      .leftJoinAndSelect('src_creator.logins', 'src_logins')
      .where('proposals.shortId = :shortId', {shortId})
      .andWhere('proposals.destDocId = :destDocId', {destDocId})
      .getOne();
    return this._normalizeQueryResults(result);
  }

  /**
   * Run an operation in an existing transaction if available, otherwise create
   * a new transaction for it.
   *
   * @param transaction: the manager of an existing transaction, or undefined.
   * @param op: the operation to run in a transaction.
   */
  public runInTransaction<T>(
    transaction: EntityManager|undefined,
    op: (manager: EntityManager) => Promise<T>
  ): Promise<T> {
    if (transaction) { return op(transaction); }
    return this._connection.transaction(op);
  }

  // Convenient helpers for database utilities that depend on _dbType.
  public makeJsonArray(content: string): string { return makeJsonArray(this._dbType, content); }
  public readJson(selection: any) { return readJson(this._dbType, selection); }

  // This method is implemented for test purpose only
  // Using it outside of tests context will lead to partial db
  // destruction
  public async testDeleteAllServiceAccounts() {
    return this._serviceAccountsManager.testDeleteAllServiceAccounts();
  }

  public async createServiceAccount(
    ownerId: number,
    props?: ServiceAccountProperties
  ) {
    return this._serviceAccountsManager.createServiceAccount(ownerId, props);
  }

  public async getOwnedServiceAccounts(ownerId: number) {
    return this._serviceAccountsManager.getOwnedServiceAccounts(ownerId);
  }

  public assertServiceAccountExistingAndOwned(
    serviceAccount: ServiceAccount|null, expectedOwnerId: number
  ): asserts serviceAccount is ServiceAccount {
    return this._serviceAccountsManager.assertServiceAccountExistingAndOwned(serviceAccount, expectedOwnerId);
  }

  public async getServiceAccount(serviceId: number) {
    return this._serviceAccountsManager.getServiceAccount(serviceId);
  }

  public async getServiceAccountByLoginWithOwner(login: string) {
    return this._serviceAccountsManager.getServiceAccountByLoginWithOwner(login);
  }

  public async updateServiceAccount(
    serviceId: number, partial: Partial<ServiceAccount>, options: { expectedOwnerId?: number } = {}
  ) {
    return this._serviceAccountsManager.updateServiceAccount(serviceId, partial, options);
  }

  public async deleteServiceAccount(serviceId: number, options: { expectedOwnerId?: number } = {}){
    return this._serviceAccountsManager.deleteServiceAccount(serviceId, options);
  }

  public async createServiceAccountApiKey(serviceId: number, options: {expectedOwnerId?: number} = {}) {
    return this._serviceAccountsManager.createServiceAccountApiKey(serviceId, options);
  }

  public async deleteServiceAccountApiKey(serviceId: number, options: {expectedOwnerId?: number} = {}) {
    return this._serviceAccountsManager.deleteServiceAccountApiKey(serviceId, options);
  }

  public async getApiKey(userId: number) {
    return this._usersManager.getApiKey(userId);
  }

  public async createApiKey(userId: number, force: boolean, transaction?: EntityManager) {
    return this._usersManager.createApiKey(userId, force, transaction);
  }

  public async deleteApiKey(userId: number, transaction?: EntityManager) {
    return this._usersManager.deleteApiKey(userId, transaction);
  }

  private async _doGetDocPrefs(scope: DocScope, manager: EntityManager): Promise<[Document, FullDocPrefs]> {
    const {urlId: docId, userId} = scope;
    const docQb = this._doc(scope, {accessStyle: 'openNoPublic', manager});
    // The following combination throws ApiError for insufficient access.
    const doc = this.unwrapQueryResult(await this._verifyAclPermissions(docQb))[0];

    const records = await manager.createQueryBuilder()
      .select('doc_pref')
      .from(DocPref, 'doc_pref')
      .where('doc_id = :docId AND (user_id IS NULL OR user_id = :userId)', {docId, userId})
      .getMany();

    return [doc, {
      docDefaults: records.find(r => r.userId === null)?.prefs || {},
      currentUser: records.find(r => r.userId === userId)?.prefs || {},
    }];
  }

  private async _createNotFoundUsers(options: {
    analysis: PermissionDeltaAnalysis;
    transaction?: EntityManager;
  }) {
    const { analysis, transaction } = options;
    const { foundUserDelta, foundUsers } = analysis;
    const { userDelta: notFoundUserDelta, users: notFoundUsers } =
      await this._usersManager.translateDeltaEmailsToUserIds(
        analysis.notFoundUserDelta ?? {},
        transaction
      );
    return {
      userIdDelta: { ...foundUserDelta, ...notFoundUserDelta },
      users: [...foundUsers, ...notFoundUsers],
    };
  }

  private _installConfig(
    key: ConfigKey,
    { manager }: { manager?: EntityManager }
  ): SelectQueryBuilder<Config> {
    return this._configs(manager).where(
      "configs.key = :key AND configs.org_id is NULL",
      { key }
    );
  }

  private _orgConfig(
    scope: Scope,
    org: string|number,
    key: ConfigKey,
    { manager }: { manager?: EntityManager }
  ): SelectQueryBuilder<Config> {
    let query = this._configs(manager)
      .where("configs.key = :key", { key })
      .leftJoinAndSelect("configs.org", "orgs");
    if (this.isMergedOrg(org)) {
      query = query.where("orgs.owner_id = :userId", { userId: scope.userId });
    } else {
      query = this._whereOrg(query, org, false);
    }
    const effectiveUserId = scope.userId;
    const threshold = Permissions.OWNER;
    query = query.addSelect(
      this._markIsPermitted("orgs", effectiveUserId, "open", threshold),
      "is_permitted"
    );
    return query;
  }

  private _configs(manager?: EntityManager) {
    return (manager || this._connection)
      .createQueryBuilder()
      .select("configs")
      .from(Config, "configs");
  }

  private async _getOrgMembers(org: string|number|Organization) {
    if (!(org instanceof Organization)) {
      const result = await this._orgMembers(org).getRawAndEntities();
      if (result.entities.length === 0) {
        // If the query for the org failed, return the failure result.
        throw new ApiError('org not found', 404);
      }
      org = result.entities[0];
    }
    return UsersManager.getResourceUsers(org, this.defaultNonGuestGroupNames);
  }

  private _orgMembers(
    org: string | number,
    manager?: EntityManager
  ) {
    return (
      this._org(null, false, org, {
        needRealOrg: true,
        manager,
      })
        // Join the org's ACL rules (with 1st level groups/users listed).
        .leftJoinAndSelect("orgs.aclRules", "acl_rules")
        .leftJoinAndSelect("acl_rules.group", "org_groups")
        .leftJoinAndSelect("org_groups.memberUsers", "org_member_users")
    );
  }

  private async _getOrCreateLimitAndReset(
    accountId: number,
    limitType: LimitType,
    force: boolean,
    transaction?: EntityManager
  ): Promise<Limit|null> {
    if (accountId === 0) {
      throw new Error(`getLimit: called for not existing account`);
    }
    const result = this.runInTransaction(transaction, async manager => {
      let existing = await manager.createQueryBuilder()
        .select('limit')
        .from(Limit, 'limit')
        .innerJoinAndSelect('limit.billingAccount', 'account')
        .innerJoinAndSelect('account.product', 'product')
        .where('account.id = :accountId', {accountId})
          .andWhere('limit.type = :limitType', {limitType})
        .getOne();

      // If we don't have a limit, and we can't create one, return null.
      if (!existing && !force) { return null; }

      // If we have a limit, check if we don't need to reset it.
      if (existing) {
        // We reset the limit if current date (in UTC) is greater then last billing period and the limit
        // wasn't reset yet. We store the last reset date in the limit itself.

        // We can only reset the limit if we know the billing period end date, and this is not a free plan.
        if (existing.billingAccount.status?.currentPeriodEnd
            && existing.billingAccount.status?.currentPeriodStart
            && existing.billingAccount.inGoodStanding
            && !isFreePlan(existing.billingAccount.product.name)
           ) {
          const startDate = new Date(existing.billingAccount.status.currentPeriodStart).getTime();
          const endDate = new Date(existing.billingAccount.status.currentPeriodEnd).getTime();

          // Calculate the date the limit should be cleared.
          const timestamp = new Date();
          const expected = expectedResetDate(startDate, endDate, timestamp.getTime());
          if (expected) {
            // If we expect to see a reset date, make sure it was reset at that date or little bit after.
            const wasResetOk = existing.resetAt && expected < existing.resetAt.getTime();
            if (!wasResetOk) {
              // So the limit wasn't reset yet, or before the date we expected.
              existing.usage = 0;
              existing.resetAt = timestamp;
              log.info(
                `Resetting limit ${limitType} for account ` +
                `${accountId} (${existing.billingAccount.stripeSubscriptionId}) at ${timestamp}`
              );
              await manager.save(existing);
            }
          }
        }

        return existing;
      }
      const ba = await manager.createQueryBuilder()
        .select('billing_accounts')
        .from(BillingAccount, 'billing_accounts')
        .leftJoinAndSelect('billing_accounts.product', 'products')
        .where('billing_accounts.id = :accountId', {accountId})
        .getOne();
      if (!ba) {
        throw new Error(`getLimit: no product for account ${accountId}`);
      }
      existing = new Limit();
      existing.billingAccountId = ba.id;
      existing.type = limitType;
      existing.limit = ba.getFeatures().baseMaxAssistantCalls ?? 0;
      existing.usage = 0;
      await manager.save(existing);
      return existing;
    });
    return result;
  }

  private _org(scope: Scope|null, includeSupport: boolean, org: string|number|null,
               options: QueryOptions = {}): SelectQueryBuilder<Organization> {
    let query = this._orgs(options.manager);
    // merged pseudo-org must become personal org.
    if (org === null || (options.needRealOrg && this.isMergedOrg(org))) {
      if (!scope || !scope.userId) { throw new Error('_org: requires userId'); }
      query = query.where('orgs.owner_id = :userId', {userId: scope.userId});
    } else {
      query = this._whereOrg(query, org, includeSupport);
    }
    if (options.markPermissions) {
      if (!scope || !scope.userId) {
        throw new Error(`_orgQuery error: userId must be set to mark permissions`);
      }
      let effectiveUserId = scope.userId;
      let threshold = options.markPermissions;
      // TODO If the specialPermit is used across the network, requests could refer to orgs in
      // different ways (number vs string), causing this comparison to fail.
      if (options.allowSpecialPermit && scope.specialPermit && scope.specialPermit.org === org) {
        effectiveUserId = this._usersManager.getPreviewerUserId();
        threshold = Permissions.VIEW;
      }
      // Compute whether we have access to the doc
      query = query.addSelect(
        this._markIsPermitted('orgs', effectiveUserId, 'open', threshold),
        'is_permitted'
      );
    }
    return query;
  }

  /**
   * Construct a QueryBuilder for a select query on a specific org's workspaces given by orgId.
   * Provides options for running in a transaction and adding permission info.
   * See QueryOptions documentation above.
   */
  private _orgWorkspaces(scope: Scope, org: string|number|null,
                         options: QueryOptions = {}): SelectQueryBuilder<Organization> {
    const {userId} = scope;
    const supportId = this._usersManager.getSpecialUserId(SUPPORT_EMAIL);
    let query = this.org(scope, org, options)
      .leftJoinAndSelect('orgs.workspaces', 'workspaces')
      .leftJoinAndSelect('workspaces.docs', 'docs', this._onDoc(scope))
      .leftJoin('orgs.billingAccount', 'account')
      .leftJoin('account.product', 'product')
      .addSelect('product.features')
      .addSelect('product.id')
      .addSelect('account.id')
      // order the support org (aka Samples/Examples) after other ones.
      .orderBy('coalesce(orgs.owner_id = :supportId, false)')
      .setParameter('supportId', supportId)
      .setParameter('userId', userId)
      .addOrderBy('(orgs.owner_id = :userId)', 'DESC')
      // For consistency of results, particularly in tests, order workspaces by name.
      .addOrderBy('workspaces.name')
      .addOrderBy('docs.created_at')
      .leftJoinAndSelect('orgs.owner', 'org_users');

    if (userId !== this._usersManager.getAnonymousUserId()) {
      query = this._addForks(userId, query);
    }

    // If merged org, we need to take some special steps.
    if (this.isMergedOrg(org)) {
      // Add information about owners of personal orgs.
      query = query.leftJoinAndSelect('org_users.logins', 'org_logins');
      // Add a direct, efficient filter to remove irrelevant personal orgs from consideration.
      query = this._filterByOrgGroups(query, userId, null);
      // The anonymous user is a special case; include only examples from support user.
      if (userId === this._usersManager.getAnonymousUserId()) {
        query = query.andWhere('orgs.owner_id = :supportId', { supportId });
      }
    }
    query = this._addIsSupportWorkspace(userId, query, 'orgs', 'workspaces');
    // Add access information and query limits
    // TODO: allow generic org limit once sample/support workspace is done differently
    query = this._applyLimit(query, {...scope, org: undefined}, ['orgs', 'workspaces', 'docs'], 'list');
    return query;
    }

  /**
   * Check if urlId is already in use in the given org, and throw an error if so.
   * If the org is a personal org, we check for use of the urlId in any personal org.
   * If docId is set, we permit the urlId to be in use by that doc.
   */
  private async _checkForUrlIdConflict(manager: EntityManager, org: Organization, urlId: string, docId?: string) {
    // Prepare a query to see if there is an existing conflicting urlId.
    let aliasQuery = this._docs(manager)
      .leftJoinAndSelect('docs.aliases', 'aliases')
      .leftJoinAndSelect('aliases.org', 'orgs')
      .where('docs.urlId = :urlId', {urlId});  // Place restriction on active urlIds only.
                                               // Older urlIds are best-effort, and subject to
                                               // reuse (currently).
    if (org.ownerId === this._usersManager.getSupportUserId()) {
      // This is the support user.  Some of their documents end up as examples on team sites.
      // so urlIds need to be checked globally, which corresponds to placing no extra where
      // clause here.
    } else if (org.ownerId) {
      // This is a personal org, so look for conflicts in any personal org
      // (needed to ensure consistency in merged personal org).
      // We don't need to do anything special about examples since they are stored in a personal
      // org.
      aliasQuery = aliasQuery.andWhere('orgs.owner_id is not null');
    } else {
      // For team sites, just check within the team site.
      // We also need to check within the support@ org for conflict with examples, which
      // currently have an existence within team sites.
      aliasQuery = aliasQuery.andWhere('(aliases.orgId = :orgId OR aliases.orgId = :exampleOrgId)',
                                       {orgId: org.id, exampleOrgId: this._exampleOrgId});
    }
    if (docId) {
      aliasQuery = aliasQuery.andWhere('docs.id <> :docId', {docId});
    }
    if (await aliasQuery.getOne()) {
      throw new ApiError('urlId already in use', 400);
    }
    // Also forbid any urlId that would match an existing docId, that is a recipe for confusion
    // and mischief.
    if (await this._docs(manager).where('docs.id = :urlId', {urlId}).getOne()) {
      throw new ApiError('urlId already in use as document id', 400);
    }
  }

  /**
   * Updates the workspace guests with any first-level users of docs inside the workspace.
   */
  private async _repairWorkspaceGuests(scope: Scope, wsId: number, transaction?: EntityManager): Promise<void> {
    return await this.runInTransaction(transaction, async manager => {
      // Get guest group for workspace.
      const wsQuery = this._workspace(scope, wsId, {manager})
      .leftJoinAndSelect('workspaces.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'groups')
      .leftJoinAndSelect('groups.memberUsers', 'users');
      const workspace: Workspace = (await wsQuery.getOne())!;
      const wsGuestGroup = workspace.aclRules.map(aclRule => aclRule.group)
        .find(_grp => _grp.name === roles.GUEST);
      if (!wsGuestGroup) {
        throw new Error(`_repairWorkspaceGuests error: could not find ${roles.GUEST} ACL group`);
      }

      // Get explicitly added users of docs inside the workspace, as a separate query
      // to avoid multiplying rows and to allow filtering the result in sql.
      const wsWithDocsQuery = this._workspace(scope, wsId, {manager})
        .leftJoinAndSelect('workspaces.docs', 'docs')
        .leftJoinAndSelect('docs.aclRules', 'doc_acl_rules')
        .leftJoinAndSelect('doc_acl_rules.group', 'doc_groups')
        .leftJoinAndSelect('doc_groups.memberUsers', 'doc_users')
        .andWhere('docs.removed_at IS NULL')  // Don't grant guest access for soft-deleted docs.
        .andWhere('doc_users.id is not null');
      const wsWithDocs = await wsWithDocsQuery.getOne();
      await this._groupsManager.setGroupUsers(manager, wsGuestGroup.id, wsGuestGroup.memberUsers,
                                this._usersManager.filterEveryone(
                                   UsersManager.getResourceUsers(wsWithDocs?.docs || [])
                                )
      );
    });
  }

  /**
   * Updates the org guests with any first-level users of workspaces inside the org.
   * NOTE: If repairing both workspace and org guests, this should always be called AFTER
   * _repairWorkspaceGuests.
   */
  private async _repairOrgGuests(scope: Scope, orgKey: string|number, transaction?: EntityManager): Promise<void> {
    return await this.runInTransaction(transaction, async manager => {
      const orgQuery = this.org(scope, orgKey, {manager})
      .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'groups')
      .leftJoinAndSelect('groups.memberUsers', 'users')
      .andWhere('groups.name = :role', {role: roles.GUEST});
      const org = await orgQuery.getOne();
      if (!org) { throw new Error('cannot find org'); }
      const workspaceQuery = this._workspaces(manager)
      .where('workspaces.org_id = :orgId', {orgId: org.id})
      .andWhere('workspaces.removed_at IS NULL')  // Don't grant guest access for soft-deleted workspaces.
      .leftJoinAndSelect('workspaces.aclRules', 'workspace_acl_rules')
      .leftJoinAndSelect('workspace_acl_rules.group', 'workspace_group')
      .leftJoinAndSelect('workspace_group.memberUsers', 'workspace_users')
      .leftJoinAndSelect('workspaces.org', 'org');
      org.workspaces = await workspaceQuery.getMany();
      const orgGroups = org.aclRules.map(aclRule => aclRule.group);
      if (orgGroups.length !== 1) {
        throw new Error(`_repairOrgGuests error: found ${orgGroups.length} ${roles.GUEST} ACL group(s)`);
      }
      const orgGuestGroup = orgGroups[0]!;
      await this._groupsManager.setGroupUsers(manager, orgGuestGroup.id, orgGuestGroup.memberUsers,
                                this._usersManager.filterEveryone(UsersManager.getResourceUsers(org.workspaces)));
    });
  }

  /**
   * Creates, initializes and saves a workspace in the given org with the given properties.
   * Product limits on number of workspaces allowed in org are not checked.
   */
  private async _doAddWorkspace(
    {org, props, ownerId}: CreateWorkspaceOptions,
    transaction?: EntityManager
  ): Promise<Workspace> {
    if (!props.name) { throw new ApiError('Bad request: name required', 400); }
    return await this.runInTransaction<Workspace>(transaction, async manager => {
      // Create a new workspace.
      const workspace = new Workspace();
      workspace.checkProperties(props);
      workspace.updateFromProperties(props);
      workspace.org = org;
      // Create the special initial permission groups for the new workspace.
      // Optionally add the owner to the workspace.
      const groupMap = this._groupsManager.createGroups(org, ownerId);
      workspace.aclRules = this.defaultCommonGroups.map(_grpDesc => {
        // Get the special group with the name needed for this ACL Rule
        const group = groupMap[_grpDesc.name];
        // Add each of the special groups to the new workspace.
        const aclRuleWs = new AclRuleWs();
        aclRuleWs.permissions = _grpDesc.permissions;
        aclRuleWs.group = group;
        aclRuleWs.workspace = workspace;
        return aclRuleWs;
      });
      // Saves the workspace as well as its new ACL Rules and Group.
      const groups = workspace.aclRules.map(rule => rule.group);
      const result = await manager.save([workspace, ...workspace.aclRules, ...groups]);
      if (ownerId) {
        // If we modified direct access to the workspace, we need to update the
        // guest group to include the owner.
        await this._repairOrgGuests({userId: ownerId}, org.id, manager);
      }
      return result[0] as Workspace;
    });
  }

  /**
   * If the user is a manager of the billing account associated with
   * the domain, an extra `billingAccount` field is returned,
   * containing a `inGoodStanding` flag, a `status` json field, and a
   * `product.paid` flag which is true if on a paid plan or false
   * otherwise.  Other `billingAccount` fields are included (stripe ids in
   * particular) but these will not be reported across the API.
   */
  private _addBillingAccount(qb: SelectQueryBuilder<Organization>, userId: number) {
    qb = qb.leftJoinAndSelect('orgs.billingAccount', 'billing_accounts');
    qb = qb.leftJoinAndSelect('billing_accounts.product', 'products');
    qb = qb.leftJoinAndSelect('billing_accounts.managers', 'managers',
                              'managers.billing_account_id = billing_accounts.id and ' +
                              'managers.user_id = :userId');
    qb = qb.setParameter('userId', userId);
    qb = this._addBillingAccountCalculatedFields(qb);
    return qb;
  }

  /**
   * Adds any calculated fields related to billing accounts - currently just
   * products.paid.
   */
  private _addBillingAccountCalculatedFields<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>) {
    // We need to sum up whether the account is paid or not, so that UI can provide
    // a "billing" vs "upgrade" link.  For the moment, we just check if there is
    // a subscription id.  TODO: make sure this is correct in case of free plans.
    qb = qb.addSelect(`(billing_accounts.stripe_subscription_id is not null)`, 'billing_accounts_paid');
    return qb;
  }

  /**
   * Makes sure that product features for orgs are available in query result.
   */
  private _addFeatures<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, orgAlias: string = 'orgs') {
    qb = qb.leftJoinAndSelect(`${orgAlias}.billingAccount`, 'billing_accounts');
    qb = qb.leftJoinAndSelect('billing_accounts.product', 'products');
    // orgAlias.billingAccount.product.features should now be available
    return qb;
  }

  private _addIsSupportWorkspace<T extends ObjectLiteral>(users: AvailableUsers, qb: SelectQueryBuilder<T>,
                                    orgAlias: string, workspaceAlias: string) {
    const supportId = this._usersManager.getSpecialUserId(SUPPORT_EMAIL);

    // We'll be selecting a boolean and naming it as *_support.  This matches the
    // SQL name `support` of a column in the Workspace entity whose javascript
    // name is `isSupportWorkspace`.
    const alias = `${workspaceAlias}_support`;

    // If we happen to be the support user, don't treat our workspaces as anything
    // special, so we can work with them in the ordinary way.
    if (UsersManager.isSingleUser(users) && users === supportId) { return qb.addSelect('false', alias); }

    // Otherwise, treat workspaces owned by support as special.
    return qb.addSelect(`coalesce(${orgAlias}.owner_id = ${supportId}, false)`, alias);
  }

  /**
   * Makes sure that doc forks are available in query result.
   */
  private _addForks<T extends ObjectLiteral>(userId: number, qb: SelectQueryBuilder<T>) {
    return qb.leftJoin('docs.forks', 'forks', 'forks.created_by = :forkUserId')
      .setParameter('forkUserId', userId)
      .addSelect([
        'forks.id',
        'forks.trunkId',
        'forks.createdBy',
        'forks.updatedAt',
        'forks.options'
      ]);
  }

  /**
   * Modify an access level when the document is a fork. Here are the rules, as they
   * have evolved (the main constraint is that currently forks have no access info of
   * their own in the db).
   *   - If fork is a tutorial:
   *     - User ~USERID from the fork id is owner, all others have no access.
   *   - If fork is not a tutorial:
   *     - If there is no ~USERID in fork id, then all viewers of trunk are owners of the fork.
   *     - If there is a ~USERID in fork id, that user is owner, all others are at most viewers.
   */
  private _setForkAccess(doc: Document,
                         ids: {userId: number, forkUserId?: number},
                         res: {access: roles.Role|null}) {
    if (doc.type === 'tutorial') {
      if (ids.userId === this._usersManager.getPreviewerUserId()) {
        res.access = 'viewers';
      } else if (ids.forkUserId && ids.forkUserId === ids.userId) {
        res.access = 'owners';
      } else {
        res.access = null;
      }
    } else {
      // Forks without a user id are editable by anyone with view access to the trunk.
      if (ids.forkUserId === undefined && roles.canView(res.access)) { res.access = 'owners'; }
      if (ids.forkUserId !== undefined) {
        // A fork user id is known, so only that user should get to edit the fork.
        if (ids.userId === ids.forkUserId) {
          if (roles.canView(res.access)) { res.access = 'owners'; }
        } else {
          // reduce to viewer if not already viewer
          res.access = roles.getWeakestRole('viewers', res.access);
        }
      }
    }
  }
  /**
   * A helper to throw an error if a user with ACL_EDIT permission attempts
   * to change their own access rights. The user permissions are expected to
   * be in the supplied QueryResult, or if none is supplied are assumed to be
   * ACL_EDIT.
   */
  private _failIfPowerfulAndChangingSelf(analysis: PermissionDeltaAnalysis, result?: QueryResult<any>) {
    const permissions: Permissions = result ? result.data.permissions : Permissions.ACL_EDIT;
    if (permissions === undefined) {
      throw new Error('Query malformed');
    }
    if ((permissions & Permissions.ACL_EDIT) && analysis.affectsSelf) {
      // editors don't get to remove themselves.
      // TODO: Consider when to allow updating own permissions - allowing updating own
      // permissions indiscriminately could lead to orphaned resources.
      throw new ApiError('Bad request: cannot update own permissions', 400);
    }
  }

  private _failIfTooManyBillingManagers(options: {
    analysis: PermissionDeltaAnalysis;
    billingAccount: BillingAccount;
  }) {
    const { analysis, billingAccount } = options;
    const { foundUserDelta, foundUsers, notFoundUserDelta } = analysis;

    const max = Deps.defaultMaxBillingManagersPerOrg.value;
    if (max === undefined) { return; }

    const foundUserIds = new Set(foundUsers.map((user) => user.id));
    const addedUsers = foundUsers.filter((user) => foundUserDelta?.[user.id]);
    const delta = size(notFoundUserDelta) + addedUsers.length;
    if (!delta) {
      return;
    }

    const current = billingAccount.managers.filter((manager) =>
      !foundUserIds.has(manager.userId)).length;
    if (current + delta > max) {
      throw new ApiError("Your site has too many billing managers", 403);
    }
  }

  private async _failIfTooManyNewUserInvites(options: {
    orgKey: string | number;
    analysis: PermissionDeltaAnalysis;
    billingAccount: BillingAccount;
    manager?: EntityManager;
  }) {
    const { orgKey, analysis, billingAccount, manager } = options;
    const { foundUserDelta, foundUsers, notFoundUserDelta } = analysis;

    const max =
      billingAccount.getFeatures().maxNewUserInvitesPerOrg ??
      Deps.defaultMaxNewUserInvitesPerOrg.value;
    if (max === undefined) { return; }

    const createdSince = moment()
      .subtract(Deps.defaultMaxNewUserInvitesPerOrg.durationMs, "milliseconds")
      .toDate();
    const newUsers = foundUsers.filter((user) => {
      return user.isFirstTimeUser && user.createdAt >= createdSince;
    });
    const addedUsers = newUsers.filter((user) => foundUserDelta?.[user.id]);
    const delta = size(notFoundUserDelta) + addedUsers.length;
    if (!delta) {
      return;
    }

    const current = await this.getNewUserInvitesCount(orgKey, {
      createdSince,
      excludedUserIds: newUsers.map((user) => user.id),
      transaction: manager,
    });
    if (current + delta > max) {
      throw new ApiError("Your site has too many pending invitations", 403);
    }
  }

  /**
   * Helper for adjusting acl rules. Given an array of top-level groups from the resource
   * of interest, returns the updated groups. The returned groups should be saved to
   * update the group inheritance in the database. Updates the passed in groups.
   *
   * NOTE that all group memberUsers must be populated.
   */
  private async _updateUserPermissions(
    groups: NonGuestGroup[],
    userDelta: UserIdDelta,
    manager: EntityManager
  ): Promise<void> {
    // Get the user objects which map to non-null values in the userDelta.
    const userIds = Object.keys(userDelta).filter(userId => userDelta[userId])
      .map(userIdStr => parseInt(userIdStr, 10));
    const users = await this._usersManager.getUsersByIds(userIds, {manager});

    // Add unaffected users to the delta so that we have a record of where they are.
    groups.forEach(grp => {
      grp.memberUsers.forEach(usr => {
        if (!(usr.id in userDelta)) {
          userDelta[usr.id] = grp.name;
          users.push(usr);
        }
      });
    });

    // Create mapping from group names to top-level groups (contain the inherited groups)
    const topGroups: {[groupName: string]: NonGuestGroup} = {};
    groups.forEach(grp => {
      // Note that this has a side effect of resetting the memberUsers arrays.
      grp.memberUsers = [];
      topGroups[grp.name] = grp;
    });

    // Add users to groups (this has a side-effect of updating the group memberUsers)
    users.forEach(user => {
      const groupName = userDelta[user.id]!;
      // NOTE that the special names constant is ordered from least to most permissive.
      // The destination must be a reserved inheritance group or null.
      if (groupName && !this.defaultNonGuestGroupNames.includes(groupName)) {
        throw new Error(`_updateUserPermissions userDelta contains invalid group`);
      }
      topGroups[groupName].memberUsers.push(user);
    });
  }

  /**
   * Aggregate the given columns as a json object.  The keys should be simple
   * alphanumeric strings, and the values should be the names of sql columns -
   * this method is not set up to quote concrete values.
   */
  private _aggJsonObject(content: {[key: string]: string}): string {
    const args = [...Object.keys(content).map(key => [`'${key}'`, content[key]])];
    if (this._dbType === 'postgres') {
      return `json_agg(json_build_object(${args.join(',')}))`;
    } else {
      return `json_group_array(json_object(${args.join(',')}))`;
    }
  }

  // If cte is provided, assume it is a common table
  // expression that selects certain rows of docs, and
  // substitute it in.
  private _docs(manager?: EntityManager, cte?: string) {
    const builder = (manager || this._connection).createQueryBuilder();
    const docs = (cte ? builder.addCommonTableExpression(cte, 'filtered_docs') : builder)
      .select('docs')
      .from(cte ? FilteredDocument : Document, 'docs');
    return docs;
  }

  /**
   * Construct a QueryBuilder for a select query on a specific doc given by urlId.
   * Provides options for running in a transaction and adding permission info.
   * See QueryOptions documentation above.
   *
   * In order to accept urlIds, the aliases, workspaces, and orgs tables are joined.
   */
  private _doc(scope: DocScope, options: DocQueryOptions = {}): SelectQueryBuilder<Document> {
    const {urlId, userId} = scope;
    // Check if doc is being accessed with a merged org url.  If so,
    // we will only filter urlId matches, and will allow docId matches
    // for team site documents.  This is for backwards compatibility,
    // to support https://docs.getgrist.com/api/docs/<docid> for team
    // site documents.
    const mergedOrg = this.isMergedOrg(scope.org || null);
    // OPTIMIZATION: we add a CTE to prefilter docs table for a union
    // of matches on docs.id or on aliases. We observe the Postgres query
    // planner having a hard time with the WHERE clause that does this
    // filtering later with an OR.
    // QUIRK: the :urlId parameter in the CTE relies on it being introduced
    // later in the where clause. There's nowhere to add it in TypeORM's CTE
    // interface.
    let query = this._docs(options.manager, `
  SELECT docs.*
  FROM docs
  WHERE docs.id = :urlId

  UNION ALL

  SELECT docs.*
  FROM aliases
  JOIN docs ON docs.id = aliases.doc_id
  WHERE aliases.url_id = :urlId
`)
      .leftJoinAndSelect('docs.workspace', 'workspaces')
      .leftJoinAndSelect('workspaces.org', 'orgs')
      .leftJoinAndSelect('docs.aliases', 'aliases')
      .where(new Brackets(cond => {
        return cond
          .where('docs.id = :urlId', {urlId})
          .orWhere(new Brackets(urlIdCond => {
            let urlIdQuery = urlIdCond
              .where('aliases.url_id = :urlId', {urlId})
              .andWhere('aliases.org_id = orgs.id');
            if (mergedOrg) {
              // Filter specifically for merged org documents.
              urlIdQuery = urlIdQuery.andWhere('orgs.owner_id is not null');
            }
            return urlIdQuery;
          }));
      }));

    // TODO includeSupport should really be false, and the support for it should be removed.
    // (For this, example doc URLs should be under docs.getgrist.com rather than team domains.)
    // Add access information and query limits
    const accessStyle = options.accessStyle || 'open';
    query = this._applyLimit(query, {...scope, includeSupport: true}, ['docs', 'workspaces', 'orgs'], accessStyle);
    if (options.markPermissions) {
      let effectiveUserId = userId;
      let threshold = options.markPermissions;
      if (options.allowSpecialPermit && scope.specialPermit && scope.specialPermit.docId) {
        query = query.andWhere('docs.id = :docId', {docId: scope.specialPermit.docId});
        effectiveUserId = this._usersManager.getPreviewerUserId();
        threshold = Permissions.VIEW;
      }
      // Compute whether we have access to the doc
      query = query.addSelect(
        this._markIsPermitted('docs', effectiveUserId, accessStyle, threshold),
        'is_permitted'
      );
    }
    return query;
  }

  /**
   * Construct a QueryBuilder for a select query on a specific fork given by urlId.
   * Provides options for running in a transaction.
   */
  private _fork(scope: DocScope, options: QueryOptions = {}): SelectQueryBuilder<Document> {
    // Extract the forkId from the urlId and use it to find the fork in the db.
    const {forkId} = parseUrlId(scope.urlId);
    let query = this._docs(options.manager)
      .leftJoinAndSelect('docs.trunk', 'trunk')
      .leftJoinAndSelect('trunk.workspace', 'trunk_workspace')
      .leftJoinAndSelect('trunk_workspace.org', 'trunk_org')
      .where('docs.id = :forkId', {forkId});

    // Compute whether we have access to the fork.
    if (options.allowSpecialPermit && scope.specialPermit?.docId) {
      const {forkId: permitForkId} = parseUrlId(scope.specialPermit.docId);
      query = query
        .setParameter('permitForkId', permitForkId)
        .addSelect(
          'docs.id = :permitForkId',
          'is_permitted'
        );
    } else {
      query = query
        .setParameter('forkUserId', scope.userId)
        .setParameter('forkAnonId', this._usersManager.getAnonymousUserId())
        .addSelect(
          // Access to forks is currently limited to the users that created them, with
          // the exception of anonymous users, who have no access to their forks.
          'docs.created_by = :forkUserId AND docs.created_by <> :forkAnonId',
          'is_permitted'
        );
    }

    return query;
  }

  private _workspaces(manager?: EntityManager) {
    return (manager || this._connection).createQueryBuilder()
      .select('workspaces')
      .from(Workspace, 'workspaces');
  }

  /**
   * Construct "ON" clause for joining docs.  This clause takes care of filtering
   * out any docs that are not to be listed due to soft deletion.  This filtering
   * is done in the "ON" clause rather than in a "WHERE" clause since we still
   * want to list workspaces even if there are no docs within them.  A "WHERE" clause
   * would entirely remove information about a workspace with no docs.  The "ON"
   * clause, in combination with a "LEFT JOIN", preserves the workspace information
   * and just sets doc information to NULL.
   */
  private _onDoc(scope: Scope) {
    const onDefault = 'docs.workspace_id = workspaces.id';
    if (scope.showAll) {
      return onDefault;
    } else if (scope.showRemoved) {
      return `${onDefault} AND (workspaces.removed_at IS NOT NULL OR docs.removed_at IS NOT NULL)`;
    } else {
      return `${onDefault} AND (workspaces.removed_at IS NULL AND docs.removed_at IS NULL)`;
    }
  }

  /**
   * Construct a QueryBuilder for a select query on a specific workspace given by
   * wsId. Provides options for running in a transaction and adding permission info.
   * See QueryOptions documentation above.
   */
  private _workspace(scope: Scope, wsId: number, options: QueryOptions = {}): SelectQueryBuilder<Workspace> {
    let query = this._workspaces(options.manager)
      .where('workspaces.id = :wsId', {wsId});
    if (options.markPermissions) {
      let effectiveUserId = scope.userId;
      let threshold = options.markPermissions;
      if (options.allowSpecialPermit && scope.specialPermit &&
          scope.specialPermit.workspaceId === wsId) {
        effectiveUserId = this._usersManager.getPreviewerUserId();
        threshold = Permissions.VIEW;
      }
      // Compute whether we have access to the ws
      query = query.addSelect(
        this._markIsPermitted('workspaces', effectiveUserId, 'open', threshold),
        'is_permitted'
      );
    }
    return query;
  }

  private _orgs(manager?: EntityManager) {
    return (manager || this._connection).createQueryBuilder()
      .select('orgs')
      .from(Organization, 'orgs');
  }

  // Adds a where clause to filter orgs by domain or id.
  // If org is null, filter for user's personal org.
  // if includeSupport is true, include the org of the support@ user (for the Samples workspace)
  private _whereOrg<T extends WhereExpressionBuilder>(qb: T, org: string|number, includeSupport = false): T {
    if (this.isMergedOrg(org)) {
      // Select from universe of personal orgs.
      // Don't panic though!  While this means that SQL can't use an organization id
      // to narrow down queries, it will still be filtering via joins against the user and
      // groups the user belongs to.
      qb = qb.andWhere('orgs.owner_id is not null');
      return qb;
    }
    // Always include the org of the support@ user, which contains the Samples workspace,
    // which we always show. (For isMergedOrg case, it's already included.)
    if (includeSupport) {
      const supportId = this._usersManager.getSpecialUserId(SUPPORT_EMAIL);
      return qb.andWhere(new Brackets((q) =>
        this._wherePlainOrg(q, org).orWhere('orgs.owner_id = :supportId', {supportId})));
    } else {
      return this._wherePlainOrg(qb, org);
    }
  }

  private _wherePlainOrg<T extends WhereExpressionBuilder>(qb: T, org: string|number): T {
    if (typeof org === 'number') {
      return qb.andWhere('orgs.id = :org', {org});
    }
    if (org.startsWith(`docs-${this._idPrefix}`)) {
      // this is someone's personal org
      const ownerId = org.split(`docs-${this._idPrefix}`)[1];
      qb = qb.andWhere('orgs.owner_id = :ownerId', {ownerId});
    } else if (org.startsWith(`o-${this._idPrefix}`)) {
      // this is an org identified by org id
      const orgId = org.split(`o-${this._idPrefix}`)[1];
      qb = qb.andWhere('orgs.id = :orgId', {orgId});
    } else {
      // this is a regular domain
      qb = qb.andWhere('orgs.domain = :org', {org});
    }
    return qb;
  }

  private _withAccess(qb: SelectQueryBuilder<any>, users: AvailableUsers,
                      table: 'orgs'|'workspaces'|'docs',
                      accessStyle: AccessStyle = 'open',
                      variableNamePrefix?: string) {
    return qb
      .addSelect(this._markIsPermitted(table, users, accessStyle, null, variableNamePrefix), `${table}_permissions`);
  }

  /**
   * Filter for orgs for which the user is a member of a group (or which are shared
   * with "everyone@").  For access to workspaces and docs, we rely on the fact that
   * the user will be added to a guest group at the organization level.
   *
   * If AvailableUsers is a profile list, we do NOT include orgs accessible
   * via "everyone@" (this affects the "api/session/access/all" endpoint).
   *
   * Otherwise, orgs shared with "everyone@" are candidates for inclusion.
   * If an orgKey is supplied, it is the only org which will be considered
   * for inclusion on the basis of sharing with "everyone@".  TODO: consider
   * whether this wrinkle is needed anymore, or can be safely removed.
   */
  private _filterByOrgGroups(qb: SelectQueryBuilder<Organization>, users: AvailableUsers,
                             orgKey: string|number|null,
                             options?: {ignoreEveryoneShares?: boolean}) {
    qb = qb
      .leftJoin('orgs.aclRules', 'acl_rules')
      .leftJoin('acl_rules.group', 'groups')
      .leftJoin('groups.memberUsers', 'members');
    if (UsersManager.isSingleUser(users)) {
      // Add an exception for the previewer user, if present.
      const previewerId = this._usersManager.getSpecialUserId(PREVIEWER_EMAIL);
      if (users === previewerId) { return qb; }
      const everyoneId = this._usersManager.getSpecialUserId(EVERYONE_EMAIL);
      if (options?.ignoreEveryoneShares) {
        return qb.where('members.id = :userId', {userId: users});
      }
      return qb.andWhere(new Brackets(cond => {
        // Accept direct membership, or via a share with "everyone@".
        return cond
          .where('members.id = :userId', {userId: users})
          .orWhere(new Brackets(everyoneCond => {
            const everyoneQuery = everyoneCond.where('members.id = :everyoneId', {everyoneId});
            return (orgKey !== null) ? this._whereOrg(everyoneQuery, orgKey) : everyoneQuery;
          }));
      }));
    }

    // The user hasn't been narrowed down to one choice, so join against logins and
    // check normalized email.
    const emails = new Set(users.map(profile => normalizeEmail(profile.email)));
    // Empty list needs to be special-cased since "in ()" isn't supported in postgres.
    if (emails.size === 0) { return qb.andWhere('1 = 0'); }
    return qb
      .leftJoin('members.logins', 'memberLogins')
      .andWhere('memberLogins.email in (:...emails)', {emails: [...emails]});
  }

  private _single(result: QueryResult<any>) {
    if (result.status === 200) {
      // TODO: assert result is really singular.
      result.data = result.data[0];
    }
    return result;
  }

  /**
   * Helper for adjusting acl inheritance rules. Given an array of top-level groups from the
   * resource of interest, and an array of inherited groups belonging to the parent resource,
   * moves the inherited groups to the group with the destination name or lower, if their
   * permission level is lower. If the destination group name is omitted, the groups are
   * moved to their original inheritance locations. If the destination group name is null,
   * the groups are all removed and there is no access inheritance to this resource.
   * Returns the updated array of top-level groups. These returned groups should be saved
   * to update the group inheritance in the database.
   *
   * For all passed-in groups, their .memberGroups will be reset. For
   * the basic roles (owner | editor | viewer), these will get updated
   * to include inheritedGroups, with roles reduced to dest when dest
   * is given. All of the basic roles must be present among
   * groups. Any non-basic roles present among inheritedGroups will be
   * ignored.
   *
   * Does not modify inheritedGroups.
   */
  private _moveInheritedGroups(
    groups: NonGuestGroup[], inheritedGroups: Group[], dest?: roles.BasicRole|null
  ): void {
    // Limit scope to those inheritedGroups that have basic roles (viewers, editors, owners).
    inheritedGroups = inheritedGroups.filter(group => roles.isBasicRole(group.name));

    // NOTE that the special names constant is ordered from least to most permissive.
    const reverseDefaultNames = this.defaultBasicGroupNames.reverse();

    // The destination must be a reserved inheritance group or null.
    if (dest && !reverseDefaultNames.includes(dest)) {
      throw new Error('moveInheritedGroups called with invalid destination name');
    }

    // Mapping from group names to top-level groups
    const topGroups: {[groupName: string]: NonGuestGroup} = {};
    groups.forEach(grp => {
      // Note that this has a side effect of initializing the memberGroups arrays.
      grp.memberGroups = [];
      topGroups[grp.name] = grp;
    });

    // The destFunc maps from an inherited group to its required top-level group name.
    const destFunc = (inherited: Group) =>
      dest === null ? null : reverseDefaultNames.find(sp => sp === inherited.name || sp === dest);

    // Place inherited groups (this has the side-effect of updating member groups)
    inheritedGroups.forEach(grp => {
      if (!roles.isBasicRole(grp.name)) {
        // We filtered out such groups at the start of this method, but just in case...
        throw new Error(`${grp.name} is not an inheritable group`);
      }
      const moveTo = destFunc(grp);
      if (moveTo) {
        topGroups[moveTo].memberGroups.push(grp);
      }
    });
  }

  // Return a QueryResult reflecting the output of a query builder.
  // If a rawQueryBuilder is supplied, it is used to make the query,
  // but then the original queryBuilder is used to interpret the results
  // as entities (make sure the two queries give results in the same format!)
  // Checks on all "permissions" fields which select queries set on
  // resources to indicate whether the user has access.
  // If the output is empty, and `emptyAllowed` is not set, we signal that the desired
  // resource does not exist (404).
  // If the overall permissions do not allow viewing, we signal that the resource is forbidden.
  // Access fields are added to all entities giving the group name corresponding
  // with the access level of the user.
  // Returns the resource fetched by the queryBuilder.
  private async _verifyAclPermissions<T extends Resource>(
    queryBuilder: SelectQueryBuilder<T>,
    options: {
      rawQueryBuilder?: SelectQueryBuilder<any>,
      emptyAllowed?: boolean,
      scope?: Scope,
      // If permissions have been marked, check them
      markedPermissions?: boolean,
      // Requires having `users_disabled_at` in the query result
      checkDisabledUser?: boolean,
    } = {}
  ): Promise<QueryResult<T[]>> {
    if (Deps.usePreparedStatements) {
      const sql = options.rawQueryBuilder?.getSql() || queryBuilder.getSql();
      maybePrepareStatement(sql);
    }
    const results = await (options.rawQueryBuilder ?
                           getRawAndEntities(options.rawQueryBuilder, queryBuilder) :
                           queryBuilder.getRawAndEntities());

    if (options.checkDisabledUser) {
      if (results.raw.some(entry => entry.users_disabled_at === undefined)) {
        throw new Error('checkDisabledUser requested but users_disabled_at is undefined');
      }

      // Disabled users shouldn't be able to even log in, but if they
      // got this far (for example they have an existing websocket
      // connexion), they shouldn't be able to have any document
      // access.
      if (results.raw.some(entry => entry.users_disabled_at !== null)) {
        return {
          status: 403,
          errMessage: "access denied",
        };
      }
    }
    if (options.markedPermissions) {
      if (!results.raw.every(entry => entry.is_permitted)) {
        return {
          status: 403,
          errMessage: "access denied"
        };
      }
    }
    if (results.entities.length === 0 ||
        (results.entities.length === 1 && results.entities[0].filteredOut)) {
      if (options.emptyAllowed) { return {status: 200, data: []}; }
      return {errMessage: `${getFrom(queryBuilder)} not found`, status: 404};
    }
    const resources = this._normalizeQueryResults(results.entities, {
      scope: options.scope,
    });
    if (resources.length === 0 && !options.emptyAllowed) {
      return {errMessage: "access denied", status: 403};
    } else {
      return {
        status: 200,
        data: resources
      };
    }
  }

  // Normalize query results in the following ways:
  //   * Convert `permissions` fields to summary `access` fields.
  //   * Set appropriate `domain` fields for personal organizations.
  //   * Include `billingAccount` field only for a billing account manager.
  //   * Replace `user.logins` objects with user.email and user.anonymous.
  //   * Collapse fields from nested `manager.user` objects into the surrounding
  //     `manager` objects.
  //
  // Find any nested entities with a "permissions" field, and add to them an
  // "access" field (if the permission is a simple number) or an "accessOptions"
  // field (if the permission is json).  Entities in a list that the user doesn't
  // have the right to access may be removed.
  //   * They are removed for workspaces in orgs.
  //   * They are not removed for docs in workspaces, if user has right to delete
  //     the workspace.
  //
  // When returning organizations, set the domain to docs-${userId} for personal orgs.
  // We could also have simply stored that domain in the database, but have kept
  // them out for now, for the flexibility to change how we want these kinds of orgs
  // to be presented without having to do awkward migrations.
  //
  // The suppressDomain option ensures that any organization domains are given
  // in ugly o-NNNN form.
  private _normalizeQueryResults(value: any,
                                 options: {
                                   suppressDomain?: boolean,
                                   scope?: Scope,
                                   parentPermissions?: number,
                                 } = {}): any {
    // We only need to examine objects, excluding null.
    if (typeof value !== 'object' || value === null) { return value; }
    // For arrays, add access information and remove anything user should not see.
    if (Array.isArray(value)) {
      const items = value.map(v => this._normalizeQueryResults(v, options));
      // If the items are not workspaces, and the user can delete their parent, then
      // ignore the user's access level when deciding whether to filter them out or
      // to keep them.
      const ignoreAccess = options.parentPermissions &&
        (options.parentPermissions & Permissions.REMOVE) && // tslint:disable-line:no-bitwise
        items.length > 0 && !items[0].docs;
      return items.filter(v => !this._isForbidden(v, Boolean(ignoreAccess), options.scope));
    }
    // For hashes, iterate through key/values, adding access info if 'permissions' field is found.
    if (value.billingAccount) {
      // This is an organization with billing account information available.  Check limits.
      const org = value as Organization;
      const features = org.billingAccount.getFeatures();
      if (!features.vanityDomain) {
        // Vanity domain not allowed for this org.
        options = {...options, suppressDomain: true};
      }
    }
    const permissions = (typeof value.permissions === 'number') ? value.permissions : undefined;
    const childOptions = { ...options, parentPermissions: permissions };
    for (const key of Object.keys(value)) {
      const subValue = value[key];
      // When returning organizations, set the domain to docs-${userId} for personal orgs.
      // We could also have simply stored that domain in the database.  I'd prefer to keep
      // them out for now, for the flexibility to change how we want these kinds of orgs
      // to be presented without having to do awkward migrations.
      if (key === 'domain') {
        value[key] = this.normalizeOrgDomain(value.id, subValue, value.owner && value.owner.id,
                                             false, options.suppressDomain);
        continue;
      }
      if (key === 'billingAccount') {
        if (value[key].managers) {
          value[key].isManager = Boolean(value[key].managers.length);
          delete value[key].managers;
        }
        continue;
      }
      if (key === 'logins') {
        const logins = subValue;
        delete value[key];
        if (logins.length !== 1) {
          throw new ApiError('Cannot find unique login for user', 500);
        }
        value.email = logins[0].displayEmail;
        value.anonymous = (logins[0].userId === this._usersManager.getAnonymousUserId());
        continue;
      }
      if (key === 'managers') {
        const managers = this._normalizeQueryResults(subValue, childOptions);
        for (const manager of managers) {
          if (manager.user) {
            Object.assign(manager, manager.user);
            delete manager.user;
          }
        }
        value[key] = managers;
        continue;
      }
      if (key === 'prefs' && Array.isArray(subValue)) {
        delete value[key];
        const prefs = this._normalizeQueryResults(subValue, childOptions);
        for (const pref of prefs) {
          if (pref.orgId && pref.userId) {
            value.userOrgPrefs = pref.prefs;
          } else if (pref.orgId) {
            value.orgPrefs = pref.prefs;
          } else if (pref.userId) {
            value.userPrefs = pref.prefs;
          }
        }
        continue;
      }
      if (key !== 'permissions') {
        value[key] = this._normalizeQueryResults(subValue, childOptions);
        continue;
      }
      if (typeof subValue === 'number' || !subValue) {
        // Find the first special group for which the user has all permissions.
        value.access = this._groupsManager.getRoleFromPermissions(subValue || 0);
        if (subValue & Permissions.PUBLIC) { // tslint:disable-line:no-bitwise
          value.public = true;
        }
      } else {
        // Resource may be accessed by multiple users, encoded in JSON.
        const accessOptions: AccessOption[] = readJson(this._dbType, subValue);
        value.accessOptions = accessOptions.map(option => ({
          access: this._groupsManager.getRoleFromPermissions(option.perms), ...option
        }));
      }
      delete value.permissions;  // permissions is not specified in the api, so we drop it.
    }
    return value;
  }

  // entity is forbidden if it contains an access field set to null, or an accessOptions field
  // that is the empty list.
  private _isForbidden(entity: any, ignoreAccess: boolean, scope?: Scope): boolean {
    if (!entity) { return false; }
    if (entity.filteredOut) { return true; }
    // Specifically for workspaces (as determined by having a "docs" field):
    // if showing trash, and the workspace looks empty, and the workspace is itself
    // not marked as trash, then filter it out.  This situation can arise when there is
    // a trash doc in a workspace that the user does not have access to, and also a
    // doc that the user does have access to.
    if (entity.docs && scope?.showRemoved && entity.docs.length === 0 &&
        !entity.removedAt)  { return true; }
    if (ignoreAccess) { return false; }
    if (entity.access === null) { return true; }
    if (!entity.accessOptions) { return false; }
    return entity.accessOptions.length === 0;
  }

  /**
   * Return a query builder to check if we have access to the given resource.
   * Tests the given permission-level access, defaulting to view permission.
   * @param resType: type of resource (table name)
   * @param userId: id of user accessing the resource
   * @param permissions: permission to test for - if null, we return the permissions
   */
  private _markIsPermitted(
    resType: 'orgs'|'workspaces'|'docs',
    users: AvailableUsers,
    accessStyle: AccessStyle,
    permissions: Permissions|null = Permissions.VIEW,
    variableNamePrefix?: string,
  ): (qb: SelectQueryBuilder<any>) => SelectQueryBuilder<any> {
    const idColumn = resType.slice(0, -1) + "_id";
    return qb => {
      const getBasicPermissions = (q: SelectQueryBuilder<any>) => {
        if (permissions !== null) {
          q = q.select('acl_rules.permissions');
        } else {
          const everyoneId = this._usersManager.getSpecialUserId(EVERYONE_EMAIL);
          const anonId = this._usersManager.getSpecialUserId(ANONYMOUS_USER_EMAIL);
          // Overall permissions are the bitwise-or of all individual
          // permissions from ACL rules.  We also include
          // Permissions.PUBLIC if any of the ACL rules are for the
          // public (shared with everyone@ or anon@).  This could be
          // optimized if we eliminate one of those users.  The guN
          // aliases are joining in _getUsersAcls, and refer to the
          // group_users table at different levels of nesting.

          // When listing, everyone@ shares do not contribute to access permissions,
          // only to the public flag.  So resources available to the user only because
          // they are publically available will not be listed.  Shares with anon@,
          // on the other hand, *are* listed.

          // At this point, we have user ids available for a group associated with the acl
          // rule, or a subgroup of that group, of a subgroup of that group, or a subgroup
          // of that group (this is enough nesting to support docs in workspaces in orgs,
          // with one level of nesting held for future use).
          const userIdCols = ['gu0.user_id', 'gu1.user_id', 'gu2.user_id', 'gu3.user_id'];

          // If any of the user ids is public (everyone@, anon@), we set the PUBLIC flag.
          // This is only advisory, for display in the client - it plays no role in access
          // control.
          const publicFlagSql = `case when ` +
            hasAtLeastOneOfTheseIds(this._dbType, [everyoneId, anonId], userIdCols) +
            ` then ${Permissions.PUBLIC} else 0 end`;

          // The contribution made by the acl rule to overall user permission is contained
          // in acl_rules.permissions. BUT if we are listing resources, we discount the
          // permission contribution if it is only made with everyone@, and not anon@
          // or any of the ids associated with the user. The resource may end up being
          // accessible but unlisted for this user.
          const contributionSql = accessStyle !== 'list' ? 'acl_rules.permissions' :
            `case when ` +
            hasOnlyTheseIdsOrNull(this._dbType, [everyoneId], userIdCols) +
            ` then 0 else acl_rules.permissions end`;

          // Finally, if all users are null, the resource is being viewed by the special
          // previewer user.
          const previewerSql = `case when coalesce(${userIdCols.join(',')}) is null` +
            ` then acl_rules.permissions else 0 end`;

          q = q.select(
            bitOr(this._dbType, `(${publicFlagSql} | ${contributionSql} | ${previewerSql})`, 8),
            'permissions'
          );
        }
        q = q.from('acl_rules', 'acl_rules');
        q = this._getUsersAcls(q, users, accessStyle, variableNamePrefix);
        q = q.andWhere(`acl_rules.${idColumn} = ${resType}.id`);
        if (permissions !== null) {
          q = q.andWhere(`(acl_rules.permissions & :permissions) = :permissions`, {permissions}).limit(1);
        } else if (!UsersManager.isSingleUser(users)) {
          q = q.addSelect('profiles.id');
          q = q.addSelect('profiles.display_email');
          q = q.addSelect('profiles.name');
          // anything we select without aggregating, we must also group by (postgres is fussy
          // about this)
          q = q.groupBy('profiles.id');
          q = q.addGroupBy('profiles.display_email');
          q = q.addGroupBy('profiles.name');
        }
        return q;
      };
      if (UsersManager.isSingleUser(users)) {
        return getBasicPermissions(qb.subQuery());
      } else {
        return qb.subQuery()
          .from(subQb => getBasicPermissions(subQb.subQuery()), 'options')
          .select(this._aggJsonObject({id: 'options.id',
                                       email: 'options.display_email',
                                       perms: 'options.permissions',
                                       name: 'options.name'}));
      }
    };
  }

  // Takes a query that includes acl_rules, and filters for just those acl_rules that apply
  // to the user, either directly or via up to three layers of nested groups.  Two layers are
  // sufficient for our current ACL setup.  A third is added as a low-cost preparation
  // for implementing something like teams in the future.  It has no measurable effect on
  // speed.
  private _getUsersAcls(qb: SelectQueryBuilder<any>, users: AvailableUsers,
                        accessStyle: AccessStyle, variableNamePrefix: string = 'acls') {
    // Every acl_rule is associated with a single group.  A user may
    // be a direct member of that group, via the group_users table.
    // Or they may be a member of a group that is a member of that
    // group, via group_groups.  Or they may be even more steps
    // removed.  We unroll to a fixed number of steps, and use joins
    // rather than a recursive query, since we need this step to be as
    // fast as possible.
    const userIdVariable = `${variableNamePrefix}UserId`;
    const permissionsVariable = `${variableNamePrefix}Permissions`;
    qb = qb
      // filter for the specified user being a direct or indirect member of the acl_rule's group
      .where(new Brackets(cond => {
        if (UsersManager.isSingleUser(users)) {
          // Users is an integer, so ok to insert into sql.  It we
          // didn't, we'd need to use distinct parameter names, since
          // we may include this code with different user ids in the
          // same query
          cond = cond.where(`:${userIdVariable} IN (gu0.user_id, gu1.user_id, gu2.user_id, gu3.user_id)`,
                            {[userIdVariable]: users});
          // Support public access via the special "everyone" user, except for 'openStrict' mode.
          if (accessStyle !== 'openNoPublic') {
            const everyoneId = this._usersManager.getEveryoneUserId();
            cond = cond.orWhere(`${everyoneId} IN (gu0.user_id, gu1.user_id, gu2.user_id, gu3.user_id)`);
          }
          if (accessStyle === 'list') {
            // Support also the special anonymous user.  Currently, by convention, sharing a
            // resource with anonymous should make it listable.
            const anonId = this._usersManager.getAnonymousUserId();
            cond = cond.orWhere(`${anonId} IN (gu0.user_id, gu1.user_id, gu2.user_id, gu3.user_id)`);
          }

          // Add an exception for the previewer user, if present.
          const previewerId = this._usersManager.getSpecialUserId(PREVIEWER_EMAIL);
          if (users === previewerId) {
            // All acl_rules granting view access are available to previewer user.
            cond = cond.orWhere(`acl_rules.permissions = :${permissionsVariable}`,
                                {[permissionsVariable]: Permissions.VIEW});
          }
        } else {
          cond = cond.where(`profiles.id IN (gu0.user_id, gu1.user_id, gu2.user_id, gu3.user_id)`);
        }
        return cond;
      }));
    if (!UsersManager.isSingleUser(users)) {
      // We need to join against a list of users.
      const emails = new Set(users.map(profile => normalizeEmail(profile.email)));
      if (emails.size > 0) {
        // the 1 = 1 on clause seems the shortest portable way to do a cross join in postgres
        // and sqlite via typeorm.
        qb = qb.leftJoin('(select users.id, display_email, email, name from users inner join logins ' +
                         'on users.id = logins.user_id where logins.email in (:...emails))',
                         'profiles', '1 = 1');
        qb = qb.setParameter('emails', [...emails]);
      } else {
        // Add a dummy user with id 0, for simplicity.  This user will
        // not match any group.  The casts are needed for a postgres 9.5 issue
        // where type inference fails (we use 9.5 on jenkins).
        qb = qb.leftJoin(`(select 0 as id, cast('none' as text) as display_email, ` +
                         `cast('none' as text) as email, cast('none' as text) as name)`,
                         'profiles', '1 = 1');
      }
    }
    // join the relevant groups and subgroups
    return this._joinToAllGroupUsers(qb);
  }

  private async _getDocsInheritingFrom(manager: EntityManager, options: {orgId: number} | {wsId: number}) {
    const queryBuilder = manager.createQueryBuilder()
      .from(Document, 'docs')
      .leftJoinAndSelect('docs.aclRules', 'acl_rules')
      .leftJoin('group_groups', 'gg1', 'gg1.group_id = acl_rules.group_id')
      .leftJoin('group_groups', 'gg2', 'gg2.group_id = gg1.subgroup_id')
      .leftJoin('group_groups', 'gg3', 'gg3.group_id = gg2.subgroup_id')
      .innerJoin('acl_rules', 'rules', 'rules.group_id in (gg1.subgroup_id, gg2.subgroup_id, gg3.subgroup_id)')
      .chain(qb => (
        'orgId' in options ? qb.where('rules.org_id = :orgId', {orgId: options.orgId}) :
        'wsId' in options ? qb.where('rules.workspace_id = :wsId', {wsId: options.wsId}) :
        qb
      ))
      .select('docs.id', 'docId')
      .distinct(true);
    const result = await queryBuilder.getRawMany();
    return result.map(r => r.docId);
  }

  // Takes a query that includes 'acl_rules' and joins it to all group_users records that are
  // connected to it directly or via subgroups.
  // Public for limited use by extensions of HomeDBManager in some flavors of Grist.
  // eslint-disable-next-line @typescript-eslint/member-ordering
  public _joinToAllGroupUsers<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>): SelectQueryBuilder<T> {
    return qb
      .leftJoin('group_groups', 'gg1', 'gg1.group_id = acl_rules.group_id')
      .leftJoin('group_groups', 'gg2', 'gg2.group_id = gg1.subgroup_id')
      .leftJoin('group_groups', 'gg3', 'gg3.group_id = gg2.subgroup_id')
      // join the users in the relevant groups and subgroups.
      .leftJoin('group_users', 'gu3', 'gg3.subgroup_id = gu3.group_id')
      .leftJoin('group_users', 'gu2', 'gg2.subgroup_id = gu2.group_id')
      .leftJoin('group_users', 'gu1', 'gg1.subgroup_id = gu1.group_id')
      .leftJoin('group_users', 'gu0', 'acl_rules.group_id = gu0.group_id');
  }

  // Apply limits to the query.  Results should be limited to a specific org
  // if request is from a branded webpage; results should be limited to a
  // specific user or set of users.
  private _applyLimit<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, limit: Scope,
                         resources: Array<'docs'|'workspaces'|'orgs'>,
                         accessStyle: AccessStyle): SelectQueryBuilder<T> {
    if (limit.org) {
      // Filtering on merged org is a special case, see urlIdQuery
      const mergedOrg = this.isMergedOrg(limit.org || null);
      if (!mergedOrg) {
        qb = this._whereOrg(qb, limit.org, limit.includeSupport || false);
      }
    }
    if (limit.users || limit.userId) {
      for (const res of resources) {
        qb = this._withAccess(qb, limit.users || limit.userId, res, accessStyle, 'limit');
      }
    }
    if (resources.includes('docs') && resources.includes('workspaces') && !limit.showAll) {
      // Add Workspace.filteredOut column that is set for workspaces that should be filtered out.
      // We don't use a WHERE clause directly since this would leave us unable to distinguish
      // an empty result from insufficient access; and there's no straightforward way to do
      // what we want in an ON clause.
      // Filter out workspaces only if there are no docs in them (The "ON" clause from
      // _onDocs will have taken care of including the right docs).  If there are docs,
      // then include the workspace regardless of whether it itself has been soft-deleted
      // or not.
      // TODO: if getOrgWorkspaces and getWorkspace were restructured to make two queries
      // rather than a single query, this trickiness could be eliminated.
      if (limit.showRemoved) {
        qb = qb.addSelect('docs.id IS NULL AND workspaces.removed_at IS NULL',
                          'workspaces_filtered_out');
      } else {
        qb = qb.addSelect('docs.id IS NULL AND workspaces.removed_at IS NOT NULL',
                          'workspaces_filtered_out');
      }
    }
    return qb;
  }

  // Filter out all personal orgs, and add back in a single merged org.
  private _mergePersonalOrgs(userId: number, orgs: Organization[]): Organization[] {
    const regularOrgs = orgs.filter(org => org.owner === null);
    const personalOrg = orgs.find(org => org.owner && org.owner.id === userId);
    if (!personalOrg) { return regularOrgs; }
    personalOrg.id = 0;
    personalOrg.domain = this.mergedOrgDomain();
    return [personalOrg].concat(regularOrgs);
  }

  // Check if shares are about to exceed a limit, and emit a meaningful
  // ApiError if so.
  // If checkChange is set, issue an error only if a new share is being
  // made.
  private _restrictShares(role: roles.NonGuestRole|null, limit: number,
                          before: User[], after: User[], checkChange: boolean, kind: string,
                          features: Features) {
    const existingUserIds = new Set(before.map(user => user.id));
    // Do not emit error if users are not added, even if the number is past the limit.
    if (after.length > limit &&
        (!checkChange || after.some(user => !existingUserIds.has(user.id)))) {
      const more = limit > 0 ? ' more' : '';
      throw new ApiError(
        checkChange ? `No${more} external ${kind} ${role || 'shares'} permitted` :
          `Too many external ${kind} ${role || 'shares'}`,
        403, {
          limit: {
            quantity: 'collaborators',
            subquantity: role || undefined,
            maximum: limit,
            value: before.length,
            projectedValue: after.length
          },
          tips: canAddOrgMembers(features) ? [{
            action: 'add-members',
            message: 'add users as team members to the site first'
          }] : [{
            action: 'upgrade',
            message: 'pay for more team members'
          }]
        });
    }
  }

  // Check if document shares exceed any of the share limits, and emit a meaningful
  // ApiError if so.  If both membersBefore and membersAfter are specified, fail
  // only if a new share is being added, but otherwise don't complain even if limits
  // are exceeded.  If only membersBefore is specified, fail strictly if limits are
  // exceeded.
  private _restrictAllDocShares(features: Features,
                                nonOrgMembersBefore: Map<roles.NonGuestRole, User[]>,
                                nonOrgMembersAfter: Map<roles.NonGuestRole, User[]>,
                                checkChange: boolean = true) {
    // Apply a limit to document shares that is not specific to a particular role.
    if (features.maxSharesPerDoc !== undefined) {
      this._restrictShares(null, features.maxSharesPerDoc, removeRole(nonOrgMembersBefore),
                           removeRole(nonOrgMembersAfter), checkChange, 'document', features);
    }
    if (features.maxSharesPerDocPerRole) {
      for (const role of this.defaultBasicGroupNames) {
        const limit = features.maxSharesPerDocPerRole[role];
        if (limit === undefined) { continue; }
        // Apply a per-role limit to document shares.
        this._restrictShares(role, limit, nonOrgMembersBefore.get(role) || [],
                             nonOrgMembersAfter.get(role) || [], checkChange, 'document', features);
      }
    }
  }

  // Throw an error if there's no room for adding another document.
  private async _checkRoomForAnotherDoc(workspace: Workspace, manager: EntityManager) {
    const features = workspace.org.billingAccount.getFeatures();
    if (features.maxDocsPerOrg !== undefined) {
      // we need to count how many docs are in the current org, and if we
      // are already at or above the limit, then fail.
      const wss = this.unwrapQueryResult(await this.getOrgWorkspaces({userId: this._usersManager.getPreviewerUserId()},
                                                                     workspace.org.id,
                                                                     {manager}));
      const count = wss.map(ws => ws.docs.length).reduce((a, b) => a + b, 0);
      if (count >= features.maxDocsPerOrg) {
        throw new ApiError('No more documents permitted', 403, {
          limit: {
            quantity: 'docs',
            maximum: features.maxDocsPerOrg,
            value: count,
            projectedValue: count + 1
          }
        });
      }
    }
  }

  // For the moment only the support user can add both everyone@ and anon@ to a
  // resource, since that allows spam.  TODO: enhance or remove.
  private _checkUserChangeAllowed(userId: number, groups: Group[]) {
    return this._usersManager.checkUserChangeAllowed(userId, groups);
  }

  // Fetch a Document with all access information loaded.  Make sure the user has the
  // specified permissions on the doc.  The Document's organization will have product
  // feature information loaded also.
  private async _loadDocAccess(scope: DocScope, markPermissions: Permissions,
                               transaction?: EntityManager): Promise<Document> {
    return await this.runInTransaction(transaction, async manager => {

      const docQuery = this._doc(scope, {manager, markPermissions});
      const queryResult = await verifyEntity(docQuery);
      this.checkQueryResult(queryResult);
      const doc = getDocResult(queryResult);

      // Retrieve the doc's ACL rules and groups/users so we can edit them.
      // We do this as a separate query to avoid repeating the document
      // row (which can be particulary costly since the main document
      // query contains some non-trivial subqueries and postgres
      // will re-execute them for each repeated document row).
      const aclQuery = this._docs(manager)
      .where({ id: doc.id })
      .leftJoinAndSelect('docs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'doc_groups')
      .leftJoinAndSelect('doc_groups.memberUsers', 'doc_group_users')
      .leftJoinAndSelect('doc_groups.memberGroups', 'doc_group_groups')
      .leftJoinAndSelect('doc_group_users.logins', 'doc_user_logins');
      const aclDoc: Document = (await aclQuery.getOne())!;
      doc.aclRules = aclDoc.aclRules;

      // Load the workspace's member groups/users.
      const workspaceQuery = this._workspace(scope, doc.workspace.id, {manager})
      .leftJoinAndSelect('workspaces.aclRules', 'workspace_acl_rules')
      .leftJoinAndSelect('workspace_acl_rules.group', 'workspace_groups')
      .leftJoinAndSelect('workspace_groups.memberUsers', 'workspace_group_users')
      .leftJoinAndSelect('workspace_groups.memberGroups', 'workspace_group_groups')
      .leftJoinAndSelect('workspace_group_users.logins', 'workspace_user_logins')
      // We'll need the org as well. We will join its members as a separate query, since
      // SQL results are flattened, and multiplying the number of rows we have already
      // by the number of org users could get excessive.
      .leftJoinAndSelect('workspaces.org', 'org');
      doc.workspace = (await workspaceQuery.getOne())!;

      // Load the org's member groups/users.
      let orgQuery = this.org(scope, doc.workspace.org.id, {manager})
      .leftJoinAndSelect('orgs.aclRules', 'org_acl_rules')
      .leftJoinAndSelect('org_acl_rules.group', 'org_groups')
      .leftJoinAndSelect('org_groups.memberUsers', 'org_group_users')
      .leftJoinAndSelect('org_group_users.logins', 'org_user_logins');
      orgQuery = this._addFeatures(orgQuery);
      doc.workspace.org = (await orgQuery.getOne())!;
      return doc;
    });
  }

  // Emit an event indicating that the count of users with access to the org has changed, with
  // the customerId and the updated number of users.
  // The org argument must include the billingAccount.
  private _userChangeNotification(
    userId: number,
    org: Organization,       // Must include billingAccount
    countBefore: number,
    countAfter: number,
    membersBefore: Map<roles.NonGuestRole, User[]>,
    membersAfter: Map<roles.NonGuestRole, User[]>
  ) {
    return async () => {
      const customerId = org.billingAccount.stripeCustomerId;
      const change: UserChange = {userId, org, customerId,
                                  countBefore, countAfter,
                                  membersBefore, membersAfter};
      await this._notifier.userChange(change);
    };
  }

  // Create a notification function that emits an event when users may have been added to a resource.
  private _inviteNotification(userId: number, resource: Organization|Workspace|Document,
                              userIdDelta: UserIdDelta, membersBefore: Map<roles.NonGuestRole,
                              User[]>): () => Promise<void> {
    return async () => {
      await this._notifier.addUser(userId, resource, userIdDelta, membersBefore);
    };
  }

  private _billingManagerNotification(userId: number, addUserId: number, orgs: Organization[]) {
    return async () => {
      await this._notifier.addBillingManager(userId, addUserId, orgs);
    };
  }

  private _teamCreatorNotification(userId: number) {
    return async () => {
      await this._notifier.teamCreator(userId);
    };
  }

  private _streamingDestinationsChange(orgId?: number) {
    return async () => {
      await this._notifier.streamingDestinationsChange(orgId || null);
    };
  }

  // Set Workspace.removedAt to null (undeletion) or to a datetime (soft deletion)
  private _setWorkspaceRemovedAt(scope: Scope, wsId: number, removedAt: Date|null) {
    return this._connection.transaction(async manager => {
      const wsQuery = this._workspace({...scope, showAll: true}, wsId, {
        manager,
        markPermissions: Permissions.REMOVE
      })
      .leftJoinAndSelect('workspaces.org', 'orgs');
      const workspace: Workspace = this.unwrapQueryResult(await verifyEntity(wsQuery));
      workspace.removedAt = removedAt;
      await manager.createQueryBuilder()
        .update(Workspace).set({removedAt}).where({id: workspace.id})
        .execute();

      // Update the guests in the org after soft-deleting/undeleting this workspace.
      await this._repairOrgGuests(scope, workspace.org.id, manager);

      return {status: 200, data: workspace};
    });
  }

  // Set Document.removedAt to null (undeletion) or to a datetime (soft deletion)
  private _setDocumentRemovedAt(scope: DocScope, removedAt: Date|null) {
    return this._setDocumentDeletionProperty(scope, 'removedAt', removedAt);
  }

  private _setDocumentDisabledAt(scope: DocScope, removedAt: Date|null) {
    return this._setDocumentDeletionProperty(scope, 'disabledAt', removedAt);
  }

  private _setDocumentDeletionProperty(scope: DocScope, property: 'removedAt'|'disabledAt', value: Date|null) {
    return this._connection.transaction(async manager => {
      let docQuery = this._doc({...scope, showAll: true}, {
        manager,
        markPermissions: Permissions.SCHEMA_EDIT | Permissions.REMOVE,
        allowSpecialPermit: true
      });
      if (!value) {
        docQuery = this._addFeatures(docQuery);  // pull in billing information for doc count limits
      }
      const doc: Document = this.unwrapQueryResult(await verifyEntity(docQuery));
      if (!value) {
        await this._checkRoomForAnotherDoc(doc.workspace, manager);
      }
      doc[property] = value;
      await manager.createQueryBuilder()
        .update(Document).set({[property]: value}).where({id: doc.id})
        .execute();

      // Update guests of the workspace and org after soft-deleting/undeleting this doc.
      await this._repairWorkspaceGuests(scope, doc.workspace.id, manager);
      await this._repairOrgGuests(scope, doc.workspace.org.id, manager);

      return {status: 200, data: doc};
    });
  }

  private _filterAccessData(
    scope: Scope,
    users: UserAccessData[],
    maxInheritedRole: roles.BasicRole|null,
    docId?: string
  ): {personal: true, public: boolean}|undefined {
    if (scope.userId === this._usersManager.getPreviewerUserId()) { return; }

    // If we have special access to the resource, don't filter user information.
    if (scope.specialPermit?.docId === docId && docId) { return; }

    const thisUser = this._usersManager.getAnonymousUserId() === scope.userId
      ? null
      : users.find(user => user.id === scope.userId);
    const realAccess = thisUser ? getRealAccess(thisUser, {maxInheritedRole}) : null;

    // If we are an owner, don't filter user information.
    if (thisUser && realAccess === 'owners') { return; }

    // Limit user information returned to being about the current user.
    users.length = 0;
    if (thisUser) { users.push(thisUser); }
    return { personal: true, public: !realAccess };
  }

  private _buildWorkspaceWithACLRules(scope: Scope, wsId: number, options: Partial<QueryOptions> = {}) {
    return this._workspace(scope, wsId, {
      ...options
    })
    // Join the workspace's ACL rules (with 1st level groups/users listed).
    .leftJoinAndSelect('workspaces.aclRules', 'acl_rules')
    .leftJoinAndSelect('acl_rules.group', 'workspace_groups')
    .leftJoinAndSelect('workspace_groups.memberUsers', 'workspace_group_users')
    .leftJoinAndSelect('workspace_groups.memberGroups', 'workspace_group_groups')
    .leftJoinAndSelect('workspace_group_users.logins', 'workspace_user_logins')
    .leftJoinAndSelect('workspaces.org', 'org');
  }

  private _getWorkspaceWithACLRules(scope: Scope, wsId: number, options: Partial<QueryOptions> = {}) {
    const query = this._buildWorkspaceWithACLRules(scope, wsId, {
      markPermissions: Permissions.VIEW,
      ...options
    });
    return verifyEntity(query);
  }

  private _buildOrgWithACLRulesQuery(scope: Scope, org: number|string, opts: Partial<QueryOptions> = {}) {
    return this.org(scope, org, {
      needRealOrg: true,
      ...opts
    })
      // Join the org's ACL rules (with 1st level groups/users listed).
      .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'org_groups')
      .leftJoinAndSelect('org_groups.memberUsers', 'org_member_users')
      .leftJoinAndSelect('org_member_users.logins', 'user_logins');
  }

  private _getOrgWithACLRules(scope: Scope, org: number|string) {
    const orgQuery = this._buildOrgWithACLRulesQuery(scope, org, {
      markPermissions: Permissions.VIEW,
      allowSpecialPermit: true,
    });
    return verifyEntity(orgQuery);
  }
}

// Return a QueryResult reflecting the output of a query builder.
// Checks on the "is_permitted" field which select queries set on resources to
// indicate whether the user has access.
//
// If the output is empty, we signal that the desired resource does not exist.
//
// If we retrieve more than 1 entity, we signal that the request is ambiguous.
//
// If the "is_permitted" field is falsy, we signal that the resource is forbidden,
// unless skipPermissionCheck is set.
//
// Returns the resource fetched by the queryBuilder.
async function verifyEntity(
  queryBuilder: SelectQueryBuilder<any>,
  options: { skipPermissionCheck?: boolean } = {}
): Promise<QueryResult<any>> {
  if (Deps.usePreparedStatements) {
    const sql = queryBuilder.getSql();
    maybePrepareStatement(sql);
  }
  const results = await queryBuilder.getRawAndEntities();
  if (results.entities.length === 0) {
    return {
      status: 404,
      errMessage: `${getFrom(queryBuilder)} not found`
    };
  } else if (results.entities.length > 1) {
    return {
      status: 400,
      errMessage: `ambiguous ${getFrom(queryBuilder)} request`
    };
  } else if (!options.skipPermissionCheck && !results.raw[0].is_permitted) {
    return {
      status: 403,
      errMessage: "access denied"
    };
  }
  return {
    status: 200,
    data: results.entities[0]
  };
}

// Extract a human-readable name for the type of entity being selected.
function getFrom(queryBuilder: SelectQueryBuilder<any>): string {
  const alias = queryBuilder.expressionMap.mainAlias;
  const name = (alias && alias.metadata && alias.metadata.name.toLowerCase()) || 'resource';
  if (name === 'filtereddocument') { return 'document'; }
  return name;
}

// Flatten a map of users per role into a simple list of users.
export function removeRole(usersWithRoles: Map<roles.NonGuestRole, User[]>) {
  return flatten([...usersWithRoles.values()]);
}

export async function makeDocAuthResult(docPromise: Promise<Document>): Promise<DocAuthResult> {
  try {
    const doc = await docPromise;
    const removed = Boolean(doc.removedAt || doc.workspace.removedAt);
    const disabled = Boolean(doc.disabledAt);
    return {docId: doc.id, access: doc.access, removed, disabled, cachedDoc: doc};
  } catch (error) {
    return {docId: null, access: null, removed: null, disabled: null, error};
  }
}

/**
 * Extracts DocAuthKey information from scope.  This includes everything needed to
 * identify the document to access.  Throws if information is not present.
 */
export function getDocAuthKeyFromScope(scope: Scope): DocAuthKey {
  const {urlId, userId, org} = scope;
  if (!urlId) { throw new Error('document required'); }
  return {urlId, userId, org};
}

// Returns whether the given group is a valid non-guest group.
function isNonGuestGroup(group: Group): group is NonGuestGroup {
  return roles.isNonGuestRole(group.name);
}

function getNonGuestGroups(entity: Organization|Workspace|Document): NonGuestGroup[] {
  return (entity.aclRules as AclRule[]).map(aclRule => aclRule.group).filter(isNonGuestGroup);
}

function getUserAccessChanges({
  users,
  userIdDelta,
}: {
  users: User[];
  userIdDelta: UserIdDelta | null;
}) {
  if (
    !userIdDelta ||
    Object.keys(userIdDelta).length === 0 ||
    users.length === 0
  ) {
    return undefined;
  }

  return users.map((user) => ({
    ...pick(user, "id", "name"),
    email: user.loginEmail,
    access: userIdDelta[user.id],
  }));
}

/**
 * Extract a Document from a query result that is expected to
 * contain one. If it is a FilteredDocument, reset the prototype
 * to be Document - that class is just a tiny variant of Document
 * with a different alias for use with CTEs as a hack around
 * some TypeORM limitations.
 * CAUTION: this modifies material in the queryResult.
 */
function getDocResult(queryResult: QueryResult<any>) {
  const doc: Document = queryResult.data;
  // The result may be a Document or a FilteredDocument,
  // For our purposes they are the same.
  if (Object.getPrototypeOf(doc) === FilteredDocument.prototype) {
    Object.setPrototypeOf(doc, Document.prototype);
  }
  return doc;
}

function patch<T extends object>(obj: T, ...patches: Partial<T>[]): T {
  return Object.assign(obj, ...patches);
}
