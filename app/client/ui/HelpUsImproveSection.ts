import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/homeUrl";
import { showEnterpriseToggle } from "app/client/ui/ActivationPage";
import { textInput } from "app/client/ui/inputs";
import { cssQuickSetupCard } from "app/client/ui/SettingsLayout";
import { theme } from "app/client/ui2018/cssVars";
import { select } from "app/client/ui2018/menus";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { ConfigAPI } from "app/common/ConfigAPI";
import { isEmail } from "app/common/gutil";
import { HelpUsImproveSubmission } from "app/common/HelpUsImproveAPI";
import { GETGRIST_COM_PROVIDER_KEY } from "app/common/loginProviders";
import { tokens } from "app/common/ThemePrefs";
import { getAdminConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("HelpUsImproveSection");
const testId = makeTestId("test-help-us-improve-");

const HEAR_ABOUT_OPTIONS = [
  { value: "search_engine",       label: t("Search engine") },
  { value: "ai_response",         label: t("AI response") },
  { value: "social_media",        label: t("Social media") },
  { value: "friend_or_colleague", label: t("Friend/colleague") },
  { value: "reddit_or_forum",     label: t("Reddit/forum") },
  { value: "github",              label: t("GitHub") },
  { value: "conference_or_event", label: t("Conference/event") },
  { value: "other",               label: t("Other") },
];

const USER_TYPE_OPTIONS = [
  { value: "individual",   label: t("Individual or hobbyist") },
  { value: "business",     label: t("A business or organization") },
  { value: "nonprofit",    label: t("Nonprofit") },
  { value: "education",    label: t("Education/Research Institute") },
  { value: "developer_it", label: t("Developer/IT") },
  { value: "other",        label: t("Other") },
];

const EMAIL_INPUT_ID = "help-improve-email";
const SUBSCRIBE_SWITCH_ID = "help-improve-subscribe-switch";

/**
 * Opt-in survey card: how the user heard about Grist, what kind of user
 * they are, and an optional email subscription for product/security
 * updates. Intended to be embedded by a parent that gates submission on
 * `isValid` (e.g. disabling its submit button) and reads
 * `getSubmissionData()` to POST the result.
 */
export class HelpUsImproveSection extends Disposable {
  // Whether the form is currently in a submittable state.
  // Must be instantiated last (after any dependencies) to avoid errors.
  public readonly isValid: Computed<boolean>;

  private _hearAbout = Observable.create<string>(this, "");
  private _userType = Observable.create<string>(this, "");
  private _subscribeEnabled = Observable.create<boolean>(this, false);
  // Seeded from initialEmail in the constructor.
  private _email = Observable.create<string>(this, "");

  // Inline email-field error. Reactive — appears as soon as the user
  // opts in to updates without a valid email and clears as they fix it.
  private _emailError = Computed.create<string>(this, (use) => {
    if (!use(this._subscribeEnabled)) { return ""; }
    const email = use(this._email).trim();
    if (!email) { return t("Email is required when subscribing to updates."); }
    if (!isEmail(email)) { return t("Please enter a valid email address."); }
    return "";
  });

  // initialEmail seeds the email field; the toggle stays off so opting in
  // remains a deliberate act.
  constructor(initialEmail: string = "") {
    super();
    this._email.set(initialEmail);
    this.isValid = Computed.create(this, use => !use(this._emailError));
  }

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
            toggleSwitch(this._subscribeEnabled, {
              inputArgs: [{ id: SUBSCRIBE_SWITCH_ID }],
            }),
            testId("subscribe-toggle"),
          ),
          cssSubscribeText(
            cssSubscribeTitle(t("Send me product and security updates"),
              { for: SUBSCRIBE_SWITCH_ID }),
            cssSubscribeDescription(
              t("Occasional email about new releases and important security notices."),
            ),
          ),
        ),
        dom.maybe(this._subscribeEnabled, () =>
          cssEmailRow(
            cssEmailLabel(t("Email:"), { for: EMAIL_INPUT_ID }),
            textInput(this._email,
              { type: "email", placeholder: "you@example.com", id: EMAIL_INPUT_ID },
              testId("email"),
            ),
            dom.maybe(this._emailError, err =>
              cssEmailError(err, testId("email-error")),
            ),
          ),
        ),
      ),
    );
  }

  /**
   * Returns the user's form input, or null if nothing has been filled in.
   * Caller uses the null to skip the network POST entirely.
   */
  public async getSubmissionData(): Promise<HelpUsImproveSubmission | null> {
    const hearAbout = this._hearAbout.get();
    const userType = this._userType.get();
    const email = this._email.get().trim();
    const subscribe = this._subscribeEnabled.get();

    if (!hearAbout && !userType && !subscribe) {
      return null;
    }

    const { installationId, deploymentType } = getAdminConfig();
    return {
      installationId,
      loginWithGristClientId: await this._fetchLoginWithGristClientId(),
      referralSource: hearAbout,
      role: userType,
      subscribeToUpdates: subscribe,
      email: subscribe ? email : "",
      deploymentType,
      build: showEnterpriseToggle() ? "full" : "community",
    };
  }

  private async _fetchLoginWithGristClientId(): Promise<string> {
    try {
      const configAPI = new ConfigAPI(getHomeUrl());
      const config = await configAPI.getAuthProviderConfig(GETGRIST_COM_PROVIDER_KEY);
      return config.oidcClientId ?? "";
    } catch (e) {
      // Don't block submission on fetch failure — record the error in the field so
      // it reaches us via the survey row instead.
      return `Could not fetch OIDC client id - ${(e as Error).message}`.slice(0, 200);
    }
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

const cssSubscribeTitle = styled("label", `
  font-size: 14px;
  font-weight: 600;
  color: ${theme.text};
  margin-bottom: 4px;
  display: block;
  cursor: pointer;
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

const cssEmailError = styled("div", `
  font-size: 12px;
  color: ${theme.errorText};
`);
