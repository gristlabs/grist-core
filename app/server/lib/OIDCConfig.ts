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
 *        Host at which our /oauth2 endpoint will live, usually the same value as `APP_HOME_URL`.
 *    env GRIST_OIDC_IDP_ISSUER
 *        The issuer URL for the IdP, passed to node-openid-client, see: https://github.com/panva/node-openid-client/blob/a84d022f195f82ca1c97f8f6b2567ebcef8738c3/docs/README.md#issuerdiscoverissuer.
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
 *
 * /!\ CAUTION: For production, be sure to use https for all URLs. /!\
 *
 * For development of this module on localhost, these settings should work:
 *   - GRIST_OIDC_SP_HOST=http://localhost:8484 (or whatever port you use for Grist)
 *   - GRIST_OIDC_IDP_ISSUER=http://localhost:8080/realms/myrealm (replace 8080 by the port you use for keycloak)
 *   - GRIST_OIDC_IDP_CLIENT_ID=my_grist_instance
 *   - GRIST_OIDC_IDP_CLIENT_SECRET=YOUR_SECRET (as set in keycloak)
 *   - GRIST_OIDC_IDP_SCOPES="openid email profile"
 */

import * as express from 'express';
import {GristLoginSystem, GristServer} from './GristServer';
import { Client, generators, Issuer, UserinfoResponse } from 'openid-client';
import {Sessions} from './Sessions';
import log from 'app/server/lib/log';
import {appSettings} from './AppSettings';
import {RequestWithLogin} from './Authorizer';

const CALLBACK_URL = '/oauth2/callback';

export class OIDCConfig {
  private _client: Client;
  private _redirectUrl: string;

  public constructor() {
  }

  public async initOIDC(): Promise<void> {
    const section = appSettings.section('login').section('system').section('oidc');
    const spHost = section.flag('spHost').requireString({
      envVar: 'GRIST_OIDC_SP_HOST',
      defaultValue: process.env.APP_HOME_URL,
    });
    const issuerUrl = section.flag('issuer').requireString({
      envVar: 'GRIST_OIDC_IDP_ISSUER',
    });
    const clientId = section.flag('clientId').requireString({
      envVar: 'GRIST_OIDC_IDP_CLIENT_ID',
    });
    const clientSecret = section.flag('clientSecret').requireString({
      envVar: 'GRIST_OIDC_IDP_CLIENT_SECRET',
    });

    const issuer = await Issuer.discover(issuerUrl);
    this._redirectUrl = new URL(CALLBACK_URL, spHost).href;
    this._client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [ this._redirectUrl ],
      response_types: ['code'],
    });
  }

  public addEndpoints(app: express.Application, sessions: Sessions): void {
    app.get(CALLBACK_URL, this.handleCallback.bind(this, sessions));
  }

  public async handleCallback(sessions: Sessions, req: express.Request, res: express.Response): Promise<void> {
    try {
      const params = this._client.callbackParams(req);
      const { state } = params;
      if (!state) {
        throw new Error('Login or logout failed to complete');
      }

      const codeVerifier = await this._retrieveCodeVerifierFromSession(req);

      const tokenSet = await this._client.callback(
        this._redirectUrl,
        params,
        { state, code_verifier: codeVerifier }
      );

      const userInfo = await this._client.userinfo(tokenSet);
      const profile = this._makeUserProfileFromUserInfo(userInfo);

      const scopedSession = sessions.getOrCreateSessionFromRequest(req);
      await scopedSession.operateOnScopedSession(req, async (user) => Object.assign(user, {
        profile,
      }));

      res.redirect('/');
    } catch (err) {
      log.error(`OIDC callback failed: ${err.message}`);
      res.status(500).send(`OIDC callback failed: ${err.message}`);
    }
  }

  public async getLoginRedirectUrl(req: express.Request): Promise<string> {
    const codeVerifier = await this._generateAndStoreCodeVerifier(req);
    const codeChallenge = generators.codeChallenge(codeVerifier);
    const state = generators.state();

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

  private async _generateAndStoreCodeVerifier(req: express.Request) {
    const mreq = req as RequestWithLogin;
    if (!mreq.session) { throw new Error('no session available'); }
    const codeVerifier = generators.codeVerifier();
    mreq.session.oidc = {
      codeVerifier,
    };
    console.log('mreq.session = ', mreq.session);

    return codeVerifier;
  }

  private async _retrieveCodeVerifierFromSession(req: express.Request) {
    const mreq = req as RequestWithLogin;
    if (!mreq.session) { throw new Error('no session available'); }
    const codeVerifier = mreq.session.oidc?.codeVerifier;
    if (!codeVerifier) { throw new Error('Login is stale'); }
    console.log('mreq.session = ', mreq.session);
    delete mreq.session.oidc?.codeVerifier;
    console.log('zzzz mreq.session = ', mreq.session);
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
  if (!process.env.GRIST_OIDC_IDP_ISSUER) { return undefined; }
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
