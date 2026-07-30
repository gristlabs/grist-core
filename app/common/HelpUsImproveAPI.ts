import { GristDeploymentType } from "app/common/gristUrls";

// Whether the enterprise code is bundled in this build.
export type GristBuild = "full" | "community";
export type HelpUsImproveDeploymentType = "saas" | "core" | "enterprise" | "electron" | "static";

// This is a small check that guarantees GristDeploymentType is identical to HelpUsImproveDeploymentType.
// We can't use GristDeploymentType directly, as it doesn't have a type checker from ts-interface-builder.
// TODO: Move GristDeploymentType to another file so it can have a generated type checker.
declare const gristDeploymentType: GristDeploymentType;
declare const helpUsImproveDeploymentType: HelpUsImproveDeploymentType;
void (gristDeploymentType satisfies HelpUsImproveDeploymentType); // Grist ⊆ HelpUsImprove
void (helpUsImproveDeploymentType satisfies GristDeploymentType);

/**
 * Body of POST /api/help-us-improve. Submitted by the "Help us improve Grist" survey
 * on the QuickSetup wizard. The endpoint is hosted by Gristlabs.
 */
export interface HelpUsImproveSubmission {
  installationId: string;
  // oidcClientId of a server using "Sign in with Grist". Empty string if Sign in with Grist is not in use.
  loginWithGristClientId: string;
  referralSource: string;
  role: string;
  subscribeToUpdates: boolean;
  email: string;
  deploymentType?: HelpUsImproveDeploymentType;
  build: GristBuild;
}

/**
 * Response from POST /api/help-us-improve. The endpoint attempts persist and
 * subscribe independently; each may fail without failing the other. Status is
 * 200 iff both `*Failed` flags are false, else 500.
 *
 * `persistUnrecoverable` distinguishes 4xx client-error failures (retry won't
 * help — payload shape, missing doc, etc.) from transient 5xx/network failures.
 */
export interface HelpUsImproveResponse {
  persistFailed: boolean;
  subscribeFailed: boolean;
  persistUnrecoverable?: boolean;
}
