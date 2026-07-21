/**
 * Storyboard for the nudge in Document Settings. Its states are tricky to reach in the real UI
 * (deployment type, email/Redis/AI config, viewer role, doc kind), so there's one story per
 * combination. Every story calls the real builder — no UI is duplicated — and the panel
 * definitions are shared with the CI walk, so they can't drift.
 *
 * The rows are live: click one to expand its description and checklist.
 */
import {
  anonymousViewer, buildPanel, electron, fork, freshCoreAdmin, freshCoreCollaborator,
  freshCoreCollaboratorAsked, freshCoreCollaboratorOthersAsked, fullyConfigured,
  mixedProgressAdmin, mixedProgressCollaborator, onlyAiMissingAdmin,
  Panel,
} from "test/fixtures/projects/helpers/notificationsNudgePanels";

import { styled } from "grainjs";

export default {
  title: "Document settings/Notifications nudge",
  parameters: {
    docs: { codePanel: true, source: { type: "code" } },
  },
};

function panelStory(panel: Panel) {
  return {
    name: panel.title,
    render: (_args: any, { owner }: any) => {
      // buildPanel swaps window.gristConfig (the builder reads it at build time);
      // restore it on dispose so other stories aren't affected.
      const prev = (window as any).gristConfig;
      owner.onDispose(() => { (window as any).gristConfig = prev; });
      return cssFrame(buildPanel(panel) ?? cssNothing("(renders nothing)"));
    },
  };
}

export const FreshCoreAdmin = panelStory(freshCoreAdmin);
export const FreshCoreCollaborator = panelStory(freshCoreCollaborator);
export const FreshCoreCollaboratorOthersAsked = panelStory(freshCoreCollaboratorOthersAsked);
export const FreshCoreCollaboratorAsked = panelStory(freshCoreCollaboratorAsked);
export const MixedProgressAdmin = panelStory(mixedProgressAdmin);
export const MixedProgressCollaborator = panelStory(mixedProgressCollaborator);
export const OnlyAiMissingAdmin = panelStory(onlyAiMissingAdmin);
export const FullyConfigured = panelStory(fullyConfigured);
export const Electron = panelStory(electron);
export const AnonymousViewer = panelStory(anonymousViewer);
export const ForkDocument = panelStory(fork);

const cssFrame = styled("div", `
  max-width: 50rem;
`);

const cssNothing = styled("div", `
  color: #888;
  font-style: italic;
`);
