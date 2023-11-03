/**
 * Configuration for OpenID Connect (OIDC), useful for enterprise single-sign-on logins.
 * A good informative overview of OIDC is at https://developer.okta.com/blog/2019/10/21/illustrated-guide-to-oauth-and-oidc
 * Note:
 *    SP is "Service Provider", in our case, the Grist application.
 *    IdP is the "Identity Provider", somewhere users log into, e.g. Okta or Google Apps.
 *
 * We also use optional attributes for the user's name, for which we accept any of:
 *    given_name
 *    family_name
 *
 * Expected environment variables:
 *    env GRIST_OIDC_SP_HOST=https://<your-domain>
 *        Host at which our /oidc endpoint will live; identifies our application.
 *    env GRIST_OIDC_IDP_ISSUER
 *        The issuer URL for the IdP.
 *    env GRIST_OIDC_IDP_CLIENT_ID
 *        The client ID for the application, as registered with the IdP.
 *    env GRIST_OIDC_IDP_CLIENT_SECRET
 *        The client secret for the application, as registered with the IdP.
 *    env GRIST_OIDC_IDP_SCOPES
 *        The scopes to request from the IdP, as a space-separated list. Defaults to "openid email profile".
 *
 * This version of OIDCConfig has been tested with Keycloak OIDC IdP following the instructions
 * at:
 *   https://www.keycloak.org/getting-started/getting-started-docker
 * When running on localhost and http, the settings tested were with:
 *   - GRIST_OIDC_SP_HOST=http://localhost:8484 (or whatever port you use for Grist)
 *   - GRIST_OIDC_IDP_ISSUER=http://localhost:8080/realms/myrealm (replace 8080 by the port you use for keycloak)
 *   - GRIST_OIDC_IDP_CLIENT_ID=myclient
 *   - GRIST_OIDC_IDP_CLIENT_SECRET=YOUR_SECRET (as set in keycloak)
 *   - GRIST_OIDC_IDP_SCOPES="openid email profile"
 */

import * as express from 'express';
import {GristLoginSystem, GristServer} from './GristServer';
import { Client, generators, Issuer, UserinfoResponse } from 'openid-client';
import {Sessions} from './Sessions';
import log from 'app/server/lib/log';
import {Permit} from './Permit';

const CALLBACK_URL = '/oauth2/callback';
const LOGIN_URL = '/oauth2/login';

const LOGIN_ACTION = 'oidc-login';
const WAIT_IN_MINUTES = 20;

export class OIDCConfig {
  private _client: Client;

  public constructor(private _gristServer: GristServer) {
  }

  public async initOIDC(): Promise<void> {
    if (!process.env.GRIST_OIDC_SP_HOST) { throw new Error('initOIDC requires GRIST_OIDC_SP_HOST to be set'); }
    if (!process.env.GRIST_OIDC_IDP_ISSUER) { throw new Error('initOIDC requires GRIST_OIDC_IDP_ISSUER to be set'); }
    if (!process.env.GRIST_OIDC_IDP_CLIENT_ID) {
      throw new Error('initOIDC requires GRIST_OIDC_IDP_CLIENT_ID to be set');
    }
    if (!process.env.GRIST_OIDC_IDP_CLIENT_SECRET) {
      throw new Error('initOIDC requires GRIST_OIDC_IDP_CLIENT_SECRET to be set');
    }
    const spHost: string = process.env.GRIST_OIDC_SP_HOST;
    const issuer = await Issuer.discover(process.env.GRIST_OIDC_IDP_ISSUER);
    this._client = new issuer.Client({
      client_id: process.env.GRIST_OIDC_IDP_CLIENT_ID,
      client_secret: process.env.GRIST_OIDC_IDP_CLIENT_SECRET,
      redirect_uris: [ new URL(CALLBACK_URL, spHost).href ],
      response_types: ['code'],
    });
  }

  public addEndpoints(app: express.Application, sessions: Sessions): void {
    app.get(LOGIN_URL, this.handleLogin.bind(this));
    app.get(CALLBACK_URL, this.handleCallback.bind(this, sessions));
  }

