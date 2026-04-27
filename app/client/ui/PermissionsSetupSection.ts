import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/homeUrl";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { cssQuickSetupCard, cssShadowedPrimaryButton } from "app/client/ui/SettingsLayout";
import { bigBasicButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { ConfigAPI } from "app/common/ConfigAPI";
import { not } from "app/common/gutil";
import { InstallAPIImpl, PermissionsStatus } from "app/common/InstallAPI";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("PermissionsSetupSection");
const testId = makeTestId("test-permissions-setup-");

/**
 * Renders the "Apply & Restart" step of the setup wizard.
 *
 * Shows default permission toggles with preset modes (Locked down / Recommended / Open),
 * a "Go Live" button that saves settings and restarts the server, and a success state
 * after restart completes.
 */
export class PermissionsSetupSection extends Disposable {
  // Needed to read and update settings.
  private _installAPI = new InstallAPIImpl(getHomeUrl());
  // Needed for restarts.
  private _configAPI = new ConfigAPI(getHomeUrl());
  // Data received from the server about current permissions status.
  private _status = Observable.create<PermissionsStatus | null>(this, null);
  // Error message holder.
  private _error = Observable.create<string>(this, "");
  // Loading state.
  private _saving = Observable.create<boolean>(this, false);
  // Whether the server has been restarted after saving. Used to switch to the success page.
  private _restarted = Observable.create<boolean>(this, false);

  // Dirty state for the things being toggled. Default values are set to those that
  // are in grist-core, but it doesn't matter, they are replaced when the real status is loaded.
  private _toggles: Record<string, Observable<boolean>> = {
    teamSites: Observable.create<boolean>(this, false), // values are not important
    personalSites: Observable.create<boolean>(this, false),
    anonAccess: Observable.create<boolean>(this, false),
    playground: Observable.create<boolean>(this, false),
  };

  // Preset detector. Checks state of toggles, and if they match it shows which preset is active.
  // Env-locked toggles are excluded from matching — they can't be changed, so they shouldn't
  // prevent a preset from being recognized.
  private _presetDetector = Computed.create(this, (use) => {
    const status = use(this._status);
    for (const [name, values] of Object.entries(PRESETS)) {
      if (Object.entries(values).every(([k, v]) => {
        if (status && this._isEnvLocked(status, k)) { return true; }
        return use(this._toggles[k]) === v;
      })) {
        return name;
      }
    }
    return null;
  });

  constructor() {
    super();
    void this._load();
  }

  public buildDom(): DomContents {
    return dom("div",
      testId("section"),
      dom.domComputed(this._restarted, (done) => {
        // If we are restarted, show the success page.
        if (done) { return this._buildSuccessPage(); }

        // Otherwise show the permissions setup page, with error/loading states.
        return dom("div",
          dom.maybe(this._error, err => cssError(err)),
          dom.domComputed(this._status, (s) => {
            if (!s) { return cssLoading(loadingSpinner(), t("Loading permissions…")); }
            return this._buildContent(s);
          }),
        );
      }),
    );
  }

  private async _load() {
    try {
      const s = await this._installAPI.getPermissionsStatus();
      if (this.isDisposed()) { return; }
      this._status.set(s);
      // Initialize all toggles from current server values.
      this._toggles.teamSites.set(s.orgCreationAnyone.value ?? true);
      this._toggles.personalSites.set(s.personalOrgs.value ?? true);
      this._toggles.anonAccess.set(!(s.forceLogin.value ?? false));
      this._toggles.playground.set(s.anonPlayground.value ?? true);
      // Apply recommended preset — skips env-locked toggles, so their
      // server values above are preserved.
      this._applyPreset("recommended");
      // When GRIST_SINGLE_ORG=docs, the personal org is the only org —
      // disabling personal sites would make Grist non-functional.
      if (getGristConfig().singleOrg === "docs") {
        this._toggles.personalSites.set(true);
      }
    } catch (e) {
      if (this.isDisposed()) { return; }
      this._error.set(String(e));
    }
  }

  private _applyPreset(preset: string) {
    const status = this._status.get();
    for (const [toggleName, toggleValue] of Object.entries(PRESETS[preset])) {
      // Don't override toggles locked by environment variables.
      if (status && this._isEnvLocked(status, toggleName)) { continue; }
      this._toggles[toggleName].set(toggleValue);
    }
  }

  private _isEnvLocked(status: PermissionsStatus, toggleKey: string): boolean {
    const def = TOGGLE_DEFS.find(d => d.key === toggleKey);
    return !!def && status[def.permKey].source === "environment-variable";
  }

  private async _handleGoLive() {
    // Simple way for preventing multiple clicks.
    if (this._saving.get()) { return; }
    this._saving.set(true);
    this._error.set("");
    try {
      await this._installAPI.updateInstallPrefs({ envVars: {
        GRIST_ORG_CREATION_ANYONE: String(this._toggles.teamSites.get()),
        GRIST_PERSONAL_ORGS: String(this._toggles.personalSites.get()),
        GRIST_FORCE_LOGIN: String(!this._toggles.anonAccess.get()),
        GRIST_ANON_PLAYGROUND: String(this._toggles.playground.get()),
        GRIST_IN_SERVICE: "true",
      } });
      await this._configAPI.restartServer();
      await this._waitForReady();
      if (this.isDisposed()) { return; }
      this._saving.set(false);
      this._restarted.set(true);
    } catch (e) {
      if (this.isDisposed()) { return; }
      this._error.set(String(e));
    } finally {
      if (!this.isDisposed()) { this._saving.set(false); }
    }
  }

  private async _waitForReady() {
    if (!await this._configAPI.waitUntilReady()) {
      if (this.isDisposed()) { return; }
      throw new Error(t("Server did not restart in time. Please refresh the page."));
    }
  }

  private _goHome() {
    window.location.href = getHomeUrl(); // avoid using urlState here, as it is meant for team navigation.
  }

  private _buildContent(status: PermissionsStatus): DomContents {
    return dom("div",
      quickSetupStepHeader({
        icon: "Settings",
        title: t("Apply & Restart"),
        description: t("Review these defaults before going live. " +
          "You can change them later from the admin panel."),
      }),
      cssPermissionsSection(
        dom.cls("disabled", this._saving),
        cssSectionLabel(t("DEFAULT PERMISSIONS")),
        cssPresetBar(
          ...([
            ["locked", t("Locked down")] as const,
            ["recommended", t("Recommended")] as const,
            ["open", t("Open")] as const,
          ].map(([key, label]) =>
            cssPresetButton(
              label,
              dom.cls("active", use => use(this._presetDetector) === key),
              dom.on("click", () => this._applyPreset(key)),
              testId(`preset-${key}`),
            ),
          )),
        ),

        // Toggle rows.
        ...TOGGLE_DEFS.map(({ key, permKey, label, description }) => {
          const locked = status[permKey].source === "environment-variable";
          const conflict = key === "personalSites" && getGristConfig().singleOrg === "docs";
          return cssPermissionRow(
            cssPermissionToggle(
              toggleSwitch(this._toggles[key], {
                args: [locked ? dom.cls("disabled") : null],
                inputArgs: locked ? [dom.prop("disabled", true)] : [],
              }),
            ),
            cssPermissionInfo(
              cssPermissionLabelRow(
                cssPermissionLabel(label()),
                locked ? cssBadge(cssBadge.cls("-warning"), t("Environment"), testId("env-badge")) : null,
                conflict ? cssBadge(cssBadge.cls("-error"), t("Conflict"), testId("conflict-badge")) : null,
              ),
              cssPermissionDescription(description()),
            ),
            testId(`perm-${permKey}`),
          );
        }),

        // Warning when some settings are locked by environment variables.
        hasEnvLocked(status) ? cssWarningWell(
          t("Some settings are controlled by environment variables and cannot be \
changed here: {{vars}}. To modify them, update the corresponding variables \
in your server configuration and restart.",
          { vars: getEnvLockedVars(status).join(", ") }),
          testId("env-warning"),
        ) : null,

        // GRIST_SINGLE_ORG warning.
        getGristConfig().singleOrg ? cssWarningWell(
          t("You have GRIST_SINGLE_ORG={{value}} set. With this, users only see one \
site — but personal sites and team creation still work behind the \
scenes. Worth locking down unless you have a specific reason to keep them.",
          { value: getGristConfig().singleOrg! }),
          getGristConfig().singleOrg === "docs" ? dom("div",
            dom.style("margin-top", "8px"),
            t("The personal org is the only org available — personal sites must \
stay enabled or Grist will be non-functional."),
          ) : null,
          testId("single-org-warning"),
        ) : null,
      ),

      // Bottom area: Go Live / Loading states.
      dom.maybe(this._saving, () =>
        cssRestartingRow(
          loadingSpinner(),
          t("Applying settings and restarting…"),
        ),
      ),
      dom.maybe(not(this._saving), () =>
        cssBottomRow(
          cssGoLiveButton(t("Apply and Go Live!"),
            dom.on("click", () => this._handleGoLive()),
            testId("go-live"),
          ),
        ),
      ),
    );
  }

  private _buildSuccessPage(): DomContents {
    return cssSuccessPage(
      cssSparks(),
      cssSuccessTitle(t("Grist is live!")),
      cssSuccessSubtitle(t("Your configuration changes have been applied and the server has been restarted. \
Grist is now in service and available to users.")),
      bigBasicButton(t("Back to installation"),
        dom.on("click", () => this._goHome()),
        testId("back-to-install"),
      ),
    );
  }
}

const PRESETS: Record<string, Record<string, boolean>> = {
  locked: { teamSites: false, personalSites: false, anonAccess: false, playground: false },
  recommended: { teamSites: false, personalSites: true, anonAccess: true,  playground: false },
  open: { teamSites: true,  personalSites: true,  anonAccess: true,  playground: true },
};

function hasEnvLocked(status: PermissionsStatus): boolean {
  return TOGGLE_DEFS.some(({ permKey }) => status[permKey].source === "environment-variable");
}

function getEnvLockedVars(status: PermissionsStatus): string[] {
  return TOGGLE_DEFS
    .filter(({ permKey }) => status[permKey].source === "environment-variable")
    .map(({ envVar }) => envVar);
}

type PermissionKey = keyof Omit<PermissionsStatus, "singleOrg">;

const TOGGLE_DEFS: {
  key: string;
  permKey: PermissionKey;
  envVar: string;
  label: () => string;
  description: () => string;
}[] = [
  {
    key: "teamSites",
    permKey: "orgCreationAnyone",
    envVar: "GRIST_ORG_CREATION_ANYONE",
    label: () => t("Allow anyone to create team sites"),
    description: () => t("Any logged-in user can create new team sites. \
Turn off to restrict team creation to admins only."),
  },
  {
    key: "personalSites",
    permKey: "personalOrgs",
    envVar: "GRIST_PERSONAL_ORGS",
    label: () => t("Allow personal sites"),
    description: () => t("Users can create their own personal sites with documents. \
Turn off to restrict all documents to team sites managed by admins."),
  },
  {
    key: "anonAccess",
    permKey: "forceLogin",
    envVar: "GRIST_FORCE_LOGIN",
    label: () => t("Allow anonymous access"),
    description: () => t("Visitors who aren't signed in can view publicly shared documents. \
This is needed for link sharing and published forms."),
  },
  {
    key: "playground",
    permKey: "anonPlayground",
    envVar: "GRIST_ANON_PLAYGROUND",
    label: () => t("Allow anonymous playground"),
    description: () => t("Visitors who aren't signed in can create and edit documents \
in a temporary playground. Turn off to require sign-in before creating any documents."),
  },
];

const cssLoading = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 32px;
  color: ${theme.lightText};
`);

const cssError = styled("div", `
  background: ${theme.toastErrorBg};
  border-radius: 8px;
  color: white;
  padding: 12px 16px;
  margin-bottom: 16px;
`);

const cssPermissionsSection = styled(cssQuickSetupCard, `
  transition: opacity 0.2s;

  &.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
`);

const cssSectionLabel = styled("div", `
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  margin-bottom: 16px;
  color: ${theme.lightText};
`);

const cssPresetBar = styled("div", `
  display: flex;
  background: ${tokens.bgTertiary};
  border-radius: 8px;
  padding: 3px;
  margin-bottom: 20px;
`);

const cssPresetButton = styled("div", `
  flex: 1;
  text-align: center;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${theme.lightText};
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;

  &.active {
    color: ${theme.text};
    font-weight: 600;
    background: ${theme.mainPanelBg};
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1);
  }
