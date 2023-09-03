import {auth} from '@googleapis/oauth2';
import {ApiError} from 'app/common/ApiError';
import {parseSubdomain} from 'app/common/gristUrls';
import {expressWrap} from 'app/server/lib/expressWrap';
import log from 'app/server/lib/log';
import {getOriginUrl, optStringParam, stringParam} from 'app/server/lib/requestUtils';
import * as express from 'express';
import {URL} from 'url';

/**
 * Google Auth Endpoint for performing server side authentication. More information can be found
 * at https://developers.google.com/identity/protocols/oauth2/web-server.
 *
 * Environmental variables used:
 * - GOOGLE_CLIENT_ID :     key obtained from a Google Project, not secret can be shared publicly,
 *                          the same client id is used in Google Drive Plugin
 * - GOOGLE_CLIENT_SECRET:  secret key for Google Project, can't be shared - it is used to (d)encrypt
 *                          data that we obtain from Google Auth Service (all done in the api)
 * - GOOGLE_DRIVE_SCOPE:    scope requested for the Google drive integration (defaults to drive.file which allows
 *                          to create files and get files via Google Drive Picker)
 *
 * High level description:
 *
 * Each API endpoint that wants to talk to Google Api needs an access_token that identifies our application
 * and permits us to access some of the user data or work with the API on the user's behalf (examples for that are
 * Google Drive plugin and Google Export endpoint, [Send to Google Drive] feature on the UI).)
 * To obtain this token on the server-side, the application needs to redirect the user to a
 * Google Consent Screen - where the user can log into his account and give consent for the permissions
 * we need. Permissions are defined by SCOPES - that exactly describes what we are allowed to do.
 * More on scopes can be read on https://developers.google.com/identity/protocols/oauth2/scopes.
 * When we are redirecting the user to a Google Consent Screen, we are also sending a static URL for an endpoint
 * where Google will redirect the user after he gives us permissions or declines our request. For that, we are exposing
 * static URL http://docs.getgrist.com/auth/google (on prod) or http://localhost:8080/auth/google (dev).
 *
 * NOTE: Actually, we are exposing only auth/google endpoint that can be accessed in various ways, including any
 * subdomain, but Google will always redirect to the configured endpoint (example: http://docs.getgrist.com/auth/google)
 *
 * This endpoint will render a simple page (see /static/message.html) that will immediately post
 * a message to the parent window with a response from Google in the form of { code? : string, error?: string }.
 * Code returned from Google will be an encrypted access_token that the client-side code should use to invoke
 * the server-side API endpoint that wishes to call one of the Google API endpoints. A server-side endpoint can use
 * "googleAuthTokenMiddleware" middleware to convert code to access_token (by making a separate call to Google
 * for exchanging code for an access_token).
 * This access_token could be stored in the user's session for further use, but since we are making only a single call
 * very rarely, and access_token will expire eventually; it is better to acquire access_token every time.
 * More on storing access_token offline can be read on:
 * https://developers.google.com/identity/protocols/oauth2/web-server#obtainingaccesstokens
 *
 * How to use:
 *
 * To call server-side endpoint that expects access_token, first decorate it with "googleAuthTokenMiddleware"
 * middleware, then perform "server-side" authentication with Google on the client-side to acquire an encrypted token.
 * Client code should open up a popup window with an URL to Grist's Google Auth endpoint (/auth/google) and wait
 * for a message from a popup window containing an encrypted token.
 * Having encrypted token ("code"), a client can call the server-side endpoint by adding to the query string the code
 * acquired from the popup window. Server endpoint (decorated by "googleAuthTokenMiddleware") will get access_token
 * in a query string.
 */

// Path for the auth endpoint.
const authHandlerPath = "/auth/google";

// Redirect host after the Google Auth login form is completed. This reuses the same domain name
// as for Cognito login.
const AUTH_SUBDOMAIN = process.env.GRIST_ID_PREFIX ? `docs-${process.env.GRIST_ID_PREFIX}` : 'docs';

/**
 * Return a full url for Google Auth handler. Examples are:
 *
 * http://localhost:8080/auth/google in dev
 * https://docs-s.getgrist.com in staging
 * https://docs.getgrist.com in prod
 */
