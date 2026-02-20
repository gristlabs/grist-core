/**
 * The server-side support for integration as an OAuth2 client. This is when Grist is registered
 * with another service with a clientId and clientSecret. We provide endpoints:
 *  1. For the client to start the authorization flow: /oauth2/:integration/authorize.
 *  2. For the service to redirect back to: /oauth2/:integration/callback (this should typically
 *     get registered with the service)
 *  3. To get existing tokens, if any: /oauth2/:integration/tokens.
 *
 * Note that each integration requires a clientId and a clientSecret to be provided via
 * environment variables. Without that, it's unconfigured and can't be used. Grist client can
 * check for that using the /tokens endpoint, which returns different errors.
 *
 * TODO The current implementation stores access_token (as well as refresh_token, if provided) in
 * the active user's session, and returns it to the browser. In the future, we probably want to
 * allow the user to choose to store these with an org or with a document, to enable an
 * integration for others. We'll probably need to proxy requests to the resource provider through
 * the server, rather than share access token with the browser: because access token is not OK to
 * expose to other users, because CORS may block direct requests from browser, and because
 * proxying seems to be the recommended pattern: see
 * https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps#name-backend-for-frontend-bff.
 */
import { ApiError } from "app/common/ApiError";
import { safeJsonParse } from "app/common/gutil";
import { User } from "app/common/User";
import { appSettings } from "app/server/lib/AppSettings";
import { getAuthorizedUserId, RequestWithLogin } from "app/server/lib/Authorizer";
import { SessionOIDCInfo, SessionUserObj } from "app/server/lib/BrowserSession";
import { expressWrap, secureJsonErrorHandler } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import log from "app/server/lib/log";
import { ProtectionsManager } from "app/server/lib/oidc/Protections";
import { agents } from "app/server/lib/ProxyAgent";
import { allowHost, stringParam } from "app/server/lib/requestUtils";

import express from "express";
import pick from "lodash/pick";
import openidClient, { Client, ClientMetadata, Issuer, IssuerMetadata, TokenSet } from "openid-client";

type IntegrationId = "airtable" | "smartsheet";

/**
 * For the sake of tests, we can override any integration's settings. For example:
 * {"airtable": {"issuerMetadata": {"authorization_endpoint": ...}}}
 */
const testOverrides = safeJsonParse(process.env.TEST_GRIST_OAUTH2_CLIENTS_OVERRIDES || "", null);

/**
 * The REDIRECT URI to register with the other service is {redirectHost}/oauth2/{integrationId}/callback.
 */
const redirectHost = () => appSettings.section("oauth2").flag("redirectHost").readString({
  envVar: "OAUTH2_GRIST_HOST",
  defaultValue: process.env.APP_HOME_URL,   // NOTE: This variable may not be set.
});

/**
 * Each supported integration is defined using IntegrationSpec.
 * - All integrations share a few endpoints:
 *      GET /oauth2/:integration/(authorize|callback|token)
 *      DELETE /oauth2/:integration/token
 * - The REDIRECT URI to register with the other service is {redirectHost}/oauth2/{integrationId}/callback.
 * - Each integration specifies the env vars to hold clientId and clientSecret.
 * - OAuth2 session state is in {flow, tokenSet} object in session.oauth2[integration].
 * - Each integration defines protections to use (["PKCE", "STATE] is recommended).
 * - Each integration specifies the scope to ask for (depends on service).
 * - After initialization, `.client` is set if suitable env vars were found, or null otherwise.
 */
interface Integration {
  id: IntegrationId;
  name: string;
  envVarClientId: string;
  envVarClientSecret: string;
  issuerMetadata: IssuerMetadata;
  extraMetadata?: Partial<ClientMetadata>;
  protections: ProtectionsManager;
  scope: string;
  redirectUri: string;
  client?: Client | null;
}

interface ValidIntegration extends Integration {
  client: Client;
}

const INTEGRATIONS = new Map<IntegrationId, Integration>();