`);

const cssPermissionRow = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid ${theme.pagePanelsBorder};
`);

const cssPermissionToggle = styled("div", `
  flex: none;
  padding-top: 2px;

  & .disabled {
    opacity: 0.5;
    pointer-events: none;
  }
`);

const cssPermissionInfo = styled("div", `
  flex: 1;
  min-width: 0;
`);

const cssPermissionLabelRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
`);

const cssPermissionLabel = styled("div", `
  font-size: 14px;
  font-weight: 600;
  color: ${theme.text};
`);

const cssBadge = styled("span", `
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: ${vars.smallFontSize};
  font-weight: 600;
  letter-spacing: 0.2px;
  color: white;

  &-warning {
    background-color: ${theme.toastWarningBg};
  }
  &-error {
    background-color: ${theme.toastErrorBg};
  }
`);

const cssPermissionDescription = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.4;
`);

const cssWarningWell = styled("div", `
  border: 2px solid ${theme.toastWarningBg};
  border-radius: 8px;
  padding: 12px 16px;
  margin-top: 16px;
  font-size: ${vars.smallFontSize};
  line-height: 1.4;
  color: ${theme.text};
`);

const cssBottomRow = styled("div", `
  display: flex;
  justify-content: stretch;
  margin-top: 24px;
  & > * {
    flex: 1;
  }
`);

const cssRestartingRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 8px;
  color: ${theme.lightText};
  font-size: 14px;
`);

const cssGoLiveButton = styled(cssShadowedPrimaryButton, `
  background-color: ${theme.toastSuccessBg};
  border-color: ${theme.toastSuccessBg};
  &:hover {
    background-color: ${theme.toastSuccessBg};
    filter: brightness(0.95);
  }
`);

const cssSuccessPage = styled("div", `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 32px;
  gap: 12px;
`);

const cssSparks = styled("div", `
  height: 48px;
  width: 48px;
  background-image: var(--icon-Sparks);
  display: inline-block;
  background-repeat: no-repeat;
`);

const cssSuccessTitle = styled("div", `
  font-size: 18px;
  font-weight: 600;
  color: ${theme.text};
`);

const cssSuccessSubtitle = styled("div", `
  font-size: 14px;
  color: ${theme.lightText};
  margin-bottom: 16px;
`);