function getFullAuthEndpointUrl(): string {
  const homeUrl = process.env.APP_HOME_URL;
  // if homeUrl is localhost - (in dev environment) - use the development url
  if (homeUrl && new URL(homeUrl).hostname === "localhost") {
    return `${homeUrl}${authHandlerPath}`;
  }
  const homeBaseDomain = homeUrl && parseSubdomain(new URL(homeUrl).host).base;
  const baseDomain = homeBaseDomain || '.getgrist.com';
  return `https://${AUTH_SUBDOMAIN}${baseDomain}${authHandlerPath}`;
}

/**
 * Middleware for obtaining access_token from Google Auth Service.
 * It expects code query parameter (provided by frontend code) add adds to access_token to query parameters.
 */
export async function googleAuthTokenMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction) {
  // If access token is in place, proceed
  if (!optStringParam(req.query.code, 'code')) {
    throw new ApiError("Google Auth endpoint requires a code parameter in the query string", 400);
  } else {
    try {
      const oAuth2Client = getGoogleAuth();
      // Decrypt code that was send back from Google Auth service. Uses GOOGLE_CLIENT_SECRET key.
      const tokenResponse = await oAuth2Client.getToken(stringParam(req.query.code, 'code'));
      // Get the access token (access token will be present in a default request configuration).
      const access_token = tokenResponse.tokens.access_token!;
      req.query.access_token = access_token;
      next();
    } catch (err) {
      log.error("GoogleAuth - Error", err);
      throw err;
    }
  }
}

/**
 * Adds a static Google Auth endpoint. This will be used by Google Auth Service to redirect back, after the user
 * finishes a signing and a consent flow. Google will pass 2 arguments in a query string:
 * - code: encrypted access token when user gave permissions
 * - error: error code when user declined our request.
 */
export function addGoogleAuthEndpoint(
  expressApp: express.Application,
  messagePage: (req: express.Request, res: express.Response, message: any) => any
) {
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    log.warn("Failed to create GoogleAuth endpoint: GOOGLE_CLIENT_SECRET is not defined");
    expressApp.get(authHandlerPath, expressWrap(async (req: express.Request, res: express.Response) => {
      throw new Error("Send to Google Drive is not configured.");
    }));
    return;
  }
  log.info(`GoogleAuth - auth handler at ${getFullAuthEndpointUrl()}`);

  expressApp.get(authHandlerPath, expressWrap(async (req: express.Request, res: express.Response) => {

    // Test if the code is in a query string. Google sends it back after user has given a concent for
    // our request. It is encrypted (with CLIENT_SECRET) and signed with redirect url.
    // In state query parameter we will receive an url that was send as part of the request to Google.

    if (optStringParam(req.query.code, 'code')) {
      log.debug("GoogleAuth - response from Google with valid code");
      messagePage(req, res, { code: stringParam(req.query.code, 'code'),
                              origin: stringParam(req.query.state, 'state') });
    } else if (optStringParam(req.query.error, 'error')) {
      log.debug("GoogleAuth - response from Google with error code", stringParam(req.query.error, 'error'));
      if (stringParam(req.query.error, 'error') === "access_denied") {
        messagePage(req, res, { error: stringParam(req.query.error, 'error'),
                                origin: stringParam(req.query.state, 'state') });
      } else {
        // This should not happen, either code or error is a mandatory query parameter.
        throw new ApiError("Error authenticating with Google", 500);
      }
    } else {
      const oAuth2Client = getGoogleAuth();
      const scope = stringParam(req.query.scope, 'scope');
      // Create url for origin parameter for a popup window.
      const origin = getOriginUrl(req);
      const authUrl = oAuth2Client.generateAuthUrl({
        scope,
        prompt: 'select_account',
        state: origin
      });
      log.debug(`GoogleAuth - redirecting to Google consent screen`, {
        authUrl,
        scope,
        state: origin
      });
      res.redirect(authUrl);
    }
  }));
}

/**
 * Builds the OAuth2 Google client.
 */
export function getGoogleAuth() {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const oAuth2Client = new auth.OAuth2(CLIENT_ID, CLIENT_SECRET, getFullAuthEndpointUrl());
  return oAuth2Client;
}
