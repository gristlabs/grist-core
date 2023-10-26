/**
 * Configuration for OpenID Connect (OIDC), useful for enterprise single-sign-on logins.
 * A good informative overview of SAML is at https://developer.okta.com/blog/2019/10/21/illustrated-guide-to-oauth-and-oidc
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
 *    env GRIST_OIDC_IDP_CODE_CHALLENGE_METHOD
 *        The method to use for code challenge. Defaults to "S256".
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
import { Client, generators, Issuer } from 'openid-client';
import {Sessions} from './Sessions';
const CALLBACK_URL = '/oauth2/callback';
const LOGIN_URL = '/oauth2/login';

export class OIDCConfig {
  private _client: Client;
  private _nonce: string;
  private _codeVerifier: string;
  private _codeChallenge: string;

  public constructor() {
    this._nonce = generators.nonce();
    this._codeVerifier = generators.codeVerifier();
    this._codeChallenge = generators.codeChallenge(this._codeVerifier);
  }

  public async initOIDC(): Promise<void> {
    if (!process.env.GRIST_OIDC_SP_HOST) { throw new Error('initConfig requires GRIST_OIDC_SP_HOST to be set'); }
    if (!process.env.GRIST_OIDC_IDP_ISSUER) { throw new Error('initConfig requires GRIST_OIDC_IDP_ISSUER to be set'); }
    if (!process.env.GRIST_OIDC_IDP_CLIENT_ID) {
      throw new Error('initConfig requires GRIST_OIDC_IDP_CLIENT_ID to be set');
    }
    if (!process.env.GRIST_OIDC_IDP_CLIENT_SECRET) {
      throw new Error('initConfig requires GRIST_OIDC_IDP_CLIENT_SECRET to be set');
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

    const params = this._client.callbackParams(req);
    const { state } = params;
    const tokenSet = await this._client.callback(
      new URL(CALLBACK_URL, process.env.GRIST_OIDC_SP_HOST).href,
      params,
      { nonce: this._nonce, state, code_verifier: this._codeVerifier }
    );
    const userInfo = await this._client.userinfo(tokenSet);
    const email = userInfo.email;
    const fname = userInfo.given_name ?? '';
    const lname = userInfo.family_name ?? '';
    const profile = {
      email,
      name: `${fname} ${lname}`.trim(),
    };
    const scopedSession = sessions.getOrCreateSessionFromRequest(req);
    await scopedSession.operateOnScopedSession(req, async (user) => Object.assign(user, {
      profile,
    }));
    res.redirect('/');
  }

  public async handleLogin(req: express.Request, res: express.Response): Promise<void> {
    res.redirect(await this.getLoginRedirectUrl());
  }

  public async getLoginRedirectUrl(): Promise<string> {
    const state = generators.state();
    const authUrl = this._client.authorizationUrl({
      scope: process.env.GRIST_OIDC_IDP_SCOPES || 'openid email profile',
      code_challenge: this._codeChallenge,
      code_challenge_method: process.env.GRIST_OIDC_IDP_CODE_CHALLENGE_METHOD || 'S256',
      nonce: this._nonce,
      state,
    });
    return authUrl;
  }

  public async getLogoutRedirectUrl(req: express.Request, redirectUrl: URL): Promise<string> {
    return this._client.endSessionUrl({
      post_logout_redirect_uri: redirectUrl.href
    });
  }
}

export async function getOIDCLoginSystem(): Promise<GristLoginSystem|undefined> {
  if (!process.env.GRIST_OIDC_SP_HOST) { return undefined; }
  return {
    async getMiddleware(gristServer: GristServer) {
      const config = new OIDCConfig();
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
