import {ShareInfo} from 'app/common/ActiveDocAPI';
import {ApiError, LimitType} from 'app/common/ApiError';
import {mapGetOrSet, mapSetOrClear, MapWithTTL} from 'app/common/AsyncCreate';
import {getDataLimitStatus} from 'app/common/DocLimits';
import {createEmptyOrgUsageSummary, DocumentUsage, OrgUsageSummary} from 'app/common/DocUsage';
import {normalizeEmail} from 'app/common/emails';
import {canAddOrgMembers, Features} from 'app/common/Features';
import {buildUrlId, MIN_URLID_PREFIX_LENGTH, parseUrlId} from 'app/common/gristUrls';
import {FullUser, UserProfile} from 'app/common/LoginSessionAPI';
import {checkSubdomainValidity} from 'app/common/orgNameUtils';
import {UserOrgPrefs} from 'app/common/Prefs';
import * as roles from 'app/common/roles';
import {StringUnion} from 'app/common/StringUnion';
import {
  ANONYMOUS_USER_EMAIL,
  DocumentProperties,
  EVERYONE_EMAIL,
  getRealAccess,
  ManagerDelta,
  NEW_DOCUMENT_CODE,
  OrganizationProperties,
  Organization as OrgInfo,
  PermissionData,
  PermissionDelta,
  UserAccessData,
  UserOptions,
  WorkspaceProperties
} from "app/common/UserAPI";
import {AclRule, AclRuleDoc, AclRuleOrg, AclRuleWs} from "app/gen-server/entity/AclRule";
import {Alias} from "app/gen-server/entity/Alias";
import {BillingAccount} from "app/gen-server/entity/BillingAccount";
import {BillingAccountManager} from "app/gen-server/entity/BillingAccountManager";
import {Document} from "app/gen-server/entity/Document";
import {Group} from "app/gen-server/entity/Group";
import {Login} from "app/gen-server/entity/Login";
import {AccessOption, AccessOptionWithRole, Organization} from "app/gen-server/entity/Organization";
import {Pref} from "app/gen-server/entity/Pref";
import {getDefaultProductNames, personalFreeFeatures, Product} from "app/gen-server/entity/Product";
import {Secret} from "app/gen-server/entity/Secret";
import {Share} from "app/gen-server/entity/Share";
import {User} from "app/gen-server/entity/User";
import {Workspace} from "app/gen-server/entity/Workspace";
import {Limit} from 'app/gen-server/entity/Limit';
import {Permissions} from 'app/gen-server/lib/Permissions';
import {scrubUserFromOrg} from "app/gen-server/lib/scrubUserFromOrg";
import {applyPatch} from 'app/gen-server/lib/TypeORMPatches';
import {
  bitOr,
  getRawAndEntities,
  hasAtLeastOneOfTheseIds,
  hasOnlyTheseIdsOrNull,
  now,
  readJson
} from 'app/gen-server/sqlUtils';
import {appSettings} from 'app/server/lib/AppSettings';
import {getOrCreateConnection} from 'app/server/lib/dbUtils';
import {makeId} from 'app/server/lib/idUtils';
import log from 'app/server/lib/log';
import {Permit} from 'app/server/lib/Permit';
import {getScope} from 'app/server/lib/requestUtils';
import {WebHookSecret} from "app/server/lib/Triggers";
import {EventEmitter} from 'events';
import {Request} from "express";
import {
  Brackets,
  Connection,
  DatabaseType,
  EntityManager,
  SelectQueryBuilder,
  WhereExpression
} from "typeorm";
import uuidv4 from "uuid/v4";
import flatten = require('lodash/flatten');
import pick = require('lodash/pick');

// Support transactions in Sqlite in async code.  This is a monkey patch, affecting
// the prototypes of various TypeORM classes.
// TODO: remove this patch if the issue is ever accepted as a problem in TypeORM and
// fixed.  See https://github.com/typeorm/typeorm/issues/1884#issuecomment-380767213
applyPatch();

export const NotifierEvents = StringUnion(
  'addUser',
  'userChange',
  'firstLogin',
  'addBillingManager',
  'teamCreator',
  'trialPeriodEndingSoon',
  'trialingSubscription',
  'scheduledCall',
);

export type NotifierEvent = typeof NotifierEvents.type;

// Nominal email address of a user who can view anything (for thumbnails).
export const PREVIEWER_EMAIL = 'thumbnail@getgrist.com';

// A special user allowed to add/remove the EVERYONE_EMAIL to/from a resource.
export const SUPPORT_EMAIL = appSettings.section('access').flag('supportEmail').requireString({
  envVar: 'GRIST_SUPPORT_EMAIL',
  defaultValue: 'support@getgrist.com',
});

// A list of emails we don't expect to see logins for.
const NON_LOGIN_EMAILS = [PREVIEWER_EMAIL, EVERYONE_EMAIL, ANONYMOUS_USER_EMAIL];

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
const DOC_AUTH_CACHE_TTL = 5000;

type Resource = Organization|Workspace|Document;

export interface QueryResult<T> {
  status: number;
  data?: T;
  errMessage?: string;
}

// Maps from userId to group name, or null to inherit.
export interface UserIdDelta {
  [userId: string]: roles.NonGuestRole|null;
}

// A collection of fun facts derived from a PermissionDelta (used to describe
// a change of users) and a user.
export interface PermissionDeltaAnalysis {
  userIdDelta: UserIdDelta | null;   // New roles for users, indexed by user id.
  permissionThreshold: Permissions;  // The permissions needed to make the change.
                                     // Usually Permissions.ACL_EDIT, but
                                     // Permissions.ACL_VIEW is enough for a user
                                     // to removed themselves.
  affectsSelf: boolean;              // Flags if the user making the change would
                                     // be affected by the change.
}

// Options for certain create query helpers private to this file.
interface QueryOptions {
  manager?: EntityManager;
  markPermissions?: Permissions;
  needRealOrg?: boolean;  // Set if pseudo-org should be collapsed to user's personal org
  allowSpecialPermit?: boolean;  // Set if specialPermit in Scope object should be respected,
                                 // potentially overriding markPermissions.
}

interface GroupDescriptor {
  readonly name: roles.Role;
  readonly permissions: number;
  readonly nestParent: boolean;
  readonly orgOnly?: boolean;
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

// A specification of the users available during a request.  This can be a single
// user, identified by a user id, or a collection of profiles (typically drawn from
// the session).
type AvailableUsers = number | UserProfile[];

// A type guard to check for single-user case.
function isSingleUser(users: AvailableUsers): users is number {
  return typeof users === 'number';
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
  showOnlyPinned?: boolean;      // When set, query is scoped only to pinned docs.
  showAll?: boolean;             // When set, return both removed and regular resources.
  specialPermit?: Permit;        // When set, extra rights are granted on a specific resource.
}

// Flag for whether we are listing resources or opening them.  This makes a difference
// for public resources, which we allow users to open but not necessarily list.
type AccessStyle = 'list' | 'open';

// A Scope for documents, with mandatory urlId.
export interface DocScope extends Scope {
  urlId: string;
}

type NonGuestGroup = Group & { name: roles.NonGuestRole };

// Returns whether the given group is a valid non-guest group.
function isNonGuestGroup(group: Group): group is NonGuestGroup {
  return roles.isNonGuestRole(group.name);
}

export interface UserProfileChange {
  name?: string;
  isFirstTimeUser?: boolean;
}

// Identifies a request to access a document. This combination of values is also used for caching
// DocAuthResult for DOC_AUTH_CACHE_TTL.  Other request scope information is passed along.
export interface DocAuthKey {
  urlId: string;              // May be docId. Must be unambiguous in the context of the org.
  userId: number;             // The user accessing this doc. (Could be the ID of Anonymous.)
  org?: string;               // Undefined if unknown (e.g. in API calls, but needs unique urlId).
}

// Document auth info. This is the minimum needed to resolve user access checks. For anything else
// (e.g. doc title), the uncached getDoc() call should be used.
export interface DocAuthResult {
  docId: string|null;         // The unique identifier of the document. Null on error.
  access: roles.Role|null;    // The access level for the requesting user. Null on error.
  removed: boolean|null;      // Set if the doc is soft-deleted. Users may still have access
                              // to removed documents for some purposes. Null on error.
  error?: ApiError;
  cachedDoc?: Document;       // For cases where stale info is ok.
}

interface GetUserOptions {
  manager?: EntityManager;
  profile?: UserProfile;
  userOptions?: UserOptions;
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
 */
export type BillingOptions = Partial<Pick<BillingAccount,
  'product' |
  'stripeCustomerId' |
  'stripeSubscriptionId' |
  'stripePlanId' |
  'externalId' |
  'externalOptions' |
  'inGoodStanding' |
  'status'
>>;

/**
 * HomeDBManager handles interaction between the ApiServer and the Home database,
 * encapsulating the typeorm logic.
 */
export class HomeDBManager extends EventEmitter {
  private _connection: Connection;
  private _dbType: DatabaseType;
  private _specialUserIds: {[name: string]: number} = {};  // id for anonymous user, previewer, etc
  private _exampleWorkspaceId: number;
  private _exampleOrgId: number;
  private _idPrefix: string = "";  // Place this before ids in subdomains, used in routing to
                                   // deployments on same subdomain.

  private _docAuthCache = new MapWithTTL<string, Promise<DocAuthResult>>(DOC_AUTH_CACHE_TTL);
  // In restricted mode, documents should be read-only.
  private _restrictedMode: boolean = false;


  /**
   * Five aclRules, each with one group (with the names 'owners', 'editors', 'viewers',
   * 'guests', and 'members') are created by default on every new entity (Organization,
   * Workspace, Document). These special groups are documented in the _defaultGroups
   * constant below.
   *
   * When a child resource is created under a parent (i.e. when a new Workspace is created
   * under an Organization), special groups with a truthy 'nestParent' property are set up
   * to include in their memberGroups a single group on initialization - the parent's
   * corresponding special group. Special groups with a falsy 'nextParent' property are
   * empty on intialization.
   *
   * NOTE: The groups are ordered from most to least permissive, and should remain that way.
   * TODO: app/common/roles already contains an ordering of the default roles. Usage should
   * be consolidated.
   */
  private readonly _defaultGroups: GroupDescriptor[] = [{
    name: roles.OWNER,
    permissions: Permissions.OWNER,
    nestParent: true
  }, {
    name: roles.EDITOR,
    permissions: Permissions.EDITOR,
    nestParent: true
  }, {
    name: roles.VIEWER,
    permissions: Permissions.VIEW,
    nestParent: true
  }, {
    name: roles.GUEST,
    permissions: Permissions.VIEW,
    nestParent: false
  }, {
    name: roles.MEMBER,
    permissions: Permissions.VIEW,
    nestParent: false,
    orgOnly: true
  }];

  public emit(event: NotifierEvent, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }

  // All groups.
  public get defaultGroups(): GroupDescriptor[] {
    return this._defaultGroups;
  }

  // Groups whose permissions are inherited from parent resource to child resources.
  public get defaultBasicGroups(): GroupDescriptor[] {
    return this._defaultGroups
      .filter(_grpDesc => _grpDesc.nestParent);
  }

  // Groups that are common to all resources.
  public get defaultCommonGroups(): GroupDescriptor[] {
    return this._defaultGroups
      .filter(_grpDesc => !_grpDesc.orgOnly);
  }

  public get defaultGroupNames(): roles.Role[] {
    return this._defaultGroups.map(_grpDesc => _grpDesc.name);
  }