function initializeIntegrations() {
  const spHost = redirectHost();
  if (!spHost) {
    log.warn("OAuth2 clients require OAUTH2_GRIST_HOST or APP_HOME_URL to be set");
    return;
  }
  const redirectUri = (id: IntegrationId) =>
    new URL(OAUTH2_ENDPOINTS.callback.replace(":integration", id), spHost).href;

  // Airtable OAuth reference: https://airtable.com/developers/web/api/oauth-reference. It asks
  // for both STATE and PKCE protections.
  INTEGRATIONS.set("airtable", initIntegration({
    id: "airtable",
    name: "Airtable",
    envVarClientId: "OAUTH2_AIRTABLE_CLIENT_ID",
    envVarClientSecret: "OAUTH2_AIRTABLE_CLIENT_SECRET",
    issuerMetadata: {
      issuer: "airtable",
      authorization_endpoint: "https://airtable.com/oauth2/v1/authorize",
      token_endpoint: "https://airtable.com/oauth2/v1/token",
    },
    protections: new ProtectionsManager(new Set(["PKCE", "STATE"])),
    scope: "data.records:read schema.bases:read",
    redirectUri: redirectUri("airtable"),
  }));

  // Smartsheet OAuth: https://developers.smartsheet.com/api/smartsheet/guides/advanced-topics/oauth.
  // It only seems to support STATE (not PKCE) protection. It's /token endpoint needs client
  // secret included in the body of the post (hence "client_secret_post" for token auth method).
  INTEGRATIONS.set("smartsheet", initIntegration({
    id: "smartsheet",
    name: "Smartsheet",
    envVarClientId: "OAUTH2_SMARTSHEET_CLIENT_ID",
    envVarClientSecret: "OAUTH2_SMARTSHEET_CLIENT_SECRET",
    issuerMetadata: {
      issuer: "smartsheet",
      authorization_endpoint: "https://app.smartsheet.com/b/authorize",
      token_endpoint: "https://api.smartsheet.com/2.0/token",
    },
    extraMetadata: {
      token_endpoint_auth_method: "client_secret_post",
    },
    protections: new ProtectionsManager(new Set(["STATE"])),
    scope: "READ_SHEETS",
    redirectUri: redirectUri("smartsheet"),
  }));
}

function initIntegration(spec: Integration): Integration {
  const section = appSettings.section("oauth2").section(spec.id);
  const clientId = section.flag("clientId").readString({
    envVar: spec.envVarClientId,
  });

  let client: Client | null = null;
  if (clientId) {
    const clientSecret = section.flag("clientSecret").requireString({
      envVar: spec.envVarClientSecret,
      censor: true,
    });
    if (testOverrides?.[spec.id]) {
      spec = { ...spec, ...testOverrides[spec.id] };
    }
    const issuer = new Issuer(spec.issuerMetadata);

    client = new issuer.Client({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uris: [spec.redirectUri],
      response_types: ["code"],
      ...spec.extraMetadata,
    });
  }
  return { ...spec, client };
}

interface IntegrationSessionInfo {
  flow?: SessionOIDCInfo;
  // We need to postMessage from spHost origin to the origin of the opening page, which may be
  // different when running in an environment with subdomains. We remember it temporarily here.
  openerOrigin?: string;
  tokenSet?: TokenSet;
}

interface SessionUserObjWithOAuth extends SessionUserObj {
  oauth2?: { [key: string]: IntegrationSessionInfo };
}

const OAUTH2_ENDPOINTS = {
  authorize: "/oauth2/:integration/authorize", // Client should open a window with this URL.
  callback: "/oauth2/:integration/callback", // To register with authorization server as redirectUri.
  token: "/oauth2/:integration/token", // Get stored tokens; 400=not configured, 401=no valid tokens.
};

export class OAuth2Clients {
  private _sessions = this._gristServer.getSessions();

  constructor(private _gristServer: GristServer) {
    // Tell openid-client library to use the trusted proxy agent if one is configured.
    if (agents.trusted) {
      openidClient.custom.setHttpOptionsDefaults({ agent: agents.trusted });
    }
    initializeIntegrations();
  }

