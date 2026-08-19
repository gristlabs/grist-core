import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { cssWell, cssWellContent } from "app/client/ui/AdminPanelCss";
import {
  PermissionsToggleModel,
  PresetName,
} from "app/client/ui/PermissionsToggleModel";
import { quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";
import { cssQuickSetupCard, cssValueLabel } from "app/client/ui/SettingsLayout";
import { theme, vars } from "app/client/ui2018/cssVars";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("PermissionsSetupSection");
const testId = makeTestId("test-permissions-setup-");

/**
 * Pure renderer for the permissions card on the wizard's "Apply & restart" step.
 *
 * Owns wizard-specific model initialization (apply "recommended" preset by
 * default; force personalSites on for GRIST_SINGLE_ORG=docs deployments
 * that would otherwise be bricked). Exposes its `model` so the step's
 * DraftChangesManager can register it; lifecycle (apply, restart, success
 * page) lives in {@link QuickSetupApplyStep}.
 */
export class PermissionsSetupSection extends Disposable {
  public readonly model = PermissionsToggleModel.create(this);

  constructor() {
    super();
    this._load().catch(reportError);
  }

  public buildDom(opts: { disabled?: Observable<boolean> } = {}): DomContents {
    return dom("div",
      quickSetupStepHeader({
        icon: "Settings",
        title: t("Apply & restart"),
        description: t("Review these defaults before going live. " +
          "You can change them later from the admin panel."),
      }),
      buildPermissionsCard(this.model, opts),
    );
  }

  private async _load() {
    await this.model.loaded;
    if (this.isDisposed()) { return; }
    // Recommended is the wizard default; applyPreset skips env-locked
    // toggles, so their server values from load() are preserved.
    this.model.applyPreset("recommended");
    // GRIST_SINGLE_ORG=docs makes the personal org the only org —
    // disabling personal sites would brick Grist.
    if (getGristConfig().singleOrg === "docs") {
      this.model.toggles.personalSites.set(true);
    }
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
 * GRIST_SINGLE_ORG. Used by both the QuickSetup wizard's "Apply & restart"
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

      ...model.toggleDefs.map(({ key, permKey, label, description }) => {
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

      model.hasEnvLocked() ? cssWell(cssWell.cls("-warning"),
        cssWellContent(
          t("Some settings are controlled by environment variables and cannot be \
changed here: {{vars}}. To modify them, update the corresponding variables \
in your server configuration and restart.",
          { vars: model.getEnvLockedVars().join(", ") }),
        ),
        testId("env-warning"),
      ) : null,

      getGristConfig().singleOrg ? cssWell(cssWell.cls("-warning"),
        cssWellContent(
          dom("p", t("You have GRIST_SINGLE_ORG={{value}} set. With this, users only see one \
site — but personal sites and team creation still work behind the \
scenes. Worth locking down unless you have a specific reason to keep them.",
          { value: getGristConfig().singleOrg! })),
          getGristConfig().singleOrg === "docs" ? dom("p",
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
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;

  &.active {
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
  line-height: 1.4;
`);
