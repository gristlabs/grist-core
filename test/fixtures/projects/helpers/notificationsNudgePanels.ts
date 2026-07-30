/**
 * Storyboard panels for the nudge: one per interesting state, each built by the REAL builder with
 * varied inputs (window.gristConfig, AppModel/DocInfo stubs). Shared by the Storybook stories and
 * the fixture page the CI walk drives, so the two can't drift.
 */
import { AppModel } from "app/client/models/AppModel";
import { DocInfo } from "app/client/models/DocPageModel";
import { buildNotificationsAndAutomationsNudge } from "app/client/ui/NotificationsAndAutomationsNudge";
import { GristLoadConfig } from "app/common/gristUrls";
import { SetupRequestSpec, SetupRequestsSummary } from "app/common/SetupRequests";
import { SetupRequestsAPI } from "app/common/SetupRequestsAPI";

import { DomContents } from "grainjs";

export interface Panel {
  title: string;
  config: Partial<GristLoadConfig>;  // Becomes window.gristConfig for this panel.
  canAct?: boolean;                  // Viewer is an install admin.
  owner?: boolean;                   // Viewer owns the current org (true even for a personal org).
  anonymous?: boolean;               // Viewer is not signed in.
  fork?: boolean;                    // Doc is a fork (not a live doc).
  requests?: SetupRequestsSummary;   // Pre-existing setup requests, served by a fake API.
}

export const freshCoreAdmin: Panel = {
  title: "Fresh core install, admin viewer (shared next step, imperative voice)",
  config: { deploymentType: "core" },
  canAct: true,
};

export const freshCoreCollaborator: Panel = {
  title: "Fresh core install, collaborator viewer (descriptive voice)",
  config: { deploymentType: "core" },
};

export const freshCoreCollaboratorOthersAsked: Panel = {
  title: "Fresh core install, collaborator, 2 others have asked the admin",
  config: { deploymentType: "core" },
  requests: { steps: { "full-grist": { count: 2, requestedByMe: false } } },
};

export const freshCoreCollaboratorAsked: Panel = {
  title: "Fresh core install, collaborator who asked the admin (with 2 others)",
  config: { deploymentType: "core" },
  requests: { steps: { "full-grist": { count: 3, requestedByMe: true } } },
};

export const mixedProgressAdmin: Panel = {
  title: "Full Grist + email, admin (mixed progress, per-row next steps)",
  config: { deploymentType: "enterprise", notifierEnabled: true },
  canAct: true,
};

export const mixedProgressCollaborator: Panel = {
  title: "Full Grist + email, collaborator (per-row \"Waiting on\")",
  config: { deploymentType: "enterprise", notifierEnabled: true },
  canAct: false,
};

export const onlyAiMissingAdmin: Panel = {
  title: "Only AI missing, admin (shared next step again, most features ready)",
  config: { deploymentType: "enterprise", notifierEnabled: true, redisAvailable: true },
  canAct: true,
};

export const fullyConfigured: Panel = {
  title: "Fully configured (live card would take the slot)",
  config: {
    deploymentType: "enterprise", notifierEnabled: true, redisAvailable: true,
    assistant: { provider: "OpenAI", version: 2 },
  },
  canAct: true,
};

export const electron: Panel = {
  title: "Electron / grist-static (no upgrade path)",
  config: { deploymentType: "electron" },
  canAct: true,
};

export const anonymousViewer: Panel = {
  title: "Anonymous / public viewer",
  config: { deploymentType: "core" },
  anonymous: true,
};

// A personal-org owner who is not an install admin: self-hosted, so they can't act on any step
// and still get the descriptive voice and the ask button (isOwner() alone must not grant "act").
export const freshCoreOwner: Panel = {
  title: "Fresh core install, owner-but-not-admin viewer (still descriptive, still asks)",
  config: { deploymentType: "core" },
  owner: true,
};

export const fork: Panel = {
  title: "Fork (not a live doc)",
  config: { deploymentType: "core" },
  canAct: true,
  fork: true,
};

// In the order the fixture page shows them (the CI walk indexes into this), render-nothing last.
export const ALL_PANELS: Panel[] = [
  freshCoreAdmin,
  freshCoreCollaborator,
  freshCoreCollaboratorOthersAsked,
  freshCoreCollaboratorAsked,
  mixedProgressAdmin,
  mixedProgressCollaborator,
  onlyAiMissingAdmin,
  freshCoreOwner,
  fullyConfigured,
  electron,
  anonymousViewer,
  fork,
];

/**
 * A setup-requests API backed by panel data instead of a server, so panels can show the
 * ask-the-admin states. Asking works: the fake records the request, so the widget flips
 * to its acknowledged state live.
 */
function makeFakeRequestsApi(initial: SetupRequestsSummary): SetupRequestsAPI {
  // Copy, so re-rendering a panel starts over from its declared state.
  let summary: SetupRequestsSummary = structuredClone(initial);
  return {
    async getSummary() { return summary; },
    async sendRequest(spec: SetupRequestSpec) {
      const prev = summary.steps[spec.step];
      summary = {
        steps: {
          ...summary.steps,
          [spec.step]: {
            count: (prev?.count ?? 0) + (prev?.requestedByMe ? 0 : 1),
            requestedByMe: true,
          },
        },
      };
      return summary;
    },
  };
}

/**
 * Render one panel with the real builder. Returns null in the states where the nudge
 * renders nothing. Note this swaps window.gristConfig (the builder reads it at build
 * time); callers that care should save and restore around the call.
 */
export function buildPanel(panel: Panel): DomContents {
  (window as any).gristConfig = panel.config;
  const appModel = {
    currentValidUser: panel.anonymous ? null : { id: 1, email: "viewer@example.com" },
    isInstallAdmin: () => Boolean(panel.canAct),
    isOwner: () => Boolean(panel.owner),
    isBillingManager: () => false,
  } as unknown as AppModel;
  const doc = {
    isFork: Boolean(panel.fork),
    isSnapshot: false,
    isTutorialFork: false,
    access: "viewers",
  } as unknown as DocInfo;
  return buildNotificationsAndAutomationsNudge(appModel, doc, {
    requestsApi: makeFakeRequestsApi(panel.requests ?? { steps: {} }),
  });
}
