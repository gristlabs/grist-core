/**
 * MOCKUP STATE — POC support for the marketing-demo mockup controls panel.
 *
 * Singleton observables that override section data when set. Sections call
 * the helper functions below to consult the override before falling back
 * to real data. Mockup buttons (in QuickSetup._buildMockupControls) write
 * to these observables.
 *
 * Search this file for "MOCKUP" to find every override hook in the codebase.
 * To remove the demo controls cleanly, delete this file plus every section
 * call to its helpers (each tagged with "MOCKUP:").
 */
import { BackupsBootProbeDetails } from "app/common/BootProbe";
import { AuthProvider } from "app/common/ConfigAPI";
import { SandboxingStatus } from "app/common/SandboxInfo";

import { Observable } from "grainjs";

class MockupStateImpl {
  // null = use real data; non-null = override.
  public sandboxStatus = Observable.create<SandboxingStatus | null>(null, null);
  public authProviders = Observable.create<AuthProvider[] | null>(null, null);
  public loginSystemId = Observable.create<string | null>(null, null);
  public backups = Observable.create<BackupsBootProbeDetails | null>(null, null);
  public fullGristAvailable = Observable.create<boolean | null>(null, null);
  public singleOrg = Observable.create<string | null>(null, null);
}

// Module-scope singleton. Shared by section overrides and the mockup panel.
export const mockupState = new MockupStateImpl();

/** Reset every mockup override to null (use real data). */
export function resetMockupState(): void {
  mockupState.sandboxStatus.set(null);
  mockupState.authProviders.set(null);
  mockupState.loginSystemId.set(null);
  mockupState.backups.set(null);
  mockupState.fullGristAvailable.set(null);
  mockupState.singleOrg.set(null);
}
