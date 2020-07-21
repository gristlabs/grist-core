import * as session from '@gristlabs/express-session';
import {parseSubdomain} from 'app/common/gristUrls';
import {RequestWithOrg} from 'app/server/lib/extractOrg';
import {GristServer} from 'app/server/lib/GristServer';
import {Sessions} from 'app/server/lib/Sessions';
import {promisifyAll} from 'bluebird';
import * as express from 'express';
import * as path from 'path';
import * as shortUUID from "short-uuid";


export const cookieName = process.env.GRIST_SESSION_COOKIE || 'grist_sid';

export const COOKIE_MAX_AGE = 90 * 24 * 60 * 60 * 1000;  // 90 days in milliseconds

// RedisStore and SqliteStore are expected to provide a set/get interface for sessions.
export interface SessionStore {
  getAsync(sid: string): Promise<any>;
  setAsync(sid: string, session: any): Promise<void>;
}

/**
 *
 * A V1 session.  A session can be associated with a number of users.
 * There may be a preferred association between users and organizations:
 * specifically, if from the url we can tell that we are showing material
 * for a given organization, we should pick a user that has access to that
 * organization.
 *
 * This interface plays no role at all yet!  Working on refactoring existing
 * sessions step by step to get closer to this.
 *
 */
export interface IGristSession {

  // V1 Hosted Grist - known available users.
  users: Array<{
    userId?: number;
  }>;

  // V1 Hosted Grist - known user/org relationships.
  orgs: Array<{
    orgId: number;
    userId: number;
  }>;
}

function createSessionStoreFactory(sessionsDB: string): () => SessionStore {
  if (process.env.REDIS_URL) {
    // Note that ./build excludes this module from the electron build.
    const RedisStore = require('connect-redis')(session);
    promisifyAll(RedisStore.prototype);
    return () => new RedisStore({
      url: process.env.REDIS_URL,
    });
  } else {
    const SQLiteStore = require('@gristlabs/connect-sqlite3')(session);
    promisifyAll(SQLiteStore.prototype);
    return () => new SQLiteStore({
      dir: path.dirname(sessionsDB),
      db: path.basename(sessionsDB),    // SQLiteStore no longer appends a .db suffix.
      table: 'sessions'
    });
  }
}

export function getAllowedOrgForSessionID(sessionID: string): {org: string, host: string}|null {
  if (sessionID.startsWith('c-') && sessionID.includes('@')) {
    const [, org, host] = sessionID.split('@');
    if (!host) { throw new Error('Invalid session ID'); }
    return {org, host};
  }
  // Otherwise sessions start with 'g-', but we also accept older sessions without a prefix.
  return null;
}

/**
 * Set up Grist Sessions, either in a sqlite db or via redis.
 * @param instanceRoot: path to storage area in case we need to make a sqlite db.
 */
export function initGristSessions(instanceRoot: string, server: GristServer) {
  // TODO: We may need to evaluate the usage of space in the SQLite store grist-sessions.db
  // since entries are created on the first get request.
  const sessionsDB: string = path.join(instanceRoot, 'grist-sessions.db');

  // The extra step with the creator function is used in server.js to create a new session store
  // after unpausing the server.
  const sessionStoreCreator = createSessionStoreFactory(sessionsDB);
  const sessionStore = sessionStoreCreator();

  const adaptDomain = process.env.GRIST_ADAPT_DOMAIN === 'true';
  const fixedDomain = process.env.GRIST_SESSION_DOMAIN || process.env.GRIST_DOMAIN;

  const getCookieDomain = (req: express.Request) => {
    const mreq = req as RequestWithOrg;
    if (mreq.isCustomHost) {
      // For custom hosts, omit the domain to make it a "host-only" cookie, to avoid it being
      // included into subdomain requests (since we would not control all the subdomains).
      return undefined;
    }
    if (adaptDomain) {
      const reqDomain = parseSubdomain(req.get('host'));
      if (reqDomain.base) { return reqDomain.base.split(':')[0]; }
    }
    return fixedDomain;
  };
  // Use a separate session IDs for custom domains than for native ones. Because a custom domain
  // cookie could be stolen (with some effort) by the custom domain's owner, we limit the damage
  // by only honoring custom-domain cookies for requests to that domain.
  const generateId = (req: RequestWithOrg) => {
    const uid = shortUUID.generate();
    return req.isCustomHost ? `c-${uid}@${req.org}@${req.get('host')}` : `g-${uid}`;
  };
  const sessionSecret = server.create.sessionSecret();
  const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: cookieName,
    requestDomain: getCookieDomain,
    genid: generateId,
    cookie: {
      // We do not initially set max-age, leaving the cookie as a
      // session cookie until there's a successful login.  On the
      // redis back-end, the session associated with the cookie will
      // persist for 24 hours if there is no successful login.  Once
      // there is a successful login, max-age will be set to
      // COOKIE_MAX_AGE, making the cookie a persistent cookie.  The
      // session associated with the cookie will receive an updated
      // time-to-live, so that it persists for COOKIE_MAX_AGE.
    },
    store: sessionStore
  });

  const sessions = new Sessions(sessionSecret, sessionStore, server);

  return {sessions, sessionSecret, sessionStore, sessionMiddleware, sessionStoreCreator};
}
