import { ApiError } from 'app/common/ApiError';
import { normalizeEmail } from 'app/common/emails';
import { PERSONAL_FREE_PLAN } from 'app/common/Features';
import { buildUrlId } from 'app/common/gristUrls';
import { UserOrgPrefs } from 'app/common/Prefs';
import * as roles from 'app/common/roles';
import {
  ANONYMOUS_USER_EMAIL,
  EVERYONE_EMAIL,
  FullUser,
  PermissionDelta,
  PREVIEWER_EMAIL,
  UserOptions,
  UserProfile
} from 'app/common/UserAPI';
import { AclRule } from 'app/gen-server/entity/AclRule';
import { Document } from 'app/gen-server/entity/Document';
import { Group } from 'app/gen-server/entity/Group';
import { Login } from 'app/gen-server/entity/Login';
import { User } from 'app/gen-server/entity/User';
import { appSettings } from 'app/server/lib/AppSettings';
import { HomeDBManager, PermissionDeltaAnalysis, Scope, UserIdDelta } from 'app/gen-server/lib/homedb/HomeDBManager';
import {
  AvailableUsers, GetUserOptions, NonGuestGroup, QueryResult, Resource, RunInTransaction, UserProfileChange
} from 'app/gen-server/lib/homedb/Interfaces';
import { Permissions } from 'app/gen-server/lib/Permissions';
import { Pref } from 'app/gen-server/entity/Pref';

import flatten from 'lodash/flatten';
import { EntityManager, IsNull, Not } from 'typeorm';

// A special user allowed to add/remove both the EVERYONE_EMAIL and ANONYMOUS_USER_EMAIL to/from a resource.
export const SUPPORT_EMAIL = appSettings.section('access').flag('supportEmail').requireString({
  envVar: 'GRIST_SUPPORT_EMAIL',
  defaultValue: 'support@getgrist.com',
});

// A list of emails we don't expect to see logins for.
const NON_LOGIN_EMAILS = [PREVIEWER_EMAIL, EVERYONE_EMAIL, ANONYMOUS_USER_EMAIL];

/**
 * Class responsible for Users Management.
 *
 * It's only meant to be used by HomeDBManager. If you want to use one of its (instance or static) methods,
 * please make an indirection which passes through HomeDBManager.
 */
export class UsersManager {
  public static isSingleUser(users: AvailableUsers): users is number {
    return typeof users === 'number';
  }

