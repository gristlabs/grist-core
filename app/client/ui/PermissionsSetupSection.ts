import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/homeUrl";
import { cssWell, cssWellContent } from "app/client/ui/AdminPanelCss";
import { mockupState } from "app/client/ui/MockupState";
import {
  getEnvLockedVars,
  hasEnvLocked,
  PermissionsToggleModel,
  PresetName,
  TOGGLE_DEFS,
} from "app/client/ui/PermissionsToggleModel";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { cssQuickSetupCard, cssShadowedPrimaryButton, cssValueLabel } from "app/client/ui/SettingsLayout";
import { bigBasicButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { ConfigAPI } from "app/common/ConfigAPI";
import { not } from "app/common/gutil";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("PermissionsSetupSection");
const testId = makeTestId("test-permissions-setup-");

// MOCKUP: lets the mockup panel pretend GRIST_SINGLE_ORG is set/unset.
function getEffectiveSingleOrg(): string | undefined {
  const override = mockupState.singleOrg.get();
  if (override !== null) { return override || undefined; }
  return getGristConfig().singleOrg;
}

/**
 * Renders the "Apply & Restart" step of the setup wizard.
 *
 * Shows default permission toggles with preset modes (Locked down / Recommended / Open),
 * a "Go Live" button that saves settings and restarts the server, and a success state
 * after restart completes.
 */
export class PermissionsSetupSection extends Disposable {
  private _model = PermissionsToggleModel.create(this);
  private _configAPI = new ConfigAPI(getHomeUrl());
  private _installAPI = new InstallAPIImpl(getHomeUrl());
  private _error = Observable.create<string>(this, "");
  private _saving = Observable.create<boolean>(this, false);
  // Whether the server has been restarted after saving. Used to switch to the success page.
  private _restarted = Observable.create<boolean>(this, false);

  constructor() {
    super();
    void this._load();
  }

  public buildDom(): DomContents {
    return dom("div",
      testId("section"),
      dom.domComputed(this._restarted, (done) => {
        if (done) { return this._buildSuccessPage(); }
        return dom("div",
          dom.maybe(this._error, err => cssError(err)),
          this._buildContent(),
        );
      }),
    );
  }

  private async _load() {
    try {
      await this._model.loaded;
      if (this.isDisposed()) { return; }
      // Recommended is the wizard default; applyPreset skips env-locked
      // toggles, so their server values from load() are preserved.
      this._model.applyPreset("recommended");
      // GRIST_SINGLE_ORG=docs makes the personal org the only org —
      // disabling personal sites would brick Grist.
      if (getEffectiveSingleOrg() === "docs") {
        this._model.toggles.personalSites.set(true);
      }
    } catch (e) {
      if (this.isDisposed()) { return; }
      this._error.set(String(e));
    }
  }

  private async _handleGoLive() {
    if (this._saving.get()) { return; }
    this._saving.set(true);
    this._error.set("");
    try {
      await this._model.apply();
      // The wizard's Go Live step is what clears the post-setup gate;
      // service status is its own concern, so set it via a separate call
      // rather than bundling it into the permissions write.
      await this._installAPI.updateInstallPrefs({ envVars: { GRIST_IN_SERVICE: "true" } });
      await this._configAPI.restartServer();
      await this._waitForReady();
      if (this.isDisposed()) { return; }
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

  private _buildContent(): DomContents {
    return dom("div",
      quickSetupStepHeader({
        icon: "Settings",
        title: t("Apply & Restart"),
        description: t("Review these defaults before going live. " +
          "You can change them later from the admin panel."),
      }),
      buildPermissionsCard(this._model, { disabled: this._saving }),

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

const PRESET_LABELS: Record<PresetName, () => string> = {
  locked: () => t("Locked down"),
  recommended: () => t("Recommended"),
  open: () => t("Open"),
};

/**
 * Renders the shared "Default Permissions" card: preset bar, the four
 * permission toggle rows, and warning wells for env-locked toggles and
 * GRIST_SINGLE_ORG. Used by both the QuickSetup wizard's "Apply & Restart"
 * step and the admin panel's grouped permissions item so the two surfaces
 * stay visually identical. Shows a spinner until the model's status loads.
 *
 * Pass `options.disabled` to grey out and lock the card (the wizard does
 * this while the Go Live restart is in flight).
 */
export function buildPermissionsCard(
  model: PermissionsToggleModel,
  options: { disabled?: Observable<boolean> } = {},
): DomContents {
  return dom.domComputed(model.status, (status) => {
    if (!status) { return cssLoading(loadingSpinner(), t("Loading permissions…")); }
    return cssPermissionsSection(
      options.disabled ? dom.cls("disabled", options.disabled) : null,
      cssSectionLabel(t("DEFAULT PERMISSIONS")),
      cssPresetBar(
        ...(Object.keys(PRESET_LABELS) as PresetName[]).map(key =>
          cssPresetButton(
            PRESET_LABELS[key](),
            dom.cls("active", use => use(model.presetDetector) === key),
            dom.on("click", () => model.applyPreset(key)),
            testId(`preset-${key}`),
          ),
        ),
      ),

      ...TOGGLE_DEFS.map(({ key, permKey, label, description }) => {
        const locked = status[permKey].source === "environment-variable";
        const conflict = model.hasConflict(key);
        return cssPermissionRow(
          cssPermissionToggle(
            toggleSwitch(model.toggles[key], {
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

      hasEnvLocked(status) ? cssWell(cssWell.cls("-warning"),
        cssWellContent(
          t("Some settings are controlled by environment variables and cannot be \
changed here: {{vars}}. To modify them, update the corresponding variables \
in your server configuration and restart.",
          { vars: getEnvLockedVars(status).join(", ") }),
        ),
        testId("env-warning"),
      ) : null,

      getEffectiveSingleOrg() ? cssWell(cssWell.cls("-warning"),
        cssWellContent(
          dom("p", t("You have GRIST_SINGLE_ORG={{value}} set. With this, users only see one \
site — but personal sites and team creation still work behind the \
scenes. Worth locking down unless you have a specific reason to keep them.",
          { value: getEffectiveSingleOrg()! })),
          getEffectiveSingleOrg() === "docs" ? dom("p",
            t("The personal org is the only org available — personal sites must \
stay enabled or Grist will be non-functional."),
          ) : null,
        ),
        testId("single-org-warning"),
      ) : null,
    );
  });
}

/**
 * Compact status for the admin-panel item's collapsed row, naming the
 * active preset (or "Custom" when toggles match no preset). Mirrors
 * {@link EditionSection.buildStatusDisplay} on neighbouring items.
 */
export function buildPermissionsStatusDisplay(model: PermissionsToggleModel): DomContents {
  return dom.domComputed((use) => {
    if (!use(model.status)) { return cssValueLabel(t("loading…")); }
    const preset = use(model.presetDetector);
    return cssValueLabel(preset ? PRESET_LABELS[preset]() : t("Custom"));
  });
}

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