  public get defaultBasicGroupNames(): roles.BasicRole[] {
    return this.defaultBasicGroups
      .map(_grpDesc => _grpDesc.name) as roles.BasicRole[];
  }

  public get defaultNonGuestGroupNames(): roles.NonGuestRole[] {
    return this._defaultGroups
      .filter(_grpDesc => _grpDesc.name !== roles.GUEST)
      .map(_grpDesc => _grpDesc.name) as roles.NonGuestRole[];
  }

  public get defaultCommonGroupNames(): roles.NonMemberRole[] {
    return this.defaultCommonGroups
      .map(_grpDesc => _grpDesc.name) as roles.NonMemberRole[];
  }

  public setPrefix(prefix: string) {
    this._idPrefix = prefix;
  }

  public setRestrictedMode(restricted: boolean) {
    this._restrictedMode = restricted;
  }

  public async connect(): Promise<void> {
    this._connection = await getOrCreateConnection();
    this._dbType = this._connection.driver.options.type;
  }

  // make sure special users and workspaces are available
  public async initializeSpecialIds(options?: {
    skipWorkspaces?: boolean  // if set, skip setting example workspace.
  }): Promise<void> {
    await this._getSpecialUserId({
      email: ANONYMOUS_USER_EMAIL,
      name: "Anonymous"
    });
    await this._getSpecialUserId({
      email: PREVIEWER_EMAIL,
      name: "Preview"
    });
    await this._getSpecialUserId({
      email: EVERYONE_EMAIL,
      name: "Everyone"
    });
    await this._getSpecialUserId({
      email: SUPPORT_EMAIL,
      name: "Support"
    });

    if (!options?.skipWorkspaces) {
      // Find the example workspace.  If there isn't one named just right, take the first workspace
      // belonging to the support user.  This shouldn't happen in deployments but could happen
      // in tests.
      // TODO: it should now be possible to remove all this; the only remaining
      // issue is what workspace to associate with documents created by
      // anonymous users.
      const supportWorkspaces = await this._workspaces()
        .leftJoinAndSelect('workspaces.org', 'orgs')
        .where('orgs.owner_id = :userId', { userId: this.getSupportUserId() })
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
   * Clear all user preferences associated with the given email addresses.
   * For use in tests.
   */
  public async testClearUserPrefs(emails: string[]) {
    return await this._connection.transaction(async manager => {
      for (const email of emails) {
        const user = await this.getUserByLogin(email, {manager});
        if (user) {
          await manager.delete(Pref, {userId: user.id});
        }
      }
    });
  }

  public async getUserByKey(apiKey: string): Promise<User|undefined> {
    // Include logins relation for Authorization convenience.
    return await User.findOne({where: {apiKey}, relations: ["logins"]}) || undefined;
  }

  public async getUserByRef(ref: string): Promise<User|undefined> {
    return await User.findOne({where: {ref}, relations: ["logins"]}) || undefined;
  }

  public async getUser(
    userId: number,
    options: {includePrefs?: boolean} = {}
  ): Promise<User|undefined> {
    const {includePrefs} = options;
    const relations = ["logins"];
    if (includePrefs) { relations.push("prefs"); }
    return await User.findOne({where: {id: userId}, relations}) || undefined;
  }

  public async getFullUser(userId: number): Promise<FullUser> {
    const user = await User.findOne({where: {id: userId}, relations: ["logins"]});
    if (!user) { throw new ApiError("unable to find user", 400); }
    return this.makeFullUser(user);
  }

  /**
   * Convert a user record into the format specified in api.
   */
  public makeFullUser(user: User): FullUser {
    if (!user.logins?.[0]?.displayEmail) {
      throw new ApiError("unable to find mandatory user email", 400);
    }
    const displayEmail = user.logins[0].displayEmail;
    const loginEmail = user.loginEmail;
    const result: FullUser = {
      id: user.id,
      email: displayEmail,
      // Only include loginEmail when it's different, to avoid overhead when FullUser is sent
      // around, and also to avoid updating too many tests.
      loginEmail: loginEmail !== displayEmail ? loginEmail : undefined,
      name: user.name,
      picture: user.picture,
      ref: user.ref,
      locale: user.options?.locale,
      prefs: user.prefs?.find((p)=> p.orgId === null)?.prefs,
    };
    if (this.getAnonymousUserId() === user.id) {
      result.anonymous = true;
    }
    if (this.getSupportUserId() === user.id) {
      result.isSupport = true;
    }
    return result;
  }

  /**
   * Ensures that user with external id exists and updates its profile and email if necessary.
   *
   * @param profile External profile
   */
  public async ensureExternalUser(profile: UserProfile) {
    await this._connection.transaction(async manager => {
      // First find user by the connectId from the profile
      const existing = await manager.findOne(User, {
        where: {connectId: profile.connectId || undefined},
        relations: ["logins"],
      });

      // If a user does not exist, create it with data from the external profile.
      if (!existing) {
        const newUser = await this.getUserByLoginWithRetry(profile.email, {
          profile,
          manager
        });
        if (!newUser) {
          throw new ApiError("Unable to create user", 500);
        }
        // No need to survey this user.
        newUser.isFirstTimeUser = false;
        await newUser.save();
      } else {
        // Else update profile and login information from external profile.
        let updated = false;
        let login: Login = existing.logins[0]!;
        const properEmail = normalizeEmail(profile.email);

        if (properEmail !== existing.loginEmail) {
          login = login ?? new Login();
          login.email = properEmail;
          login.displayEmail = profile.email;
          existing.logins.splice(0, 1, login);
          login.user = existing;
          updated = true;
        }

        if (profile?.name && profile?.name !== existing.name) {
          existing.name = profile.name;
          updated = true;
        }

        if (profile?.picture && profile?.picture !== existing.picture) {
          existing.picture = profile.picture;
          updated = true;
        }

        if (updated) {
          await manager.save([existing, login]);
        }
      }
    });
  }

  public async updateUser(userId: number, props: UserProfileChange): Promise<void> {
    let isWelcomed: boolean = false;
    let user: User|null = null;
    await this._connection.transaction(async manager => {
      user = await manager.findOne(User, {relations: ['logins'],
                                          where: {id: userId}});
      let needsSave = false;
      if (!user) { throw new ApiError("unable to find user", 400); }
      if (props.name && props.name !== user.name) {
        user.name = props.name;
        needsSave = true;
      }
      if (props.isFirstTimeUser !== undefined && props.isFirstTimeUser !== user.isFirstTimeUser) {
        user.isFirstTimeUser = props.isFirstTimeUser;
        needsSave = true;
        // If we are turning off the isFirstTimeUser flag, then right
        // after this transaction commits is a great time to trigger
        // any automation for first logins
        if (!props.isFirstTimeUser) { isWelcomed = true; }
      }
      if (needsSave) {
        await user.save();
      }
    });
    if (user && isWelcomed) {
      this.emit('firstLogin', this.makeFullUser(user));
    }
  }

  public async updateUserName(userId: number, name: string) {
    const user = await User.findOne({where: {id: userId}});
    if (!user) { throw new ApiError("unable to find user", 400); }
    user.name = name;
    await user.save();
  }

  public async updateUserOptions(userId: number, props: Partial<UserOptions>) {
    const user = await User.findOne({where: {id: userId}});
    if (!user) { throw new ApiError("unable to find user", 400); }

    const newOptions = {...(user.options ?? {}), ...props};
    user.options = newOptions;
    await user.save();
  }

  // Fetch user from login, creating the user if previously unseen, allowing one retry
  // for an email key conflict failure.  This is in case our transaction conflicts with a peer
  // doing the same thing.  This is quite likely if the first page visited by a previously
  // unseen user fires off multiple api calls.
  public async getUserByLoginWithRetry(email: string, options: GetUserOptions = {}): Promise<User|undefined> {
    try {
      return await this.getUserByLogin(email, options);
    } catch (e) {
      if (e.name === 'QueryFailedError' && e.detail &&
          e.detail.match(/Key \(email\)=[^ ]+ already exists/)) {
        // This is a postgres-specific error message. This problem cannot arise in sqlite,
        // because we have to serialize sqlite transactions in any case to get around a typeorm
        // limitation.
        return await this.getUserByLogin(email, options);
      }
      throw e;
    }
  }

  /**
   *
   * Fetches a user record based on an email address.  If a user record already
   * exists linked to the email address supplied, that is the record returned.
   * Otherwise a fresh record is created, linked to the supplied email address.
   * The supplied `options` are used when creating a fresh record, or updating
   * unset/outdated fields of an existing record.
   *
   */
  public async getUserByLogin(email: string, options: GetUserOptions = {}): Promise<User|undefined> {
    const {manager: transaction, profile, userOptions} = options;
    const normalizedEmail = normalizeEmail(email);
    const userByLogin = await this._runInTransaction(transaction, async manager => {
      let needUpdate = false;
      const userQuery = manager.createQueryBuilder()
        .select('user')
        .from(User, 'user')
        .leftJoinAndSelect('user.logins', 'logins')
        .leftJoinAndSelect('user.personalOrg', 'personalOrg')
        .where('email = :email', {email: normalizedEmail});
      let user = await userQuery.getOne();
      let login: Login;
      if (!user) {
        user = new User();
        // Special users do not have first time user set so that they don't get redirected to the
        // welcome page.
        user.isFirstTimeUser = !NON_LOGIN_EMAILS.includes(normalizedEmail);
        login = new Login();
        login.email = normalizedEmail;
        login.user = user;
        needUpdate = true;
      } else {
        login = user.logins[0];
      }

      // Check that user and login records are up to date.
      if (!user.name) {
        // Set the user's name if our provider knows it.  Otherwise use their username
        // from email, for lack of something better.  If we don't have a profile at this
        // time, then leave the name blank in the hopes of learning it when the user logs in.
        user.name = (profile && (profile.name || email.split('@')[0])) || '';
        needUpdate = true;
      }
      if (profile && !user.firstLoginAt) {
        // set first login time to now (remove milliseconds for compatibility with other
        // timestamps in db set by typeorm, and since second level precision is fine)
        const nowish = new Date();
        nowish.setMilliseconds(0);
        user.firstLoginAt = nowish;
        needUpdate = true;
      }
      if (!user.picture && profile && profile.picture) {
        // Set the user's profile picture if our provider knows it.
        user.picture = profile.picture;
        needUpdate = true;
      }
      if (profile && profile.email && profile.email !== login.displayEmail) {
        // Use provider's version of email address for display.
        login.displayEmail = profile.email;
        needUpdate = true;
      }

      if (profile?.connectId && profile?.connectId !== user.connectId) {
        user.connectId = profile.connectId;
        needUpdate = true;
      }

      if (!login.displayEmail) {
        // Save some kind of display email if we don't have anything at all for it yet.
        // This could be coming from how someone wrote it in a UserManager dialog, for
        // instance.  It will get overwritten when the user logs in if the provider's
        // version is different.
        login.displayEmail = email;
        needUpdate = true;
      }
      if (!user.options?.authSubject && userOptions?.authSubject) {
        // Link subject from password-based authentication provider if not previously linked.
        user.options = {...(user.options ?? {}), authSubject: userOptions.authSubject};
        needUpdate = true;
      }
      if (needUpdate) {
        login.user = user;
        await manager.save([user, login]);
      }
      if (!user.personalOrg && !NON_LOGIN_EMAILS.includes(login.email)) {
        // Add a personal organization for this user.
        // We don't add a personal org for anonymous/everyone/previewer "users" as it could
        // get a bit confusing.
        const result = await this.addOrg(user, {name: "Personal"}, {
          setUserAsOwner: true,
          useNewPlan: true
        }, manager);
        if (result.status !== 200) {
          throw new Error(result.errMessage);
        }
        needUpdate = true;

        // We just created a personal org; set userOrgPrefs that should apply for new users only.
        const userOrgPrefs: UserOrgPrefs = {showGristTour: true};
        const orgId = result.data;
        if (orgId) {
          await this.updateOrg({userId: user.id}, orgId, {userOrgPrefs}, manager);
        }
      }
      if (needUpdate) {
        // We changed the db - reload user in order to give consistent results.
        // In principle this could be optimized, but this is simpler to maintain.
        user = await userQuery.getOne();
      }
      return user;
    });
    return userByLogin;
  }

  /**
   * Find a user by email. Don't create the user if it doesn't already exist.
   */
  public async getExistingUserByLogin(
    email: string,
    manager?: EntityManager
  ): Promise<User|undefined> {
    const normalizedEmail = normalizeEmail(email);
    return await (manager || this._connection).createQueryBuilder()
      .select('user')
      .from(User, 'user')
      .leftJoinAndSelect('user.logins', 'logins')
      .where('email = :email', {email: normalizedEmail})
      .getOne() || undefined;
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
    if (!(org instanceof Organization)) {
      const orgQuery = this._org(null, false, org, {
        needRealOrg: true
      })
      // Join the org's ACL rules (with 1st level groups/users listed).
        .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
        .leftJoinAndSelect('acl_rules.group', 'org_groups')
        .leftJoinAndSelect('org_groups.memberUsers', 'org_member_users');
      const result = await orgQuery.getRawAndEntities();
      if (result.entities.length === 0) {
        // If the query for the org failed, return the failure result.
        throw new ApiError('org not found', 404);
      }
      org = result.entities[0];
    }
    return getResourceUsers(org, this.defaultNonGuestGroupNames).length;
  }

  /**
   * Deletes a user from the database.  For the moment, the only person with the right
   * to delete a user is the user themselves.
   * Users have logins, a personal org, and entries in the group_users table.  All are
   * removed together in a transaction.  All material in the personal org will be lost.
   *
   * @param scope: request scope, including the id of the user initiating this action
   * @param userIdToDelete: the id of the user to delete from the database
   * @param name: optional cross-check, delete only if user name matches this
   */
  public async deleteUser(scope: Scope, userIdToDelete: number,
                          name?: string): Promise<QueryResult<void>> {
    const userIdDeleting = scope.userId;
    if (userIdDeleting !== userIdToDelete) {
      throw new ApiError('not permitted to delete this user', 403);
    }
    await this._connection.transaction(async manager => {
      const user = await manager.findOne(User, {where: {id: userIdToDelete},
                                                relations: ["logins", "personalOrg", "prefs"]});
      if (!user) { throw new ApiError('user not found', 404); }
      if (name) {
        if (user.name !== name) {
          throw new ApiError(`user name did not match ('${name}' vs '${user.name}')`, 400);
        }
      }
      if (user.personalOrg) { await this.deleteOrg(scope, user.personalOrg.id, manager); }
      await manager.remove([...user.logins]);
      // We don't have a GroupUser entity, and adding one tickles lots of TypeOrm quirkiness,
      // so use a plain query to delete entries in the group_users table.
      await manager.createQueryBuilder()
        .delete()
        .from('group_users')
        .where('user_id = :userId', {userId: userIdToDelete})
        .execute();

      await manager.delete(User, userIdToDelete);
    });
    return {
      status: 200
    };
  }

  /**
   * Returns a QueryResult for the given organization.  The orgKey
   * can be a string (the domain from url) or the id of an org.  If it is
   * null, the user's personal organization is returned.
   */
  public async getOrg(scope: Scope, orgKey: string|number|null,
                      transaction?: EntityManager): Promise<QueryResult<Organization>> {
    const {userId} = scope;
    // Anonymous access to the merged org is a special case.  We return an
    // empty organization, not backed by the database, and which can contain
    // nothing but the example documents always added to the merged org.
    if (this.isMergedOrg(orgKey) && userId === this.getAnonymousUserId()) {
      const anonOrg: OrgInfo = {
        id: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        domain: this.mergedOrgDomain(),
        name: 'Anonymous',
        owner: this.makeFullUser(this.getAnonymousUser()),
        access: 'viewers',
        billingAccount: {
          id: 0,
          individual: true,
          product: {
            name: 'anonymous',
            features: personalFreeFeatures,
          },
          isManager: false,
          inGoodStanding: true,
        },
        host: null
      };
      return { status: 200, data: anonOrg as any };
    }
    let qb = this.org(scope, orgKey, {
      manager: transaction,
      needRealOrg: true
    });
    qb = this._addBillingAccount(qb, scope.userId);
    let effectiveUserId = scope.userId;
    if (scope.specialPermit && scope.specialPermit.org === orgKey) {
      effectiveUserId = this.getPreviewerUserId();
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
    const result = await this._verifyAclPermissions(qb);
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
    if (!org.billingAccount.isManager && scope.userId !== this.getPreviewerUserId() &&
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
    return this._runInTransaction(transaction, async tr => {
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
    // has no home org or workspace.  For all other sitations, expect at least one workspace.
    const emptyAllowed = this.isMergedOrg(orgKey) && scope.userId === this.getAnonymousUserId();
    const result = await this._verifyAclPermissions(query, { scope, emptyAllowed });
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
    transaction?: EntityManager
  ): Promise<QueryResult<Workspace>> {
    const {userId} = scope;
    let queryBuilder = this._workspaces(transaction)
      .where('workspaces.id = :wsId', {wsId})
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
    const result = await this._verifyAclPermissions(queryBuilder, { scope });
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
    const productFeatures = org.billingAccount.product.features;

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
    for (const {usage: docUsage, gracePeriodStart} of docs) {
      const dataLimitStatus = getDataLimitStatus({docUsage, gracePeriodStart, productFeatures});
      if (dataLimitStatus) { summary[dataLimitStatus] += 1; }
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
    const options: AccessOptionWithRole[] = result.data[0].accessOptions;
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
    if (isSingleUser(users)) {
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
    if (this._isAnonymousUser(users) && !listPublicSites) {
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
        .where('key = :key', {key: shareKey})
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
        isPinned: false,
        urlId: key.urlId,
        // For the moment, I don't include a useful workspace.
        // TODO: look up the document properly, perhaps delegating
        // to the regular path through this method.
        workspace: this.unwrapQueryResult<Workspace>(
          await this.getWorkspace({userId: this.getSupportUserId()},
                                   this._exampleWorkspaceId)),
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
        (userId === this.getPreviewerUserId() ? 'viewers' : null);
      if (!access) { throw new ApiError("access denied", 403); }
      doc = {
        name: 'Untitled',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        id: 'new',
        isPinned: false,
        urlId: null,
        workspace: this.unwrapQueryResult<Workspace>(
          await this.getWorkspace({userId: this.getSupportUserId()},
                                   this._exampleWorkspaceId)),
        aliases: [],
        access
      } as any;
    } else {
      // We can't delegate filtering of removed documents to the db, since we'll be
      // caching authentication.  But we also don't need to delegate filtering, since
      // it is very simple at the single-document level.  So we direct the db to include
      // everything with showAll flag, and let the getDoc() wrapper deal with the remaining
      // work.
      let qb = this._doc({...key, showAll: true}, {manager: transaction})
        .leftJoinAndSelect('orgs.owner', 'org_users');
      if (userId !== this.getAnonymousUserId()) {
        qb = this._addForks(userId, qb);
      }
      qb = this._addIsSupportWorkspace(userId, qb, 'orgs', 'workspaces');
      qb = this._addFeatures(qb);  // add features to determine whether we've gone readonly
      const docs = this.unwrapQueryResult<Document[]>(await this._verifyAclPermissions(qb));
      if (docs.length === 0) { throw new ApiError('document not found', 404); }
      if (docs.length > 1) { throw new ApiError('ambiguous document request', 400); }
      doc = docs[0];
      const features = doc.workspace.org.billingAccount.product.features;
      if (features.readOnlyDocs || this._restrictedMode) {
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

  public async getRawDocById(docId: string, transaction?: EntityManager) {
    return await this.getDoc({
      urlId: docId,
      userId: this.getPreviewerUserId(),
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
   * Adds an org with the given name. Returns a query result with the id of the added org.
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
   * @param planType: if set, controls the type of plan used for the org. Only
   *   meaningful for team sites currently.
   * @param billing: if set, controls the billing account settings for the org.
   */
  public async addOrg(user: User, props: Partial<OrganizationProperties>,
                      options: { setUserAsOwner: boolean,
                                 useNewPlan: boolean,
                                 planType?: string,
                                 billing?: BillingOptions},
                      transaction?: EntityManager): Promise<QueryResult<number>> {
    const notifications: Array<() => void> = [];
    const name = props.name;
    const domain = props.domain;
    if (!name) {
      return {
        status: 400,
        errMessage: 'Bad request: name required'
      };
    }
    const orgResult = await this._runInTransaction(transaction, async manager => {
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
        let productName = options.setUserAsOwner ? productNames.personal :
          options.planType === productNames.teamFree ? productNames.teamFree : productNames.teamInitial;
        // A bit fragile: this is called during creation of support@ user, before
        // getSupportUserId() is available, but with setUserAsOwner of true.
        if (!options.setUserAsOwner
            && user.id === this.getSupportUserId()
            && options.planType !== productNames.teamFree) {
          // For teams created by support@getgrist.com, set the product to something
          // good so payment not needed.  This is useful for testing.
          productName = productNames.team;
        }
        billingAccount = new BillingAccount();
        billingAccount.individual = options.setUserAsOwner;
        const dbProduct = await manager.findOne(Product, {where: {name: productName}});
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
          const allowedKeys: Array<keyof BillingOptions> = [
            'product',
            'stripeCustomerId',
            'stripeSubscriptionId',
            'stripePlanId',
            // save will fail if externalId is a duplicate.
            'externalId',
            'externalOptions',
            'inGoodStanding',
            'status'
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
      const groupMap = this._createGroups();
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
      return {
        status: 200,
        data: savedOrg.id
      };
    });
    for (const notification of notifications) { notification(); }
    return orgResult;
  }

  // If setting anything more than prefs:
  //   Checks that the user has UPDATE permissions to the given org. If not, throws an
  //   error. Otherwise updates the given org with the given name. Returns an empty
  //   query result with status 200 on success.
  // For setting userPrefs or userOrgPrefs:
  //   These are user-specific setting, so are allowed with VIEW access (that includes
  //   guests).  Prefs are replaced in their entirety, not merged.
  // For setting orgPrefs:
  //   These are not user-specific, so require UPDATE permissions.
  public async updateOrg(
    scope: Scope,
    orgKey: string|number,
    props: Partial<OrganizationProperties>,
    transaction?: EntityManager,
  ): Promise<QueryResult<number>> {

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
    return await this._runInTransaction(transaction, async manager => {
      const orgQuery = this.org(scope, orgKey, {
        manager,
        markPermissions,
        needRealOrg: true
      });
      const queryResult = await verifyEntity(orgQuery);
      if (queryResult.status !== 200) {
        // If the query for the workspace failed, return the failure result.
        return queryResult;
      }
      // Update the fields and save.
      const org: Organization = queryResult.data;
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
      return {status: 200};
    });
  }

  // Checks that the user has REMOVE permissions to the given org. If not, throws an
  // error. Otherwise deletes the given org. Returns an empty query result with
  // status 200 on success.
  public async deleteOrg(scope: Scope, orgKey: string|number,
                         transaction?: EntityManager): Promise<QueryResult<number>> {
    return await this._runInTransaction(transaction, async manager => {
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
      return {status: 200};
    });
  }

  // Checks that the user has ADD permissions to the given org. If not, throws an error.
  // Otherwise adds a workspace with the given name. Returns a query result with the id
  // of the added workspace.
  public async addWorkspace(scope: Scope, orgKey: string|number,
                            props: Partial<WorkspaceProperties>): Promise<QueryResult<number>> {
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
      const features = org.billingAccount.product.features;
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
      return {
        status: 200,
        data: workspace.id
      };
    });
  }

  // Checks that the user has UPDATE permissions to the given workspace. If not, throws an
  // error. Otherwise updates the given workspace with the given name. Returns an empty
  // query result with status 200 on success.
  public async updateWorkspace(scope: Scope, wsId: number,
                               props: Partial<WorkspaceProperties>): Promise<QueryResult<number>> {
    return await this._connection.transaction(async manager => {
      const wsQuery = this._workspace(scope, wsId, {
        manager,
        markPermissions: Permissions.UPDATE
      });
      const queryResult = await verifyEntity(wsQuery);
      if (queryResult.status !== 200) {
        // If the query for the workspace failed, return the failure result.
        return queryResult;
      }
      // Update the name and save.
      const workspace: Workspace = queryResult.data;
      workspace.checkProperties(props);
      workspace.updateFromProperties(props);
      await manager.save(workspace);
      return {status: 200};
    });
  }

  // Checks that the user has REMOVE permissions to the given workspace. If not, throws an
  // error. Otherwise deletes the given workspace. Returns an empty query result with
  // status 200 on success.
  public async deleteWorkspace(scope: Scope, wsId: number): Promise<QueryResult<number>> {
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
      // Delete the workspace, workspace docs, doc ACLs/groups and workspace ACLs/groups.
      const wsGroups = workspace.aclRules.map(wsAcl => wsAcl.group);
      const docAcls = ([] as AclRule[]).concat(...workspace.docs.map(doc => doc.aclRules));
      const docGroups = docAcls.map(docAcl => docAcl.group);
      await manager.remove([workspace, ...wsGroups, ...docAcls, ...workspace.docs,
        ...workspace.aclRules, ...docGroups]);
      // Update the guests in the org after removing this workspace.
      await this._repairOrgGuests(scope, workspace.org.id, manager);
      return {status: 200};
    });
  }

  public softDeleteWorkspace(scope: Scope, wsId: number): Promise<void> {
    return this._setWorkspaceRemovedAt(scope, wsId, new Date());
  }

  public async undeleteWorkspace(scope: Scope, wsId: number): Promise<void> {
    return this._setWorkspaceRemovedAt(scope, wsId, null);
  }

  // Checks that the user has ADD permissions to the given workspace. If not, throws an
  // error. Otherwise adds a doc with the given name. Returns a query result with the id
  // of the added doc.
  // The desired docId may be passed in.  If passed in, it should have been generated
  // by makeId().  The client should not be given control of the choice of docId.
  // This option is used during imports, where it is convenient not to add a row to the
  // document database until the document has actually been imported.
  public async addDocument(scope: Scope, wsId: number, props: Partial<DocumentProperties>,
                           docId?: string): Promise<QueryResult<string>> {
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
      const groupMap = this._createGroups(workspace, scope.userId);
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
      const result = await manager.save([doc, ...doc.aclRules, ...doc.aliases, ...groups]);
      // Ensure that the creator is in the ws and org's guests group. Creator already has
      // access to the workspace (he is at least an editor), but we need to be sure that
      // even if he is removed from the workspace, he will still have access to this doc.
      // Guest groups are updated after any access is changed, so even if we won't add creator
      // now, he will be added later. NOTE: those functions would normally fail in transaction
      // as those groups might by already fixed (when there is another doc created in the same
      // time), but they are ignoring any unique constraints errors.
      await this._repairWorkspaceGuests(scope, workspace.id, manager);
      await this._repairOrgGuests(scope, workspace.org.id, manager);
      return {
        status: 200,
        data: (result[0] as Document).id
      };
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
      throw new ApiError('secret with given id not found', 404);
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
  public async updateWebhookUrl(id: string, docId: string, url: string, outerManager?: EntityManager) {
    return await this._runInTransaction(outerManager, async manager => {
      const value = await this.getSecret(id, docId, manager);
      if (!value) {
        throw new ApiError('Webhook with given id not found', 404);
      }
      const webhookSecret = JSON.parse(value);
      webhookSecret.url = url;
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

  // Checks that the user has SCHEMA_EDIT permissions to the given doc. If not, throws an
  // error. Otherwise updates the given doc with the given name. Returns an empty
  // query result with status 200 on success.
  // NOTE: This does not update the updateAt date indicating the last modified time of the doc.
  // We may want to make it do so.
  public async updateDocument(
    scope: DocScope,
    props: Partial<DocumentProperties>,
    transaction?: EntityManager
  ): Promise<QueryResult<number>> {
    const markPermissions = Permissions.SCHEMA_EDIT;
    return await this._runInTransaction(transaction, async (manager) => {
      const {forkId} = parseUrlId(scope.urlId);
      let query: SelectQueryBuilder<Document>;
      if (forkId) {
        query = this._fork(scope, {
          manager,
        });
      } else {
        query = this._doc(scope, {
          manager,
          markPermissions,
        });
      }
      const queryResult = await verifyEntity(query);
      if (queryResult.status !== 200) {
        // If the query for the doc or fork failed, return the failure result.
        return queryResult;
      }
      // Update the name and save.
      const doc: Document = queryResult.data;
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
      return {status: 200};
    });
  }

  // Checks that the user has REMOVE permissions to the given document. If not, throws an
  // error. Otherwise deletes the given document. Returns an empty query result with
  // status 200 on success.
  public async deleteDocument(scope: DocScope): Promise<QueryResult<number>> {
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
        const fork: Document = queryResult.data;
        await manager.remove([fork]);
        return {status: 200};
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
        const doc: Document = queryResult.data;
        // Delete the doc and doc ACLs/groups.
        const docGroups = doc.aclRules.map(docAcl => docAcl.group);
        await manager.remove([doc, ...docGroups, ...doc.aclRules]);
        // Update guests of the workspace and org after removing this doc.
        await this._repairWorkspaceGuests(scope, doc.workspace.id, manager);
        await this._repairOrgGuests(scope, doc.workspace.org.id, manager);
        return {status: 200};
      }
    });
  }

  public softDeleteDocument(scope: DocScope): Promise<void> {
    return this._setDocumentRemovedAt(scope, new Date());
  }

  public async undeleteDocument(scope: DocScope): Promise<void> {
    return this._setDocumentRemovedAt(scope, null);
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
    userId: number,
    orgKey: string|number,
    callback: (billingAccount: BillingAccount, transaction: EntityManager) => void|Promise<void>
  ): Promise<QueryResult<void>> {
    return await this._connection.transaction(async transaction => {
      const billingAccount = await this.getBillingAccount({userId}, orgKey, false, transaction);
      const billingAccountCopy = Object.assign({}, billingAccount);
      await callback(billingAccountCopy, transaction);
      // Pick out properties that are allowed to be changed, to prevent accidental updating
      // of other information.
      const updated = pick(billingAccountCopy, 'inGoodStanding', 'status', 'stripeCustomerId',
                           'stripeSubscriptionId', 'stripePlanId', 'product', 'externalId',
                           'externalOptions');
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
    const notifications: Array<() => void> = [];
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
      const analysis = await this._verifyAndLookupDeltaEmails(userId, permissionDelta, true, transaction);
      this._failIfPowerfulAndChangingSelf(analysis);
      const {userIdDelta} = analysis;
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
      for (const notification of notifications) { notification(); }
      return { status: 200 };
    });
  }

  // Updates the permissions of users on the given org according to the PermissionDelta.
  public async updateOrgPermissions(
    scope: Scope,
    orgKey: string|number,
    delta: PermissionDelta
  ): Promise<QueryResult<void>> {
    const {userId} = scope;
    const notifications: Array<() => void> = [];
    const result = await this._connection.transaction(async manager => {
      const analysis = await this._verifyAndLookupDeltaEmails(userId, delta, true, manager);
      const {userIdDelta} = analysis;
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
      const groups = getNonGuestGroups(org);
      if (userIdDelta) {
        const membersBefore = getUsersWithRole(groups, this.getExcludedUserIds());
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
        // Emit an event if the number of org users is changing.
        const membersAfter = getUsersWithRole(groups, this.getExcludedUserIds());
        const countAfter = removeRole(membersAfter).length;
        notifications.push(this._userChangeNotification(userId, org, countBefore, countAfter,
                                                        membersBefore, membersAfter));
        // Notify any added users that they've been added to this resource.
        notifications.push(this._inviteNotification(userId, org, userIdDelta, membersBefore));
      }
      return {status: 200};
    });
    for (const notification of notifications) { notification(); }
    return result;
  }

  // Updates the permissions of users on the given workspace according to the PermissionDelta.
  public async updateWorkspacePermissions(
    scope: Scope,
    wsId: number,
    delta: PermissionDelta
  ): Promise<QueryResult<void>> {
    const {userId} = scope;
    const notifications: Array<() => void> = [];
    const result = await this._connection.transaction(async manager => {
      const analysis = await this._verifyAndLookupDeltaEmails(userId, delta, false, manager);
      let {userIdDelta} = analysis;
      let wsQuery = this._workspace(scope, wsId, {
        manager,
        markPermissions: analysis.permissionThreshold,
      })
      // Join the workspace's ACL rules and groups/users so we can edit them.
      .leftJoinAndSelect('workspaces.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'workspace_groups')
      .leftJoinAndSelect('workspace_groups.memberUsers', 'workspace_users')
      // Join the workspace's org and org member groups so we know what should be inherited.
      .leftJoinAndSelect('workspaces.org', 'org')
      .leftJoinAndSelect('org.aclRules', 'org_acl_rules')
      .leftJoinAndSelect('org_acl_rules.group', 'org_groups')
      .leftJoinAndSelect('org_groups.memberUsers', 'org_users');
      wsQuery = this._addFeatures(wsQuery, 'org');
      wsQuery = this._withAccess(wsQuery, userId, 'workspaces');
      const queryResult = await verifyEntity(wsQuery);
      if (queryResult.status !== 200) {
        // If the query for the workspace failed, return the failure result.
        return queryResult;
      }
      this._failIfPowerfulAndChangingSelf(analysis, queryResult);
      const ws: Workspace = queryResult.data;
      // Get all the non-guest groups on the org.
      const orgGroups = getNonGuestGroups(ws.org);
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
      const membersBefore = this._withoutExcludedUsers(new Map(groups.map(grp => [grp.name, grp.memberUsers])));
      if (userIdDelta) {
        // To check limits on shares, we track group members before and after call
        // to _updateUserPermissions.  Careful, that method mutates groups.
        const nonOrgMembersBefore = this._getUserDifference(groups, orgGroups);
        await this._updateUserPermissions(groups, userIdDelta, manager);
        this._checkUserChangeAllowed(userId, groups);
        const nonOrgMembersAfter = this._getUserDifference(groups, orgGroups);
        const features = ws.org.billingAccount.product.features;
        const limit = features.maxSharesPerWorkspace;
        if (limit !== undefined) {
          this._restrictShares(null, limit, removeRole(nonOrgMembersBefore),
                               removeRole(nonOrgMembersAfter), true, 'workspace', features);
        }
      }
      await manager.save(groups);
      // If the users in workspace were changed, make a call to repair the guests in the org.
      if (userIdDelta) {
        await this._repairOrgGuests(scope, ws.org.id, manager);
        notifications.push(this._inviteNotification(userId, ws, userIdDelta, membersBefore));
      }
      return {status: 200};
    });
    for (const notification of notifications) { notification(); }
    return result;
  }

  // Updates the permissions of users on the given doc according to the PermissionDelta.
  public async updateDocPermissions(
    scope: DocScope,
    delta: PermissionDelta
  ): Promise<QueryResult<void>> {
    const notifications: Array<() => void> = [];
    const result = await this._connection.transaction(async manager => {
      const {userId} = scope;
      const analysis = await this._verifyAndLookupDeltaEmails(userId, delta, false, manager);
      let {userIdDelta} = analysis;
      const doc = await this._loadDocAccess(scope, analysis.permissionThreshold, manager);
      this._failIfPowerfulAndChangingSelf(analysis, {data: doc, status: 200});
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
        const nonOrgMembersBefore = this._getUserDifference(groups, orgGroups);
        await this._updateUserPermissions(groups, userIdDelta, manager);
        this._checkUserChangeAllowed(userId, groups);
        const nonOrgMembersAfter = this._getUserDifference(groups, orgGroups);
        const features = org.billingAccount.product.features;
        this._restrictAllDocShares(features, nonOrgMembersBefore, nonOrgMembersAfter);
      }
      await manager.save(groups);
      if (userIdDelta) {
        // If the users in the doc were changed, make calls to repair workspace then org guests.
        await this._repairWorkspaceGuests(scope, doc.workspace.id, manager);
        await this._repairOrgGuests(scope, doc.workspace.org.id, manager);
        notifications.push(this._inviteNotification(userId, doc, userIdDelta, membersBefore));
      }
      return {status: 200};
    });
    for (const notification of notifications) { notification(); }
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
    const userRoleMap = getMemberUserRoles(org, this.defaultGroupNames);
    const users = getResourceUsers(org).filter(u => userRoleMap[u.id]).map(u => {
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

    const wsMap = getMemberUserRoles(workspace, this.defaultCommonGroupNames);

    // Also fetch the organization ACLs so we can determine inherited rights.

    // The orgMap gives the org access inherited by each user.
    const orgMap = getMemberUserRoles(org, this.defaultBasicGroupNames);
    const orgMapWithMembership = getMemberUserRoles(org, this.defaultGroupNames);
    // Iterate through the org since all users will be in the org.

    const users: UserAccessData[] = getResourceUsers([workspace, org]).map(u => {
      const orgAccess = orgMapWithMembership[u.id] || null;
      return {
        ...this.makeFullUser(u),
        loginEmail: undefined,    // Not part of PermissionData.
        access: wsMap[u.id] || null,
        parentAccess: roles.getEffectiveRole(orgMap[u.id] || null),
        isMember: orgAccess && orgAccess !== 'guests',
      };
    });
    const maxInheritedRole = this._getMaxInheritedRole(workspace);
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

    const doc = await this._loadDocAccess({...scope, urlId: trunkId}, Permissions.VIEW);
    const docMap = getMemberUserRoles(doc, this.defaultCommonGroupNames);
    // The wsMap gives the ws access inherited by each user.
    const wsMap = getMemberUserRoles(doc.workspace, this.defaultBasicGroupNames);
    // The orgMap gives the org access inherited by each user.
    const orgMap = getMemberUserRoles(doc.workspace.org, this.defaultBasicGroupNames);
    // The orgMapWithMembership gives the full access to the org for each user, including
    // the "members" level, which grants no default inheritable access but allows the user
    // to be added freely to workspaces and documents.
    const orgMapWithMembership = getMemberUserRoles(doc.workspace.org, this.defaultGroupNames);
    const wsMaxInheritedRole = this._getMaxInheritedRole(doc.workspace);
    // Iterate through the org since all users will be in the org.
    let users: UserAccessData[] = getResourceUsers([doc, doc.workspace, doc.workspace.org]).map(u => {
      // Merge the strongest roles from the resource and parent resources. Note that the parent
      // resource access levels must be tempered by the maxInheritedRole values of their children.
      const inheritFromOrg = roles.getWeakestRole(orgMap[u.id] || null, wsMaxInheritedRole);
      const orgAccess = orgMapWithMembership[u.id] || null;
      return {
        ...this.makeFullUser(u),
        loginEmail: undefined,    // Not part of PermissionData.
        access: docMap[u.id] || null,
        parentAccess: roles.getEffectiveRole(
          roles.getStrongestRole(wsMap[u.id] || null, inheritFromOrg)
        ),
        isMember: orgAccess && orgAccess !== 'guests',
        isSupport: u.id === this.getSupportUserId() ? true : undefined,
      };
    });
    let maxInheritedRole = this._getMaxInheritedRole(doc);

    if (options?.excludeUsersWithoutAccess) {
      users = users.filter(user => {
        const access = getRealAccess(user, { maxInheritedRole, users });
        return roles.canView(access);
      });
    }

    if (forkId || snapshotId || options?.flatten) {
      for (const user of users) {
        const access = getRealAccess(user, { maxInheritedRole, users });
        user.access = access;
        user.parentAccess = undefined;
      }
      maxInheritedRole = null;
    }

    const personal = this._filterAccessData(scope, users, maxInheritedRole, doc.id);

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
        ...personal,
        maxInheritedRole,
        users
      }
    };
  }

  public async moveDoc(
    scope: DocScope,
    wsId: number
  ): Promise<QueryResult<void>> {
    return await this._connection.transaction(async manager => {
      // Get the doc
      const docQuery = this._doc(scope, {
        manager,
        markPermissions: Permissions.OWNER
      })
      .leftJoinAndSelect('docs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'doc_groups')
      .leftJoinAndSelect('doc_groups.memberUsers', 'doc_users')
      .leftJoinAndSelect('workspaces.aclRules', 'workspace_acl_rules')
      .leftJoinAndSelect('workspace_acl_rules.group', 'workspace_groups')
      .leftJoinAndSelect('workspace_groups.memberUsers', 'workspace_users')
      .leftJoinAndSelect('orgs.aclRules', 'org_acl_rules')
      .leftJoinAndSelect('org_acl_rules.group', 'org_groups')
      .leftJoinAndSelect('org_groups.memberUsers', 'org_users');
      const docQueryResult = await verifyEntity(docQuery);
      if (docQueryResult.status !== 200) {
        // If the query for the doc failed, return the failure result.
        return docQueryResult;
      }
      const doc: Document = docQueryResult.data;
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
      const firstLevelUsers = getResourceUsers(doc);
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
          const nonOrgMembersBefore = this._getUserDifference(docGroups, sourceOrgGroups);
          const nonOrgMembersAfter = this._getUserDifference(docGroups, destOrgGroups);
          const features = destOrg.billingAccount.product.features;
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
        this._setInheritance(aclRule.group, workspace);
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
      await manager.save([doc, ...doc.aclRules, ...docGroups]);
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
      return {
        status: 200
      };
    });
  }

  // Pin or unpin a doc.
  public async pinDoc(
    scope: DocScope,
    setPinned: boolean
  ): Promise<QueryResult<void>> {
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
      const doc: Document = docQueryResult.data;
      if (doc.isPinned !== setPinned) {
        doc.isPinned = setPinned;
        // Forcibly remove the aliases relation from the document object, so that TypeORM
        // doesn't try to save it.  It isn't safe to do that because it was filtered by
        // a where clause.
        doc.aliases = undefined as any;
        // Save and return success status.
        await manager.save(doc);
      }
      return { status: 200 };
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

  /**
   * Get the anonymous user, as a constructed object rather than a database lookup.
   */
  public getAnonymousUser(): User {
    const user = new User();
    user.id = this.getAnonymousUserId();
    user.name = "Anonymous";
    user.isFirstTimeUser = false;
    const login = new Login();
    login.displayEmail = login.email = ANONYMOUS_USER_EMAIL;
    user.logins = [login];
    user.ref = '';
    return user;
  }

  /**
   *
   * Get the id of the anonymous user.
   *
   */
  public getAnonymousUserId(): number {
    const id = this._specialUserIds[ANONYMOUS_USER_EMAIL];
    if (!id) { throw new Error("Anonymous user not available"); }
    return id;
  }

  /**
   * Get the id of the thumbnail user.
   */
  public getPreviewerUserId(): number {
    const id = this._specialUserIds[PREVIEWER_EMAIL];
    if (!id) { throw new Error("Previewer user not available"); }
    return id;
  }

  /**
   * Get the id of the 'everyone' user.
   */
  public getEveryoneUserId(): number {
    const id = this._specialUserIds[EVERYONE_EMAIL];
    if (!id) { throw new Error("'everyone' user not available"); }
    return id;
  }

  /**
   * Get the id of the 'support' user.
   */
  public getSupportUserId(): number {
    const id = this._specialUserIds[SUPPORT_EMAIL];
    if (!id) { throw new Error("'support' user not available"); }
    return id;
  }

  /**
   * Get ids of users to be excluded from member counts and emails.
   */
  public getExcludedUserIds(): number[] {
    return [this.getSupportUserId(), this.getAnonymousUserId(), this.getEveryoneUserId()];
  }

  /**
   *
   * Take a list of user profiles coming from the client's session, correlate
   * them with Users and Logins in the database, and construct full profiles
   * with user ids, standardized display emails, pictures, and anonymous flags.
   *
   */
  public async completeProfiles(profiles: UserProfile[]): Promise<FullUser[]> {
    if (profiles.length === 0) { return []; }
    const qb = this._connection.createQueryBuilder()
      .select('logins')
      .from(Login, 'logins')
      .leftJoinAndSelect('logins.user', 'user')
      .where('logins.email in (:...emails)', {emails: profiles.map(profile => normalizeEmail(profile.email))});
    const completedProfiles: {[email: string]: FullUser} = {};
    for (const login of await qb.getMany()) {
      completedProfiles[login.email] = {
        id: login.user.id,
        email: login.displayEmail,
        name: login.user.name,
        picture: login.user.picture,
        anonymous: login.user.id === this.getAnonymousUserId(),
        locale: login.user.options?.locale
      };
    }
    return profiles.map(profile => completedProfiles[normalizeEmail(profile.email)])
      .filter(profile => profile);
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
    return await this._getOrCreateLimit(accountId, limitType, true);
  }

  public async peekLimit(accountId: number, limitType: LimitType): Promise<Limit|null> {
    return await this._getOrCreateLimit(accountId, limitType, false);
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
  }): Promise<Limit|null> {
    const limitOrError: Limit|ApiError|null = await this._connection.transaction(async manager => {
      const org = await this._org(scope, false, scope.org ?? null, {manager, needRealOrg: true})
        .innerJoinAndSelect('orgs.billingAccount', 'billing_account')
        .innerJoinAndSelect('billing_account.product', 'product')
        .leftJoinAndSelect('billing_account.limits', 'limit', 'limit.type = :limitType', {limitType})
        .getOne();
      // If the org doesn't exists, or is a fake one (like for anonymous users), don't do anything.
      if (!org || org.id === 0) {
        // This API shouldn't be called, it should be checked first if the org is valid.
        throw new ApiError(`Can't create a limit for non-existing organization`, 500);
      }
      let existing = org?.billingAccount?.limits?.[0];
      if (!existing) {
        const product = org?.billingAccount?.product;
        if (!product) {
          throw new ApiError(`getLimit: no product found for org`, 500);
        }
        if (product.features.baseMaxAssistantCalls === undefined) {
          // If the product has no assistantLimit, then it is not billable yet, and we don't need to
          // track usage as it is basically unlimited.
          return null;
        }
        existing = new Limit();
        existing.billingAccountId = org.billingAccountId;
        existing.type = limitType;
        existing.limit = product.features.baseMaxAssistantCalls ?? 0;
        existing.usage = 0;
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

  private async _getOrCreateLimit(accountId: number, limitType: LimitType, force: boolean): Promise<Limit|null> {
    if (accountId === 0) {
      throw new Error(`getLimit: called for not existing account`);
    }
    const result = this._connection.transaction(async manager => {
      let existing = await manager.createQueryBuilder()
        .select('limit')
        .from(Limit, 'limit')
        .innerJoin('limit.billingAccount', 'account')
        .where('account.id = :accountId', {accountId})
          .andWhere('limit.type = :limitType', {limitType})
        .getOne();
      if (!force && !existing) { return null; }
      if (existing) { return existing; }
      const product = await manager.createQueryBuilder()
        .select('product')
        .from(Product, 'product')
        .innerJoinAndSelect('product.accounts', 'account')
        .where('account.id = :accountId', {accountId})
        .getOne();
      if (!product) {
        throw new Error(`getLimit: no product for account ${accountId}`);
      }
      existing = new Limit();
      existing.billingAccountId = product.accounts[0].id;
      existing.type = limitType;
      existing.limit = product.features.baseMaxAssistantCalls ?? 0;
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
        effectiveUserId = this.getPreviewerUserId();
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
    const supportId = this._specialUserIds[SUPPORT_EMAIL];
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

    if (userId !== this.getAnonymousUserId()) {
      query = this._addForks(userId, query);
    }

    // If merged org, we need to take some special steps.
    if (this.isMergedOrg(org)) {
      // Add information about owners of personal orgs.
      query = query.leftJoinAndSelect('org_users.logins', 'org_logins');
      // Add a direct, efficient filter to remove irrelevant personal orgs from consideration.
      query = this._filterByOrgGroups(query, userId, null);
      // The anonymous user is a special case; include only examples from support user.
      if (userId === this.getAnonymousUserId()) {
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
    if (org.ownerId === this.getSupportUserId()) {
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
    return await this._runInTransaction(transaction, async manager => {
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
        .andWhere('doc_users.id is not null');
      const wsWithDocs = await wsWithDocsQuery.getOne();
      await this._setGroupUsers(manager, wsGuestGroup.id, wsGuestGroup.memberUsers,
                                this._filterEveryone(getResourceUsers(wsWithDocs?.docs || [])));
    });
  }

  /**
   * Updates the org guests with any first-level users of workspaces inside the org.
   * NOTE: If repairing both workspace and org guests, this should always be called AFTER
   * _repairWorkspaceGuests.
   */
  private async _repairOrgGuests(scope: Scope, orgKey: string|number, transaction?: EntityManager): Promise<void> {
    return await this._runInTransaction(transaction, async manager => {
      const orgQuery = this.org(scope, orgKey, {manager})
      .leftJoinAndSelect('orgs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'groups')
      .leftJoinAndSelect('groups.memberUsers', 'users')
      .andWhere('groups.name = :role', {role: roles.GUEST});
      const org = await orgQuery.getOne();
      if (!org) { throw new Error('cannot find org'); }
      const workspaceQuery = this._workspaces(manager)
      .where('workspaces.org_id = :orgId', {orgId: org.id})
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
      await this._setGroupUsers(manager, orgGuestGroup.id, orgGuestGroup.memberUsers,
                                this._filterEveryone(getResourceUsers(org.workspaces)));
    });
  }

  /**
   * Update the set of users in a group.  TypeORM's .save() method appears to be
   * unreliable for a ManyToMany relation with a table with a multi-column primary
   * key, so we make the update using explicit deletes and inserts.
   */
  private async _setGroupUsers(manager: EntityManager, groupId: number, usersBefore: User[],
                               usersAfter: User[]) {
    const userIdsBefore = new Set(usersBefore.map(u => u.id));
    const userIdsAfter = new Set(usersAfter.map(u => u.id));
    const toDelete = [...userIdsBefore].filter(id => !userIdsAfter.has(id));
    const toAdd = [...userIdsAfter].filter(id => !userIdsBefore.has(id));
    if (toDelete.length > 0) {
      await manager.createQueryBuilder()
        .delete()
        .from('group_users')
        .whereInIds(toDelete.map(id => ({user_id: id, group_id: groupId})))
        .execute();
    }
    if (toAdd.length > 0) {
      await manager.createQueryBuilder()
        .insert()
        // Since we are adding new records in group_users, we may get a duplicate key error if two documents
        // are added at the same time (even in transaction, since we are not blocking the whole table).
        .orIgnore()
        .into('group_users')
        .values(toAdd.map(id => ({user_id: id, group_id: groupId})))
        .execute();
    }
  }

  /**
   * Don't add everyone@ as a guest, unless also sharing with anon@.
   * This means that material shared with everyone@ doesn't become
   * listable/discoverable by default.
   *
   * This is a HACK to allow existing example doc setup to continue to
   * work. It could be removed if we are willing to share the entire
   * support org with users.  E.g. move any material we don't want to
   * share into a workspace that doesn't inherit ACLs.  TODO: remove
   * this hack, or enhance it up as a way to support discoverability /
   * listing.  It has the advantage of cloning well.
   */
  private _filterEveryone(users: User[]): User[] {
    const everyone = this.getEveryoneUserId();
    const anon = this.getAnonymousUserId();
    if (users.find(u => u.id === anon)) { return users; }
    return users.filter(u => u.id !== everyone);
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
    return await this._runInTransaction(transaction, async manager => {
      // Create a new workspace.
      const workspace = new Workspace();
      workspace.checkProperties(props);
      workspace.updateFromProperties(props);
      workspace.org = org;
      // Create the special initial permission groups for the new workspace.
      // Optionally add the owner to the workspace.
      const groupMap = this._createGroups(org, ownerId);
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
      return result[0];
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
  private _addBillingAccountCalculatedFields<T>(qb: SelectQueryBuilder<T>) {
    // We need to sum up whether the account is paid or not, so that UI can provide
    // a "billing" vs "upgrade" link.  For the moment, we just check if there is
    // a subscription id.  TODO: make sure this is correct in case of free plans.
    qb = qb.addSelect(`(billing_accounts.stripe_subscription_id is not null)`, 'billing_accounts_paid');
    return qb;
  }

  /**
   * Makes sure that product features for orgs are available in query result.
   */
  private _addFeatures<T>(qb: SelectQueryBuilder<T>, orgAlias: string = 'orgs') {
    qb = qb.leftJoinAndSelect(`${orgAlias}.billingAccount`, 'billing_accounts');
    qb = qb.leftJoinAndSelect('billing_accounts.product', 'products');
    // orgAlias.billingAccount.product.features should now be available
    return qb;
  }

  private _addIsSupportWorkspace<T>(users: AvailableUsers, qb: SelectQueryBuilder<T>,
                                    orgAlias: string, workspaceAlias: string) {
    const supportId = this._specialUserIds[SUPPORT_EMAIL];

    // We'll be selecting a boolean and naming it as *_support.  This matches the
    // SQL name `support` of a column in the Workspace entity whose javascript
    // name is `isSupportWorkspace`.
    const alias = `${workspaceAlias}_support`;

    // If we happen to be the support user, don't treat our workspaces as anything
    // special, so we can work with them in the ordinary way.
    if (isSingleUser(users) && users === supportId) { return qb.addSelect('false', alias); }

    // Otherwise, treat workspaces owned by support as special.
    return qb.addSelect(`coalesce(${orgAlias}.owner_id = ${supportId}, false)`, alias);
  }

  /**
   * Makes sure that doc forks are available in query result.
   */
  private _addForks<T>(userId: number, qb: SelectQueryBuilder<T>) {
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
   *
   * Get the id of a special user, creating that user if it is not already present.
   *
   */
  private async _getSpecialUserId(profile: UserProfile) {
    let id = this._specialUserIds[profile.email];
    if (!id) {
      // get or create user - with retry, since there'll be a race to create the
      // user if a bunch of servers start simultaneously and the user doesn't exist
      // yet.
      const user = await this.getUserByLoginWithRetry(profile.email, {profile});
      if (user) { id = this._specialUserIds[profile.email] = user.id; }
    }
    if (!id) { throw new Error(`Could not find or create user ${profile.email}`); }
    return id;
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
      if (ids.userId === this.getPreviewerUserId()) {
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

  // This deals with the problem posed by receiving a PermissionDelta specifying a
  // role for both alice@x and Alice@x.  We do not distinguish between such emails.
  // If there are multiple indistinguishabe emails, we preserve just one of them,
  // assigning it the most powerful permission specified.  The email variant perserved
  // is the earliest alphabetically.
  private _mergeIndistinguishableEmails(delta: PermissionDelta) {
    if (!delta.users) { return; }
    // We normalize emails for comparison, but track how they were capitalized
    // in order to preserve it.  This is worth doing since for the common case
    // of a user being added to a resource prior to ever logging in, their
    // displayEmail will be seeded from this value.
    const displayEmails: {[email: string]: string} = {};
    // This will be our output.
    const users: {[email: string]: roles.NonGuestRole|null} = {};
    for (const displayEmail of Object.keys(delta.users).sort()) {
      const email = normalizeEmail(displayEmail);
      const role = delta.users[displayEmail];
      const key = displayEmails[email] = displayEmails[email] || displayEmail;
      users[key] = users[key] ? roles.getStrongestRole(users[key], role) : role;
    }
    delta.users = users;
  }

  // Looks up the emails in the permission delta and adds them to the users map in
  // the delta object.
  // Returns a QueryResult based on the validity of the passed in PermissionDelta object.
  private async _verifyAndLookupDeltaEmails(
    userId: number,
    delta: PermissionDelta,
    isOrg: boolean = false,
    transaction?: EntityManager
  ): Promise<PermissionDeltaAnalysis> {
    if (!delta) {
      throw new ApiError('Bad request: missing permission delta', 400);
    }
    this._mergeIndistinguishableEmails(delta);
    const hasInherit = 'maxInheritedRole' in delta;
    const hasUsers = delta.users;  // allow zero actual changes; useful to reduce special
                                   // cases in scripts
    if ((isOrg && (hasInherit || !hasUsers)) || (!isOrg && !hasInherit && !hasUsers)) {
      throw new ApiError('Bad request: invalid permission delta', 400);
    }
    // Lookup the email access changes and move them to the users object.
    const userIdMap: {[userId: string]: roles.NonGuestRole|null} = {};
    if (hasInherit) {
      // Verify maxInheritedRole
      const role = delta.maxInheritedRole;
      const validRoles = new Set(this.defaultBasicGroupNames);
      if (role && !validRoles.has(role)) {
        throw new ApiError(`Invalid maxInheritedRole ${role}`, 400);
      }
    }
    if (delta.users) {
      // Verify roles
      const deltaRoles = Object.keys(delta.users).map(_userId => delta.users![_userId]);
      // Cannot set role "members" on workspace/doc.
      const validRoles = new Set(isOrg ? this.defaultNonGuestGroupNames : this.defaultBasicGroupNames);
      for (const role of deltaRoles) {
        if (role && !validRoles.has(role)) {
          throw new ApiError(`Invalid user role ${role}`, 400);
        }
      }
      // Lookup emails
      const emailMap = delta.users;
      const emails = Object.keys(emailMap);
      const emailUsers = await Promise.all(
        emails.map(async email => await this.getUserByLogin(email, {manager: transaction}))
      );
      emails.forEach((email, i) => {
        const userIdAffected = emailUsers[i]!.id;
        // Org-level sharing with everyone would allow serious spamming - forbid it.
        if (emailMap[email] !== null &&                    // allow removing anything
            userId !== this.getSupportUserId() &&          // allow support user latitude
            userIdAffected === this.getEveryoneUserId() &&
            isOrg) {
            throw new ApiError('This user cannot share with everyone at top level', 403);
        }
        userIdMap[userIdAffected] = emailMap[email];
      });
    }
    const userIdDelta = delta.users ? userIdMap : null;
    const userIds = Object.keys(userIdDelta || {});
    const removingSelf = userIds.length === 1 && userIds[0] === String(userId) &&
      delta.maxInheritedRole === undefined && userIdDelta?.[userId] === null;
    const permissionThreshold = removingSelf ? Permissions.VIEW : Permissions.ACL_EDIT;
    return {
      userIdDelta,
      permissionThreshold,
      affectsSelf: userId in userIdMap,
    };
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
    const users = await this._getUsers(userIds, manager);

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
   * Run an operation in an existing transaction if available, otherwise create
   * a new transaction for it.
   *
   * @param transaction: the manager of an existing transaction, or undefined.
   * @param op: the operation to run in a transaction.
   */
  private _runInTransaction(transaction: EntityManager|undefined,
                            op: (manager: EntityManager) => Promise<any>): Promise<any> {
    if (transaction) { return op(transaction); }
    return this._connection.transaction(op);
  }

  /**
   * Returns a Promise for an array of User entites for the given userIds.
   */
  private async _getUsers(userIds: number[], optManager?: EntityManager): Promise<User[]> {
    if (userIds.length === 0) {
      return [];
    }
    const manager = optManager || new EntityManager(this._connection);
    const queryBuilder = manager.createQueryBuilder()
      .select('users')
      .from(User, 'users')
      .where('users.id IN (:...userIds)', {userIds});
    return await queryBuilder.getMany();
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

  private _docs(manager?: EntityManager) {
    return (manager || this._connection).createQueryBuilder()
      .select('docs')
      .from(Document, 'docs');
  }

  /**
   * Construct a QueryBuilder for a select query on a specific doc given by urlId.
   * Provides options for running in a transaction and adding permission info.
   * See QueryOptions documentation above.
   *
   * In order to accept urlIds, the aliases, workspaces, and orgs tables are joined.
   */
  private _doc(scope: DocScope, options: QueryOptions = {}): SelectQueryBuilder<Document> {
    const {urlId, userId} = scope;
    // Check if doc is being accessed with a merged org url.  If so,
    // we will only filter urlId matches, and will allow docId matches
    // for team site documents.  This is for backwards compatibility,
    // to support https://docs.getgrist.com/api/docs/<docid> for team
    // site documents.
    const mergedOrg = this.isMergedOrg(scope.org || null);
    let query = this._docs(options.manager)
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
    query = this._applyLimit(query, {...scope, includeSupport: true}, ['docs', 'workspaces', 'orgs'], 'open');
    if (options.markPermissions) {
      let effectiveUserId = userId;
      let threshold = options.markPermissions;
      if (options.allowSpecialPermit && scope.specialPermit && scope.specialPermit.docId) {
        query = query.andWhere('docs.id = :docId', {docId: scope.specialPermit.docId});
        effectiveUserId = this.getPreviewerUserId();
        threshold = Permissions.VIEW;
      }
      // Compute whether we have access to the doc
      query = query.addSelect(
        this._markIsPermitted('docs', effectiveUserId, 'open', threshold),
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
        .setParameter('forkAnonId', this.getAnonymousUserId())
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
    } else if (scope.showOnlyPinned) {
      return `${onDefault} AND docs.is_pinned = TRUE AND (workspaces.removed_at IS NULL AND docs.removed_at IS NULL)`;
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
        effectiveUserId = this.getPreviewerUserId();
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
  private _whereOrg<T extends WhereExpression>(qb: T, org: string|number, includeSupport = false): T {
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
      const supportId = this._specialUserIds[SUPPORT_EMAIL];
      return qb.andWhere(new Brackets((q) =>
        this._wherePlainOrg(q, org).orWhere('orgs.owner_id = :supportId', {supportId})));
    } else {
      return this._wherePlainOrg(qb, org);
    }
  }

  private _wherePlainOrg<T extends WhereExpression>(qb: T, org: string|number): T {
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
                      accessStyle: AccessStyle = 'open') {
    return qb
      .addSelect(this._markIsPermitted(table, users, accessStyle, null), `${table}_permissions`);
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
    if (isSingleUser(users)) {
      // Add an exception for the previewer user, if present.
      const previewerId = this._specialUserIds[PREVIEWER_EMAIL];
      if (users === previewerId) { return qb; }
      const everyoneId = this._specialUserIds[EVERYONE_EMAIL];
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

  /**
   * Returns a name to group mapping for the standard groups. Useful when adding a new child
   * entity. Finds and includes the correct parent groups as member groups.
   */
  private _createGroups(inherit?: Organization|Workspace, ownerId?: number): {[name: string]: Group} {
    const groupMap: {[name: string]: Group} = {};
    this.defaultGroups.forEach(groupProps => {
      if (!groupProps.orgOnly || !inherit) {
        // Skip this group if it's an org only group and the resource inherits from a parent.
        const group = new Group();
        group.name = groupProps.name;
        if (inherit) {
          this._setInheritance(group, inherit);
        }
        groupMap[groupProps.name] = group;
      }
    });
    // Add the owner explicitly to the owner group.
    if (ownerId) {
      const ownerGroup = groupMap[roles.OWNER];
      const user = new User();
      user.id = ownerId;
      ownerGroup.memberUsers = [user];
    }
    return groupMap;
  }

  // Sets the given group to inherit the groups in the given parent resource.
  private _setInheritance(group: Group, parent: Organization|Workspace) {
    // Add the parent groups to the group
    const groupProps = this.defaultGroups.find(special => special.name === group.name);
    if (!groupProps) {
      throw new Error(`Non-standard group passed to _addInheritance: ${group.name}`);
    }
    if (groupProps.nestParent) {
      const parentGroups = (parent.aclRules as AclRule[]).map((_aclRule: AclRule) => _aclRule.group);
      const inheritGroup = parentGroups.find((_parentGroup: Group) => _parentGroup.name === group.name);
      if (!inheritGroup) {
        throw new Error(`Special group ${group.name} not found in ${parent.name} for inheritance`);
      }
      group.memberGroups = [inheritGroup];
    }
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
    } = {}
  ): Promise<QueryResult<any>> {
    const results = await (options.rawQueryBuilder ?
                           getRawAndEntities(options.rawQueryBuilder, queryBuilder) :
                           queryBuilder.getRawAndEntities());
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
      const features = org.billingAccount.product.features;
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
        value.anonymous = (logins[0].userId === this.getAnonymousUserId());
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
        value.access = this._getRoleFromPermissions(subValue || 0);
        if (subValue & Permissions.PUBLIC) { // tslint:disable-line:no-bitwise
          value.public = true;
        }
      } else {
        // Resource may be accessed by multiple users, encoded in JSON.
        const accessOptions: AccessOption[] = readJson(this._dbType, subValue);
        value.accessOptions = accessOptions.map(option => ({
          access: this._getRoleFromPermissions(option.perms), ...option
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

  // Returns the most permissive default role that does not have more permissions than the passed
  // in argument.
  private _getRoleFromPermissions(permissions: number): roles.Role|null {
    permissions &= ~Permissions.PUBLIC; // tslint:disable-line:no-bitwise
    const group = this.defaultBasicGroups.find(grp =>
      (permissions & grp.permissions) === grp.permissions); // tslint:disable-line:no-bitwise
    return group ? group.name : null;
  }

  // Returns the maxInheritedRole group name set on a resource.
  // The resource's aclRules, groups, and memberGroups must be populated.
  private _getMaxInheritedRole(res: Workspace|Document): roles.BasicRole|null {
    const groups = (res.aclRules as AclRule[]).map((_aclRule: AclRule) => _aclRule.group);
    let maxInheritedRole: roles.NonGuestRole|null = null;
    for (const name of this.defaultBasicGroupNames) {
      const group = groups.find(_grp => _grp.name === name);
      if (!group) {
        throw new Error(`Error in _getMaxInheritedRole: group ${name} not found in ${res.name}`);
      }
      if (group.memberGroups.length > 0) {
        maxInheritedRole = name;
        break;
      }
    }
    return roles.getEffectiveRole(maxInheritedRole);
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
    permissions: Permissions|null = Permissions.VIEW
  ): (qb: SelectQueryBuilder<any>) => SelectQueryBuilder<any> {
    const idColumn = resType.slice(0, -1) + "_id";
    return qb => {
      const getBasicPermissions = (q: SelectQueryBuilder<any>) => {
        if (permissions !== null) {
          q = q.select('acl_rules.permissions');
        } else {
          const everyoneId = this._specialUserIds[EVERYONE_EMAIL];
          const anonId = this._specialUserIds[ANONYMOUS_USER_EMAIL];
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
        q = this._getUsersAcls(q, users, accessStyle);
        q = q.andWhere(`acl_rules.${idColumn} = ${resType}.id`);
        if (permissions !== null) {
          q = q.andWhere(`(acl_rules.permissions & ${permissions}) = ${permissions}`).limit(1);
        } else if (!isSingleUser(users)) {
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
      if (isSingleUser(users)) {
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
                        accessStyle: AccessStyle) {
    // Every acl_rule is associated with a single group.  A user may
    // be a direct member of that group, via the group_users table.
    // Or they may be a member of a group that is a member of that
    // group, via group_groups.  Or they may be even more steps
    // removed.  We unroll to a fixed number of steps, and use joins
    // rather than a recursive query, since we need this step to be as
    // fast as possible.
    qb = qb
      // filter for the specified user being a direct or indirect member of the acl_rule's group
      .where(new Brackets(cond => {
        if (isSingleUser(users)) {
          // Users is an integer, so ok to insert into sql.  It we
          // didn't, we'd need to use distinct parameter names, since
          // we may include this code with different user ids in the
          // same query
          cond = cond.where(`gu0.user_id = ${users}`);
          cond = cond.orWhere(`gu1.user_id = ${users}`);
          cond = cond.orWhere(`gu2.user_id = ${users}`);
          cond = cond.orWhere(`gu3.user_id = ${users}`);
          // Support the special "everyone" user.
          const everyoneId = this._specialUserIds[EVERYONE_EMAIL];
          if (everyoneId === undefined) {
            throw new Error("Special user id for EVERYONE_EMAIL not found");
          }
          cond = cond.orWhere(`gu0.user_id = ${everyoneId}`);
          cond = cond.orWhere(`gu1.user_id = ${everyoneId}`);
          cond = cond.orWhere(`gu2.user_id = ${everyoneId}`);
          cond = cond.orWhere(`gu3.user_id = ${everyoneId}`);
          if (accessStyle === 'list') {
            // Support also the special anonymous user.  Currently, by convention, sharing a
            // resource with anonymous should make it listable.
            const anonId = this._specialUserIds[ANONYMOUS_USER_EMAIL];
            if (anonId === undefined) {
              throw new Error("Special user id for ANONYMOUS_USER_EMAIL not found");
            }
            cond = cond.orWhere(`gu0.user_id = ${anonId}`);
            cond = cond.orWhere(`gu1.user_id = ${anonId}`);
            cond = cond.orWhere(`gu2.user_id = ${anonId}`);
            cond = cond.orWhere(`gu3.user_id = ${anonId}`);
          }
          // Add an exception for the previewer user, if present.
          const previewerId = this._specialUserIds[PREVIEWER_EMAIL];
          if (users === previewerId) {
            // All acl_rules granting view access are available to previewer user.
            cond = cond.orWhere('acl_rules.permissions = :permission',
                                {permission: Permissions.VIEW});
          }
        } else {
          cond = cond.where('gu0.user_id = profiles.id');
          cond = cond.orWhere('gu1.user_id = profiles.id');
          cond = cond.orWhere('gu2.user_id = profiles.id');
          cond = cond.orWhere('gu3.user_id = profiles.id');
        }
        return cond;
      }));
    if (!isSingleUser(users)) {
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
  private _applyLimit<T>(qb: SelectQueryBuilder<T>, limit: Scope,
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
        qb = this._withAccess(qb, limit.users || limit.userId, res, accessStyle);
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
    const features = workspace.org.billingAccount.product.features;
    if (features.maxDocsPerOrg !== undefined) {
      // we need to count how many docs are in the current org, and if we
      // are already at or above the limit, then fail.
      const wss = this.unwrapQueryResult(await this.getOrgWorkspaces({userId: this.getPreviewerUserId()},
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
    if (userId === this.getSupportUserId()) { return; }
    const ids = new Set(flatten(groups.map(g => g.memberUsers)).map(u => u.id));
    if (ids.has(this.getEveryoneUserId()) && ids.has(this.getAnonymousUserId())) {
      throw new Error('this user cannot share with everyone and anonymous');
    }
  }

  // Fetch a Document with all access information loaded.  Make sure the user has the
  // specified permissions on the doc.  The Document's organization will have product
  // feature information loaded also.
  private async _loadDocAccess(scope: DocScope, markPermissions: Permissions,
                               transaction?: EntityManager): Promise<Document> {
    return await this._runInTransaction(transaction, async manager => {

      const docQuery = this._doc(scope, {manager, markPermissions})
      // Join the doc's ACL rules and groups/users so we can edit them.
      .leftJoinAndSelect('docs.aclRules', 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'doc_groups')
      .leftJoinAndSelect('doc_groups.memberUsers', 'doc_group_users')
      .leftJoinAndSelect('doc_groups.memberGroups', 'doc_group_groups')
      .leftJoinAndSelect('doc_group_users.logins', 'doc_user_logins')
      // Join the workspace so we know what should be inherited.  We will join
      // the workspace member groups/users as a separate query, since
      // SQL results are flattened, and multiplying the number of rows we have already
      // by the number of workspace users could get excessive.
      .leftJoinAndSelect('docs.workspace', 'workspace');
      const queryResult = await verifyEntity(docQuery);
      const doc: Document = this.unwrapQueryResult(queryResult);

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
    return () => {
      const customerId = org.billingAccount.stripeCustomerId;
      const change: UserChange = {userId, org, customerId,
                                  countBefore, countAfter,
                                  membersBefore, membersAfter};
      this.emit('userChange', change);
    };
  }

  // Create a notification function that emits an event when users may have been added to a resource.
  private _inviteNotification(userId: number, resource: Organization|Workspace|Document,
                              userIdDelta: UserIdDelta, membersBefore: Map<roles.NonGuestRole, User[]>): () => void {
    return () => this.emit('addUser', userId, resource, userIdDelta, membersBefore);
  }

  // Given two arrays of groups, returns a map of users present in the first array but
  // not the second, where the map is broken down by user role.
  // This method is used for checking limits on shares.
  // Excluded users are removed from the results.
  private _getUserDifference(groupsA: Group[], groupsB: Group[]): Map<roles.NonGuestRole, User[]> {
    const subtractSet: Set<number> =
      new Set(flatten(groupsB.map(grp => grp.memberUsers)).map(usr => usr.id));
    const result = new Map<roles.NonGuestRole, User[]>();
    for (const group of groupsA) {
      const name = group.name;
      if (!roles.isNonGuestRole(name)) { continue; }
      result.set(name, group.memberUsers.filter(user => !subtractSet.has(user.id)));
    }
    return this._withoutExcludedUsers(result);
  }

  private _withoutExcludedUsers(members: Map<roles.NonGuestRole, User[]>): Map<roles.NonGuestRole, User[]> {
    const excludedUsers = this.getExcludedUserIds();
    for (const [role, users] of members.entries()) {
      members.set(role, users.filter((user) => !excludedUsers.includes(user.id)));
    }
    return members;
  }

  private _billingManagerNotification(userId: number, addUserId: number, orgs: Organization[]) {
    return () => {
      this.emit('addBillingManager', userId, addUserId, orgs);
    };
  }

  private _teamCreatorNotification(userId: number) {
    return () => {
      this.emit('teamCreator', userId);
    };
  }

  /**
   * Check for anonymous user, either encoded directly as an id, or as a singular
   * profile (this case arises during processing of the session/access/all endpoint
   * whether we are checking for available orgs without committing yet to a particular
   * choice of user).
   */
  private _isAnonymousUser(users: AvailableUsers): boolean {
    return isSingleUser(users) ? users === this.getAnonymousUserId() :
      users.length === 1 && normalizeEmail(users[0].email) === ANONYMOUS_USER_EMAIL;
  }

  // Set Workspace.removedAt to null (undeletion) or to a datetime (soft deletion)
  private _setWorkspaceRemovedAt(scope: Scope, wsId: number, removedAt: Date|null) {
    return this._connection.transaction(async manager => {
      const wsQuery = this._workspace({...scope, showAll: true}, wsId, {
        manager,
        markPermissions: Permissions.REMOVE
      });
      const workspace: Workspace = this.unwrapQueryResult(await verifyEntity(wsQuery));
      await manager.createQueryBuilder()
        .update(Workspace).set({removedAt}).where({id: workspace.id})
        .execute();
    });
  }

  // Set Document.removedAt to null (undeletion) or to a datetime (soft deletion)
  private _setDocumentRemovedAt(scope: DocScope, removedAt: Date|null) {
    return this._connection.transaction(async manager => {
      let docQuery = this._doc({...scope, showAll: true}, {
        manager,
        markPermissions: Permissions.SCHEMA_EDIT | Permissions.REMOVE,
        allowSpecialPermit: true
      });
      if (!removedAt) {
        docQuery = this._addFeatures(docQuery);  // pull in billing information for doc count limits
      }
      const doc: Document = this.unwrapQueryResult(await verifyEntity(docQuery));
      if (!removedAt) {
        await this._checkRoomForAnotherDoc(doc.workspace, manager);
      }
      await manager.createQueryBuilder()
        .update(Document).set({removedAt}).where({id: doc.id})
        .execute();
    });
  }

  private _filterAccessData(
    scope: Scope,
    users: UserAccessData[],
    maxInheritedRole: roles.BasicRole|null,
    docId?: string
  ): {personal: true, public: boolean}|undefined {
    if (scope.userId === this.getPreviewerUserId()) { return; }

    // If we have special access to the resource, don't filter user information.
    if (scope.specialPermit?.docId === docId && docId) { return; }

    const thisUser = this.getAnonymousUserId() === scope.userId
      ? null
      : users.find(user => user.id === scope.userId);
    const realAccess = thisUser ? getRealAccess(thisUser, { maxInheritedRole, users }) : null;

    // If we are an owner, don't filter user information.
    if (thisUser && realAccess === 'owners') { return; }

    // Limit user information returned to being about the current user.
    users.length = 0;
    if (thisUser) { users.push(thisUser); }
    return { personal: true, public: !realAccess };
  }

  private _getWorkspaceWithACLRules(scope: Scope, wsId: number, options: Partial<QueryOptions> = {}) {
    const query = this._workspace(scope, wsId, {
      markPermissions: Permissions.VIEW,
      ...options
    })
    // Join the workspace's ACL rules (with 1st level groups/users listed).
    .leftJoinAndSelect('workspaces.aclRules', 'acl_rules')
    .leftJoinAndSelect('acl_rules.group', 'workspace_groups')
    .leftJoinAndSelect('workspace_groups.memberUsers', 'workspace_group_users')
    .leftJoinAndSelect('workspace_groups.memberGroups', 'workspace_group_groups')
    .leftJoinAndSelect('workspace_group_users.logins', 'workspace_user_logins')
    .leftJoinAndSelect('workspaces.org', 'org');
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

// Returns all first-level memberUsers in the resources. Requires all resources' aclRules, groups
// and memberUsers to be populated.
// If optRoles is provided, only checks membership in resource groups with the given roles.
function getResourceUsers(res: Resource|Resource[], optRoles?: string[]): User[] {
  res = Array.isArray(res) ? res : [res];
  const users: {[uid: string]: User} = {};
  let resAcls: AclRule[] = flatten(res.map(_res => _res.aclRules as AclRule[]));
  if (optRoles) {
    resAcls = resAcls.filter(_acl => optRoles.includes(_acl.group.name));
  }
  resAcls.forEach((aclRule: AclRule) => {
    aclRule.group.memberUsers.forEach((u: User) => users[u.id] = u);
  });
  const userList = Object.keys(users).map(uid => users[uid]);
  userList.sort((a, b) => a.id - b.id);
  return userList;
}

// Returns a map of userIds to the user's strongest default role on the given resource.
// The resource's aclRules, groups, and memberUsers must be populated.
function getMemberUserRoles<T extends roles.Role>(res: Resource, allowRoles: T[]): {[userId: string]: T} {
  // Add the users to a map to ensure uniqueness. (A user may be present in
  // more than one group)
  const userMap: {[userId: string]: T} = {};
  (res.aclRules as AclRule[]).forEach((aclRule: AclRule) => {
    const role = aclRule.group.name as T;
    if (allowRoles.includes(role)) {
      // Map the users to remove sensitive information from the result and
      // to add the group names.
      aclRule.group.memberUsers.forEach((u: User) => {
        // If the user is already present in another group, use the more
        // powerful role name.
        userMap[u.id] = userMap[u.id] ? roles.getStrongestRole(userMap[u.id], role) : role;
      });
    }
  });
  return userMap;
}

// Extract a human-readable name for the type of entity being selected.
function getFrom(queryBuilder: SelectQueryBuilder<any>): string {
  const alias = queryBuilder.expressionMap.mainAlias;
  return (alias && alias.metadata && alias.metadata.name.toLowerCase()) || 'resource';
}

// Flatten a map of users per role into a simple list of users.
export function removeRole(usersWithRoles: Map<roles.NonGuestRole, User[]>) {
  return flatten([...usersWithRoles.values()]);
}

function getNonGuestGroups(entity: Organization|Workspace|Document): NonGuestGroup[] {
  return (entity.aclRules as AclRule[]).map(aclRule => aclRule.group).filter(isNonGuestGroup);
}

// Returns a map of users indexed by their roles. Optionally excludes users whose ids are in
// excludeUsers.
function getUsersWithRole(groups: NonGuestGroup[], excludeUsers?: number[]): Map<roles.NonGuestRole, User[]> {
  const members = new Map<roles.NonGuestRole, User[]>();
  for (const group of groups) {
    let users = group.memberUsers;
    if (excludeUsers) {
      users = users.filter((user) => !excludeUsers.includes(user.id));
    }
    members.set(group.name, users);
  }
  return members;
}

export async function makeDocAuthResult(docPromise: Promise<Document>): Promise<DocAuthResult> {
  try {
    const doc = await docPromise;
    const removed = Boolean(doc.removedAt || doc.workspace.removedAt);
    return {docId: doc.id, access: doc.access, removed, cachedDoc: doc};
  } catch (error) {
    return {docId: null, access: null, removed: null, error};
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