  public async handleCallback(sessions: Sessions, req: express.Request, res: express.Response): Promise<void> {

    try {
      const params = this._client.callbackParams(req);
      const { state } = params;
      if (!state) {
        throw new Error('Login or logout failed to complete');
      }
      const codeVerifier = await this._retrieveCodeVerifierFromPermit(state);
      const tokenSet = await this._client.callback(
        new URL(CALLBACK_URL, process.env.GRIST_OIDC_SP_HOST).href,
        params,
        { state, code_verifier: codeVerifier }
      );
      const userInfo = await this._client.userinfo(tokenSet);
      const profile = this._makeUserProfileFromUserInfo(userInfo);
      const scopedSession = sessions.getOrCreateSessionFromRequest(req);
      await scopedSession.operateOnScopedSession(req, async (user) => Object.assign(user, {
        profile,
        accessToken: tokenSet.access_token,
        refreshToken: tokenSet.refresh_token,
      }));
      res.redirect('/');
    } catch (err) {
      log.error(`OIDC callback failed: ${err.message}`);
      res.status(500).send(`Cannot connect to OIDC provider: ${err.message}`);
    }
  }

  public async handleLogin(req: express.Request, res: express.Response): Promise<void> {
    try {
      res.redirect(await this.getLoginRedirectUrl(req));
    } catch (ex) {
      log.error(`OIDC login failed: ${ex.message}`);
      res.status(500).send(`Cannot connect to OIDC provider: ${ex.message}`);
    }
  }

  public async getLoginRedirectUrl(req: express.Request): Promise<string> {
    const { state, codeVerifier } = await this._generateAndStoreCodeVerifier(req, this._gristServer.getSessions());
    const codeChallenge = generators.codeChallenge(codeVerifier);

    const authUrl = this._client.authorizationUrl({
      scope: process.env.GRIST_OIDC_IDP_SCOPES || 'openid email profile',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
    });
    return authUrl;
  }

  public async getLogoutRedirectUrl(req: express.Request, redirectUrl: URL): Promise<string> {
    return this._client.endSessionUrl({
      post_logout_redirect_uri: redirectUrl.href
    });
  }

  private async _generateAndStoreCodeVerifier(req: express.Request, sessions: Sessions) {
    const permitStore = this._gristServer.getExternalPermitStore();
    const sessionId = sessions.getSessionIdFromRequest(req);
    if (!sessionId) { throw new Error('no session available'); }
    const codeVerifier = generators.codeVerifier();
    const permit: Permit = {
      action: LOGIN_ACTION,
      sessionId,
      codeVerifier,
    };
    const state = await permitStore.setPermit(permit, WAIT_IN_MINUTES * 60 * 1000);
    return { codeVerifier, state };
  }

  private async _retrieveCodeVerifierFromPermit(state: string) {
    const permitStore = this._gristServer.getExternalPermitStore();
    const permit = await permitStore.getPermit(state);
    if (!permit || !permit.codeVerifier) {
      throw new Error('Login or logout is stale');
    }
    if (permit.action !== LOGIN_ACTION) {
      throw new Error(`Unexpected action: "${permit.action}"`);
    }
    const { codeVerifier } = permit;
    await permitStore.removePermit(state);
    return codeVerifier;
  }

  private _makeUserProfileFromUserInfo(userInfo: UserinfoResponse) {
      const email = userInfo.email;
      const fname = userInfo.given_name ?? '';
      const lname = userInfo.family_name ?? '';
      return {
        email,
        name: `${fname} ${lname}`.trim(),
      };
  }
}

export async function getOIDCLoginSystem(): Promise<GristLoginSystem|undefined> {
  if (!process.env.GRIST_OIDC_SP_HOST) { return undefined; }
  return {
    async getMiddleware(gristServer: GristServer) {
      const config = new OIDCConfig(gristServer);
      await config.initOIDC();
      return {
        getLoginRedirectUrl: config.getLoginRedirectUrl.bind(config),
        getSignUpRedirectUrl: config.getLoginRedirectUrl.bind(config),
        getLogoutRedirectUrl: config.getLogoutRedirectUrl.bind(config),
        async addEndpoints(app: express.Express) {
          config.addEndpoints(app, gristServer.getSessions());
          return 'oidc';
        },
      };
    },
    async deleteUser() {},
  };
}
