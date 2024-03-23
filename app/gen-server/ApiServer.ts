import * as crypto from 'crypto';
import * as express from 'express';
import {EntityManager} from 'typeorm';
import * as cookie from 'cookie';
import {Request} from 'express';

import {ApiError} from 'app/common/ApiError';
import {FullUser} from 'app/common/LoginSessionAPI';
import {BasicRole} from 'app/common/roles';
import {OrganizationProperties, PermissionDelta} from 'app/common/UserAPI';
import {User} from 'app/gen-server/entity/User';
import {BillingOptions, HomeDBManager, QueryResult, Scope} from 'app/gen-server/lib/HomeDBManager';
import {getAuthorizedUserId, getUserId, getUserProfiles, RequestWithLogin} from 'app/server/lib/Authorizer';
import {getSessionUser, linkOrgWithEmail} from 'app/server/lib/BrowserSession';
import {expressWrap} from 'app/server/lib/expressWrap';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import {GristServer} from 'app/server/lib/GristServer';
import {getTemplateOrg} from 'app/server/lib/gristSettings';
import log from 'app/server/lib/log';
import {addPermit, clearSessionCacheIfNeeded, getDocScope, getScope, integerParam,
        isParameterOn, optStringParam, sendOkReply, sendReply, stringParam} from 'app/server/lib/requestUtils';
import {IWidgetRepository} from 'app/server/lib/WidgetRepository';
import {getCookieDomain} from 'app/server/lib/gristSessions';

// exposed for testing purposes
export const Deps = {
  apiKeyGenerator: () => crypto.randomBytes(20).toString('hex')
};

// Fetch the org this request was made for, or null if it isn't tied to a particular org.
// Early middleware should have put the org in the request object for us.
export function getOrgFromRequest(req: Request): string|null {
  return (req as RequestWithOrg).org || null;
}

/**
 * Compute the signature of the user's email address using HelpScout's secret key, to prove to
 * HelpScout the user identity for identifying customer information and conversation history.
 */
function helpScoutSign(email: string): string|undefined {
  const secretKey = process.env.HELP_SCOUT_SECRET_KEY_V2;
  if (!secretKey) { return undefined; }
  return crypto.createHmac('sha256', secretKey).update(email).digest('hex');
}

/**
 * Fetch an identifier for an organization from the "oid" parameter of the request.
 *   - Integers are accepted, and will be compared with values in orgs.id column
 *   - Strings are accepted, and will be compared with values in orgs.domain column
 *     (or, if they match the pattern docs-NNNN, will check orgs.owner_id)
 *   - The special string "current" is replaced with the current org domain embedded
 *     in the url
 *   - If there is no identifier available, a 400 error is thrown.
 */
export function getOrgKey(req: Request): string|number {
  let orgKey: string|null = stringParam(req.params.oid, 'oid');
  if (orgKey === 'current') {
    orgKey = getOrgFromRequest(req);
  }
  if (!orgKey) {
    throw new ApiError("No organization chosen", 400);
  } else if (/^\d+$/.test(orgKey)) {
    return parseInt(orgKey, 10);
  }
  return orgKey;
}

// Adds an non-personal org with a new billingAccount, with the given name and domain.
// Returns a QueryResult with the orgId on success.
export function addOrg(
  dbManager: HomeDBManager,
  userId: number,
  props: Partial<OrganizationProperties>,
  options?: {
    planType?: string,
    billing?: BillingOptions,
  }
): Promise<number> {
  return dbManager.connection.transaction(async manager => {
    const user = await manager.findOne(User, {where: {id: userId}});
    if (!user) { return handleDeletedUser(); }
    const query = await dbManager.addOrg(user, props, {
      ...options,
      setUserAsOwner: false,
      useNewPlan: true
    }, manager);
    if (query.status !== 200) { throw new ApiError(query.errMessage!, query.status); }
    return query.data!;
  });
}

/**
 * Provides a REST API for the landing page, which returns user's workspaces, organizations and documents.
 * Temporarily sqlite database is used. Later it will be changed to RDS Aurora or PostgreSQL.
 */
export class ApiServer {
  /**
   * Add API endpoints to the specified connection. An error handler is added to /api to make sure
   * all error responses have a body in json format.
   *
   * Note that it expects bodyParser, userId, and jsonErrorHandler middleware to be set up outside
   * to apply to these routes, and trustOrigin too for cross-domain requests.
   */
  constructor(
    private _gristServer: GristServer,
    private _app: express.Application,
    private _dbManager: HomeDBManager,
    private _widgetRepository: IWidgetRepository
  ) {
    this._addEndpoints();
  }

