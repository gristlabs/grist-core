import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { SetupStep } from "app/client/ui/SetupSteps";
import { textButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { SetupFeatureId } from "app/common/Config";
import { MAX_SETUP_REASON_LENGTH, SetupRequestsSummary } from "app/common/SetupRequests";
import { SetupRequestsAPI } from "app/common/SetupRequestsAPI";
import { tokens } from "app/common/ThemePrefs";

import { dom, DomContents, IDisposableOwner, makeTestId, Observable, styled } from "grainjs";

// Strings from NotificationsAndAutomationsNudge migrated to this file.
// eslint-disable-next-line local/makeT-filename
const t = makeT("NotificationsAndAutomationsNudge");
const testId = makeTestId("test-notifications-");

// The ask-the-admin widget for one step: a button, then an acknowledgement with the requester
// count and an optional note. `summary` is shared, so asking once updates every widget for it.
export function buildAskTheAdmin(
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