  public getValidClients(): IntegrationId[] {
    return [...INTEGRATIONS.values()].filter(it => it.client).map(it => it.id);
  }

  public attachEndpoints(app: express.Express, middleware: express.RequestHandler[]) {
    /**
     * Redirect to the resource provider's authorization endpoint.
     */
    app.get(OAUTH2_ENDPOINTS.authorize, middleware, expressWrap(async (req, res) => {
      const openerOrigin = stringParam(req.query.openerOrigin, "openerOrigin");
      if (openerOrigin && !allowHost(req, new URL(openerOrigin))) {
        // This is outside try/catch because a problem with the origin can't be reported back to the opener.
        throw new ApiError("Untrusted opener origin", 403);
      }
      try {
        assertUserIsAuthorized(req);
        const { id, client, protections, scope } = this._getIntegration(req.params.integration);
        const session = this._sessions.getOrCreateSessionFromRequest(req);
        const flowInfo = protections.generateSessionInfo();
        await session.operateOnScopedSession(req, async (user: SessionUserObjWithOAuth) => {
          const previousInfo = user.oauth2?.[id] || {};
          user.oauth2 = { ...user.oauth2, [id]: { ...previousInfo, openerOrigin, flow: flowInfo } };
          return user;
        });
        const authUrl = client.authorizationUrl({
          scope,
          ...protections.forgeAuthUrlParams(flowInfo),
        });
        res.redirect(authUrl);
      } catch (e) {
        log.warn(`OAuth2 authorize error: ${e.message}`);
        // Short-circuit to the error response we'd get after a redirect, i.e. respond with the
        // HTML page that closes the popup and sends the error code back to the window opener.
        const payload = { error: String(e.message) };
        return res.send(renderEndFlowHtmlTemplate(payload, openerOrigin));
      }
    }));

    /**
     * Receive redirect back from resource provider, to complete authorization code flow and get
     * access tokens. Returns HTML to close the popup window and post back the credential.
     */
    app.get(OAUTH2_ENDPOINTS.callback, middleware, expressWrap(async (req, res) => {
      assertUserIsAuthorized(req);
      const { id, name, client, protections, redirectUri } = this._getIntegration(req.params.integration);
      let payload = {};
      let openerOrigin: string | undefined;
      try {
        const params = client.callbackParams(req);
        const state = stringParam(params.state, "state");
        const sessionUsers = getRequiredSessionUsers(req);
        const sessionUser = sessionUsers.find(u => u.oauth2?.[id].flow?.state === state);
        if (!sessionUser) {
          throw new Error("Session expired");
        }

        const userSelector = sessionUser.profile?.email;
        if (!userSelector) {
          throw new Error("Session missing profile email");
        }

        const info = sessionUser.oauth2?.[id];
        const flow = info?.flow;
        if (!flow) { throw new Error(`Session missing ${name} info`); }
        if (!info.openerOrigin) { throw new Error(`Session missing openerOrigin`); }
        openerOrigin = info.openerOrigin;

        // This is the verification critical to security.
        const checks = protections.getCallbackChecks(flow);

        const tokenSet = await client.oauthCallback(redirectUri, params, checks);

        // Store the result in the session, dropping other transient info.
        const session = this._sessions.getOrCreateSession(req.sessionID, undefined, userSelector);
        await session.operateOnScopedSession(req, async (user: SessionUserObjWithOAuth) => {
          user.oauth2 = { ...user.oauth2, [id]: { tokenSet } };
          return user;
        });
      } catch (e) {
        log.warn(`OAuth2 callback error: ${e.message}. Response`, e.response?.body);
        payload = { error: String(e.message) };
        // We are normally careful about only posting data back to the opener if that opener is on
        // an allowed origin (e.g. not evil.com). But in case of an error, we may not have the
        // origin, and the error message is presumably not so sensitive. So post it regardless.
        // (It so happens that we now avoid posting anything sensitive in all cases.)
        if (!openerOrigin) {
          openerOrigin = "*";
        }
      }

      // ENDPOINT.authorize redirects through the resource provider to here. The client opens it
      // in a new window, and here we should serve a page that sends back our redirect result and
      // closes itself. It needs an actual HTML page.
      return res.send(renderEndFlowHtmlTemplate(payload, openerOrigin));
    }));

    app.options(OAUTH2_ENDPOINTS.token, middleware, expressWrap((req, res) => {
      // For OPTIONS requests, the included trustOriginHandler middleware will actually respond.
      res.sendStatus(200);
    }));

    /**
     * Fetch access token if have one in the session, or 400 if integration is not configured, or
     * 401 if the token is missing or expired.
     */
    app.get(OAUTH2_ENDPOINTS.token, middleware, expressWrap(async (req, res) => {
      log.warn(`REQ ${req.method} ${req.url} ${req.params.integration}`);
      assertUserIsAuthorized(req);
      const { id, name } = this._getIntegration(req.params.integration);
      const session = this._sessions.getOrCreateSessionFromRequest(req);
      const sessionUser: SessionUserObjWithOAuth = await session.getScopedSession(req.session);
      const tokenSet = sessionUser.oauth2?.[id]?.tokenSet;
      if (!tokenSet) {
        throw new ApiError(`Not authorized with ${name}`, 401);
      }
      if (typeof tokenSet.expires_at === "number" && Date.now() / 1000 >= tokenSet.expires_at) {
        // TODO actually we could (should) attempt to get a new access_token using refresh token
        // if we have one.
        throw new ApiError(`${name} token expired`, 401);
      }
      res.json(pick(tokenSet, "access_token", "expires_at"));
    }), secureJsonErrorHandler);

    /**
     * Delete the token stored in the session, along with other session material for this integration.
     */
    app.delete(OAUTH2_ENDPOINTS.token, middleware, expressWrap(async (req, res) => {
      assertUserIsAuthorized(req);
      const id = req.params.integration;
      const session = this._sessions.getOrCreateSessionFromRequest(req);
      const sessionUser: SessionUserObjWithOAuth = await session.getScopedSession(req.session);
      if (sessionUser.oauth2?.[id] !== undefined) {
        await session.operateOnScopedSession(req, async (user: SessionUserObjWithOAuth) => {
          delete user.oauth2?.[id];
          return user;
        });
      }
      res.json(null);
    }));
  }

