// Must come before the AdminChecks import: that module calls `t(...)` at
// module load, which requires an initialized global i18next instance.
import "test/client/_helpers/setupI18n";

import { AdminChecks } from "app/client/models/AdminChecks";
import { BootProbeInfo, BootProbeResult } from "app/common/BootProbe";
import { InstallAPI } from "app/common/InstallAPI";

import { assert } from "chai";
import { Disposable } from "grainjs";

class FakeInstallAPI implements Partial<InstallAPI> {
  public probes: BootProbeInfo[] = [
    { id: "sandbox-providers", name: "Sandbox providers" },
    { id: "authentication", name: "Authentication" },
  ];

  public runCheckCalls: string[] = [];
  public results = new Map<string, () => Promise<BootProbeResult>>();

  public async getChecks() {
    return { probes: this.probes };
  }

  public runCheck(id: string): Promise<BootProbeResult> {
    this.runCheckCalls.push(id);
    const factory = this.results.get(id);
    if (!factory) { return Promise.reject(new Error(`no fake set for ${id}`)); }
    return factory();
  }
}

class TestOwner extends Disposable {}

describe("AdminChecks", function() {
  let owner: TestOwner;

  beforeEach(() => {
    owner = TestOwner.create(null);
  });

  afterEach(() => {
    owner.dispose();
  });

  it("populates the result observable on success", async function() {
    const api = new FakeInstallAPI();
    api.results.set("sandbox-providers", async () => ({
      status: "success",
      details: { ok: true },
    }));

    const checks = new AdminChecks(owner, api as unknown as InstallAPI);
    // Populate probes directly to avoid `fetchAvailableChecks`, which reads
    // window.gristConfig (not present in this Node-only test environment).
    checks.probes.set(api.probes);

    const probe = checks.probes.get().find(p => p.id === "sandbox-providers")!;
    const req = checks.requestCheck(probe);
    assert.equal(req.result.get().status, "none");

    await new Promise(r => setTimeout(r, 0));

    assert.equal(req.result.get().status, "success");
    assert.deepEqual(req.result.get().details, { ok: true });
  });

  it("sets fault status when runCheck rejects", async function() {
    const api = new FakeInstallAPI();
    api.results.set("sandbox-providers", async () => {
      throw new Error("network kaboom");
    });

    const checks = new AdminChecks(owner, api as unknown as InstallAPI);
    checks.probes.set(api.probes);

    const probe = checks.probes.get().find(p => p.id === "sandbox-providers")!;
    const req = checks.requestCheck(probe);

    await new Promise(r => setTimeout(r, 0));

    const result = req.result.get();
    assert.equal(result.status, "fault");
    assert.match(String(result.details?.error), /network kaboom/);
  });

  it("dedupes concurrent requests for the same probe", async function() {
    const api = new FakeInstallAPI();
    api.results.set("sandbox-providers", async () => ({
      status: "success",
      details: {},
    }));

    const checks = new AdminChecks(owner, api as unknown as InstallAPI);
    checks.probes.set(api.probes);
    const probe = checks.probes.get().find(p => p.id === "sandbox-providers")!;

    const r1 = checks.requestCheck(probe);
    const r2 = checks.requestCheck(probe);

    // Same observable instance — that's the memoization the prefetch relies on.
    assert.strictEqual(r1.result, r2.result);

    // Only one network call, even though requestCheck was invoked twice.
    await new Promise(r => setTimeout(r, 0));
    assert.equal(api.runCheckCalls.length, 1);
  });
});
