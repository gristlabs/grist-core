/**
 * Endpoint to support DiscourseConnect, to allow users to use their Grist logins for the
 * Grist Community Forum.
 *
 * Adds one endpoint:
 *  - /discourse-connect: sends signed user info in a redirect to DISCOURSE_SITE.
 *
 * Expects environment variables:
 *  - DISCOURSE_SITE: URL of the Discourse site to which to redirect back.
 *  - DISCOURSE_CONNECT_SECRET: Secret for checking and adding signatures.
 *
 * This follows documentation at
 * https://meta.discourse.org/t/discourseconnect-official-single-sign-on-for-discourse-sso/13045
 * The recommended Discourse configuration includes:
 *  - enable discourse connect: true
 *  - discourse connect url: GRIST_SITE/discourse-connect
 *  - discourse connect secret: DISCOURSE_CONNECT_SECRET
 *  - logout redirect (in Users): GRIST_SITE/logout?next=DISCOURSE_SITE
 */

import type {Express, NextFunction, Request, RequestHandler, Response} from 'express';
import type {RequestWithLogin} from 'app/server/lib/Authorizer';
import {expressWrap} from 'app/server/lib/expressWrap';
import {getOriginUrl} from 'app/server/lib/requestUtils';
import * as crypto from 'crypto';

const DISCOURSE_CONNECT_SECRET = process.env.DISCOURSE_CONNECT_SECRET;
const DISCOURSE_SITE = process.env.DISCOURSE_SITE;

// A hook for dependency injection. Allows tests to override these variables on the fly.
export const Deps = {DISCOURSE_CONNECT_SECRET, DISCOURSE_SITE};

// Calculate payload signature using the given secret.
export function calcSignature(payload: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Check configuration and signature of the Discourse nonce in the request.
function checkParams(req: Request, resp: Response, next: NextFunction) {
  if (!Deps.DISCOURSE_SITE || !Deps.DISCOURSE_CONNECT_SECRET) {
    throw new Error('DiscourseConnect not configured');
  }
  const payload = String(req.query.sso || '');
  const signature = String(req.query.sig || '');
  if (calcSignature(payload, Deps.DISCOURSE_CONNECT_SECRET) !== signature) {
    throw new Error('Invalid signature for Discourse SSO request');
  }
  const params = new URLSearchParams(Buffer.from(payload, 'base64').toString('utf8'));
  const nonce = params.get('nonce');
  if (!nonce) {
    throw new Error('Invalid request for Discourse SSO');
  }
  (req as any).discourseConnectNonce = nonce;
  next();
}

// Respond to the DiscourseConnect request by redirecting back to discourse, including the user
// info and a signature into the URL parameters.
function discourseConnect(req: Request, resp: Response) {
  const mreq = req as RequestWithLogin;
  const nonce: string|undefined = (req as any).discourseConnectNonce;
  if (!nonce) {
    throw new Error('Invalid request for Discourse SSO');
  }
  if (!mreq.userIsAuthorized || !mreq.user?.loginEmail) {
    throw new Error('User is not authenticated');
  }
  if (!req.query.user && mreq.users && mreq.users.length > 1) {
    const origUrl = new URL(req.originalUrl, getOriginUrl(req));
    const redirectUrl = new URL('/welcome/select-account', getOriginUrl(req));
    redirectUrl.searchParams.set('next', origUrl.toString());
    return resp.redirect(redirectUrl.toString());
  }
  const responseObj: {[key: string]: string} = {
    nonce,
    email: mreq.user.loginEmail,
    // We don't treat user IDs as secret, so use the same ID with Discourse directly.
    external_id: String(mreq.user.id),
    // We could specify the username (used for @ mentions), but let Discourse create one for us
    // (it bases it on name or email). The user can change it within Discourse.
    // username,
    name: mreq.user.name,
    ...(mreq.user.picture ? {avatar_url: mreq.user.picture} : {}),
    suppress_welcome_message: 'true',
  };
  const responseString = new URLSearchParams(responseObj).toString();
  const responsePayload = Buffer.from(responseString, 'utf8').toString('base64');
  const responseSignature = calcSignature(responsePayload, Deps.DISCOURSE_CONNECT_SECRET!);
  const redirectUrl = new URL('/session/sso_login', Deps.DISCOURSE_SITE);
  redirectUrl.search = new URLSearchParams({sso: responsePayload, sig: responseSignature}).toString();
  return resp.redirect(redirectUrl.toString());
}

/**
 * Attach the endpoint for /discourse-connect, as documented at
 * https://meta.discourse.org/t/discourseconnect-official-single-sign-on-for-discourse-sso/13045
 */
export function addDiscourseConnectEndpoints(app: Express, options: {
  userIdMiddleware: RequestHandler,
  redirectToLogin: RequestHandler,
}) {
  app.get('/discourse-connect',
    expressWrap(checkParams),      // Check early, to fail early if Discourse is misconfigured.
    options.userIdMiddleware,
    options.redirectToLogin,
    expressWrap(discourseConnect)
  );
}
