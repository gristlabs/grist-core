/**
 * Configuration for SAML, useful for enterprise single-sign-on logins.
 * A good informative overview of SAML is at https://www.okta.com/integrate/documentation/saml/
 * Note:
 *    SP is "Service Provider", in our case, the Grist application.
 *    IdP is the "Identity Provider", somewhere users log into, e.g. Okta or Google Apps.
 *
 * We expect IdP to provide us with name_id, a unique identifier for the user.
 * We also use optional attributes for the user's name, for which we accept any of:
 *    FirstName
 *    LastName
 *    http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname
 *    http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname
 *
 * Note that the code is based on the example at https://github.com/Clever/saml2
 *
 * To read more about Grist SAML flow and configuration through environmental variables, in a single server
 * setup, please visit:
 * https://support.getgrist.com/install/saml/
 *
 * Expected environment variables:
 *    env GRIST_SAML_SP_HOST=https://<your-domain>
 *        Host at which our /saml/assert endpoint will live; identifies our application.
 *    env GRIST_SAML_SP_KEY
 *        Path to file with our private key, PEM format.
 *    env GRIST_SAML_SP_CERT
 *        Path to file with our public key, PEM format.
 *    env GRIST_SAML_IDP_LOGIN
 *        Login url to redirect user to for log-in.
 *    env GRIST_SAML_IDP_LOGOUT
 *        Logout URL to redirect user to for log-out.
 *    env GRIST_SAML_IDP_SKIP_SLO
 *        If set and non-empty, don't attempt "Single Logout" flow (which I haven't gotten to
 *        work), but simply redirect to GRIST_SAML_IDP_LOGOUT after clearing session.
 *    env GRIST_SAML_IDP_CERTS
 *        Comma-separated list of paths for certificates from identity provider, PEM format.
 *    env GRIST_SAML_IDP_UNENCRYPTED
 *        If set and non-empty, allow unencrypted assertions, relying on https for privacy.
 *
 * This version of SamlConfig has been tested with Auth0 SAML IdP following the instructions
 * at:
 *   https://auth0.com/docs/protocols/saml-protocol/configure-auth0-as-saml-identity-provider
 * When running on localhost and http, the settings tested were with:
 *   - GRIST_SAML_IDP_SKIP_SLO not set
 *   - GRIST_SAML_SP_HOST=http://localhost:8080 or 8484
 *   - GRIST_SAML_IDP_UNENCRYPTED=1
 *   - GRIST_SAML_IDP_LOGIN=https://...auth0.com/samlp/xxxx
 *   - GRIST_SAML_IDP_LOGOUT=https://...auth0.com/samlp/xxxx  # these are same for Auth0
 *   - GRIST_SAML_IDP_CERTS=.../auth0.pem   # downloaded per Auth0 instructions
 *   - GRIST_SAML_SP_KEY=.../saml.pem       # created
 *   - GRIST_SAML_SP_CERT=.../saml.crt      # created
 *
 * Created and used the key/cert pair following instructions here:
 *   https://auth0.com/docs/protocols/saml-protocol/saml-sso-integrations/sign-and-encrypt-saml-requests#use-custom-certificate-to-sign-requests
 *   https://auth0.com/docs/protocols/saml-protocol/saml-sso-integrations/sign-and-encrypt-saml-requests#auth0-as-the-saml-identity-provider
 *
 */

import * as express from 'express';
import * as fse from 'fs-extra';
import * as saml2 from 'saml2-js';

import {AppSettings} from 'app/server/lib/AppSettings';
import {expressWrap} from 'app/server/lib/expressWrap';
import {getSelectedLoginSystemType} from 'app/server/lib/gristSettings';
import {GristLoginSystem, GristServer} from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';
import {Permit} from 'app/server/lib/Permit';
import {getOriginUrl} from 'app/server/lib/requestUtils';
import {fromCallback} from 'app/server/lib/serverUtils';
import {Sessions} from 'app/server/lib/Sessions';

/**
 * Interface for SAML configuration.
 */
export interface SamlConfig {
  /** Host at which our /saml/assert endpoint will live; identifies our application. */
  readonly spHost: string;
  /** The private key content, PEM format. */
  readonly spKey: string;
  /** The public key content, PEM format. */
  readonly spCert: string;
  /** Login url to redirect user to for log-in. */
  readonly idpLogin: string;
  /** Logout URL to redirect user to for log-out. */
  readonly idpLogout: string;
  /** If true, don't attempt "Single Logout" flow, but simply redirect to idpLogout after clearing session. */
  readonly skipSlo: boolean;
  /** List of certificate contents, PEM format. */
  readonly idpCerts: string[];
  /** If true, allow unencrypted assertions, relying on https for privacy. */
  readonly allowUnencrypted: boolean;
}