  // Returns all first-level memberUsers in the resources. Requires all resources' aclRules, groups
  // and memberUsers to be populated.
  // If optRoles is provided, only checks membership in resource groups with the given roles.
  public static getResourceUsers(res: Resource|Resource[], optRoles?: string[]): User[] {
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

  // Returns a map of users indexed by their roles. Optionally excludes users whose ids are in
  // excludeUsers.
  public static getUsersWithRole(groups: NonGuestGroup[], excludeUsers?: number[]): Map<roles.NonGuestRole, User[]> {
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

  private _specialUserIds: {[name: string]: number} = {}; // id for anonymous user, previewer, etc

  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(
    private readonly _homeDb: HomeDBManager,
    private _runInTransaction: RunInTransaction
  ) {}

  /**
   * Clear all user preferences associated with the given email addresses.
   * For use in tests.
   */
  public async testClearUserPrefs(emails: string[]) {
    return await this._connection.transaction(async manager => {
      for (const email of emails) {
        const user = await this.getExistingUserByLogin(email, manager);
        if (user) {
          await manager.delete(Pref, {userId: user.id});
        }
      }
    });
  }

  public getSpecialUserId(key: string) {
    return this._specialUserIds[key];
  }

  /**
   * Return the special user ids.
   */
  public getSpecialUserIds() {
    return Object.values(this._specialUserIds);
  }

  /**
   *
   * Get the id of the anonymous user.
   *
   */
  public getAnonymousUserId(): number {
    const id = this._specialUserIds[ANONYMOUS_USER_EMAIL];
    if (!id) { throw new Error("'Anonymous' user not available"); }
    return id;
  }

  /**
   * Get the id of the thumbnail user.
   */
  public getPreviewerUserId(): number {
    const id = this._specialUserIds[PREVIEWER_EMAIL];
    if (!id) { throw new Error("'Previewer' user not available"); }
    return id;
  }

  /**
   * Get the id of the 'everyone' user.
   */
  public getEveryoneUserId(): number {
    const id = this._specialUserIds[EVERYONE_EMAIL];
    if (!id) { throw new Error("'Everyone' user not available"); }
    return id;
  }

  /**
   * Get the id of the 'support' user.
   */
  public getSupportUserId(): number {
    const id = this._specialUserIds[SUPPORT_EMAIL];
    if (!id) { throw new Error("'Support' user not available"); }
    return id;
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
      firstLoginAt: user.firstLoginAt || null,
      disabledAt: user.disabledAt,
    };
    if (user.firstLoginAt) {
      result.firstLoginAt = user.firstLoginAt;
    }
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
        // No need to survey this user.
        newUser.isFirstTimeUser = false;
        await manager.save(newUser);
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

  public async updateUser(userId: number, props: UserProfileChange){
    return await this._connection.transaction(async manager => {
      let isWelcomed = false;
      let needsSave = false;
      const user = await manager.findOne(User, {
        relations: ['logins'],
        where: {id: userId},
      });
      if (!user) { throw new ApiError("unable to find user", 400); }

      const previous = structuredClone(user);
      if (props.name && props.name !== user.name) {
        user.name = props.name;
        needsSave = true;
      }
      if (props.disabledAt !== undefined && props.disabledAt !== user.disabledAt) {
        user.disabledAt = props.disabledAt;
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
        await manager.save(user);
      }
      return {previous, current: user, isWelcomed};
    });
  }

  // TODO: rather use the updateUser() method, if that makes sense?
  public async updateUserOptions(userId: number, props: Partial<UserOptions>) {
    await this._runInTransaction(undefined, async manager => {
      const user = await manager.findOne(User, {where: {id: userId}});
      if (!user) { throw new ApiError("unable to find user", 400); }
      user.options = {...(user.options ?? {}), ...props};
      await manager.save(user);
    });
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

  // Fetch user from login, creating the user if previously unseen, allowing one retry
  // for an email key conflict failure. This is in case our transaction conflicts with a peer
  // doing the same thing. This is quite likely if the first page visited by a previously
  // unseen user fires off multiple api calls.
  public async getUserByLoginWithRetry(email: string, options: GetUserOptions = {}): Promise<User> {
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
   * Find a user by email. Don't create the user if it doesn't already exist.
   */
  public async getExistingUserByLogin(
    email: string,
    manager?: EntityManager
  ): Promise<User|undefined> {
    return await this._buildExistingUsersByLoginRequest([email], manager)
      .getOne() || undefined;
  }

  /**
   * Find some users by their emails. Don't create the users if they don't already exist.
   */
  public async getExistingUsersByLogin(
    emails: string[],
    manager?: EntityManager
  ): Promise<User[]> {
    if (emails.length === 0){
      return [];
    }
    return await this._buildExistingUsersByLoginRequest(emails, manager)
      .getMany();
  }

  /**
   *
   * Fetches a user record based on an email address. If a user record already
   * exists linked to the email address supplied, that is the record returned.
   * Otherwise a fresh record is created, linked to the supplied email address.
   * The supplied `options` are used when creating a fresh record, or updating
   * unset/outdated fields of an existing record.
   *
   */
  public async getUserByLogin(email: string, options: GetUserOptions = {}) {
    const {manager: transaction, profile, userOptions} = options;
    const normalizedEmail = normalizeEmail(email);
    return await this._runInTransaction(transaction, async manager => {
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
        // Set the user's name if our provider knows it. Otherwise use their username
        // from email, for lack of something better. If we don't have a profile at this
        // time, then leave the name blank in the hopes of learning it when the user logs in.
        user.name = (profile && this._getNameOrDeduceFromEmail(profile.name, email)) || '';
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
        // instance. It will get overwritten when the user logs in if the provider's
        // version is different.
        login.displayEmail = email;
        needUpdate = true;
      }
      if (!user.options?.authSubject && userOptions?.authSubject) {
        // Link subject from password-based authentication provider if not previously linked.
        user.options = {...(user.options ?? {}), authSubject: userOptions.authSubject};
        needUpdate = true;
      }
      // We might want to store extra information returned by the identity provider
      if (options.profile?.extra) {
        // Update already existing user options
        user.options = {...user.options, ssoExtraInfo: options.profile.extra};
        needUpdate = true;
      }

      // get date of now (remove milliseconds for compatibility with other
      // timestamps in db set by typeorm, and since second level precision is fine)
      const nowish = new Date();
      nowish.setMilliseconds(0);
      if (profile && !user.firstLoginAt) {
        // set first login time to now
        user.firstLoginAt = nowish;
        needUpdate = true;
      }
      const getTimestampStartOfDay = (date: Date) => {
        const timestamp = Math.floor(date.getTime() / 1000); // unix timestamp seconds from epoc
        const startOfDay = timestamp - (timestamp % 86400 /*24h*/); // start of a day in seconds since epoc
        return startOfDay;
      };
      if (!user.lastConnectionAt || getTimestampStartOfDay(user.lastConnectionAt) !== getTimestampStartOfDay(nowish)) {
        user.lastConnectionAt = nowish;
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
        const result = await this._homeDb.addOrg(user, {name: "Personal"}, {
          setUserAsOwner: true,
          useNewPlan: true,
          product: PERSONAL_FREE_PLAN,
        }, manager);
        if (result.status !== 200) {
          throw new Error(result.errMessage);
        }
        needUpdate = true;

        // We just created a personal org; set userOrgPrefs that should apply for new users only.
        const userOrgPrefs: UserOrgPrefs = {showGristTour: true};
        const org = result.data;
        if (org) {
          await this._homeDb.updateOrg({userId: user.id}, org.id, {userOrgPrefs}, manager);
        }
      }
      if (needUpdate) {
        // We changed the db - reload user in order to give consistent results.
        // In principle this could be optimized, but this is simpler to maintain.
        user = await userQuery.getOne();
      }
      return user!;
    });
  }

  /*
   * Deletes a user from the database. For the moment, the only person with the right
   * to delete a user is the user themselves.
   * Users have logins, a personal org, and entries in the group_users table. All are
   * removed together in a transaction. All material in the personal org will be lost.
   *
   * @param scope: request scope, including the id of the user initiating this action
   * @param userIdToDelete: the id of the user to delete from the database
   * @param name: optional cross-check, delete only if user name matches this
   */
  public async deleteUser(scope: Scope, userIdToDelete: number,
                          name?: string): Promise<QueryResult<User>> {
    const userIdDeleting = scope.userId;
    if (userIdDeleting !== userIdToDelete) {
      throw new ApiError('not permitted to delete this user', 403);
    }

    // Deleting a user leaves their forks orphaned, inaccessible.
    // Worse, even Grist loses track of how to access them on
    // disk and in external storage, since they are identified
    // using a composite key that includes the user id. So we
    // delete the forks now. Deleting can be a relatively slow
    // operation, since in general it needs to work via
    // communication with doc workers. So we do it outside
    // the main transaction for deleting the user. Within
    // the transaction, we simply check that no forks have
    // since appeared. Staying outside the transaction is
    // important also for single-process Grist combining
    // home server and doc worker.
    const forksToDelete = await this._connection.getRepository(Document).find({
      where: {
        createdBy: userIdToDelete,
        trunkId: Not(IsNull()),
      }});
    // Delete external storage for orphaned forks.
    // This might take some time, if there's a lot of them.
    for (const doc of forksToDelete) {
      // In tests the storage coordinator may not be present and
      // that's usually fine. But if we're deleting forks it had
      // better be there.
      if (!this._homeDb.storageCoordinator) {
        throw new Error('no mechanism available to delete forks');
      }
      const fullId = buildUrlId({trunkId: doc.trunkId!, forkId: doc.id, forkUserId: doc.createdBy!});
      await this._homeDb.storageCoordinator.hardDeleteDoc(fullId);
    }

    return await this._connection.transaction(async manager => {
      const user = await manager.findOne(User, {where: {id: userIdToDelete},
                                                relations: ["logins", "personalOrg", "prefs"]});
      if (!user) { throw new ApiError('user not found', 404); }
      if (name) {
        if (user.name !== name) {
          throw new ApiError(`user name did not match ('${name}' vs '${user.name}')`, 400);
        }
      }
      if (user.personalOrg) { await this._homeDb.deleteOrg(scope, user.personalOrg.id, manager); }

      // Unset 'created_by' on any documents created by this user. It's sad to lose this info, but
      // we can't leave an invalid reference (and violate the foreign-key constraint)
      const docs = await manager.getRepository(Document).find({where: {createdBy: userIdToDelete}});
      docs.forEach(doc => {
        if (doc.trunkId) {
          // We tried cleaning up forks before starting the
          // transaction but one snuck back in? Just bail.
          throw new ApiError('Untimely document addition? Please retry.', 503);
        } else {
          doc.createdBy = null;
        }
      });
      await manager.save(docs);

      await manager.remove([...user.logins]);
      // We don't have a GroupUser entity, and adding one tickles lots of TypeOrm quirkiness,
      // so use a plain query to delete entries in the group_users table.
      await manager.createQueryBuilder()
        .delete()
        .from('group_users')
        .where('user_id = :userId', {userId: userIdToDelete})
        .execute();

      await manager.delete(User, userIdToDelete);
      return {
        status: 200,
        data: user,
      };
    });
  }

  public async initializeSpecialIds(): Promise<void> {
    await this._maybeCreateSpecialUserId({
      email: ANONYMOUS_USER_EMAIL,
      name: "Anonymous"
    });
    await this._maybeCreateSpecialUserId({
      email: PREVIEWER_EMAIL,
      name: "Preview"
    });
    await this._maybeCreateSpecialUserId({
      email: EVERYONE_EMAIL,
      name: "Everyone"
    });
    await this._maybeCreateSpecialUserId({
      email: SUPPORT_EMAIL,
      name: "Support"
    });
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
      .filter(fullProfile => fullProfile);
  }

  /**
   * Update users with passed property. Optional user properties that are missing will be reset to their default value.
   */
  public async overwriteUser(userId: number, props: UserProfile): Promise<User> {
    return await this._connection.transaction(async manager => {
      const user = await this.getUser(userId, {includePrefs: true});
      if (!user) { throw new ApiError("unable to find user to update", 404); }
      const login = user.logins[0];
      user.name = this._getNameOrDeduceFromEmail(props.name, props.email);
      user.picture = props.picture || '';
      user.options = {...(user.options || {}), locale: props.locale ?? undefined};
      if (props.email) {
        login.email = normalizeEmail(props.email);
        login.displayEmail = props.email;
      }
      await manager.save([user, login]);

      return (await this.getUser(userId))!;
    });
  }

  public async getUsers() {
    return await User.find({relations: ["logins"]});
  }


  /**
   * ==================================
   *
   * Below methods are public but not exposed by HomeDBManager
   *
   * They are meant to be used internally (i.e. by homedb/ modules)
   *
   */

  // Looks up the emails in the permission delta and adds them to the users maps in
  // the delta object.
  // Returns a QueryResult based on the validity of the passed in PermissionDelta object.
  public async verifyAndLookupDeltaEmails(
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
    const hasUsers = delta.users; // allow zero actual changes; useful to reduce special
                                  // cases in scripts
    if ((isOrg && (hasInherit || !hasUsers)) || (!isOrg && !hasInherit && !hasUsers)) {
      throw new ApiError('Bad request: invalid permission delta', 400);
    }
    // Lookup the email access changes and move them to the users object.
    const notFoundUserEmailDelta: {[email: string]: roles.NonGuestRole} = {};
    const foundUserIdDelta: {[userId: string]: roles.NonGuestRole|null} = {};
    if (hasInherit) {
      // Verify maxInheritedRole
      const role = delta.maxInheritedRole;
      const validRoles = new Set(this._homeDb.defaultBasicGroupNames);
      if (role && !validRoles.has(role)) {
        throw new ApiError(`Invalid maxInheritedRole ${role}`, 400);
      }
    }
    let foundUsers: User[] = [];
    if (delta.users) {
      // Verify roles
      const deltaRoles = Object.keys(delta.users).map(_userId => delta.users![_userId]);
      // Cannot set role "members" on workspace/doc.
      const validRoles = new Set(isOrg ? this._homeDb.defaultNonGuestGroupNames : this._homeDb.defaultBasicGroupNames);
      for (const role of deltaRoles) {
        if (role && !validRoles.has(role)) {
          throw new ApiError(`Invalid user role ${role}`, 400);
        }
      }
      // Lookup emails
      const emailMap = delta.users;
      const emails = Object.keys(emailMap);
      foundUsers = await this.getExistingUsersByLogin(emails, transaction);
      const emailUsers = new Map(foundUsers.map(user => [user.loginEmail, user]));
      for (const email of emails) {
        const user = emailUsers.get(normalizeEmail(email));
        const role = emailMap[email];
        if (!user && role === null) {
          // Removing access from non-existant users is a no-op.
          continue;
        }

        if (user) {
          // Org-level sharing with everyone would allow serious spamming - forbid it.
          if (
            role !== null && // allow removing anything
            userId !== this.getSupportUserId() && // allow support user latitude
            user.id === this.getEveryoneUserId() &&
            isOrg
          ) {
            throw new ApiError(
              "This user cannot share with everyone at top level",
              403
            );
          }
          foundUserIdDelta[user.id] = role;
        } else {
          notFoundUserEmailDelta[email] = role!;
        }
      }
    }
    const userIdsAndEmails = [
      ...Object.keys(foundUserIdDelta),
      ...Object.keys(notFoundUserEmailDelta),
    ];
    const removingSelf =
      userIdsAndEmails.length === 1 &&
      userIdsAndEmails[0] === String(userId) &&
      delta.maxInheritedRole === undefined &&
      foundUserIdDelta[userId] === null;
    const permissionThreshold = removingSelf
      ? Permissions.VIEW
      : Permissions.ACL_EDIT;
    return {
      foundUserDelta: delta.users ? foundUserIdDelta : null,
      foundUsers,
      notFoundUserDelta: delta.users ? notFoundUserEmailDelta : null,
      permissionThreshold,
      affectsSelf: userId in foundUserIdDelta,
    };
  }

  public async translateDeltaEmailsToUserIds(
    userDelta: { [email: string]: roles.NonGuestRole | null },
    transaction?: EntityManager
  ): Promise<{ userDelta: UserIdDelta; users: User[] }> {
    const newDelta: UserIdDelta = {};
    const users: User[] = [];
    for (const [email, value] of Object.entries(userDelta)) {
      const user = await this.getUserByLogin(email, {
        manager: transaction,
      });
      newDelta[user.id] = value;
      users.push(user);
    }
    return {
      userDelta: newDelta,
      users,
    };
  }

  /**
   * Check for anonymous user, either encoded directly as an id, or as a singular
   * profile (this case arises during processing of the session/access/all endpoint
   * whether we are checking for available orgs without committing yet to a particular
   * choice of user).
   */
  public isAnonymousUser(users: AvailableUsers): boolean {
    return UsersManager.isSingleUser(users) ? users === this.getAnonymousUserId() :
      users.length === 1 && normalizeEmail(users[0].email) === ANONYMOUS_USER_EMAIL;
  }

  /**
   * Get ids of users to be excluded from member counts and emails.
   */
  public getExcludedUserIds(): number[] {
    return [this.getSupportUserId(), this.getAnonymousUserId(), this.getEveryoneUserId()];
  }

  /**
   * Returns a Promise for an array of User entities for the given userIds.
   */
  public async getUsersByIds(
    userIds: number[],
    options: {manager?: EntityManager, withLogins?: boolean} = {}
  ): Promise<User[]> {
    if (userIds.length === 0) {
      return [];
    }
    const manager = options.manager || new EntityManager(this._connection);
    const queryBuilder = manager.createQueryBuilder()
      .select('users')
      .from(User, 'users')
      .chain(qb => options.withLogins ? qb.leftJoinAndSelect('users.logins', 'logins') : qb)
      .where('users.id IN (:...userIds)', {userIds});
    return await queryBuilder.getMany();
  }

  /**
   * Returns a Promise for an array of User entities for the given userIds.
   * Throws an error if any of the users are not found.
   * This is useful when we expect all users to exist, and otherwise throw an error.
   */
  public async getUsersByIdsStrict(userIds: number[], optManager?: EntityManager): Promise<User[]> {
    const users = await this.getUsersByIds(userIds, { manager: optManager });
    if (users.length !== userIds.length) {
      const foundUserIds = new Set(users.map(user => user.id));
      const missingUserIds = userIds.filter(userId => !foundUserIds.has(userId));
      throw new ApiError('Users not found: ' + missingUserIds.join(', '), 404);
    }
    return users;
  }

  /**
   * Don't add everyone@ as a guest, unless also sharing with anon@.
   * This means that material shared with everyone@ doesn't become
   * listable/discoverable by default.
   *
   * This is a HACK to allow existing example doc setup to continue to
   * work. It could be removed if we are willing to share the entire
   * support org with users. E.g. move any material we don't want to
   * share into a workspace that doesn't inherit ACLs. TODO: remove
   * this hack, or enhance it up as a way to support discoverability /
   * listing. It has the advantage of cloning well.
   */
  public filterEveryone(users: User[]): User[] {
    const everyone = this.getEveryoneUserId();
    const anon = this.getAnonymousUserId();
    if (users.find(u => u.id === anon)) { return users; }
    return users.filter(u => u.id !== everyone);
  }

  // Given two arrays of groups, returns a map of users present in the first array but
  // not the second, where the map is broken down by user role.
  // This method is used for checking limits on shares.
  // Excluded users are removed from the results.
  public getUserDifference(groupsA: Group[], groupsB: Group[]): Map<roles.NonGuestRole, User[]> {
    const subtractSet: Set<number> =
      new Set(flatten(groupsB.map(grp => grp.memberUsers)).map(usr => usr.id));
    const result = new Map<roles.NonGuestRole, User[]>();
    for (const group of groupsA) {
      const name = group.name;
      if (!roles.isNonGuestRole(name)) { continue; }
      result.set(name, group.memberUsers.filter(user => !subtractSet.has(user.id)));
    }
    return this.withoutExcludedUsers(result);
  }

  public withoutExcludedUsers(members: Map<roles.NonGuestRole, User[]>): Map<roles.NonGuestRole, User[]> {
    const excludedUsers = this.getExcludedUserIds();
    for (const [role, users] of members.entries()) {
      members.set(role, users.filter((user) => !excludedUsers.includes(user.id)));
    }
    return members;
  }


  // For the moment only the support user can add both everyone@ and anon@ to a
  // resource, since that allows spam. TODO: enhance or remove.
  public checkUserChangeAllowed(userId: number, groups: Group[]) {
    if (userId === this.getSupportUserId()) { return; }
    const ids = new Set(flatten(groups.map(g => g.memberUsers)).map(u => u.id));
    if (ids.has(this.getEveryoneUserId()) && ids.has(this.getAnonymousUserId())) {
      throw new Error('this user cannot share with everyone and anonymous');
    }
  }

  /**
   *
   * Get the id of a special user, creating that user if it is not already present.
   *
   */
  private async _maybeCreateSpecialUserId(profile: UserProfile) {
    let id = this._specialUserIds[profile.email];
    if (!id) {
      // get or create user - with retry, since there'll be a race to create the
      // user if a bunch of servers start simultaneously and the user doesn't exist
      // yet.
      const user = await this.getUserByLoginWithRetry(profile.email, {profile});
      id = this._specialUserIds[profile.email] = user.id;
    }
    if (!id) { throw new Error(`Could not find or create user ${profile.email}`); }
    return id;
  }

  private _getNameOrDeduceFromEmail(name: string, email: string) {
    return name || email.split('@')[0];
  }

  // This deals with the problem posed by receiving a PermissionDelta specifying a
  // role for both alice@x and Alice@x. We do not distinguish between such emails.
  // If there are multiple indistinguishabe emails, we preserve just one of them,
  // assigning it the most powerful permission specified. The email variant perserved
  // is the earliest alphabetically.
  private _mergeIndistinguishableEmails(delta: PermissionDelta) {
    if (!delta.users) { return; }
    // We normalize emails for comparison, but track how they were capitalized
    // in order to preserve it. This is worth doing since for the common case
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

  private _buildExistingUsersByLoginRequest(
    emails: string[],
    manager?: EntityManager
  ) {
    const normalizedEmails = emails.map(email=> normalizeEmail(email));
    return (manager || this._connection).createQueryBuilder()
      .select('user')
      .from(User, 'user')
      .leftJoinAndSelect('user.logins', 'logins')
      .where('email IN (:...emails)', {emails: normalizedEmails});
  }
}
