/**
 * Configuration for OpenID Connect (OIDC), useful for enterprise single-sign-on logins.
 * A good informative overview of OIDC is at https://developer.okta.com/blog/2019/10/21/illustrated-guide-to-oauth-and-oidc
 * Note:
 *    SP is "Service Provider", in our case, the Grist application.
 *    IdP is the "Identity Provider", somewhere users log into, e.g. Okta or Google Apps.
 *
 * We also use optional attributes for the user's name, for which we accept any of:
 *    given_name + family_name
 *    name
 *
 * Expected environment variables:
 *    env GRIST_OIDC_SP_HOST=https://<your-domain>
 *        Host at which our /oauth2 endpoint will live. Optional, defaults to `APP_HOME_URL`.
 *    env GRIST_OIDC_IDP_ISSUER
 *        The issuer URL for the IdP, passed to node-openid-client, see: https://github.com/panva/node-openid-client/blob/a84d022f195f82ca1c97f8f6b2567ebcef8738c3/docs/README.md#issuerdiscoverissuer.
 *        This variable turns on the OIDC login system.
 *    env GRIST_OIDC_IDP_CLIENT_ID
 *        The client ID for the application, as registered with the IdP.
 *    env GRIST_OIDC_IDP_CLIENT_SECRET
 *        The client secret for the application, as registered with the IdP.
 *    env GRIST_OIDC_IDP_SCOPES
 *        The scopes to request from the IdP, as a space-separated list. Defaults to "openid email profile".
 *    env GRIST_OIDC_SP_PROFILE_NAME_ATTR
 *        The key of the attribute to use for the user's name.
 *        If omitted, the name will either be the concatenation of "given_name" + "family_name" or the "name" attribute.
 *    env GRIST_OIDC_SP_PROFILE_EMAIL_ATTR
 *        The key of the attribute to use for the user's email. Defaults to "email".
 *    env GRIST_OIDC_IDP_END_SESSION_ENDPOINT
 *        If set, overrides the IdP's end_session_endpoint with an alternative URL to redirect user upon logout
 *        (for an IdP that has a logout endpoint but does not support the OIDC RP-Initiated Logout specification).
 *    env GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT
 *        If set to "true", on logout, there won't be any attempt to call the IdP's end_session_endpoint
 *        (the user will remain logged in in the IdP).
 *    env GRIST_OIDC_SP_IGNORE_EMAIL_VERIFIED
 *        If set to "true", the user will be allowed to login even if the email is not verified by the IDP.
 *        Defaults to false.
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
import { GristLoginSystem, GristServer } from './GristServer';
import { Client, generators, Issuer, UserinfoResponse } from 'openid-client';
import { Sessions } from './Sessions';
import log from 'app/server/lib/log';
import { AppSettings, appSettings } from './AppSettings';
import { RequestWithLogin } from './Authorizer';
import { UserProfile } from 'app/common/LoginSessionAPI';
import _ from 'lodash';

enum ENABLED_PROTECTIONS {
  NONCE,
  PKCE,
  STATE,
}

type EnabledProtectionsString = keyof typeof ENABLED_PROTECTIONS;

const CALLBACK_URL = '/oauth2/callback';

export class OIDCConfig {
  /**
   * Handy alias to create an OIDCConfig instance and initialize it.
   */
  public static async build(): Promise<OIDCConfig> {
    const config = new OIDCConfig();
    await config.initOIDC();
    return config;
  }

  protected _client: Client;
  private _redirectUrl: string;
  private _namePropertyKey?: string;
  private _emailPropertyKey: string;
  private _endSessionEndpoint: string;
  private _skipEndSessionEndpoint: boolean;
  private _ignoreEmailVerified: boolean;
  private _enabledProtections: EnabledProtectionsString[] = [];

  protected constructor() {
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
      censor: true,
    });
    this._namePropertyKey = section.flag('namePropertyKey').readString({
      envVar: 'GRIST_OIDC_SP_PROFILE_NAME_ATTR',
    });

    this._emailPropertyKey = section.flag('emailPropertyKey').requireString({
      envVar: 'GRIST_OIDC_SP_PROFILE_EMAIL_ATTR',
      defaultValue: 'email',
    });

    this._endSessionEndpoint = section.flag('endSessionEndpoint').readString({
      envVar: 'GRIST_OIDC_IDP_END_SESSION_ENDPOINT',
      defaultValue: '',
    })!;

    this._skipEndSessionEndpoint = section.flag('skipEndSessionEndpoint').readBool({
      envVar: 'GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT',
      defaultValue: false,
    })!;

    this._ignoreEmailVerified = section.flag('ignoreEmailVerified').readBool({
      envVar: 'GRIST_OIDC_SP_IGNORE_EMAIL_VERIFIED',
      defaultValue: false,
    })!;

    this._enabledProtections = this._buildEnabledProtections(section);
    this._redirectUrl = new URL(CALLBACK_URL, spHost).href;
    await this._initClient({issuerUrl, clientId, clientSecret});

    if (this._client.issuer.metadata.end_session_endpoint === undefined &&
        !this._endSessionEndpoint && !this._skipEndSessionEndpoint) {
      throw new Error('The Identity provider does not propose end_session_endpoint. ' +
        'If that is expected, please set GRIST_OIDC_IDP_SKIP_END_SESSION_ENDPOINT=true ' +
        'or provide an alternative logout URL in GRIST_OIDC_IDP_END_SESSION_ENDPOINT');
    }
    log.info(`OIDCConfig: initialized with issuer ${issuerUrl}`);
  }

  public addEndpoints(app: express.Application, sessions: Sessions): void {
    app.get(CALLBACK_URL, this.handleCallback.bind(this, sessions));
  }

  public async handleCallback(sessions: Sessions, req: express.Request, res: express.Response): Promise<void> {
    const mreq = req as RequestWithLogin;
    try {
      const params = this._client.callbackParams(req);
      const { state, targetUrl } = mreq.session?.oidc ?? {};
      if (!state && this.supportsProtection('STATE')) {
        throw new Error('Login or logout failed to complete');
      }

      const codeVerifier = await this._retrieveCodeVerifierFromSession(req);

      // The callback function will compare the state present in the params and the one we retrieved from the session.
      // If they don't match, it will throw an error.
      const tokenSet = await this._client.callback(
        this._redirectUrl,
        params,
        { state, code_verifier: codeVerifier }
      );

      const userInfo = await this._client.userinfo(tokenSet);

      if (!this._ignoreEmailVerified && userInfo.email_verified !== true) {
        throw new Error(`OIDCConfig: email not verified for ${userInfo.email}`);
      }

      const profile = this._makeUserProfileFromUserInfo(userInfo);
      log.info(`OIDCConfig: got OIDC response for ${profile.email} (${profile.name}) redirecting to ${targetUrl}`);

      const scopedSession = sessions.getOrCreateSessionFromRequest(req);
      await scopedSession.operateOnScopedSession(req, async (user) => Object.assign(user, {
        profile,
      }));

      delete mreq.session.oidc;
      res.redirect(targetUrl ?? '/');
    } catch (err) {
      log.error(`OIDC callback failed: ${err.stack}`);
      // Delete the session data even if the login failed.
      // This way, we prevent several login attempts.
      //
      // Also session deletion must be done before sending the response.
      delete mreq.session.oidc;
      res.status(500).send(`OIDC callback failed.`);
    }
  }

  public async getLoginRedirectUrl(req: express.Request, targetUrl: URL): Promise<string> {
    const { codeVerifier, state } = await this._generateAndStoreConnectionInfo(req, targetUrl.href);
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
    // For IdPs that don't have end_session_endpoint, we just redirect to the logout page.
    if (this._skipEndSessionEndpoint) {
      return redirectUrl.href;
    }
    // Alternatively, we could use a logout URL specified by configuration.
    if (this._endSessionEndpoint) {
      return this._endSessionEndpoint;
    }
    return this._client.endSessionUrl({
      post_logout_redirect_uri: redirectUrl.href
    });
  }

  public supportsProtection(protection: EnabledProtectionsString) {
    return this._enabledProtections.includes(protection);
  }

  protected async _initClient({issuerUrl, clientId, clientSecret}:
    {issuerUrl: string, clientId: string, clientSecret: string}
  ): Promise<void> {
    const issuer = await Issuer.discover(issuerUrl);
    this._client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [ this._redirectUrl ],
      response_types: [ 'code' ],
    });
  }

  private async _generateAndStoreConnectionInfo(req: express.Request, targetUrl: string) {
    const mreq = req as RequestWithLogin;
    if (!mreq.session) { throw new Error('no session available'); }
    const oidcInfo: {[key: string]: string} = {
      targetUrl
    };
    if (this.supportsProtection('PKCE')) {
      oidcInfo.codeVerifier = generators.codeVerifier();
    }
    if (this.supportsProtection('STATE')) {
      oidcInfo.state = generators.state();
    }
    if (this.supportsProtection('NONCE')) {
      oidcInfo.nonce = generators.nonce();
    }

    mreq.session.oidc = oidcInfo;

    return _.pick(oidcInfo, ['codeVerifier', 'state', 'nonce']);
  }

  private _buildEnabledProtections(section: AppSettings): EnabledProtectionsString[] {
    const enabledProtections = section.flag('enabledProtections').readString({
      envVar: 'GRIST_OIDC_IDP_ENABLED_PROTECTIONS',
      defaultValue: 'PKCE,STATE',
    })!.split(',');
    for (const protection of enabledProtections) {
      if (!ENABLED_PROTECTIONS.hasOwnProperty(protection as EnabledProtectionsString)) {
        throw new Error(`OIDC: Invalid protection in GRIST_OIDC_IDP_ENABLED_PROTECTIONS: ${protection}`);
      }
    }
    return enabledProtections as EnabledProtectionsString[];
  }

  private async _retrieveCodeVerifierFromSession(req: express.Request) {
    const mreq = req as RequestWithLogin;
    if (!mreq.session) { throw new Error('no session available'); }
    const codeVerifier = mreq.session.oidc?.codeVerifier;
    if (!codeVerifier) { throw new Error('Login is stale'); }
    return codeVerifier;
  }

  private _makeUserProfileFromUserInfo(userInfo: UserinfoResponse): Partial<UserProfile> {
    return {
      email: String(userInfo[ this._emailPropertyKey ]),
      name: this._extractName(userInfo)
    };
  }

  private _extractName(userInfo: UserinfoResponse): string|undefined {
    if (this._namePropertyKey) {
      return (userInfo[ this._namePropertyKey ] as any)?.toString();
    }
    const fname = userInfo.given_name ?? '';
    const lname = userInfo.family_name ?? '';

    return `${fname} ${lname}`.trim() || userInfo.name;
  }
}

export async function getOIDCLoginSystem(): Promise<GristLoginSystem|undefined> {
  if (!process.env.GRIST_OIDC_IDP_ISSUER) { return undefined; }
  return {
    async getMiddleware(gristServer: GristServer) {
      const config = await OIDCConfig.build();
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