/**
 * Read SAML configuration from application settings.
 * When reading from environment variables, the cert/key values are file paths,
 * so we read the file contents here.
 */
export async function readSamlConfigFromSettings(settings: AppSettings): Promise<SamlConfig> {
  const section = settings.section('login').section('system').section('saml');

  const spHost = section.flag('spHost').requireString({
    envVar: 'GRIST_SAML_SP_HOST',
  });

  const spKeyPath = section.flag('spKey').requireString({
    envVar: 'GRIST_SAML_SP_KEY',
  });

  const spCertPath = section.flag('spCert').requireString({
    envVar: 'GRIST_SAML_SP_CERT',
  });

  const idpLogin = section.flag('idpLogin').requireString({
    envVar: 'GRIST_SAML_IDP_LOGIN',
  });

  const idpLogout = section.flag('idpLogout').requireString({
    envVar: 'GRIST_SAML_IDP_LOGOUT',
  });

  const skipSlo = section.flag('idpSkipSlo').readBool({
    envVar: 'GRIST_SAML_IDP_SKIP_SLO',
    defaultValue: false,
  })!;

  const idpCertsPaths = section.flag('idpCerts').requireString({
    envVar: 'GRIST_SAML_IDP_CERTS',
  }).split(',').map(p => p.trim());

  const allowUnencrypted = section.flag('idpUnencrypted').readBool({
    envVar: 'GRIST_SAML_IDP_UNENCRYPTED',
    defaultValue: false,
  })!;

  // Read the file contents from paths
  const spKey = await fse.readFile(spKeyPath, {encoding: 'utf8'});
  const spCert = await fse.readFile(spCertPath, {encoding: 'utf8'});
  const idpCerts = await Promise.all(idpCertsPaths.map((p: string) =>
    fse.readFile(p, {encoding: 'utf8'})));

  return {
    spHost,
    spKey,
    spCert,
    idpLogin,
    idpLogout,
    skipSlo,
    idpCerts,
    allowUnencrypted
  };
}

/**
 * Check if SAML is configured based on environment variables.
 */
export function maybeSamlConfigured(settings: AppSettings): boolean {
  const section = settings.section('login').section('system').section('saml');
  const spHost = section.flag('spHost').readString({
    envVar: 'GRIST_SAML_SP_HOST',
  });
  return !!spHost;
}

/**
 * Check if SAML is enabled either by explicit selection or by configuration.
 */
export function isSamlEnabled(settings: AppSettings): boolean {
  const selectedType = getSelectedLoginSystemType(settings);
  if (selectedType === 'saml') {
    return true;
  }
  if (selectedType) {
    return false;
  }
  return maybeSamlConfigured(settings);
}

export class SamlBuilder {
  /**
   * Handy alias to create a SamlBuilder instance and initialize it.
   */
  public static async build(
    gristServer: GristServer,
    config: SamlConfig
  ): Promise<SamlBuilder> {
    const builder = new SamlBuilder(gristServer, config);
    await builder.initSaml();
    return builder;
  }

  private _serviceProvider: saml2.ServiceProvider;
  private _identityProvider: saml2.IdentityProvider;
  private _config: SamlConfig;

  protected constructor(
    private _gristServer: GristServer,
    config: SamlConfig
  ) {
    this._config = config;
  }

  // Initialize the SAML state using the certificate contents from config.
  public async initSaml(): Promise<void> {
    const spHost = this._config.spHost;
    const spOptions: saml2.ServiceProviderOptions = {
      entity_id: `${spHost}/saml/metadata.xml`,
      private_key: this._config.spKey,
      certificate: this._config.spCert,
      assert_endpoint: `${spHost}/saml/assert`,
      notbefore_skew: 5,      // allow 5 seconds of time skew
      sign_get_request: true  // Auth0 requires this. If it is a problem for others, could make optional.
    };
    this._serviceProvider = new saml2.ServiceProvider(spOptions);

    const idpOptions: saml2.IdentityProviderOptions = {
      sso_login_url: this._config.idpLogin,
      sso_logout_url: this._config.idpLogout,
      certificates: this._config.idpCerts,
      // Encrypted assertions are recommended, but not necessary when over https.
      allow_unencrypted_assertion: this._config.allowUnencrypted,
    };
    this._identityProvider = new saml2.IdentityProvider(idpOptions);
    log.info(`SamlConfig set with host ${spHost}, IdP ${this._config.idpLogin}`);
  }

