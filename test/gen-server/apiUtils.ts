import {delay} from 'app/common/delay';
import {Role} from 'app/common/roles';
import {UserAPIImpl, UserProfile} from 'app/common/UserAPI';
import {AclRule, AclRuleDoc, AclRuleOrg, AclRuleWs} from 'app/gen-server/entity/AclRule';
import {BillingAccountManager} from 'app/gen-server/entity/BillingAccountManager';
import {Document} from 'app/gen-server/entity/Document';
import {Group} from 'app/gen-server/entity/Group';
import {Organization} from 'app/gen-server/entity/Organization';
import {Resource} from 'app/gen-server/entity/Resource';
import {User} from 'app/gen-server/entity/User';
import {Workspace} from 'app/gen-server/entity/Workspace';
import {SessionUserObj} from 'app/server/lib/BrowserSession';
import {getDocWorkerMap} from 'app/gen-server/lib/DocWorkerMap';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import * as docUtils from 'app/server/lib/docUtils';
import {FlexServer, FlexServerOptions} from 'app/server/lib/FlexServer';
import {main as mergedServerMain, ServerType} from 'app/server/mergedServerMain';
import axios from 'axios';
import FormData from 'form-data';
import fetch from 'node-fetch';
import * as path from 'path';
import {createInitialDb, removeConnection, setUpDB} from 'test/gen-server/seed';
import {setPlan} from 'test/gen-server/testUtils';
import {fixturesRoot} from 'test/server/testUtils';
import {isAffirmative} from 'app/common/gutil';

export class TestServer {
  public serverUrl: string;
  public server: FlexServer;
  public dbManager: HomeDBManager;
  public defaultSession: TestSession;

  constructor(context?: Mocha.Context) {
    setUpDB(context);
  }

  public async start(servers: ServerType[] = ["home"],
                     options: FlexServerOptions = {}): Promise<string> {
    await createInitialDb();
    this.server = await mergedServerMain(0, servers, {logToConsole: isAffirmative(process.env.DEBUG),
                                                      externalStorage: false,
                                                      ...options});
    this.serverUrl = this.server.getOwnUrl();
    this.dbManager = this.server.getHomeDBManager();
    this.defaultSession = new TestSession(this.server);
    return this.serverUrl;
  }

  public async stop() {
    await this.server.close();
    // Wait a few seconds for any late notifications to finish up.
    // TypeORM doesn't give us a very clean way to shut down the db connection,
    // and node-sqlite3 has become fussier about this, and in regular tests
    // we substitute sqlite for postgres.
    if (this.server.hasNotifier()) {
      for (let i = 0; i < 30; i++) {
        if (!this.server.getNotifier().testPending) { break; }
        await delay(100);
      }
    }
    await removeConnection();
  }

  // Set up a profile for the given org, and return an axios configuration to
  // access the api via cookies with that profile.  Leave profile null for anonymous
  // access.
  public async getCookieLogin(
    org: string,
    profile: UserProfile|null,
    options: {clearCache?: boolean, sessionProps?: Partial<SessionUserObj>} = {}
  ) {
    return this.defaultSession.getCookieLogin(org, profile, options);
  }

  // add named user as billing manager to org (identified by domain)
  public async addBillingManager(userName: string, orgDomain: string) {
    const ents = this.dbManager.connection.createEntityManager();
    const org = await ents.findOne(Organization, {
      relations: ['billingAccount'],
      where: {domain: orgDomain}
    });
    const user = await ents.findOne(User, {where: {name: userName}});
    const manager = new BillingAccountManager();
    manager.user = user!;
    manager.billingAccount = org!.billingAccount;
    await manager.save();
  }

  // change a user's personal org to a different product (by default, one that allows anything)
  public async upgradePersonalOrg(userName: string, productName: string = 'Free') {
    const user = await User.findOne({where: {name: userName}});
    if (!user) { throw new Error(`Could not find user ${userName}`); }
    const org = await Organization.findOne({
      relations: ['billingAccount', 'owner'],
      where: {owner: {id: user.id}}  // for some reason finding by name generates wrong SQL.
    });
    if (!org) { throw new Error(`Could not find personal org of ${userName}`); }
    await setPlan(this.dbManager, org, productName);
  }

