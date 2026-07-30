/**
 * "Say what's missing" nudge for the Document Settings page, filling the Notifications slot
 * wherever the live card can't run. Per feature: a pip meter and step count, expandable to a
 * description and checklist; a shared "Next step" line when one prerequisite blocks everything.
 *
 * Voice adapts to the viewer: an install admin gets imperative "Next step" (and admin-panel deep
 * links); everyone else gets "Waiting on" plus an "ask the admin" affordance. Step state comes
 * from the page config, so progress is accurate on any build.
 */
import { makeT } from "app/client/lib/localization";
import { AppModel, getHomeUrl } from "app/client/models/AppModel";
import { DocInfo } from "app/client/models/DocPageModel";
import { reportError } from "app/client/models/errors";
import { urlState } from "app/client/models/gristUrlState";
import { getAutomationsStatus } from "app/client/ui/AutomationStatus";
import { collapsibleContent, cssCollapseIcon, SectionCard } from "app/client/ui/SettingsLayout";
import {
  computeSetupSteps,
  setupFeatureName,
  setupFeatureNeeds,
  SetupStep,
} from "app/client/ui/SetupSteps";
import { hoverTooltip } from "app/client/ui/tooltips";
import { textButton } from "app/client/ui2018/buttons";
import { mediaSmall, theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { SetupFeatureId, SetupStepId } from "app/common/Config";
import { canView } from "app/common/roles";
import { MAX_SETUP_REASON_LENGTH, SetupRequestsSummary } from "app/common/SetupRequests";
import { SetupRequestsAPI, SetupRequestsAPIImpl } from "app/common/SetupRequestsAPI";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { dom, DomContents, IDisposableOwner, makeTestId, Observable, styled } from "grainjs";

const testId = makeTestId("test-notifications-");
const t = makeT("NotificationsAndAutomationsNudge");

interface NudgeFeature {
  id: SetupFeatureId;
  name: string;
  description: DomContents; // Why a user might want this feature.
  needs: SetupStepId[];     // ids of the SetupSteps this feature requires.
}

// A feature with its setup progress computed.
interface FeatureProgress {
  feature: NudgeFeature;
  steps: SetupStep[];
  doneCount: number;
  ready: boolean;
  next?: SetupStep;   // First unmet step; unset when ready.
}

/**
 * Build the "Notifications and Automations" section, or null if it shouldn't appear here.
 * Audience (matching the live card): a signed-in collaborator on a live doc — no anonymous
 * viewers, forks, snapshots or tutorial forks.
 *
 * @param options.requestsApi Stub setup-requests client, for storyboard states without a server.
 */
export function buildNotificationsAndAutomationsNudge(
  appModel: AppModel,
  doc: DocInfo | null,
  options?: { requestsApi?: SetupRequestsAPI },
): DomContents {
  // "hidden" (electron/grist-static) has no upgrade path, so keep the slot silent.
  if (getAutomationsStatus(appModel) === "hidden") { return null; }

  // On our hosted SaaS the install is fully plumbed and plan-based upselling lives elsewhere, so
  // this "what's missing" nudge doesn't apply — it would even contradict itself (e.g. asking for a
  // plan with automation while reporting full Grist). Shown on every other build.
  if (getGristConfig().deploymentType === "saas") { return null; }

  // Default audience: a signed-in collaborator on a live doc.
  const isLiveDoc = Boolean(doc && !doc.isFork && !doc.isSnapshot && !doc.isTutorialFork);
  if (!isLiveDoc || !appModel.currentValidUser || !canView(doc!.access)) { return null; }

  const steps = computeSetupSteps(appModel);
  const stepById = (id: SetupStepId) => steps.find(s => s.id === id)!;

  // Each feature needs its own steps (independent backends); installed only when all are met.
  const features: NudgeFeature[] = [
    {
      id: "automations",
      name: setupFeatureName("automations"),
      description: t("React to changes in your data automatically with custom emails, \
webhook calls, and more."),
      needs: setupFeatureNeeds.automations,
    },
    {
      id: "invites",
      name: setupFeatureName("invites"),
      description: t("When you share a document, new members get an email invite."),
      needs: setupFeatureNeeds.invites,
    },
    {
      id: "notifications",
      name: setupFeatureName("notifications"),
      description: t("Get emailed when data changes, or when someone comments or mentions \
you."),
      needs: setupFeatureNeeds.notifications,
    },
    {
      id: "assistant",
      name: setupFeatureName("assistant"),
      description: t("Ask questions and build formulas in plain language."),
      needs: setupFeatureNeeds.assistant,
    },
  ];

  // Nothing to nudge once every step is done; the enterprise override handles this case too.
  if (steps.every(s => s.done)) { return null; }

  const progress: FeatureProgress[] = features.map((feature) => {
    const featSteps = feature.needs.map(stepById);
    const doneCount = featSteps.filter(s => s.done).length;
    return {
      feature,
      steps: featSteps,
      doneCount,
      ready: doneCount === featSteps.length,
      next: featSteps.find(s => !s.done),
    };
  });

  // When all unfinished features share the first step, say it once instead of per row.
  const todo = progress.filter(p => !p.ready);
  const sharedNext = (todo.length && todo.every(p => p.next!.id === todo[0].next!.id)) ?
    todo[0].next! : undefined;

  // Only an install admin can act: every step is install-level setup. (isOwner() is true for
  // one's own personal org, so it can't stand in for this.)
  const canAct = appModel.isInstallAdmin();
  const nextStepLabel = canAct ? t("Next step") : t("Waiting on");

  // Non-admins get an "ask the admin" affordance for unfinished steps.
  const mayAsk = !canAct && todo.length > 0;

  // Step name; for admins, links to its admin-panel item (new tab, keeping the doc open).
  const stepName = (step: SetupStep): DomContents => {
    if (!canAct || !step.adminItem) { return step.label; }
    return cssLink(step.label,
      { href: urlState().makeUrl({ adminPanel: "admin" }) + "#" + step.adminItem, target: "_blank" },
      testId("next-link"));
  };

  return dom.create((owner: IDisposableOwner) => {
    // Per-step ask counts for the ask widget. Null on failure (or serverless fixtures); the
    // widget then just offers the button.
    const summary = Observable.create<SetupRequestsSummary | null>(owner, null);
    const requestsApi = options?.requestsApi ?? new SetupRequestsAPIImpl(getHomeUrl());
    if (mayAsk) {
      requestsApi.getSummary()
        .then(s => summary.isDisposed() || summary.set(s))
        .catch(() => {});
    }

    // "Ask the admin" records a request; shown only for steps the viewer can't act on.
    const askTheAdmin = (step: SetupStep, features: SetupFeatureId[]): DomContents =>
      canAct ? null : dom.create(buildAskTheAdmin, step, features, summary, requestsApi);

    // Inner span carries the "next" testId, so it excludes the ask widget's text.
    const nextPointer = (next: SetupStep, features: SetupFeatureId[]) =>
      cssNextStep(
        dom("span", cssNextStepLabel(nextStepLabel), " ", stepName(next), testId("next")),
        askTheAdmin(next, features),
      );

    return SectionCard(t("Notifications and Automations"), [
      cssIntro(
        t("This document can run automations, send notifications, and use an AI assistant."),
        " ",
        todo.length < progress.length ?
          t("Some of these features are ready; others need more setup on this install.") :
          t("These features need additional setup on this install."),
        !mayAsk ? null :
          [" ", t("Setting these up is done by whoever manages this Grist installation.")],
        testId("intro"),
      ),
      sharedNext ? cssSharedNextStep(
        dom("span",
          cssNextStepLabel(canAct ?
            t("Next step for everything below") :
            t("Everything below is waiting on")),
          " ", stepName(sharedNext),
          testId("next"),
        ),
        askTheAdmin(sharedNext, todo.map(p => p.feature.id)),
      ) : null,
      cssFeatures(...progress.map(p =>
        buildFeature(p, !sharedNext && p.next ? nextPointer(p.next, [p.feature.id]) : null))),
    ]);
  });
}

// The ask-the-admin widget for one step: a button, then an acknowledgement with the requester
// count and an optional note. `summary` is shared, so asking once updates every widget for it.
function buildAskTheAdmin(
  owner: IDisposableOwner,
  step: SetupStep,
  features: SetupFeatureId[],
  summary: Observable<SetupRequestsSummary | null>,
  requestsApi: SetupRequestsAPI,
): DomContents {
  const noteOpen = Observable.create(owner, false);
  const noteSent = Observable.create(owner, false);
  const send = async (reason?: string) => {
    try {
      const result = await requestsApi.sendRequest(
        { step: step.id, features, ...(reason ? { reason } : {}) });
      // The page may be gone by the time the reply lands.
      if (summary.isDisposed()) { return; }
      summary.set(result);
      if (reason) {
        noteOpen.set(false);
        noteSent.set(true);
      }
    } catch (e) {
      reportError(e as Error);
    }
  };
  return cssAsk(
    dom.domComputed(summary, (s) => {
      const stepSummary = s?.steps[step.id];
      if (!stepSummary?.requestedByMe) {
        return [
          textButton(t("Ask the admin for this"),
            dom.on("click", () => { void send(); }),
            testId("ask")),
          !stepSummary?.count ? null :
            cssAskCount(othersAskedText(stepSummary.count), testId("ask-count")),
        ];
      }
      return [
        cssAskDone(cssAskTick(icon("Tick")), askedText(stepSummary.count), testId("asked")),
        dom.domComputed(noteOpen, (open) => {
          if (open) {
            return cssAskNoteInput(
              {
                type: "text",
                placeholder: t("Why do you want this? Press Enter to send."),
                maxLength: String(MAX_SETUP_REASON_LENGTH),
              },
              onEnter((value) => { void send(value); }),
              testId("ask-note-input"),
            );
          }
          return dom.domComputed(noteSent, sent => sent ?
            cssAskCount(t("Note sent."), testId("ask-note-sent")) :
            textButton(t("Add a note"),
              dom.on("click", () => noteOpen.set(true)),
              testId("ask-note")));
        }),
      ];
    }),
    testId(`ask-${step.id}`),
  );
}

function onEnter(action: (value: string) => void) {
  return dom.onKeyDown({
    Enter: (_ev, elem) => action((elem as HTMLInputElement).value.trim()),
  });
}

const askedText = (count: number) =>
  count <= 1 ? t("You've asked for this.") :
    count === 2 ? t("You and 1 other have asked for this.") :
      t("You and {{count}} others have asked for this.", { count: count - 1 });

const othersAskedText = (count: number) =>
  count === 1 ? t("1 person has asked for this.") :
    t("{{count}} people have asked for this.", { count });

// `nextPointer`: the "Next step" line, or null when the feature is ready or the shared pointer
// covers it.
function buildFeature(progress: FeatureProgress, nextPointer: DomContents): DomContents {
  const { feature, steps, doneCount, ready } = progress;
  // Meter fills from the left: done pips first (stable sort keeps setup order). The checklist
  // below stays in setup order.
  const meterSteps = [...steps].sort((a, b) => Number(b.done) - Number(a.done));
  return dom.create((owner: IDisposableOwner) => {
    const isCollapsed = Observable.create(owner, true);
    return cssFeature(
      cssFeatureHead(
        dom.domComputed(isCollapsed, c => cssCollapseIcon(c ? "Expand" : "Collapse")),
        cssFeatureName(feature.name, ready ? cssReadyTick(icon("Tick")) : null),
        cssMeter(
          cssPips(...meterSteps.map(s =>
            cssPip(
              cssPip.cls("-done", s.done),
              cssPip.cls("-ready", ready),
              hoverTooltip(s.label),
              testId("pip"),
            ),
          )),
          cssStepCount(
            t("{{done}} of {{total}} steps", { done: doneCount, total: steps.length }),
            testId("steps"),
          ),
        ),
        dom.on("click", () => isCollapsed.set(!isCollapsed.get())),
        testId("feature-head"),
      ),
      collapsibleContent(isCollapsed,
        cssExpanded(
          cssFeatureDesc(feature.description),
          cssChecklist(...steps.map(s =>
            cssChecklistItem(
              s.done ? cssCheckDone(icon("Tick")) : cssCheckTodo(),
              s.label,
              testId("step"),
              testId(s.done ? "step-done" : "step-todo"),
            ),
          )),
          nextPointer,
        ),
      ),
      testId(`feature-${feature.id}`),
      testId(ready ? "feature-ready" : "feature-todo"),
    );
  });
}

const cssIntro = styled("div", `
  padding: 16px 24px 8px;
  color: ${theme.text};
  line-height: 1.5;

  @media ${mediaSmall} {
    & { padding: 12px; }
  }
`);

const cssFeatures = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 16px 20px;

  @media ${mediaSmall} {
    & { padding: 8px 8px 16px; }
  }
`);

const cssFeature = styled("div", `
  display: flex;
  flex-direction: column;
`);

const cssFeatureHead = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    background-color: ${theme.lightHover};
  }
`);