  // Return a login URL to which to redirect the user to log in. Once logged in, the user will be
  // redirected to redirectUrl
  public async getLoginRedirectUrl(req: express.Request, redirectUrl: URL): Promise<string> {
    const sp = this._serviceProvider;
    const idp = this._identityProvider;
    const { permit: relay_state, samlNameId } = await this._prepareAppState(req, redirectUrl, {
      action: 'login',
      waitMinutes: 20,
    });
    const force_authn = samlNameId === undefined;  // If logged out locally, ignore any
                                                   // log in state retained by IdP.
    return fromCallback((cb) => sp.create_login_request_url(idp, {relay_state, force_authn}, cb));
  }

  // Returns the URL to log the user out of SAML IdentityProvider.
  public async getLogoutRedirectUrl(req: express.Request, redirectUrl: URL): Promise<string> {
    if (this._config.skipSlo) {
      // TODO: This does NOT eventually take us to redirectUrl.
      return this._config.idpLogout;
    }

    const sp = this._serviceProvider;
    const idp = this._identityProvider;

    // 2020: Not sure what I am doing wrong here, but all my attempt to use "Single Logout" fail with
    // a "400 Bad Request" error message from Okta.
    // 2021: This doesn't fail with Auth0 (now owned by Okta), but also doesn't seem to do anything.

    const { permit: relay_state, samlNameId, samlSessionIndex } = await this._prepareAppState(req, redirectUrl, {
      action: 'logout',
      waitMinutes: 1
    });

    const options: saml2.CreateLogoutRequestUrlOptions = {
      name_id: samlNameId,
      session_index: samlSessionIndex,
      relay_state,
    };
    return fromCallback<string>((cb) => sp.create_logout_request_url(idp, options, cb));
  }

  // Adds several /saml/* endpoints to the given express app, to support SAML logins.
  public addSamlEndpoints(app: express.Express, sessions: Sessions): void {
    const sp = this._serviceProvider;
    const idp = this._identityProvider;

    // A purely informational endpoint, which simply dumps the SAML metadata.
    app.get("/saml/metadata.xml", (req, res) => {
      res.type('application/xml');
      res.send(sp.create_metadata());
    });

    // Starting point for login. It redirects to the IdP, and then to /saml/assert.
    app.get("/saml/login", expressWrap(async (req, res, next) => {
      res.redirect(await this.getLoginRedirectUrl(req, new URL(getOriginUrl(req))));
    }));

    // Assert endpoint for when the login completes as POST.
    app.post("/saml/assert", express.urlencoded({extended: true}), expressWrap(async (req, res, next) => {
      const {redirectUrl, sessionId, unsolicited, action} = await this._processInitialRequest(req);
      const samlResponse: saml2.SAMLAssertResponse = await fromCallback(
        (cb) => sp.post_assert(idp, { request_body: req.body }, cb)
      );
      if (action === 'login') {
        const samlUser = samlResponse.user;
        if (!samlUser || !samlUser.name_id) {
          log.warn(`SamlConfig: bad SAML response: ${JSON.stringify(samlUser)}`);
          throw new Error("Invalid user info in SAML response");
        }

        // An example IdP response is at https://github.com/Clever/saml2#assert_response. Saml2-js
        // maps some standard attributes as user.given_name, user.surname, which we use if
        // available. Otherwise we use user.attributes which has the form {Name: [Value]}.
        const fname = (samlUser as any).given_name || samlUser.attributes?.FirstName || '';
        const lname = (samlUser as any).surname || samlUser.attributes?.LastName || '';
        const email = (samlUser as any).email || samlUser.name_id;
        const profile = {
          email,
          name: `${fname} ${lname}`.trim(),
        };

        const samlSessionIndex = samlUser.session_index;
        const samlNameId = samlUser.name_id;
        log.info(`SamlConfig: got SAML response${unsolicited ? ' (unsolicited)' : ''} for ` +
          `${profile.email} (${profile.name}) redirecting to ${redirectUrl}`);

        const scopedSession = sessions.getOrCreateSessionFromRequest(req, {sessionId});
        await scopedSession.operateOnScopedSession(req, async (user) => Object.assign(user, {
          profile,
          samlSessionIndex,
          samlNameId,
        }));
      }
      res.redirect(redirectUrl);
    }));
  }