  // Get an api object for making requests for the named user with the named org.
  // Careful: all api objects using cookie access will be in the same session.
  public async createHomeApi(userName: string, orgDomain: string,
                             useApiKey: boolean = false,
                             checkAccess: boolean = true): Promise<UserAPIImpl> {
    return this.defaultSession.createHomeApi(userName, orgDomain, useApiKey, checkAccess);
  }

  // Get a TestSession representing a distinct session for communicating with the server.
  public newSession() {
    return new TestSession(this.server);
  }

  /**
   * Lists every resource a user is linked to via direct group
   * membership.  The same resource can be listed multiple times if
   * the user is in multiple of its groups (e.g. viewers and guests).
   * A resource the user has access to will not be listed at all if
   * access is granted indirectly (e.g. a doc the user is not linked
   * to via direct group membership won't be listed even if user is in
   * owners group of workspace containing that doc, and the doc
   * inherits access from the workspace).
   */
  public async listUserMemberships(email: string): Promise<ResourceWithRole[]> {
    const rules = await this.dbManager.connection.createQueryBuilder()
      .select('acl_rules')
      .from(AclRule, 'acl_rules')
      .leftJoinAndSelect('acl_rules.group', 'groups')
      .leftJoin('groups.memberUsers', 'users')
      .leftJoin('users.logins', 'logins')
      .where('logins.email = :email', {email})
      .getMany();
    return Promise.all(rules.map(this._getResourceName.bind(this)));
  }

  /**
   * Lists every user with the specified role on the given org.  Only
   * roles set by direct group membership are listed, nothing indirect
   * is included.
   */
  public async listOrgMembership(domain: string, role: Role|null): Promise<User[]> {
    return this._listMembers(role)
      .leftJoin(Organization, 'orgs', 'orgs.id = acl_rules.org_id')
      .andWhere('orgs.domain = :domain', {domain})
      .getMany();
  }

  /**
   * Lists every user with the specified role on the given workspace.  Only
   * roles set by direct group membership are listed, nothing indirect
   * is included.
   */
  public async listWorkspaceMembership(wsId: number, role: Role|null): Promise<User[]> {
    return this._listMembers(role)
      .leftJoin(Workspace, 'workspaces', 'workspaces.id = acl_rules.workspace_id')
      .andWhere('workspaces.id = :wsId', {wsId})
      .getMany();
  }

  // check that the database structure looks sane.
  public async sanityCheck() {
    const badGroups = await this.getBadGroupLinks();
    if (badGroups.length) {
      throw new Error(`badGroups: ${JSON.stringify(badGroups)}`);
    }
  }

  // Find instances of guests and members used in inheritance.
  public async getBadGroupLinks(): Promise<Group[]> {
    // guests and members should never be in other groups, or have groups.
    return this.dbManager.connection.createQueryBuilder()
      .select('groups')
      .from(Group, 'groups')
      .innerJoinAndSelect('groups.memberGroups', 'memberGroups')
      .where(`memberGroups.name IN ('guests', 'members')`)
      .orWhere(`groups.name IN ('guests', 'members')`)
      .getMany();
  }

  /**
   * Copy a fixture doc (e.g. "Hello.grist", no path needed) and make
   * it accessible with the given docId (no ".grist" extension or path).
   */
  public async copyFixtureDoc(srcName: string, docId: string) {
    const docsRoot = this.server.docsRoot;
    const srcPath = path.resolve(fixturesRoot, 'docs', srcName);
    await docUtils.copyFile(srcPath, path.resolve(docsRoot, `${docId}.grist`));
  }

  public getWorkStore() {
    return getDocWorkerMap();
  }

