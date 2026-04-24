import { Notifier } from "app/client/models/NotifyModel";
import { AdminPanelControls } from "app/client/ui/AdminPanelCss";
import { EditionSection } from "app/client/ui/EditionSection";

import { Disposable, DomContents, Observable, styled } from "grainjs";

export default {
  title: "Admin panel/EditionSection",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

// --- Helpers ----------------------------------------------------------------

function createControls(owner: Disposable): AdminPanelControls {
  return {
    needsRestart: Observable.create(owner, false),
    restartGrist: async () => { /* no-op in storybook */ },
  };
}

// ToggleEnterpriseWidget reads `deploymentType` and `activation` straight
// from window.gristConfig, so stories need to swap it to drive the widget
// into specific visual states.
function withGristConfig(owner: Disposable, config: Record<string, unknown>) {
  const prev = (window as any).gristConfig;
  (window as any).gristConfig = { ...prev, ...config };
  owner.onDispose(() => { (window as any).gristConfig = prev; });
}

type EditionSectionOverrides =
  NonNullable<Parameters<typeof EditionSection.create>[1]>["overrides"];

interface AdminStoryArgs {
  deploymentType?: "core" | "enterprise";
  overrides: EditionSectionOverrides;
  build?: (section: EditionSection) => DomContents;
}

function adminStory({ deploymentType, overrides, build }: AdminStoryArgs) {
  return {
    render: (_args: any, { owner }: any) => {
      if (deploymentType) { withGristConfig(owner, { deploymentType }); }
      const section = EditionSection.create(owner, {
        controls: createControls(owner),
        notifier: Notifier.create(owner),
        overrides,
      });
      return cssFrame((build ?? (s => s.buildDom()))(section));
    },
  };
}

function wizardStory(overrides: EditionSectionOverrides) {
  return {
    render: (_args: any, { owner }: any) =>
      cssFrame(EditionSection.create(owner, { overrides }).buildWizardDom()),
  };
}

function statusStory(args: AdminStoryArgs) {
  return adminStory({ ...args, build: s => s.buildStatusDisplay() });
}

// --- Admin-panel mode stories ----------------------------------------------

/** Community-only build: no selector, just a note. */
export const AdminCommunityOnly = adminStory({
  overrides: { fullGristAvailable: false },
});

/**
 * Full Grist build, server currently running Community. Shows the selector;
 * the legacy ToggleEnterpriseWidget is hidden to avoid duplicating its
 * "Enable Full Grist" button.
 */
export const AdminServerCore = adminStory({
  deploymentType: "core",
  overrides: { fullGristAvailable: true, initialServerEdition: "core" },
});

/**
 * Full Grist build, server currently running Full Grist. Shows the selector
 * AND the ToggleEnterpriseWidget below (activation-key / trial / license
 * UI). The widget's activation fetch fails silently in storybook and the
 * widget renders its initial state.
 */
export const AdminServerFull = adminStory({
  deploymentType: "enterprise",
  overrides: { fullGristAvailable: true, initialServerEdition: "enterprise" },
});

/** Edition forced via GRIST_FORCE_ENABLE_ENTERPRISE: no selector, env note. */
export const AdminEditionForced = adminStory({
  deploymentType: "enterprise",
  overrides: {
    fullGristAvailable: true,
    editionForced: true,
    initialServerEdition: "enterprise",
  },
});

// --- Status-pill stories ----------------------------------------------------

export const StatusCommunity = statusStory({
  overrides: { fullGristAvailable: false },
});

export const StatusForced = statusStory({
  overrides: { fullGristAvailable: true, editionForced: true },
});

export const StatusFull = statusStory({
  deploymentType: "enterprise",
  overrides: { fullGristAvailable: true, initialServerEdition: "enterprise" },
});

// --- Wizard-mode stories ----------------------------------------------------

export const WizardCommunityOnly = wizardStory({ fullGristAvailable: false });

export const WizardFullAndCommunity = wizardStory({ fullGristAvailable: true });

const cssFrame = styled("div", `
  padding: 24px;
  max-width: 520px;
`);