  private async _processInitialRequest(req: express.Request) {
    const relayState: string = req.body.RelayState;
    const sessionId = this._gristServer.getSessions().getSessionIdFromRequest(req) || undefined;

    if (!relayState) {
      // Presumably an IdP-inititated signin.
      return {
        sessionId,
        redirectUrl: getOriginUrl(req),
        unsolicited: true,
        action: "login",
      };
    }

    const permitStore = this._gristServer.getExternalPermitStore();
    const state = await permitStore.getPermit(relayState);
    if (!state) {
      // Presumably an IdP-inititated signin without a permit, but
      // let's check to see if it has a redirect URL.
      return {
        sessionId,
        redirectUrl: checkRedirectUrl(relayState, req).href,
        unsolicited: true,
        action: "login",
      };
    }


    await permitStore.removePermit(relayState);
    return {
      sessionId: state.sessionId,
      // Trust this URL because it could only have come from us (i.e. we should've checked it
      // earlier if it was untrusted).
      redirectUrl: state.url || "",
      unsolicited: false,
      action: state.action || "",
    };
  }

  /**
   *
   * Login and logout involves redirecting to a SAML IdP, which will then POST some information
   * back to Grist.  The POST won't have Grist's cookie, because of relatively new SameSite
   * behavior.  Grist's cookie is SameSite=Lax, which withholds cookies from POSTs initiated
   * on a different site.  That's a good setting in general, but for this case we need
   * to link what the identity provider sends us with the session.  We place some state
   * in the permit store temporarily and pass the permit key through the request chain
   * so it is available when needed.
   *
   */
  private async _prepareAppState(req: express.Request, redirectUrl: URL, options: {
    action: 'login' | 'logout',   // We'll need to remember whether we are logging in or out.
    waitMinutes: number        // State may need to linger quite some time for login,
                               // less so for logout.
  }) {
    const permitStore = this._gristServer.getExternalPermitStore();
    const sessionId = this._gristServer.getSessions().getSessionIdFromRequest(req);
    if (!sessionId) { throw new Error('no session available'); }
    const state: Permit = {
      url: redirectUrl.href,
      sessionId,
      action: options.action,
    };
    const scopedSession = this._gristServer.getSessions().getOrCreateSessionFromRequest(req);
    const userSession = await scopedSession.getScopedSession();
    const samlNameId = userSession.samlNameId;
    const samlSessionIndex = userSession.samlSessionIndex;
    const permit = await permitStore.setPermit(state, options.waitMinutes * 60 * 1000);
    return { permit, samlNameId, samlSessionIndex };
  }
}

function checkRedirectUrl(untrustedUrl: string, req: express.Request): URL {
  const originUrl = new URL(getOriginUrl(req));
  try {
    const url = new URL(untrustedUrl);
    if (url.origin !== originUrl.origin) {
      throw new Error("unexpected origin");
    }
    return url;
  } catch (e) {
    log.warn(`SamlConfig: ignoring invalid redirect URL: ${e.message}`);
  }
  return originUrl;
}

/**
 * Return SAML login system if enabled, or undefined otherwise.
 */
export async function getSamlLoginSystem(settings: AppSettings): Promise<GristLoginSystem | undefined> {
  if (!isSamlEnabled(settings)) {
    return undefined;
  }

  return {
    async getMiddleware(gristServer: GristServer) {
      const config = await SamlBuilder.build(gristServer, await readSamlConfigFromSettings(settings));
      return {
        getLoginRedirectUrl: config.getLoginRedirectUrl.bind(config),
        // For saml, always use regular login page, users are enrolled externally.
        // TODO: is there a better link to give here?
        getSignUpRedirectUrl: config.getLoginRedirectUrl.bind(config),
        getLogoutRedirectUrl: config.getLogoutRedirectUrl.bind(config),
        async addEndpoints(app: express.Express) {
          config.addSamlEndpoints(app, gristServer.getSessions());
          return 'saml';
        },
      };
    },
    async deleteUser() {
      // If we could delete the user account in the external
      // authentication system, this is our chance - but we can't.
    },
  };
}