  /**
   * Looks up the resource related to an aclRule.
   * TODO: rework AclRule to automate this kind of step.
   */
  private async _getResourceName(aclRule: AclRule): Promise<ResourceWithRole> {
    const con = this.dbManager.connection.manager;
    let res: Document|Workspace|Organization|null;
    if (aclRule instanceof AclRuleDoc) {
      res = await con.findOne(Document, {where: {id: aclRule.docId}});
    } else if (aclRule instanceof AclRuleWs) {
      res = await con.findOne(Workspace, {where: {id: aclRule.workspaceId}});
    } else if (aclRule instanceof AclRuleOrg) {
      res = await con.findOne(Organization, {where: {id: aclRule.orgId}});
    } else {
      throw new Error('unknown type');
    }
    if (!res) { throw new Error('could not find resource'); }
    return {res, role: aclRule.group.name};
  }

  /**
   * Lists users and the groups/aclRules they are members of.
   * Filters for groups of the specified name.
   */
  private _listMembers(role: Role|null) {
    let q = this.dbManager.connection.createQueryBuilder()
      .select('users')
      .from(User, 'users')
      .leftJoin('users.groups', 'groups')
      .leftJoin('groups.aclRule', 'acl_rules')
      .leftJoinAndSelect('users.logins', 'logins');
    if (role) {
      q = q.andWhere('groups.name = :role', {role});
    }
    return q;
  }
}

/**
 * A distinct session.  Any api objects created with this that use cookies will share
 * the same session as each other, and be in a distinct session to other TestSessions.
 *
 * Calling createHomeApi on the server object directly results in api objects that are
 * all within the same session, which is not always desirable.  Api key access can be
 * used to work around this, but that can also be awkward.
 */
export class TestSession {
  public headers: {[key: string]: string};

  constructor(public home: FlexServer) {
    this.headers = {};
  }

  // Set up a profile for the given org, and return an axios configuration to
  // access the api via cookies with that profile.  Leave profile null for anonymous
  // access.
  public async getCookieLogin(
    org: string,
    profile: UserProfile|null,
    {clearCache, sessionProps}: {clearCache?: boolean, sessionProps?: Partial<SessionUserObj>} = {}
  ) {
    const resp = await axios.get(`${this.home.getOwnUrl()}/test/session`,
                                 {validateStatus: (s => s < 400), headers: this.headers});
    const cookie = this.headers.Cookie || resp.headers['set-cookie'][0];
    const cid = decodeURIComponent(cookie.split('=')[1].split(';')[0]);
    const sessionId = this.home.getSessions().getSessionIdFromCookie(cid);
    const scopedSession = this.home.getSessions().getOrCreateSession(sessionId as string, org, '');
    await scopedSession.updateUserProfile({} as any, profile);
    if (sessionProps) { await scopedSession.updateUser({} as any, sessionProps); }
    if (clearCache) { this.home.getSessions().clearCacheIfNeeded(); }
    this.headers.Cookie = cookie;
    return {
      validateStatus: (status: number) => true,
      headers: {
        'Cookie': cookie,
        'X-Requested-With': 'XMLHttpRequest',
      }
    };
  }

  // get an api object for making requests for the named user with the named org.
  public async createHomeApi(userName: string, orgDomain: string,
                             useApiKey: boolean = false,
                             checkAccess: boolean = true): Promise<UserAPIImpl> {
    const headers: {[key: string]: string} = {};
    if (useApiKey) {
      headers.Authorization = 'Bearer api_key_for_' + userName.toLowerCase();
    } else {
      const cookie = await this.getCookieLogin(orgDomain, {
        email: `${userName.toLowerCase()}@getgrist.com`,
        name: userName
      });
      headers.Cookie = cookie.headers.Cookie;
    }
    const api = new UserAPIImpl(`${this.home.getOwnUrl()}/o/${orgDomain}`, {
      fetch: fetch as any,
      headers,
      newFormData: () => new FormData() as any,
    });
    // Make sure api is functioning, and create user if this is their first time to hit API.
    if (checkAccess) { await api.getOrg('current'); }
    return api;
  }
}

/**
 * A resource and the name of the group associated with it that the user is in.
 */
export interface ResourceWithRole {
  res: Resource;
  role: string;
}
