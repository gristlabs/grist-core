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
    assert.equal(details.posture, "inactive");
    assert.equal(byId.get("request-function")?.status, "success");
    assert.equal(byId.get("request-function")?.state, "off");
    assert.equal(byId.get("webhooks")?.status, "success");
    assert.equal(byId.get("webhooks")?.state, "off");
    assert.deepEqual(byId.get("webhooks")?.allowedDomains, []);
    assert.equal(details.proxy.untrustedConfigured, false);
  });

  it("faults when REQUEST() is enabled without a proxy gate", async () => {
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
    const { result, details, byId } = await runProbe();
    assert.equal(result.status, "fault");
    assert.equal(details.posture, "unfiltered");
    const rf = byId.get("request-function");
    assert.equal(rf?.status, "fault");
    assert.equal(rf?.state, "on-unproxied");
  });

  it("succeeds when REQUEST() is enabled and a URL proxy is configured", async () => {
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
    process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "http://proxy.internal:3128";
    const { result, details, byId } = await runProbe();
    assert.equal(result.status, "success");
    assert.equal(details.posture, "filtered");
    assert.equal(byId.get("request-function")?.status, "success");
    assert.equal(byId.get("request-function")?.state, "on-proxied");
    assert.equal(details.proxy.untrustedConfigured, true);
    assert.equal(details.proxy.untrustedDirect, false);
  });

  it("warns when a webhook allowlist is set but no proxy is configured", async () => {
    process.env.ALLOWED_WEBHOOK_DOMAINS = "hooks.example.com";
    const { result, details, byId } = await runProbe();
    assert.equal(result.status, "warning");
    assert.equal(details.posture, "review");
    const wh = byId.get("webhooks");
    assert.equal(wh?.status, "warning");
    assert.equal(wh?.state, "on-unproxied");
    assert.deepEqual(wh?.allowedDomains, ["hooks.example.com"]);
    assert.equal(wh?.wildcardAllowed, false);
  });

  it("treats wildcard webhooks + proxy as a supported success state", async () => {
    process.env.ALLOWED_WEBHOOK_DOMAINS = "*";
    process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "http://proxy.internal:3128";
    const { result, details, byId } = await runProbe();
    assert.equal(result.status, "success");
    assert.equal(details.posture, "filtered");
    const wh = byId.get("webhooks");
    assert.equal(wh?.status, "success");
    assert.equal(wh?.state, "on-proxied");
    assert.equal(wh?.wildcardAllowed, true);
  });

  it("faults on wildcard webhooks with no proxy", async () => {
    process.env.ALLOWED_WEBHOOK_DOMAINS = "*";
    const { result, details, byId } = await runProbe();
    assert.equal(result.status, "fault");
    assert.equal(details.posture, "unfiltered");
    assert.equal(byId.get("webhooks")?.status, "fault");
    assert.equal(byId.get("webhooks")?.state, "on-unproxied");
  });

  it('surfaces GRIST_PROXY_FOR_UNTRUSTED_URLS="direct" as a "bypassed" posture, not "filtered"', async () => {
    process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "direct";
    process.env.GRIST_ENABLE_REQUEST_FUNCTION = "1";
    const { result, details, byId } = await runProbe();
    assert.equal(details.proxy.untrustedConfigured, true);
    assert.equal(details.proxy.untrustedDirect, true);
    // The feature is enabled and reaching out, but the operator opted out of
    // filtering. The per-feature state is "on-direct" (not "on-unproxied"),
    // and the roll-up posture is "bypassed" -- the admin panel renders this as
    // a warning, never as the green "filtered" banner.
    assert.equal(byId.get("request-function")?.state, "on-direct");
    assert.equal(details.posture, "bypassed");
    assert.match(result.verdict || "", /URL filtering is off/);
  });

  it('keeps a "bypassed" posture for wildcard webhooks under a direct bypass', async () => {
    process.env.ALLOWED_WEBHOOK_DOMAINS = "*";
    process.env.GRIST_PROXY_FOR_UNTRUSTED_URLS = "direct";
    const { details, byId } = await runProbe();
    const wh = byId.get("webhooks");
    assert.equal(wh?.state, "on-direct");
    assert.equal(wh?.wildcardAllowed, true);
    // Per-feature status stays "success" (the operator configured it), but the
    // overall posture is "bypassed" so the UI doesn't claim a proxy is in play.
    assert.equal(details.posture, "bypassed");
  });

  it("reports HTTPS_PROXY separately from the untrusted-URL proxy", async () => {
    process.env.HTTPS_PROXY = "http://corp-proxy:8080";
    const { details } = await runProbe();
    assert.equal(details.proxy.trustedConfigured, true);
    assert.equal(details.proxy.untrustedConfigured, false);
  });
});
