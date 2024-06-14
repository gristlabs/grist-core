import { ApiError } from "app/common/ApiError";
import { normalizeEmail } from 'app/common/emails';
import { UserOrgPrefs } from "app/common/Prefs";
import * as roles from 'app/common/roles';
import {
  ANONYMOUS_USER_EMAIL,
  EVERYONE_EMAIL,
  PermissionDelta,
  PREVIEWER_EMAIL,
  UserProfile
} from "app/common/UserAPI";
import { AclRule } from "app/gen-server/entity/AclRule";
import { Document } from "app/gen-server/entity/Document";
import { Group } from "app/gen-server/entity/Group";
import { Login } from "app/gen-server/entity/Login";
import { Organization } from "app/gen-server/entity/Organization";
import { User } from "app/gen-server/entity/User";
import { Workspace } from "app/gen-server/entity/Workspace";
import { appSettings } from "app/server/lib/AppSettings";
import { flatten } from "lodash";
import { EntityManager } from "typeorm";
import { HomeDBManager, PermissionDeltaAnalysis, Scope } from "../HomeDBManager";
import { Permissions } from "../Permissions";
import { GetUserOptions, NonGuestGroup, QueryResult } from "./Interfaces";

// A special user allowed to add/remove the EVERYONE_EMAIL to/from a resource.
export const SUPPORT_EMAIL = appSettings.section('access').flag('supportEmail').requireString({
  envVar: 'GRIST_SUPPORT_EMAIL',
  defaultValue: 'support@getgrist.com',
});

// A list of emails we don't expect to see logins for.
const NON_LOGIN_EMAILS = [PREVIEWER_EMAIL, EVERYONE_EMAIL, ANONYMOUS_USER_EMAIL];

// A specification of the users available during a request.  This can be a single
// user, identified by a user id, or a collection of profiles (typically drawn from
// the session).
export type AvailableUsers = number | UserProfile[];

export class UsersManager {
  public static isSingleUser(users: AvailableUsers): users is number {
    return typeof users === 'number';
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

  // Returns whether the given group is a valid non-guest group.
  public static isNonGuestGroup(group: Group): group is NonGuestGroup {
    return roles.isNonGuestRole(group.name);
  }


  public static getNonGuestGroups(entity: Organization|Workspace|Document): NonGuestGroup[] {
    return (entity.aclRules as AclRule[]).map(aclRule => aclRule.group).filter(UsersManager.isNonGuestGroup);
  }

  private _specialUserIds: {[name: string]: number} = {};  // id for anonymous user, previewer, etc

  private get _connection () {
    return this._homeDb.connection;
  }

  public constructor(private readonly _homeDb: HomeDBManager) {}

  public runInTransaction(transaction: EntityManager|undefined, op: (manager: EntityManager) => Promise<any>) {
    return this._homeDb.runInTransaction(transaction, op);
  }

  public getSpecialUserId(key: string) {
    return this._specialUserIds[key];
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
    const userByLogin = await this.runInTransaction(transaction, async manager => {
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
        const orgId = result.data;
        if (orgId) {
          await this._homeDb.updateOrg({userId: user.id}, orgId, {userOrgPrefs}, manager);
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
    // FIXME: should be handled by the call point
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
      if (user.personalOrg) { await this._homeDb.deleteOrg(scope, user.personalOrg.id, manager); }
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

  // Looks up the emails in the permission delta and adds them to the users map in
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
      // FIXME: below group names should be in UsersManager
      const validRoles = new Set(this._homeDb.defaultBasicGroupNames);
      if (role && !validRoles.has(role)) {
        throw new ApiError(`Invalid maxInheritedRole ${role}`, 400);
      }
    }
    if (delta.users) {
      // Verify roles
      const deltaRoles = Object.keys(delta.users).map(_userId => delta.users![_userId]);
      // Cannot set role "members" on workspace/doc.
      // FIXME: below group names should be in UsersManager
      const validRoles = new Set(isOrg ? this._homeDb.defaultNonGuestGroupNames : this._homeDb.defaultBasicGroupNames);
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
   * Returns a Promise for an array of User entites for the given userIds.
   */
  public async getUsers(userIds: number[], optManager?: EntityManager): Promise<User[]> {
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
      if (user) { id = this._specialUserIds[profile.email] = user.id; }
    }
    if (!id) { throw new Error(`Could not find or create user ${profile.email}`); }
    return id;
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
}