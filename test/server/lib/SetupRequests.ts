/**
 * Tests for the setup-requests endpoints and the careful upsert behind them
 * (`transformInstallConfig`): authorization for the user and admin halves, censoring of summaries,
 * upsert semantics for repeat requests, and concurrent requests not losing data.
 */
import { SetupRequester, SetupRequests } from "app/common/Config";
import { addSetupRequest, MAX_SETUP_REASON_LENGTH } from "app/common/SetupRequests";
import { parseSetupRequestSpec } from "app/server/lib/SetupRequestsEndpoints";
import { TestServer } from "test/gen-server/apiUtils";
import { configForUser } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";

const chimpy = configForUser("Chimpy");
const kiwi = configForUser("Kiwi");
const charon = configForUser("Charon");
const anon = configForUser("Anonymous");

describe("SetupRequests", function() {
  testUtils.setTmpLogLevel("error");

  let oldEnv: testUtils.EnvironmentSnapshot;
  let server: TestServer;
  let homeUrl: string;

  before(async function() {
    this.timeout(60000);
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.TYPEORM_DATABASE = ":memory:";
    // Make Chimpy the install admin.
    process.env.GRIST_DEFAULT_EMAIL = "chimpy@getgrist.com";
    server = new TestServer(this);
    homeUrl = await server.start();
  });

  after(async function() {
    await server.stop();
    oldEnv.restore();
  });

  it("rejects anonymous and malformed requests", async function() {
    let resp = await axios.post(`${homeUrl}/api/setup-requests`,
      { step: "email", features: ["notifications"] }, anon);
    assert.equal(resp.status, 401);
    resp = await axios.get(`${homeUrl}/api/setup-requests`, anon);
    assert.equal(resp.status, 401);
    resp = await axios.post(`${homeUrl}/api/setup-requests`,
      { step: "world-peace", features: [] }, kiwi);
    assert.equal(resp.status, 400);
    resp = await axios.post(`${homeUrl}/api/setup-requests`,
      { step: "email", features: ["world-peace"] }, kiwi);
    assert.equal(resp.status, 400);
    resp = await axios.post(`${homeUrl}/api/setup-requests`,
      { step: "email", features: [], reason: 42 }, kiwi);
    assert.equal(resp.status, 400);
  });

  it("records requests and returns censored summaries", async function() {
    let resp = await axios.post(`${homeUrl}/api/setup-requests`,
      { step: "full-grist", features: ["notifications"] }, kiwi);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      { steps: { "full-grist": { count: 1, requestedByMe: true } } });

    // Another user sees the count but not who is behind it, and is not "me".
    resp = await axios.get(`${homeUrl}/api/setup-requests`, charon);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      { steps: { "full-grist": { count: 1, requestedByMe: false } } });

    resp = await axios.post(`${homeUrl}/api/setup-requests`,
      { step: "full-grist", features: ["automations"], reason: "we need this" }, charon);
    assert.deepEqual(resp.data,
      { steps: { "full-grist": { count: 2, requestedByMe: true } } });
  });

  it("upserts repeat requests rather than double-counting", async function() {
    // Kiwi asks again for the same step, now for another feature and with a note.
    const resp = await axios.post(`${homeUrl}/api/setup-requests`,
      { step: "full-grist", features: ["assistant"], reason: "pretty please" }, kiwi);
    assert.equal(resp.status, 200);
    assert.deepEqual(resp.data,
      { steps: { "full-grist": { count: 2, requestedByMe: true } } });

    // The stored entry unioned the features and took the new reason.
    const all = await axios.get(`${homeUrl}/api/admin/setup-requests`, chimpy);
    assert.equal(all.status, 200);
    const requesters: SetupRequester[] = Object.values(all.data.steps["full-grist"].requesters);
    assert.lengthOf(requesters, 2);
    const kiwiEntry = requesters.find(r => r.email === "kiwi@getgrist.com");
    assert.deepEqual(kiwiEntry?.features.sort(), ["assistant", "notifications"]);
    assert.equal(kiwiEntry?.reason, "pretty please");
  });

  it("limits the admin half to install admins", async function() {
    let resp = await axios.get(`${homeUrl}/api/admin/setup-requests`, kiwi);
    assert.isAbove(resp.status, 399);
    resp = await axios.delete(`${homeUrl}/api/admin/setup-requests/full-grist`, kiwi);
    assert.isAbove(resp.status, 399);
    // Still there.
    resp = await axios.get(`${homeUrl}/api/setup-requests`, kiwi);
    assert.equal(resp.data.steps["full-grist"].count, 2);
  });

  it("lets install admins clear a step", async function() {
    let resp = await axios.delete(`${homeUrl}/api/admin/setup-requests/not-a-step`, chimpy);
    assert.equal(resp.status, 400);
    resp = await axios.delete(`${homeUrl}/api/admin/setup-requests/full-grist`, chimpy);
    assert.equal(resp.status, 200);
    // The DELETE returns the updated detail, so the client need not refetch...
    assert.deepEqual(resp.data, { steps: {} });
    // ...but a refetch agrees.
    resp = await axios.get(`${homeUrl}/api/admin/setup-requests`, chimpy);
    assert.deepEqual(resp.data, { steps: {} });
    resp = await axios.get(`${homeUrl}/api/setup-requests`, kiwi);
    assert.deepEqual(resp.data, { steps: {} });
  });

  it("does not lose concurrent requests", async function() {
    // Hammer transformInstallConfig directly with concurrent single-requester merges; with
    // a naive read-modify-write most of these would overwrite each other.
    const userCount = 20;
    await Promise.all(Array.from({ length: userCount }, (_, i) =>
      server.dbManager.transformInstallConfig("setup_requests", { steps: {} }, value =>
        addSetupRequest(value as SetupRequests, 1000 + i,
          { step: "redis", features: ["notifications"] },
          { email: `user${i}@example.com`, at: new Date().toISOString() }))));
    const resp = await axios.get(`${homeUrl}/api/admin/setup-requests`, chimpy);
    assert.lengthOf(Object.keys(resp.data.steps.redis.requesters), userCount);
  });
});

describe("SetupRequests parseSetupRequestSpec", function() {
  it("accepts a valid request, deduplicating and trimming", function() {
    assert.deepEqual(
      parseSetupRequestSpec({
        step: "email",
        features: ["notifications", "invites", "notifications"],
        reason: "  please  ",
      }),
      { step: "email", features: ["notifications", "invites"], reason: "please" });
    // Empty (or all-whitespace) reasons are dropped.
    assert.deepEqual(
      parseSetupRequestSpec({ step: "redis", features: [], reason: "  " }),
      { step: "redis", features: [] });
  });

  it("truncates over-long reasons", function() {
    const spec = parseSetupRequestSpec({
      step: "ai", features: [], reason: "x".repeat(MAX_SETUP_REASON_LENGTH + 50),
    });
    assert.equal(spec.reason?.length, MAX_SETUP_REASON_LENGTH);
  });

  it("rejects bad steps, features, and reasons", function() {
    assert.throws(() => parseSetupRequestSpec({ step: "nope", features: [] }), /step/);
    assert.throws(() => parseSetupRequestSpec({ step: "email" }), /features/);
    assert.throws(() => parseSetupRequestSpec({ step: "email", features: ["nope"] }),
      /features/);
    assert.throws(() => parseSetupRequestSpec({ step: "email", features: [], reason: 5 }),
      /reason/);
    assert.throws(() => parseSetupRequestSpec(null), /step/);
  });
});
