import { OutgoingRequestsProbeDetails } from "app/common/BootProbe";
import { _outgoingRequestsProbe } from "app/server/lib/BootProbes";
import { OUTGOING_REQUEST_ENV_VARS } from "app/server/lib/outgoingRequests";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { assert } from "chai";

async function runProbe() {
  const result = await _outgoingRequestsProbe.apply(undefined as any, undefined as any);
  const details = result.details as OutgoingRequestsProbeDetails;
  const byId = new Map(details.checks.map(c => [c.id, c]));
  return { result, details, byId };
}

describe("BootProbes outgoing-requests", () => {
  let env: EnvironmentSnapshot;

  beforeEach(() => {
    env = new EnvironmentSnapshot();
    OUTGOING_REQUEST_ENV_VARS.forEach((v) => { delete process.env[v]; });
  });

  afterEach(() => {
    env.restore();
  });

  it("reports success with nothing enabled and no proxy set", async () => {
    const { result, details, byId } = await runProbe();
    assert.equal(result.status, "success");
    assert.equal(byId.get("request-function")?.status, "success");
    assert.equal(byId.get("request-function")?.state, "off");
    assert.equal(byId.get("webhooks")?.status, "success");
    assert.equal(byId.get("webhooks")?.state, "off");
    assert.deepEqual(byId.get("webhooks")?.allowedDomains, []);
    assert.equal(details.proxy.untrustedConfigured, false);
  });

  it("faults when REQUEST() is enabled without a proxy gate", async () => {
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
    const { result, byId } = await runProbe();
    assert.equal(result.status, "fault");
    const rf = byId.get("request-function");
    assert.equal(rf?.status, "fault");
    assert.equal(rf?.state, "on-unproxied");
  });

  it("succeeds when REQUEST() is enabled and a URL proxy is configured", async () => {
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
    process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "http://proxy.internal:3128";
    const { result, details, byId } = await runProbe();
    assert.equal(result.status, "success");
    assert.equal(byId.get("request-function")?.status, "success");
    assert.equal(byId.get("request-function")?.state, "on-proxied");
    assert.equal(details.proxy.untrustedConfigured, true);
    assert.equal(details.proxy.untrustedDirect, false);
  });

  it("warns when a webhook allowlist is set but no proxy is configured", async () => {
    process.env.ALLOWED_WEBHOOK_DOMAINS = "hooks.example.com";
    const { result, byId } = await runProbe();
    assert.equal(result.status, "warning");
    const wh = byId.get("webhooks");
    assert.equal(wh?.status, "warning");
    assert.equal(wh?.state, "on-unproxied");
    assert.deepEqual(wh?.allowedDomains, ["hooks.example.com"]);
    assert.equal(wh?.wildcardAllowed, false);
  });

  it("treats wildcard webhooks + proxy as a supported success state", async () => {
    process.env.ALLOWED_WEBHOOK_DOMAINS = "*";
    process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "http://proxy.internal:3128";
    const { result, byId } = await runProbe();
    assert.equal(result.status, "success");
    const wh = byId.get("webhooks");
    assert.equal(wh?.status, "success");
    assert.equal(wh?.state, "on-proxied");
    assert.equal(wh?.wildcardAllowed, true);
  });

  it("faults on wildcard webhooks with no proxy", async () => {
    process.env.ALLOWED_WEBHOOK_DOMAINS = "*";
    const { result, byId } = await runProbe();
    assert.equal(result.status, "fault");
    assert.equal(byId.get("webhooks")?.status, "fault");
    assert.equal(byId.get("webhooks")?.state, "on-unproxied");
  });

  it('recognizes GRIST_PROXY_FOR_UNTRUSTED_URLS="direct" as configured but unfiltered', async () => {
    process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "direct";
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
    const { details, byId } = await runProbe();
    assert.equal(details.proxy.untrustedConfigured, true);
    assert.equal(details.proxy.untrustedDirect, true);
    // A direct bypass still registers as configured: the feature state is
    // "on-direct" (not "on-unproxied"), and the probe treats it as success.
    assert.equal(byId.get("request-function")?.state, "on-direct");
    assert.equal(byId.get("request-function")?.status, "success");
  });

  it("reports HTTPS_PROXY separately from the untrusted-URL proxy", async () => {
    process.env.HTTPS_PROXY = "http://corp-proxy:8080";
    const { details } = await runProbe();
    assert.equal(details.proxy.trustedConfigured, true);
    assert.equal(details.proxy.untrustedConfigured, false);
  });
});