const cssFeatureName = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  font-weight: bold;
  color: ${theme.text};
`);

const cssReadyTick = styled("div", `
  --icon-color: ${tokens.primary};
`);

const cssMeter = styled("div", `
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
`);

const cssPips = styled("div", `
  flex: none;
  display: flex;
  gap: 5px;
  width: 120px;
`);

const cssPip = styled("div", `
  flex: 1;
  height: 12px;
  border-radius: 2px;
  transform: skewX(-18deg);
  background: ${theme.progressBarBg};
  &-done {
    background: ${theme.progressBarFg};
  }
  &-ready {
    background: ${tokens.primary};
  }
`);

const cssStepCount = styled("div", `
  white-space: nowrap;
  min-width: 80px;
  color: ${theme.lightText};
  font-size: ${tokens.smallFontSize};
`);

const cssExpanded = styled("div", `
  padding: 2px 8px 10px 38px;
`);

const cssFeatureDesc = styled("div", `
  color: ${theme.lightText};
  line-height: 1.4;
`);

const cssChecklist = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
`);

const cssChecklistItem = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${theme.text};
`);

const cssCheckDone = styled("div", `
  display: flex;
  --icon-color: ${tokens.primary};
`);

const cssCheckTodo = styled("div", `
  flex: none;
  width: 10px;
  height: 10px;
  margin: 3px;
  border-radius: 50%;
  border: 2px solid ${theme.progressBarBg};
`);

const cssSharedNextStep = styled("div", `
  padding: 0 24px 8px;
  color: ${theme.text};

  @media ${mediaSmall} {
    & { padding: 0 12px 8px; }
  }
`);

const cssNextStep = styled("div", `
  margin-top: 8px;
  color: ${theme.text};
`);

// Bold accented lead-in setting the label apart from the step name, so it needs no trailing colon.
const cssNextStepLabel = styled("span", `
  font-weight: 600;
  color: ${theme.accentText};
`);

const cssAsk = styled("div", `
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
`);

const cssAskCount = styled("span", `
  color: ${theme.lightText};
  font-size: ${tokens.smallFontSize};
`);

const cssAskDone = styled("span", `
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: ${theme.lightText};
`);

const cssAskTick = styled("div", `
  display: flex;
  --icon-color: ${tokens.primary};
`);

const cssAskNoteInput = styled("input", `
  width: 100%;
  max-width: 320px;
  padding: 4px 8px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  background-color: ${theme.inputBg};
  color: ${theme.inputFg};
  outline: none;

  &:focus {
    border-color: ${theme.controlFg};
  }
`);
