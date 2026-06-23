import { makeT } from "app/client/lib/localization";
import { textInput } from "app/client/ui/inputs";
import { cssQuickSetupCard } from "app/client/ui/SettingsLayout";
import { theme } from "app/client/ui2018/cssVars";
import { select } from "app/client/ui2018/menus";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { tokens } from "app/common/ThemePrefs";

import { Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("HelpUsImproveSection");
const testId = makeTestId("test-help-improve-");

const HEAR_ABOUT_OPTIONS = [
  "Search engine",
  "AI response",
  "Social media",
  "Friend/colleague",
  "Reddit/forum",
  "GitHub",
  "Other",
  "Conference/event",
];

const USER_TYPE_OPTIONS = [
  "Individual or hobbyist",
  "A business or organization",
  "Nonprofit",
  "Education/Research Institute",
  "Developer/IT",
  "Other",
];

export interface HelpUsImproveSubmission {
  hearAboutGrist: string;
  userType: string;
  subscribeToUpdates: boolean;
  email: string;
}

/**
 * Opt-in survey rendered at the end of the "Apply & restart" step of the
 * QuickSetup wizard. Collects how the user heard about Grist, what kind
 * of user they are, and an optional email subscription for product /
 * security updates. The form is read by the wizard at "Go Live" time.
 */
export class HelpUsImproveSection extends Disposable {
  private _hearAbout = Observable.create<string>(this, "");
  private _userType = Observable.create<string>(this, "");
  private _subscribeEnabled = Observable.create<boolean>(this, true);
  private _email = Observable.create<string | undefined>(this, undefined);

  public buildDom(): DomContents {
    return cssCard(
      testId("section"),
      cssSectionLabel(t("Help us improve Grist")),
      cssSectionDescription(t("A couple of quick questions — optional, and only our team sees this.")),

      cssField(
        cssFieldLabel(t("How did you hear about Grist?")),
        select<string>(this._hearAbout, HEAR_ABOUT_OPTIONS, {
          defaultLabel: t("Select…"),
        }),
        testId("hear-about"),
      ),

      cssField(
        cssFieldLabel(t("What best describes you?")),
        select<string>(this._userType, USER_TYPE_OPTIONS, {
          defaultLabel: t("Select…"),
        }),
        testId("user-type"),
      ),

      cssSubscribeBox(
        cssSubscribeHeader(
          cssSubscribeToggle(
            toggleSwitch(this._subscribeEnabled),
            testId("subscribe-toggle"),
          ),
          cssSubscribeText(
            cssSubscribeTitle(t("Send me product and security updates")),
            cssSubscribeDescription(
              t("Occasional email about new releases and important security notices."),
            ),
          ),
        ),
        dom.maybe(this._subscribeEnabled, () =>
          cssEmailRow(
            cssEmailLabel(t("Email:")),
            textInput(this._email,
              { type: "email", placeholder: "you@example.com" },
              testId("email"),
            ),
          ),
        ),
      ),
    );
  }

  /**
   * Returns the user's form input, or null if nothing has been filled in.
   * Subscribe-on without an email counts as not subscribed: the user has
   * supplied no contact info, so toggle state alone shouldn't trigger a
   * submission. Caller uses the null to skip the network POST entirely.
   */
  public getSubmissionData(): HelpUsImproveSubmission | null {
    const hearAbout = this._hearAbout.get();
    const userType = this._userType.get();
    const email = (this._email.get() ?? "").trim();
    const subscribe = this._subscribeEnabled.get() && Boolean(email);

    if (!hearAbout && !userType && !subscribe) {
      return null;
    }

    return {
      hearAboutGrist: hearAbout,
      userType,
      subscribeToUpdates: subscribe,
      email: subscribe ? email : "",
    };
  }
}

const cssCard = styled(cssQuickSetupCard, `
  margin-top: 16px;
`);

const cssSectionLabel = styled("div", `
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: ${theme.lightText};
  margin-bottom: 4px;
`);

const cssSectionDescription = styled("div", `
  font-size: ${tokens.mediumFontSize};
  color: ${theme.lightText};
  margin-bottom: 16px;
`);

const cssField = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
`);

const cssFieldLabel = styled("label", `
  font-size: 13px;
  font-weight: 600;
  color: ${theme.text};
`);

const cssSubscribeBox = styled("div", `
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 8px;
  padding: 14px 16px;
  margin-top: 8px;
`);

const cssSubscribeHeader = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 12px;
`);

const cssSubscribeToggle = styled("div", `
  flex: none;
  padding-top: 2px;
`);

const cssSubscribeText = styled("div", `
  flex: 1;
  min-width: 0;
`);

const cssSubscribeTitle = styled("div", `
  font-size: 14px;
  font-weight: 600;
  color: ${theme.text};
  margin-bottom: 4px;
`);

const cssSubscribeDescription = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.4;
`);

const cssEmailRow = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
`);

const cssEmailLabel = styled("label", `
  font-size: 13px;
  font-weight: 600;
  color: ${theme.text};
`);
