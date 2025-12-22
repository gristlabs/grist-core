import fetch from "node-fetch";
import { TestServer } from "test/gen-server/apiUtils";
import { assert } from "chai";
import * as cookie from "cookie";
import * as fse from "fs-extra";
import { cookieName } from "app/server/lib/gristSessions";
import * as testUtils from "test/server/testUtils";
import * as path from "path";
import zlib from "zlib";

describe("SamlConfig", () => {
  testUtils.setTmpLogLevel("error");

  const spKey = path.resolve(testUtils.fixturesRoot, "saml/saml.key");
  const spCert = path.resolve(testUtils.fixturesRoot, "saml/saml.crt");
  const idpCert = path.resolve(testUtils.fixturesRoot, "saml/keycloak.pem");
  const spHost = "https://grist.localhost";
  // A keycloak-styled URL
  const idpHost = "http://localhost:8080/realms/grist/protocol/saml/clients/grist";

  // Static SAML assertion fixtures, valid until February 17, 2075.
  // May Grist reign's be long.
  const loginSamlPath = path.resolve(testUtils.fixturesRoot, "saml/saml-login");
  const logoutSamlPath = path.resolve(testUtils.fixturesRoot, "saml/saml-logout");

  const setupTestServer = (enabled: boolean) => {
    let homeUrl: string;
    let oldEnv: testUtils.EnvironmentSnapshot;
    let server: TestServer;

    const env = enabled ? {
      GRIST_SAML_SP_HOST: spHost,
      GRIST_SAML_IDP_UNENCRYPTED: "1",
      GRIST_SAML_IDP_LOGIN: idpHost,
      GRIST_SAML_IDP_LOGOUT: idpHost,
      GRIST_SAML_IDP_CERTS: idpCert,
      GRIST_SAML_SP_KEY: spKey,
      GRIST_SAML_SP_CERT: spCert,
    } : {};

    beforeEach(async function() {
      oldEnv = new testUtils.EnvironmentSnapshot();
      process.env.TYPEORM_DATABASE = ':memory:';
      process.env.GRIST_TEST_SERVER_DEPLOYMENT_TYPE = 'core';
      Object.assign(process.env, env);
      server = new TestServer(this);
      homeUrl = await server.start();
    });

    afterEach(async () => {
      oldEnv.restore();
      await server.stop();
    });

    return {
      homeUrl: () => homeUrl,
      sessionUrl: () => `${homeUrl}/test/session`,
      getDbManager: () => server.dbManager,
    };
  };

  describe("when disabled", () => {
    const { homeUrl } = setupTestServer(false);
    it("should not have the metadata url", async () => {
      const url = `${homeUrl()}/saml/metadata.xml`;
      const res = await fetch(url);
      assert.equal(res.status, 404);
    });
  });

  describe("when enabled", () => {
    const { homeUrl, sessionUrl, getDbManager } = setupTestServer(true);

    it("should return the server identity", async () => {
      const url = `${homeUrl()}/saml/metadata.xml`;
      const res = await fetch(url);
      const xml = await res.text();
      assert.match(xml, /entityID="https:\/\/grist.localhost\/saml\/metadata.xml"/);
    });

    it("should allow logins and logouts via redirect", async () => {
      // Ensure a clean start
      let jordi = await getDbManager().getExistingUserByLogin("jordi@getgrist.com");
      assert.equal(jordi, undefined, "jordi should not exist");

      // Get a session started
      const sessionResp = await fetch(sessionUrl());
      const sid = cookie.parse(sessionResp.headers.get("set-cookie"))[cookieName];
      const headers = { Cookie: `${cookieName}=${sid}` };

      // Let's get redirected to the SAML IdP
      const loginResp = await fetch(`${homeUrl()}/saml/login`, {
        redirect: "manual",
        headers,
      });
      assert.equal(loginResp.status, 302, "should redirect");

      const idpUrl = new URL(loginResp.headers.get("location") || "");
      assert.equal(idpUrl.origin + idpUrl.pathname, idpHost, "should redirect to IdP host");
      const relayState = idpUrl.searchParams.get("RelayState") || "";
      assert.match(relayState, /permit-external-[0-9a-f-]+/, "should have a relay state");
      const samlRequest = decodeSaml(idpUrl.searchParams.get("SAMLRequest") || "");
      assert.match(samlRequest, new RegExp(`AssertionConsumerServiceURL="${spHost}/saml/assert"`),
        "SAML request should redirect back to Grist");

      // Now we pretend that the IdP server authenticated the user and
      // sent back a SAML login, which we post back to the SAML
      // processing endpoint.
      const loginSamlPayload = await fse.readFile(loginSamlPath);
      const samlResp = await fetch(`${homeUrl()}/saml/assert`, {
        redirect: "manual",
        method: "POST",
        body: new URLSearchParams({
          SAMLResponse: loginSamlPayload.toString(),
          RelayState: relayState,
        }),
      });
      assert.equal(samlResp.status, 302, "should redirect");
      const spUrl = new URL(samlResp.headers.get("location") || "");
      assert.equal(spUrl.origin + spUrl.pathname, homeUrl() + "/", "should redirect to main");

      // Finish following the redirect
      await fetch(spUrl.href, { headers });

      // Let's check the user was created via SAML
      jordi = await getDbManager().getExistingUserByLogin("jordi@getgrist.com");
      assert.ok(jordi, "jordi should exist");
      assert.ok(jordi?.firstLoginAt instanceof Date, "jordi should have logged in");

      // Finally, we log out
      const logoutResp = await fetch(`${homeUrl()}/o/docs/logout`, {
        redirect: "manual",
        headers,
      });
      const idpLogoutUrl = new URL(logoutResp.headers.get("location") || "");
      assert.equal(idpLogoutUrl.origin + idpLogoutUrl.pathname, idpHost, "should redirect to IdP host");
      const samlLogoutRequest = decodeSaml(idpLogoutUrl.searchParams.get("SAMLRequest") || "");
      assert.match(samlLogoutRequest, /samlp:LogoutRequest/,
        "SAML logout request should have the right root element");

      const logoutRelayState = idpLogoutUrl.searchParams.get("RelayState") || "";
      assert.match(logoutRelayState, /permit-external-[0-9a-f-]+/, "should have a relay state");

      // Pretend that the IdP server sent back a logout response
      const logoutSamlPayload = await fse.readFile(logoutSamlPath);
      const samlLogoutResp = await fetch(`${homeUrl()}/saml/assert`, {
        redirect: "manual",
        method: "POST",
        body: new URLSearchParams({
          SAMLResponse: logoutSamlPayload.toString(),
          RelayState: logoutRelayState,
        }),
      });
      assert.equal(samlLogoutResp.status, 302, "should redirect");
      const spLogoutUrl = new URL(samlLogoutResp.headers.get("location") || "");
      assert.equal(
        spLogoutUrl.origin + spLogoutUrl.pathname,
        homeUrl() + "/o/docs/signed-out",
        "should redirect to main",
      );

      // Finish the logout redirect
      await fetch(`${homeUrl()}/o/docs/signed-out`, { headers });
    });

    it("should allow IdP-initiated logins", async () => {
      // Ensure a clean start
      let jordi = await getDbManager().getExistingUserByLogin("jordi@getgrist.com");
      assert.equal(jordi, undefined, "jordi should not exist");

      // Grist, our SP, is sitting there quietly, minding its own
      // business, when suddenly AN UNSOLICITED SAML LOGIN APPEARS.
      const loginSamlPayload = await fse.readFile(loginSamlPath);
      const samlResp = await fetch(`${homeUrl()}/saml/assert`, {
        redirect: "manual",
        method: "POST",
        body: new URLSearchParams({
          SAMLResponse: loginSamlPayload.toString(),
          // No RelayState, the SAML comes unrequested, nothing to relay
        }),
      });
      const sid = cookie.parse(samlResp.headers.get("set-cookie")).SameSite.split("=")[1];
      const headers = { Cookie: `${cookieName}=${sid}` };

      assert.equal(samlResp.status, 302, "should redirect");
      const spUrl = new URL(samlResp.headers.get("location") || "");
      assert.equal(spUrl.origin + spUrl.pathname, homeUrl() + "/", "should redirect to main");

      // Finish following the redirect
      await fetch(spUrl.href, { headers });

      // Let's check the user was created via SAML
      jordi = await getDbManager().getExistingUserByLogin("jordi@getgrist.com");
      assert.ok(jordi, "jordi should exist");
      assert.ok(jordi?.firstLoginAt instanceof Date, "jordi should have logged in");
    });

    it("should follow redirects from IdP-initiated logins", async () => {
      // Grist, our unsuspecting SP, once again sits quietly when
      // suddenly A SAML REQUEST WITH VALID REDIRECT COMES OUTTA
      // NOWHERE
      const loginSamlPayload = await fse.readFile(loginSamlPath);
      const samlResp = await fetch(`${homeUrl()}/saml/assert`, {
        redirect: "manual",
        method: "POST",
        body: new URLSearchParams({
          SAMLResponse: loginSamlPayload.toString(),
          RelayState: `${homeUrl()}/admin`,
        }),
      });
      assert.equal(samlResp.status, 302, "should redirect");
      const spUrl = new URL(samlResp.headers.get("location") || "");
      assert.equal(spUrl.origin + spUrl.pathname, `${homeUrl()}/admin`, "should redirect to admin");
    });

    it("should ignore invalid redirects from IdP-initiated logins", async () => {
      // This time, Grist, our innocent SP as before, is not caught
      // unaware when a SAML assert arrives, but without a valid
      // redirection URL.
      const loginSamlPayload = await fse.readFile(loginSamlPath);
      const samlResp = await fetch(`${homeUrl()}/saml/assert`, {
        redirect: "manual",
        method: "POST",
        body: new URLSearchParams({
          SAMLResponse: loginSamlPayload.toString(),
          RelayState: `https://evilcorp.com`,
        }),
      });
      assert.equal(samlResp.status, 302, "should redirect");
      const spUrl = new URL(samlResp.headers.get("location") || "");
      assert.equal(spUrl.origin + spUrl.pathname, homeUrl() + "/", "should redirect to main");
    });
  });
});

function decodeSaml(encodedSAML: string) {
  const buffer = Buffer.from(encodedSAML, "base64");
  return zlib.inflateRawSync(buffer).toString();
}
