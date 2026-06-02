import { serveSomething, Serving } from "test/server/customUtil";

import * as express from "express";
import { assert } from "mocha-webdriver";

export interface MockOIDCIssuerOptions {
  // Fail any request not handled by an explicit route. Use when the test
  // only expects discovery to be hit.
  failUnexpectedRequests?: boolean;
  // Advertise an /authorize endpoint and respond 200 there. Use when the
  // test follows a redirect from /login through to the issuer.
  authorize?: boolean;
  // Capture every request before route handlers run.
  onRequest?: (req: express.Request) => void;
}

/**
 * Fake OIDC issuer for nbrowser tests. Pass `serving.url` as
 * GRIST_OIDC_IDP_ISSUER. Caller owns the lifecycle: call `shutdown()`
 * in your `after()` hook.
 */
export async function startMockOIDCIssuer(
  options: MockOIDCIssuerOptions = {},
): Promise<Serving> {
  const serving: Serving = await serveSomething((app) => {
    if (options.onRequest) {
      const onRequest = options.onRequest;
      app.use((req, _res, next) => { onRequest(req); next(); });
    }
    app.use(express.json());
    app.get("/.well-known/openid-configuration", (_req, res) => {
      const config: Record<string, unknown> = {
        issuer: serving.url + "?provider=getgrist.com",
      };
      if (options.authorize) {
        config.authorization_endpoint = serving.url + "/authorize";
        // Extra endpoints openid-client requires when it walks discovery
        // for real (e.g. QuickSetupAuth's RestartShell case). Routes don't
        // need to actually exist; nothing in our tests reaches them.
        config.token_endpoint = serving.url + "/token";
        config.jwks_uri = serving.url + "/jwks";
        config.response_types_supported = ["code"];
        config.subject_types_supported = ["public"];
        config.id_token_signing_alg_values_supported = ["RS256"];
      }
      res.json(config);
    });
    if (options.authorize) {
      app.get("/authorize", (_req, res) => {
        res.status(200).type("html").send(
          "<!doctype html><html><body>oidc-mock-authorize</body></html>",
        );
      });
    }
    if (options.failUnexpectedRequests) {
      app.use((req) => {
        assert.fail(`Unexpected request to test OIDC server: ${req.method} ${req.url}`);
      });
    }
  });
  return serving;
}
