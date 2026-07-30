/**
 * Storyboard for the admin panel's "Setup requests" item — the receiving end of the "Ask the
 * admin" button. The stories call the real builder with a fake API, so "Clear" works live:
 * clearing every step makes the item vanish, as it does for admins with no requests.
 */
import { AppModel } from "app/client/models/AppModel";
import { buildSetupRequestsItem } from "app/client/ui/AdminSetupRequests";
import { SectionCard } from "app/client/ui/SettingsLayout";
import { SetupRequests, SetupStepId } from "app/common/Config";
import { SetupRequestsAdminAPI } from "app/common/SetupRequestsAPI";

import { Disposable, dom, styled } from "grainjs";

export default {
  title: "Admin panel/Setup requests",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

// buildSetupRequestsItem reads window.gristConfig to spot steps that look already
// done, so stories swap it and restore on dispose.
function withGristConfig(owner: Disposable, config: Record<string, unknown>) {
  const prev = (window as any).gristConfig;
  (window as any).gristConfig = { ...prev, ...config };
  owner.onDispose(() => { (window as any).gristConfig = prev; });
}

function makeFakeAdminApi(initial: SetupRequests): SetupRequestsAdminAPI {
  const data = structuredClone(initial);
  return {
    async getAll() { return structuredClone(data); },
    async clearStep(step: SetupStepId) {
      delete data.steps[step];
      return structuredClone(data);
    },
    async getSummary() { return { steps: {} }; },
    async sendRequest() { throw new Error("not used by the admin item"); },
  };
}

const SAMPLE: SetupRequests = {
  steps: {
    "full-grist": {
      requesters: {
        1: {
          email: "marie@example.com", name: "Marie", at: "2026-05-28T10:00:00Z",
          features: ["notifications", "automations"],
          reason: "We keep missing form submissions.",
        },
        2: { email: "li@example.com", at: "2026-06-02T09:30:00Z", features: ["assistant"] },
        3: {
          email: "sam@example.com", name: "Sam", at: "2026-06-05T16:20:00Z",
          features: ["notifications"],
        },
      },
    },
    "redis": {
      requesters: {
        1: {
          email: "marie@example.com", name: "Marie", at: "2026-05-30T11:00:00Z",
          features: ["notifications"],
        },
      },
    },
  },
};

function story(config: Record<string, unknown>, data: SetupRequests) {
  return {
    render: (_args: any, { owner }: any) => {
      withGristConfig(owner, config);
      // The builder only consults the app model for SaaS plan checks, which these
      // deployment types never reach.
      const appModel = {} as unknown as AppModel;
      return cssFrame(SectionCard("Server", [
        dom.create(buildSetupRequestsItem, appModel, {
          requestsApi: makeFakeAdminApi(data),
        }),
      ]));
    },
  };
}

/** A community server: every requested step is still to do. */
export const PendingRequests = story({ deploymentType: "core" }, SAMPLE);

/**
 * The same requests on a server where full Grist is already enabled: the satisfied
 * step is tagged "already done", inviting a Clear.
 */
export const PartlyDone = story({ deploymentType: "enterprise" }, SAMPLE);

const cssFrame = styled("div", `
  max-width: 50rem;
`);
