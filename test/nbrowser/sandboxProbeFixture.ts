import { BootProbeResult } from "app/common/BootProbe";

// Canned probe result for tests that load the AdminPanel but don't care
// about the sandbox section. Stops the real /probes/sandbox-providers
// handler from spawning a gvisor probe, which takes ~5s to fail on
// machines without runsc and can time out waitForServer.
export const FAST_NO_SANDBOX_PROBE: BootProbeResult = {
  status: "success",
  details: {
    options: [{
      flavor: "unsandboxed",
      available: true,
      effective: true,
      functional: true,
      configured: false,
      lastSuccessfulStep: "none",
    }],
    current: "unsandboxed",
  },
};

// Set the probe-result env var. Caller should snapshot/restore env around
// this so the value doesn't leak between suites.
export function useFastSandboxProbe(fixture: BootProbeResult = FAST_NO_SANDBOX_PROBE) {
  process.env.GRIST_TEST_SANDBOX_PROVIDERS_PROBE_RESULT = JSON.stringify(fixture);
}