  private _addEndpoints(): void {
    // GET /api/orgs
    // Get all organizations user may have some access to.
    this._app.get('/api/orgs', expressWrap(async (req, res) => {
      const userId = getUserId(req);
      const domain = getOrgFromRequest(req);
      const merged = Boolean(req.query.merged);
      const query = merged ?
        await this._dbManager.getMergedOrgs(userId, userId, domain) :
        await this._dbManager.getOrgs(userId, domain);
      return sendReply(req, res, query);
    }));

    // GET /api/workspace/:wid
    // Get workspace by id, returning nested documents that user has access to.
    this._app.get('/api/workspaces/:wid', expressWrap(async (req, res) => {
      const wsId = integerParam(req.params.wid, 'wid');
      const query = await this._dbManager.getWorkspace(getScope(req), wsId);
      return sendReply(req, res, query);
    }));

    // GET /api/orgs/:oid
    // Get organization by id
    this._app.get('/api/orgs/:oid', expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const query = await this._dbManager.getOrg(getScope(req), org);
      return sendReply(req, res, query);
    }));

    // GET /api/orgs/:oid/workspaces
    // Get all workspaces and nested documents of organization that user has access to.
    this._app.get('/api/orgs/:oid/workspaces', expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const query = await this._dbManager.getOrgWorkspaces(getScope(req), org);
      return sendReply(req, res, query);
    }));

    // GET /api/orgs/:oid/usage
    // Get usage summary of all un-deleted documents in the organization.
    // Only accessible to org owners.
    this._app.get('/api/orgs/:oid/usage', expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const usage = await this._dbManager.getOrgUsageSummary(getScope(req), org);
      return sendOkReply(req, res, usage);
    }));

    // POST /api/orgs
    // Body params: name (required), domain
    // Create a new org.
    this._app.post('/api/orgs', expressWrap(async (req, res) => {
      // Don't let anonymous users end up owning organizations, it will be confusing.
      // Maybe if the user has presented credentials this would be ok - but addOrg
      // doesn't have access to that information yet, so punting on this.
      // TODO: figure out who should be allowed to create organizations
      const userId = getAuthorizedUserId(req);
      const orgId = await addOrg(this._dbManager, userId, req.body);
      return sendOkReply(req, res, orgId);
    }));

    // PATCH /api/orgs/:oid
    // Body params: name, domain
    // Update the specified org.
    this._app.patch('/api/orgs/:oid', expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const query = await this._dbManager.updateOrg(getScope(req), org, req.body);
      return sendReply(req, res, query);
    }));

    // DELETE /api/orgs/:oid
    // Delete the specified org and all included workspaces and docs.
    this._app.delete('/api/orgs/:oid', expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const query = await this._dbManager.deleteOrg(getScope(req), org);
      return sendReply(req, res, query);
    }));

    // POST /api/orgs/:oid/workspaces
    // Body params: name
    // Create a new workspace owned by the specific organization.
    this._app.post('/api/orgs/:oid/workspaces', expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      const org = getOrgKey(req);
      const query = await this._dbManager.addWorkspace(getScope(req), org, req.body);
      this._gristServer.getTelemetry().logEvent(mreq, 'createdWorkspace', {
        full: {
          workspaceId: query.data,
          userId: mreq.userId,
        },
      });
      return sendReply(req, res, query);
    }));

    // PATCH /api/workspaces/:wid
    // Body params: name
    // Update the specified workspace.
    this._app.patch('/api/workspaces/:wid', expressWrap(async (req, res) => {
      const wsId = integerParam(req.params.wid, 'wid');
      const query = await this._dbManager.updateWorkspace(getScope(req), wsId, req.body);
      return sendReply(req, res, query);
    }));

    // DELETE /api/workspaces/:wid
    // Delete the specified workspace and all included docs.
    this._app.delete('/api/workspaces/:wid', expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      const wsId = integerParam(req.params.wid, 'wid');
      const query = await this._dbManager.deleteWorkspace(getScope(req), wsId);
      this._gristServer.getTelemetry().logEvent(mreq, 'deletedWorkspace', {
        full: {
          workspaceId: wsId,
          userId: mreq.userId,
        },
      });
      return sendReply(req, res, query);
    }));

    // POST /api/workspaces/:wid/remove
    // Soft-delete the specified workspace.  If query parameter "permanent" is set,
    // delete permanently.
    this._app.post('/api/workspaces/:wid/remove', expressWrap(async (req, res) => {
      const wsId = integerParam(req.params.wid, 'wid');
      if (isParameterOn(req.query.permanent)) {
        const mreq = req as RequestWithLogin;
        const query = await this._dbManager.deleteWorkspace(getScope(req), wsId);
        this._gristServer.getTelemetry().logEvent(mreq, 'deletedWorkspace', {
          full: {
            workspaceId: query.data,
            userId: mreq.userId,
          },
        });
        return sendReply(req, res, query);
      } else {
        await this._dbManager.softDeleteWorkspace(getScope(req), wsId);
        return sendOkReply(req, res);
      }
    }));

    // POST /api/workspaces/:wid/unremove
    // Recover the specified workspace if it was previously soft-deleted and is
    // still available.
    this._app.post('/api/workspaces/:wid/unremove', expressWrap(async (req, res) => {
      const wsId = integerParam(req.params.wid, 'wid');
      await this._dbManager.undeleteWorkspace(getScope(req), wsId);
      return sendOkReply(req, res);
    }));

    // POST /api/workspaces/:wid/docs
    // Create a new doc owned by the specific workspace.
    this._app.post('/api/workspaces/:wid/docs', expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      const wsId = integerParam(req.params.wid, 'wid');
      const query = await this._dbManager.addDocument(getScope(req), wsId, req.body);
      const docId = query.data!;
      this._gristServer.getTelemetry().logEvent(mreq, 'documentCreated', {
        limited: {
          docIdDigest: docId,
          sourceDocIdDigest: undefined,
          isImport: false,
          fileType: undefined,
          isSaved: true,
        },
        full: {
          userId: mreq.userId,
          altSessionId: mreq.altSessionId,
        },
      });
      this._gristServer.getTelemetry().logEvent(mreq, 'createdDoc-Empty', {
        full: {
          docIdDigest: docId,
          userId: mreq.userId,
          altSessionId: mreq.altSessionId,
        },
      });
      return sendReply(req, res, query);
    }));

    // GET /api/templates/
    // Get all templates (or only featured templates if `onlyFeatured` is set).
    this._app.get('/api/templates/', expressWrap(async (req, res) => {
      const templateOrg = getTemplateOrg();
      if (!templateOrg) {
        throw new ApiError('Template org is not configured', 500);
      }

      const onlyFeatured = isParameterOn(req.query.onlyFeatured);
      const query = await this._dbManager.getOrgWorkspaces(
        {...getScope(req), showOnlyPinned: onlyFeatured},
        templateOrg
      );
      return sendReply(req, res, query);
    }));

    // GET /api/widgets/
    // Get all widget definitions from external source.
    this._app.get('/api/widgets/', expressWrap(async (req, res) => {
      const widgetList = await this._widgetRepository.getWidgets();
      return sendOkReply(req, res, widgetList);
    }));

    // PATCH /api/docs/:did
    // Update the specified doc.
    this._app.patch('/api/docs/:did', expressWrap(async (req, res) => {
      const query = await this._dbManager.updateDocument(getDocScope(req), req.body);
      return sendReply(req, res, query);
    }));

    // POST /api/docs/:did/unremove
    // Recover the specified doc if it was previously soft-deleted and is
    // still available.
    this._app.post('/api/docs/:did/unremove', expressWrap(async (req, res) => {
      await this._dbManager.undeleteDocument(getDocScope(req));
      return sendOkReply(req, res);
    }));

    // PATCH /api/orgs/:oid/access
    // Update the specified org acl rules.
    this._app.patch('/api/orgs/:oid/access', expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const delta = req.body.delta;
      const query = await this._dbManager.updateOrgPermissions(getScope(req), org, delta);
      return sendReply(req, res, query);
    }));

    // PATCH /api/workspaces/:wid/access
    // Update the specified workspace acl rules.
    this._app.patch('/api/workspaces/:wid/access', expressWrap(async (req, res) => {
      const workspaceId = integerParam(req.params.wid, 'wid');
      const delta = req.body.delta;
      const query = await this._dbManager.updateWorkspacePermissions(getScope(req), workspaceId, delta);
      return sendReply(req, res, query);
    }));

    // GET /api/docs/:did
    // Get information about a document.
    this._app.get('/api/docs/:did', expressWrap(async (req, res) => {
      const query = await this._dbManager.getDoc(req);
      return sendOkReply(req, res, query);
    }));

    // PATCH /api/docs/:did/access
    // Update the specified doc acl rules.
    this._app.patch('/api/docs/:did/access', expressWrap(async (req, res) => {
      const delta = req.body.delta;
      const query = await this._dbManager.updateDocPermissions(getDocScope(req), delta);
      this._logInvitedDocUserTelemetryEvents(req as RequestWithLogin, delta);
      return sendReply(req, res, query);
    }));

    // PATCH /api/docs/:did/move
    // Move the doc to the workspace specified in the body.
    this._app.patch('/api/docs/:did/move', expressWrap(async (req, res) => {
      const workspaceId = req.body.workspace;
      const query = await this._dbManager.moveDoc(getDocScope(req), workspaceId);
      return sendReply(req, res, query);
    }));

    this._app.patch('/api/docs/:did/pin', expressWrap(async (req, res) => {
      const query = await this._dbManager.pinDoc(getDocScope(req), true);
      return sendReply(req, res, query);
    }));

    this._app.patch('/api/docs/:did/unpin', expressWrap(async (req, res) => {
      const query = await this._dbManager.pinDoc(getDocScope(req), false);
      return sendReply(req, res, query);
    }));

    // GET /api/orgs/:oid/access
    // Get user access information regarding an org
    this._app.get('/api/orgs/:oid/access', expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const query = await this._withSupportUserAllowedToView(
        org, req, (scope) => this._dbManager.getOrgAccess(scope, org)
      );
      return sendReply(req, res, query);
    }));

    // GET /api/workspaces/:wid/access
    // Get user access information regarding a workspace
    this._app.get('/api/workspaces/:wid/access', expressWrap(async (req, res) => {
      const workspaceId = integerParam(req.params.wid, 'wid');
      const query = await this._dbManager.getWorkspaceAccess(getScope(req), workspaceId);
      return sendReply(req, res, query);
    }));

    // GET /api/docs/:did/access
    // Get user access information regarding a doc
    this._app.get('/api/docs/:did/access', expressWrap(async (req, res) => {
      const query = await this._dbManager.getDocAccess(getDocScope(req));
      return sendReply(req, res, query);
    }));

    // GET /api/profile/user
    // Get user's profile
    this._app.get('/api/profile/user', expressWrap(async (req, res) => {
      const fullUser = await this._getFullUser(req);
      return sendOkReply(req, res, fullUser, {allowedFields: new Set(['allowGoogleLogin'])});
    }));

    // POST /api/profile/user/name
    // Body params: string
    // Update users profile.
    this._app.post('/api/profile/user/name', expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      if (!(req.body && req.body.name)) {
        throw new ApiError('Name expected in the body', 400);
      }
      const name = req.body.name;
      await this._dbManager.updateUserName(userId, name);
      res.sendStatus(200);
    }));

    // POST /api/profile/user/locale
    // Body params: string
    // Update users profile.
    this._app.post('/api/profile/user/locale', expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      await this._dbManager.updateUserOptions(userId, {locale: req.body.locale || null});
      res.append('Set-Cookie', cookie.serialize('grist_user_locale', req.body.locale || '', {
        httpOnly: false,    // make available to client-side scripts
        domain: getCookieDomain(req),
        path: '/',
        secure: true,
        maxAge: req.body.locale ? 31536000 : 0,
        sameSite: 'None', // there is no security concern to expose this information.
      }));
      res.sendStatus(200);
    }));

    // POST /api/profile/allowGoogleLogin
    // Update user's preference for allowing Google login.
    this._app.post('/api/profile/allowGoogleLogin', expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      const fullUser = await this._getFullUser(req);
      if (fullUser.loginMethod !== 'Email + Password') {
        throw new ApiError('Only users signed in via email can enable/disable Google login', 401);
      }

      const allowGoogleLogin: boolean | undefined = req.body.allowGoogleLogin;
      if (allowGoogleLogin === undefined) {
        throw new ApiError('Missing body param: allowGoogleLogin', 400);
      }

      await this._dbManager.updateUserOptions(userId, {allowGoogleLogin});
      res.sendStatus(200);
    }));

    this._app.post('/api/profile/isConsultant', expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      if (userId !== this._dbManager.getSupportUserId()) {
        throw new ApiError('Only support user can enable/disable isConsultant', 401);
      }
      const isConsultant: boolean | undefined = req.body.isConsultant;
      const targetUserId: number | undefined = req.body.userId;
      if (isConsultant === undefined) {
        throw new ApiError('Missing body param: isConsultant', 400);
      }
      if (targetUserId === undefined) {
        throw new ApiError('Missing body param: targetUserId', 400);
      }
      await this._dbManager.updateUserOptions(targetUserId, {
        isConsultant
      });
      res.sendStatus(200);
    }));

    // GET /api/profile/apikey
    // Get user's apiKey
    this._app.get('/api/profile/apikey', expressWrap(async (req, res) => {
      const userId = getUserId(req);
      const user = await User.findOne({where: {id: userId}});
      if (user) {
        // The null value is of no interest to the user, let's show empty string instead.
        res.send(user.apiKey || '');
        return;
      }
      handleDeletedUser();
    }));

    // POST /api/profile/apikey
    // Update user's apiKey
    this._app.post('/api/profile/apikey', expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      const force = req.body ? req.body.force : false;
      const manager = this._dbManager.connection.manager;
      let user = await manager.findOne(User, {where: {id: userId}});
      if (!user) { return handleDeletedUser(); }
      if (!user.apiKey || force) {
        user = await updateApiKeyWithRetry(manager, user);
        res.status(200).send(user.apiKey);
      } else {
        res.status(400).send({error: "An apikey is already set, use `{force: true}` to override it."});
      }
    }));

    // DELETE /api/profile/apiKey
    // Delete apiKey
    this._app.delete('/api/profile/apikey', expressWrap(async (req, res) => {
      const userId = getAuthorizedUserId(req);
      await this._dbManager.connection.transaction(async manager => {
        const user = await manager.findOne(User, {where: {id: userId}});
        if (!user) { return handleDeletedUser(); }
        user.apiKey = null;
        await manager.save(User, user);
      });
      res.sendStatus(200);
    }));

    // GET /api/session/access/active
    // Returns active user and active org (if any)
    this._app.get('/api/session/access/active', expressWrap(async (req, res) => {
      const fullUser = await this._getFullUser(req, {includePrefs: true});
      const domain = getOrgFromRequest(req);
      const org = domain ? (await this._withSupportUserAllowedToView(
        domain, req, (scope) => this._dbManager.getOrg(scope, domain)
      )) : null;
      const orgError = (org && org.errMessage) ? {error: org.errMessage, status: org.status} : undefined;
      return sendOkReply(req, res, {
        user: {...fullUser,
          helpScoutSignature: helpScoutSign(fullUser.email),
          isInstallAdmin: await this._gristServer.getInstallAdmin().isAdminReq(req) || undefined,
        },
        org: (org && org.data) || null,
        orgError
      });
    }));

    // POST /api/session/access/active
    // Body params: email (required)
    // Body params: org (optional) - string subdomain or 'current', for which org's active user to modify.
    // Sets active user for active org
    this._app.post('/api/session/access/active', expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      let domain = optStringParam(req.body.org, 'org');
      if (!domain || domain === 'current') {
        domain = getOrgFromRequest(mreq) || '';
      }
      const email = req.body.email;
      if (!email) { throw new ApiError('email required', 400); }
      try {
        // Modify session copy in request. Will be saved to persistent storage before responding
        // by express-session middleware.
        linkOrgWithEmail(mreq.session, req.body.email, domain);
        clearSessionCacheIfNeeded(req, {sessionID: mreq.sessionID});
        return sendOkReply(req, res, {email});
      } catch (e) {
        throw new ApiError('email not available', 403);
      }
    }));

    // GET /api/session/access/all
    // Returns all user profiles (with ids) and all orgs they can access.
    // Flattens personal orgs into a single org.
    this._app.get('/api/session/access/all', expressWrap(async (req, res) => {
      const domain = getOrgFromRequest(req);
      const users = getUserProfiles(req);
      const userId = getUserId(req);
      const orgs = await this._dbManager.getMergedOrgs(userId, users, domain);
      if (orgs.errMessage) { throw new ApiError(orgs.errMessage, orgs.status); }
      return sendOkReply(req, res, {
        users: await this._dbManager.completeProfiles(users),
        orgs: orgs.data
      });
    }));

    // DELETE /users/:uid
    // Delete the specified user, their personal organization, removing them from all groups.
    // Not available to the anonymous user.
    // TODO: should orphan orgs, inaccessible by anyone else, get deleted when last user
    // leaves?
    this._app.delete('/api/users/:uid', expressWrap(async (req, res) => {
      const userIdToDelete = parseInt(req.params.uid, 10);
      if (!(req.body && req.body.name !== undefined)) {
        throw new ApiError('to confirm deletion of a user, provide their name', 400);
      }
      const query = await this._dbManager.deleteUser(getScope(req), userIdToDelete, req.body.name);
      return sendReply(req, res, query);
    }));
  }

  private async _getFullUser(req: Request, options: {includePrefs?: boolean} = {}): Promise<FullUser> {
    const mreq = req as RequestWithLogin;
    const userId = getUserId(mreq);
    const user = await this._dbManager.getUser(userId, options);
    if (!user) { throw new ApiError("unable to find user", 400); }

    const fullUser = this._dbManager.makeFullUser(user);
    const domain = getOrgFromRequest(mreq);
    const sessionUser = getSessionUser(mreq.session, domain || '', fullUser.email);
    const loginMethod = sessionUser && sessionUser.profile ? sessionUser.profile.loginMethod : undefined;
    const allowGoogleLogin = user.options?.allowGoogleLogin ?? true;
    return {...fullUser, loginMethod, allowGoogleLogin};
  }


  /**
   * Run a query, and, if it is denied and the user is the support
   * user, rerun the query with permission to view the current
   * org. This is a bit inefficient, but only affects the support
   * user. We wait to add the special permission only if needed, since
   * it will in fact override any other access the support user has
   * been granted, which could reduce their apparent access if that is
   * part of what is returned by the query.
   */
  private async _withSupportUserAllowedToView<T>(
    org: string|number, req: express.Request,
    op: (scope: Scope) => Promise<QueryResult<T>>
  ): Promise<QueryResult<T>> {
    const scope = getScope(req);
    const userId = getUserId(req);
    const result = await op(scope);
    if (result.status === 200 || userId !== this._dbManager.getSupportUserId()) {
      return result;
    }
    const extendedScope = addPermit(scope, this._dbManager.getSupportUserId(), {org});
    return await op(extendedScope);
  }

  private _logInvitedDocUserTelemetryEvents(mreq: RequestWithLogin, delta: PermissionDelta) {
    if (!delta.users) { return; }

    const numInvitedUsersByAccess: Record<BasicRole, number> = {
      'viewers': 0,
      'editors': 0,
      'owners': 0,
    };
    for (const [email, access] of Object.entries(delta.users)) {
      if (email === 'everyone@getgrist.com') { continue; }
      if (access === null || access === 'members') { continue; }

      numInvitedUsersByAccess[access] += 1;
    }
    for (const [access, count] of Object.entries(numInvitedUsersByAccess)) {
      if (count === 0) { continue; }

      this._gristServer.getTelemetry().logEvent(mreq, 'invitedDocUser', {
        full: {
          access,
          count,
          userId: mreq.userId,
        },
      });
    }

    const publicAccess = delta.users['everyone@getgrist.com'];
    if (publicAccess !== undefined) {
      this._gristServer.getTelemetry().logEvent(
        mreq,
        publicAccess ? 'madeDocPublic' : 'madeDocPrivate',
        {
          full: {
            ...(publicAccess ? {access: publicAccess} : {}),
            userId: mreq.userId,
          },
        }
      );
    }
  }
}

/**
 * Throw the error for when a user has been deleted since point of call (very unlikely to happen).
 */
function handleDeletedUser(): never {
  throw new ApiError("user not known", 401);
}

/**
 * Helper to update a user's apiKey. Update might fail because of the DB uniqueness constraint on
 * the apiKey (although it is very unlikely according to `crypto`), we retry until success. Fails
 * after 5 unsuccessful attempts.
 */
async function updateApiKeyWithRetry(manager: EntityManager, user: User): Promise<User> {
  const currentKey = user.apiKey;
  for (let i = 0; i < 5; ++i) {
    user.apiKey = Deps.apiKeyGenerator();
    try {
      // if new key is the same as the current, the db update won't fail so we check it here (very
      // unlikely to happen but but still better to handle)
      if (user.apiKey === currentKey) {
        throw new Error('the new key is the same as the current key');
      }
      return await manager.save(User, user);
    } catch (e) {
      // swallow and retry
      log.warn(`updateApiKeyWithRetry: failed attempt ${i}/5, %s`, e);
    }
  }
  throw new Error('Could not generate a valid api key.');
}
