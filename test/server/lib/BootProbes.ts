import {
  OutgoingRequestsProbeDetails,
  PersistDataBootProbeDetails,
  StorageClassification,
} from "app/common/BootProbe";
import { _dataPersistsProbe, _outgoingRequestsProbe, _persistDataVerdict } from "app/server/lib/BootProbes";
import { OUTGOING_REQUEST_ENV_VARS } from "app/server/lib/outgoingRequests";
import { configForUser } from "test/gen-server/testUtils";
import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { TestServer } from "test/server/lib/helpers/TestServer";
import { createTestDir, EnvironmentSnapshot, setTmpLogLevel } from "test/server/testUtils";

import * as path from "path";

import axios from "axios";
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

describe("BootProbes with external storage", function() {
  this.timeout(30000);
  setTmpLogLevel("error");

  let env: EnvironmentSnapshot;
  let server: TestServer;
  const chimpy = configForUser("Chimpy");

  before(async function() {
    env = new EnvironmentSnapshot();
    const testDir = await createTestDir("BootProbesExternalStorage");
    await prepareDatabase(testDir, env);
    // A separate process, so storage settings don't leak into other tests via appSettings.
    server = await TestServer.startServer("home,docs", testDir, "probes", {
      GRIST_DEFAULT_EMAIL: "chimpy@getgrist.com",
      GRIST_DISABLE_S3: "",  // The helper disables external storage by default.
      // In case MinIO or S3 is configured in the environment.
      GRIST_DOCS_MINIO_BUCKET: "",
      TEST_MINIO_BUCKET: "",
      GRIST_DOCS_S3_BUCKET: "",
      TEST_S3_BUCKET: "",
      GRIST_FS_STORAGE_DIR: path.join(testDir, "storage"),
    });
  });

  after(async function() {
    await TestServer.stopAll([server]);
    env.restore();
  });

  it("reports backups as enabled when a storage backend is active", async function() {
    const resp = await axios.get(`${server.serverUrl}/api/probes/backups`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.status, "success");
    assert.equal(resp.data.details.backend, "filesystem");
  });

  it("treats documents as durable when a storage backend is active", async function() {
    const resp = await axios.get(`${server.serverUrl}/api/probes/persist-data`, chimpy);
    assert.equal(resp.status, 200);
    assert.equal(resp.data.details.docs.durability, "durable");
  });
});

const UNKNOWN: StorageClassification = { durability: "unknown" };
const DURABLE: StorageClassification = { durability: "durable" };
const ON_TMPFS: StorageClassification = {
  durability: "ephemeral",
  reason: { kind: "ram-filesystem", fsType: "tmpfs", mountPoint: "/persist" },
};
const ON_IMAGE_ROOT: StorageClassification = {
  durability: "ephemeral",
  reason: { kind: "image-root-heuristic", fsType: "overlay", mountPoint: "/" },
};

function details(over: Partial<PersistDataBootProbeDetails> = {}): PersistDataBootProbeDetails {
  return {
    dataDir: "/persist/docs",
    homeDb: "/persist/home.sqlite3",
    externalStorageActive: false,
    usesPostgres: false,
    docs: UNKNOWN,
    home: UNKNOWN,
    ...over,
  };
}

describe("BootProbes persist-data", () => {
  let env: EnvironmentSnapshot;

  beforeEach(() => {
    env = new EnvironmentSnapshot();
    ["GRIST_DATA_DIR", "TYPEORM_DATABASE", "TYPEORM_TYPE"].forEach((v) => { delete process.env[v]; });
  });

  afterEach(() => {
    env.restore();
  });

  describe("verdict", () => {
    it("is absent when neither store is ephemeral", () => {
      assert.isUndefined(_persistDataVerdict(details()));
      assert.isUndefined(_persistDataVerdict(details({ docs: DURABLE, home: DURABLE })));
    });

    it("names the env var, path and filesystem for a RAM filesystem", () => {
      assert.equal(_persistDataVerdict(details({ docs: ON_TMPFS })),
        "GRIST_DATA_DIR (/persist/docs) appears to be on a temporary filesystem (tmpfs); " +
        "anything stored there is likely to be lost when Grist restarts.");
      assert.equal(_persistDataVerdict(details({ home: ON_TMPFS })),
        "TYPEORM_DATABASE (/persist/home.sqlite3) appears to be on a temporary filesystem " +
        "(tmpfs); anything stored there is likely to be lost when Grist restarts.");
    });

    it("gives the volume advice only for the official-image heuristic", () => {
      assert.equal(_persistDataVerdict(details({ docs: ON_IMAGE_ROOT })),
        "Grist appears to be running in the official Docker image without a persistent volume " +
        "mounted at /persist; data is likely to be lost when the container is recreated.");
    });

    it("states the official-image advice once even when both stores hit it", () => {
      const verdict = _persistDataVerdict(details({ docs: ON_IMAGE_ROOT, home: ON_IMAGE_ROOT }));
      assert.equal(verdict?.match(/mounted at \/persist/g)?.length, 1);
    });

    it("joins one sentence per store when the reasons differ", () => {
      const verdict = _persistDataVerdict(details({ docs: ON_TMPFS, home: ON_IMAGE_ROOT })) || "";
      assert.match(verdict, /^GRIST_DATA_DIR \(\/persist\/docs\) appears to be on a temporary/);
      assert.include(verdict, " Grist appears to be running in the official Docker image");
    });

    it("hedges rather than asserting data loss", () => {
      for (const verdict of [
        _persistDataVerdict(details({ docs: ON_TMPFS })),
        _persistDataVerdict(details({ home: ON_IMAGE_ROOT })),
      ]) {
        assert.include(verdict || "", "appears to");
        assert.include(verdict || "", "likely to be lost");
        assert.notInclude(verdict || "", "will be lost");
      }
    });

    it("still produces a verdict if an ephemeral store carries no reason", () => {
      // A fault without a verdict reads to the client as a failed probe request.
      const verdict = _persistDataVerdict(details({ docs: { durability: "ephemeral" } }));
      assert.match(verdict || "", /^GRIST_DATA_DIR \(\/persist\/docs\) appears to be on storage/);
    });
  });

  describe("probe", () => {
    async function runPersistProbe() {
      const result = await _dataPersistsProbe.apply(undefined as any, undefined as any);
      return { result, details: result.details as PersistDataBootProbeDetails };
    }

    it("stays neutral, with null paths, when neither store is configured", async () => {
      const { result, details: d } = await runPersistProbe();
      assert.equal(result.status, "none");
      assert.isUndefined(result.verdict);
      assert.isNull(d.dataDir);
      assert.isNull(d.homeDb);
      assert.deepEqual(d.docs, UNKNOWN);
      assert.deepEqual(d.home, UNKNOWN);
    });

    it("treats a Postgres home database as durable without inspecting mounts", async () => {
      process.env.TYPEORM_TYPE = "postgres";
      process.env.TYPEORM_DATABASE = "grist";
      const { result, details: d } = await runPersistProbe();
      assert.equal(result.status, "none");
      assert.isTrue(d.usesPostgres);
      assert.deepEqual(d.home, DURABLE);
      assert.equal(d.homeDb, "grist");
    });
  });
});