  private _getIntegration(id: string): ValidIntegration {
    const integration = INTEGRATIONS.get(id as IntegrationId);
    if (!integration) {
      throw new ApiError(`Unknown integration ${id}`, 404);
    }
    if (!integration.client) {
      throw new ApiError(`Integration not configured: ${id}`, 400);
    }
    return integration as ValidIntegration;
  }
}

function assertUserIsAuthorized(req: express.Request): asserts req is RequestWithLogin & { user: User } {
  getAuthorizedUserId(req);
}

function getRequiredSessionUsers(req: express.Request): SessionUserObjWithOAuth[] {
  const mreq = req as RequestWithLogin;
  if (!mreq.session) { throw new Error("no session available"); }

  return mreq.session.users ?? [];
}

// This is a template for a HTML page served at the end of authorization to the popup window. It
// post the payload back to the window opener, and closes the window. It's tiny enough that it's
// OK to include the HTML directly into code here.
const END_FLOW_HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<body>
<script>
  if (opener) {
    opener.postMessage({{PAYLOAD}}, {{OPENER_ORIGIN}});
    close();
  }
</script>
</body>
</html>
`;

// We avoid posting sensitive payloads because we don't have to, but in case we need to in the
// future, we validate that openerOrigin is an allowed origin. Otherwise, evil.com could open our
// /authorize endpoint and receive back the payload.
function renderEndFlowHtmlTemplate(payload: object, openerOrigin: string) {
  return END_FLOW_HTML_TEMPLATE
    .replace("{{PAYLOAD}}", JSON.stringify(payload))
    .replace("{{OPENER_ORIGIN}}", JSON.stringify(openerOrigin));
}
