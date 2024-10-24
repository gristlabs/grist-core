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
 *    env GRIST_OIDC_IDP_ENABLED_PROTECTIONS
 *        A comma-separated list of protections to enable. Supported values are "PKCE", "STATE", "NONCE"
 *        (or you may set it to "UNPROTECTED" alone, to disable any protections if you *really* know what you do!).
 *        Defaults to "PKCE,STATE", which is the recommended settings.
 *        It's highly recommended that you enable STATE, and at least one of PKCE or NONCE,
 *        depending on what your OIDC provider requires/supports.
 *    env GRIST_OIDC_IDP_ACR_VALUES
 *        A space-separated list of ACR values to request from the IdP. Optional.
 *    env GRIST_OIDC_IDP_EXTRA_CLIENT_METADATA
 *        A JSON object with extra client metadata to pass to openid-client. Optional.
 *        Be aware that setting this object may override any other values passed to the openid client.
 *        More info: https://github.com/panva/node-openid-client/tree/main/docs#new-clientmetadata-jwks-options
 *    env GRIST_OIDC_SP_HTTP_TIMEOUT
 *        The timeout in milliseconds for HTTP requests to the IdP. The default value is set to 3500 by the
 *        openid-client library. See: https://github.com/panva/node-openid-client/blob/main/docs/README.md#customizing-http-requests
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
import {
  Client, ClientMetadata, custom, Issuer, errors as OIDCError, TokenSet, UserinfoResponse
} from 'openid-client';
import { Sessions } from './Sessions';
import log from 'app/server/lib/log';
import { AppSettings, appSettings } from './AppSettings';
import { RequestWithLogin } from './Authorizer';
import { UserProfile } from 'app/common/LoginSessionAPI';
import { SendAppPageFunction } from 'app/server/lib/sendAppPage';
import { StringUnionError } from 'app/common/StringUnion';
import { EnabledProtection, EnabledProtectionString, ProtectionsManager } from './oidc/Protections';
import { SessionObj } from './BrowserSession';
import { getOriginUrl } from './requestUtils';

const CALLBACK_URL = '/oauth2/callback';

function formatTokenForLogs(token: TokenSet) {
  const showValueInClear = ['token_type', 'expires_in', 'expires_at', 'scope'];
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(token)) {
    if (typeof value !== 'function') {
      result[key] = showValueInClear.includes(key) ? value : 'REDACTED';
    }
  }
  return result;
}

class ErrorWithUserFriendlyMessage extends Error {
  constructor(errMessage: string, public readonly userFriendlyMessage: string) {
    super(errMessage);
  }
}

export class OIDCConfig {
  /**
   * Handy alias to create an OIDCConfig instance and initialize it.
   */
  public static async build(sendAppPage: SendAppPageFunction): Promise<OIDCConfig> {
    const config = new OIDCConfig(sendAppPage);
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
  private _protectionManager: ProtectionsManager;
  private _acrValues?: string;

  protected constructor(
    private _sendAppPage: SendAppPageFunction
  ) {}

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
    const httpTimeout = section.flag('httpTimeout').readInt({
      envVar: 'GRIST_OIDC_SP_HTTP_TIMEOUT',
      minValue: 0, // 0 means no timeout
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

    this._acrValues = section.flag('acrValues').readString({
      envVar: 'GRIST_OIDC_IDP_ACR_VALUES',
    })!;

    this._ignoreEmailVerified = section.flag('ignoreEmailVerified').readBool({
      envVar: 'GRIST_OIDC_SP_IGNORE_EMAIL_VERIFIED',
      defaultValue: false,
    })!;

    const extraMetadata: Partial<ClientMetadata> = JSON.parse(section.flag('extraClientMetadata').readString({
      envVar: 'GRIST_OIDC_IDP_EXTRA_CLIENT_METADATA',
    }) || '{}');

    const enabledProtections = this._buildEnabledProtections(section);
    this._protectionManager = new ProtectionsManager(enabledProtections);

    this._redirectUrl = new URL(CALLBACK_URL, spHost).href;
    custom.setHttpOptionsDefaults({
      ...(httpTimeout !== undefined ? {timeout: httpTimeout} : {}),
    });
    await this._initClient({ issuerUrl, clientId, clientSecret, extraMetadata });

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
    let mreq;
    try {
      mreq = this._getRequestWithSession(req);
    } catch(err) {
      log.warn("OIDCConfig callback:", err.message);
      return this._sendErrorPage(req, res);
    }

    try {
      const params = this._client.callbackParams(req);
      if (!mreq.session.oidc) {
        throw new Error('Missing OIDC information associated to this session');
      }

      const { targetUrl } = mreq.session.oidc;

      const checks = this._protectionManager.getCallbackChecks(mreq.session.oidc);

      // The callback function will compare the protections present in the params and the ones we retrieved
      // from the session. If they don't match, it will throw an error.
      const tokenSet = await this._client.callback(this._redirectUrl, params, checks);
      log.debug("Got tokenSet: %o", formatTokenForLogs(tokenSet));

      const userInfo = await this._client.userinfo(tokenSet);
      log.debug("Got userinfo: %o", userInfo);

      if (!this._ignoreEmailVerified && userInfo.email_verified !== true) {
        throw new ErrorWithUserFriendlyMessage(
          `OIDCConfig: email not verified for ${userInfo.email}`,
          req.t("oidc.emailNotVerifiedError")
        );
      }

      const profile = this._makeUserProfileFromUserInfo(userInfo);
      log.info(`OIDCConfig: got OIDC response for ${profile.email} (${profile.name}) redirecting to ${targetUrl}`);

      const scopedSession = sessions.getOrCreateSessionFromRequest(req);
      await scopedSession.operateOnScopedSession(req, async (user) => Object.assign(user, {
        profile,
      }));

      // We clear the previous session info, like the states, nonce or the code verifier, which
      // now that we are authenticated.
      // We store the idToken for later, especially for the logout
      mreq.session.oidc = {
        idToken: tokenSet.id_token,
      };
      res.redirect(targetUrl ?? '/');
    } catch (err) {
      log.error(`OIDC callback failed: ${err.stack}`);
      const maybeResponse = this._maybeExtractDetailsFromError(err);
      if (maybeResponse) {
        log.error('Response received: %o',  maybeResponse);
      }

      // Delete entirely the session data when the login failed.
      // This way, we prevent several login attempts.
      //
      // Also session deletion must be done before sending the response.
      delete mreq.session.oidc;

      await this._sendErrorPage(req, res, err.userFriendlyMessage);
    }
  }

  public async getLoginRedirectUrl(req: express.Request, targetUrl: URL): Promise<string> {
    const mreq = this._getRequestWithSession(req);

    mreq.session.oidc = {
      targetUrl: targetUrl.href,
      ...this._protectionManager.generateSessionInfo()
    };

    return this._client.authorizationUrl({
      scope: process.env.GRIST_OIDC_IDP_SCOPES || 'openid email profile',
      acr_values: this._acrValues,
      ...this._protectionManager.forgeAuthUrlParams(mreq.session.oidc),
    });
  }

  public async getLogoutRedirectUrl(req: express.Request, redirectUrl: URL): Promise<string> {
    // For IdPs that don't have end_session_endpoint, we just redirect to the requested page.
    if (this._skipEndSessionEndpoint) {
      return redirectUrl.href;
    }
    // Alternatively, we could use a logout URL specified by configuration.
    if (this._endSessionEndpoint) {
      return this._endSessionEndpoint;
    }
    // Ignore redirectUrl because OIDC providers don't allow variable redirect URIs
    const stableRedirectUri = new URL('/signed-out', getOriginUrl(req)).href;
    const session: SessionObj|undefined = (req as RequestWithLogin).session;
    return this._client.endSessionUrl({
      post_logout_redirect_uri: stableRedirectUri,
      id_token_hint: session?.oidc?.idToken,
    });
  }

  public supportsProtection(protection: EnabledProtectionString) {
    return this._protectionManager.supportsProtection(protection);
  }

  protected async _initClient({ issuerUrl, clientId, clientSecret, extraMetadata }:
    { issuerUrl: string, clientId: string, clientSecret: string, extraMetadata: Partial<ClientMetadata> }
  ): Promise<void> {
    const issuer = await Issuer.discover(issuerUrl);
    this._client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [this._redirectUrl],
      response_types: ['code'],
      ...extraMetadata,
    });
  }

