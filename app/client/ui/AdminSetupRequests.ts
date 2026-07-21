/**
 * The "Setup requests" item for the admin panel's Server section: the receiving end of "Ask the
 * admin". Per step, shows who asked, the features they wanted, and their notes, with a "Clear".
 * Renders nothing when there are no requests.
 */
import { makeT } from "app/client/lib/localization";
import { AppModel, getHomeUrl } from "app/client/models/AppModel";
import { reportError } from "app/client/models/errors";
import { cssValueLabel, SectionItem } from "app/client/ui/SettingsLayout";
import {
  computeSetupSteps,
  setupFeatureName,
  setupStepLabel,
} from "app/client/ui/SetupSteps";
import { textButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import {
  SetupFeatureId,
  SetupRequester,
  SetupRequests,
  SetupStepId,
  SetupStepRequests,
} from "app/common/Config";
import { countStepRequests, SETUP_FEATURE_IDS, SETUP_STEP_IDS } from "app/common/SetupRequests";
import { SetupRequestsAdminAPI, SetupRequestsAPIImpl } from "app/common/SetupRequestsAPI";
import { tokens } from "app/common/ThemePrefs";

import { dom, DomContents, IDisposableOwner, makeTestId, Observable, styled } from "grainjs";

const t = makeT("AdminSetupRequests");
const testId = makeTestId("test-admin-setup-requests-");

/**
 * Build the "Setup requests" admin panel item. `options.requestsApi` is a replacement
 * API client, used by the storyboard to show states without a server.
 */
export function buildSetupRequestsItem(
  owner: IDisposableOwner,
  appModel: AppModel,
  options: { requestsApi?: SetupRequestsAdminAPI } = {},
): DomContents {
  const api = options.requestsApi ?? new SetupRequestsAPIImpl(getHomeUrl());
  const requests = Observable.create<SetupRequests | null>(owner, null);
  const update = (r: SetupRequests) => requests.isDisposed() || requests.set(r);
  api.getAll().then(update).catch(reportError);

  // Both endpoints return the updated detail, so no refetch is needed.
  const clear = (step: SetupStepId) => api.clearStep(step).then(update).catch(reportError);

  return dom.domComputed(requests, (reqs) => {
    const entries = SETUP_STEP_IDS
      .map(id => ({ id, data: reqs?.steps[id] }))
      .filter((e): e is { id: SetupStepId, data: SetupStepRequests } =>
        Boolean(e.data && countStepRequests(e.data) > 0));
    if (!entries.length) { return null; }
    const total = entries.reduce((acc, e) => acc + countStepRequests(e.data), 0);
    // Steps that look complete (same computation as the nudge, so the surfaces agree).
    const doneSteps = new Set(
      computeSetupSteps(appModel).filter(s => s.done).map(s => s.id));
    return SectionItem({
      id: "setup-requests",
      name: t("Setup requests"),
      description: t("Setup steps users have asked for"),
      value: cssValueLabel(requestCountText(total), testId("count")),
      expandedContent: dom("div",
        entries.map(e =>
          buildStepBlock(e.id, e.data, doneSteps.has(e.id), () => clear(e.id))),
      ),
    });
  });
}

function buildStepBlock(
  step: SetupStepId,
  data: SetupStepRequests,
  looksDone: boolean,
  onClear: () => void,
): DomContents {
  const requesters = (Object.values(data.requesters) as SetupRequester[])
    .sort((a, b) => b.at.localeCompare(a.at));

  // Which features the requesters wanted this step for, most-wanted first.
  const tally = new Map<SetupFeatureId, number>();
  for (const requester of requesters) {
    for (const feature of requester.features) {
      tally.set(feature, (tally.get(feature) ?? 0) + 1);
    }
  }
  const wanted = SETUP_FEATURE_IDS
    .filter(f => tally.has(f))
    .sort((a, b) => tally.get(b)! - tally.get(a)!)
    .map(f => `${setupFeatureName(f)} (${tally.get(f)})`)
    .join(", ");

  return cssStepBlock(
    cssStepHead(
      cssStepName(setupStepLabel(step)),
      looksDone ? cssDoneTag(t("already done")) : null,
      cssStepCount(requestCountText(countStepRequests(data))),
      textButton(t("Clear"), dom.on("click", onClear), testId("clear")),
    ),
    !wanted ? null : cssStepDetail(cssStepDetailLabel(t("For")), " ", wanted),
    cssRequesterList(
      requesters.map(r => cssRequester(
        cssRequesterWho(r.name ? `${r.name} <${r.email}>` : r.email),
        cssRequesterWhen(new Date(r.at).toLocaleDateString()),
        !r.reason ? null : cssRequesterReason(`“${r.reason}”`),
        testId("requester"),
      )),
    ),
    testId(`step-${step}`),
  );
}

function requestCountText(count: number): string {
  return count === 1 ? t("1 request") : t("{{count}} requests", { count });
}

const cssStepBlock = styled("div", `
  margin: 8px 0 16px;

  &:last-child {
    margin-bottom: 8px;
  }
`);

const cssStepHead = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
`);

const cssStepName = styled("span", `
  font-weight: bold;
  color: ${theme.text};
`);

const cssDoneTag = styled("span", `
  color: ${tokens.primary};
  font-size: ${tokens.smallFontSize};
`);

const cssStepCount = styled("span", `
  color: ${theme.lightText};
  font-size: ${tokens.smallFontSize};
`);

const cssStepDetail = styled("div", `
  margin-top: 4px;
  color: ${theme.lightText};
`);

// Bold lead-in setting the label apart from the value, so it needs no trailing colon.
const cssStepDetailLabel = styled("span", `
  font-weight: 600;
`);

const cssRequesterList = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
`);

const cssRequester = styled("div", `
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  color: ${theme.text};
`);

const cssRequesterWho = styled("span", ``);

const cssRequesterWhen = styled("span", `
  color: ${theme.lightText};
  font-size: ${tokens.smallFontSize};
`);

const cssRequesterReason = styled("span", `
  color: ${theme.lightText};
  font-style: italic;
`);