  private _sendErrorPage(req: express.Request, res: express.Response, userFriendlyMessage?: string) {
    return this._sendAppPage(req, res, {
      path: 'error.html',
      status: 500,
      config: {
        errPage: 'signin-failed',
        errMessage: userFriendlyMessage
      },
    });
  }

  private _getRequestWithSession(req: express.Request) {
    const mreq = req as RequestWithLogin;
    if (!mreq.session) { throw new Error('no session available'); }

    return mreq;
  }

  private _buildEnabledProtections(section: AppSettings): Set<EnabledProtectionString> {
    const enabledProtections = section.flag('enabledProtections').readString({
      envVar: 'GRIST_OIDC_IDP_ENABLED_PROTECTIONS',
      defaultValue: 'PKCE,STATE',
    })!.split(',');
    if (enabledProtections.length === 1 && enabledProtections[0] === 'UNPROTECTED') {
      log.warn("You chose to enable OIDC connection with no protection, you are exposed to vulnerabilities." +
        " Please never do that in production.");
      return new Set();
    }
    try {
      return new Set(EnabledProtection.checkAll(enabledProtections));
    } catch (e) {
      if (e instanceof StringUnionError) {
        throw new TypeError(`OIDC: Invalid protection in GRIST_OIDC_IDP_ENABLED_PROTECTIONS: ${e.actual}.`+
          ` Expected at least one of these values: "${e.values.join(",")}"`
        );
      }
      throw e;
    }
  }

  private _makeUserProfileFromUserInfo(userInfo: UserinfoResponse): Partial<UserProfile> {
    return {
      email: String(userInfo[this._emailPropertyKey]),
      name: this._extractName(userInfo)
    };
  }

  private _extractName(userInfo: UserinfoResponse): string | undefined {
    if (this._namePropertyKey) {
      return (userInfo[this._namePropertyKey] as any)?.toString();
    }
    const fname = userInfo.given_name ?? '';
    const lname = userInfo.family_name ?? '';

    return `${fname} ${lname}`.trim() || userInfo.name;
  }

  /**
   * Returns some response details from either OIDCClient's RPError or OPError,
   * which are handy for error logging.
   */
  private _maybeExtractDetailsFromError(error: Error) {
    if (error instanceof OIDCError.OPError || error instanceof OIDCError.RPError) {
      const { response } = error;
      if (response) {
        // Ensure that we don't log a buffer (which might be noisy), at least for now, unless we're sure that
        // would be relevant.
        const isBodyPureObject = response.body && Object.getPrototypeOf(response.body) === Object.prototype;
        return {
          body: isBodyPureObject ? response.body : undefined,
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
        };
      }
    }
    return null;
  }
}

export async function getOIDCLoginSystem(): Promise<GristLoginSystem | undefined> {
  if (!process.env.GRIST_OIDC_IDP_ISSUER) { return undefined; }
  return {
    async getMiddleware(gristServer: GristServer) {
      const config = await OIDCConfig.build(gristServer.sendAppPage.bind(gristServer));
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
    async deleteUser() { },
  };
}
