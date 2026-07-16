import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { Notifier } from "app/client/models/NotifyModel";
import { retryOnNetworkError } from "app/client/models/ToggleEnterpriseModel";
import { showEnterpriseToggle } from "app/client/ui/ActivationPage";
import {
  buildConfirmedRow,
  cssCelebrate,
  cssCelebrateBody,
  cssCelebrateIcon,
  cssCelebrateLead,
  cssHappyText,
  cssSectionButtonRow,
  cssSectionContainer,
  cssSectionDescription,
} from "app/client/ui/AdminPanelCss";
import { ConfigSection, DraftChangeDescription } from "app/client/ui/DraftChanges";
import { cssValueLabel } from "app/client/ui/SettingsLayout";
import { ToggleEnterpriseWidget } from "app/client/ui/ToggleEnterpriseWidget";
import { basicButton, primaryButton, textButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { colorIcon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { spinnerModal } from "app/client/ui2018/modals";
import { ConfigAPI } from "app/common/ConfigAPI";
import { AdminPageConfig, commonUrls } from "app/common/gristUrls";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, DomElementArg, makeTestId, Observable, styled } from "grainjs";

const t = makeT("EditionSection");
const testId = makeTestId("test-edition-");

export type Edition = "enterprise" | "core";

type Surface = "admin" | "wizard";

type ViewMode =
  "full-running" |
  "full-selected" |
  "community-running" |
  "community-selected";

interface EditionSectionOptions {
  /** True when rendered in the admin panel; false / absent in the wizard. */
  inAdminPanel?: boolean;
  notifier?: Notifier;
  /**
   * Optional overrides for state that's normally derived from globals
   * (`showEnterpriseToggle()`, `getGristConfig().forceEnableEnterprise`, and
   * the toggle widget's initial value). Used by storybook so stories can
   * exercise each render state without launching a real server.
   */
  overrides?: {
    fullGristAvailable?: boolean;
    editionForced?: boolean;
    initialServerEdition?: Edition;
  };
  onEditionSwitch?: (edition: Edition) => void;
}

export class EditionSection extends Disposable implements ConfigSection {
  public canProceed: Computed<boolean>;
  public isDirty: Computed<boolean>;
  public describeChange: Computed<DraftChangeDescription[]>;

  public readonly fullGristAvailable: boolean;
  public readonly editionForced: boolean;
  public readonly canSwitchToFull: boolean;
  public readonly needsRestart = true;

  private readonly _supportsExtFullEdition: boolean;
  private readonly _installAPI = new InstallAPIImpl(getHomeUrl());

  private _selectedEdition = Observable.create<Edition | null>(this, null);
  private _serverEdition = Observable.create<Edition>(this, "core");
  // Pre-confirmed in admin-panel mode so the confirm/edit flow only runs in the wizard.
  private _editionConfirmed = Observable.create<boolean>(this, !!this._options.inAdminPanel);

  private _viewMode = Computed.create<ViewMode>(this, (use) => {
    const running = use(this._serverEdition) === "enterprise";
    if (use(this._selectedEdition) === "enterprise") {
      return running ? "full-running" : "full-selected";
    }
    return running ? "community-selected" : "community-running";
  });

  // Only created in admin-panel mode (requires a notifier).
  private _toggleEnterprise: ToggleEnterpriseWidget | null;
  private _configAPI = new ConfigAPI(getHomeUrl());

  constructor(private _options: EditionSectionOptions = {}) {
    super();

    const overrides = _options.overrides ?? {};
    const adminConfig = getGristConfig() as Partial<AdminPageConfig>;
    this.fullGristAvailable = overrides.fullGristAvailable ?? showEnterpriseToggle();
    this.editionForced = overrides.editionForced ?? !!getGristConfig().forceEnableEnterprise;
    this._supportsExtFullEdition = !!adminConfig.supportsExtFullEdition;
    this.canSwitchToFull = this.fullGristAvailable || this._supportsExtFullEdition;

    const notifier = this._options.notifier;
    this._toggleEnterprise = notifier ?
      ToggleEnterpriseWidget.create(this, notifier) :
      null;

    this._serverEdition.set(
      overrides.initialServerEdition ??
      (getGristConfig().deploymentType === "enterprise" ? "enterprise" : "core"),
    );

    // Start at the server's edition, so the section isn't dirty before the user acts.
    this._selectedEdition.set(this._serverEdition.get());

    if (this.editionForced) { this._editionConfirmed.set(true); }

    this.canProceed = Computed.create(this, use => use(this._editionConfirmed));
    this.isDirty = Computed.create(this, (use) => {
      if (!use(this._editionConfirmed)) { return false; }
      const selected = use(this._selectedEdition);
      if (selected === null) { return false; }
      return selected !== use(this._serverEdition);
    });
    this.describeChange = Computed.create(this, use => [{
      label: t("Edition"),
      value: use(this._selectedEdition) === "enterprise" ? t("Full Grist") : t("Community edition"),
    }]);
  }

  public buildStatusDisplay(): DomContents {
    if (this.editionForced) {
      return cssValueLabel(cssHappyText(t("full")));
    }
    if (!this.fullGristAvailable) {
      return cssValueLabel(t("community"));
    }
    const toggle = this._toggleEnterprise?.getEnterpriseToggleObservable();
    if (!toggle) {
      return cssValueLabel(t("community"));
    }
    return dom.domComputed(toggle, (isEnterprise) => {
      if (isEnterprise) {
        return cssValueLabel(cssHappyText(t("full")));
      }
      return cssValueLabel(t("community"));
    });
  }

  // Admin panel dom
  public buildDom(): DomContents {
    if (this.editionForced) {
      return cssSectionContainer(this._buildForcedNote(), testId("section"));
    }
    return cssSectionContainer(
      dom.domComputed(this._viewMode, mode => this._buildView(mode, "admin")),
      testId("section"),
    );
  }

  // Wizard dom
  public buildWizardDom(): DomContents {
    if (this.editionForced) {
      // No confirmed row when edition is forced by env -- nothing to edit.
      return cssSectionContainer(this._buildForcedNote(), testId("wizard"));
    }
    return cssSectionContainer(
      dom.domComputed(this._viewMode, mode => this._buildView(mode, "wizard")),
      buildConfirmedRow(
        this._editionConfirmed,
        () => {
          this._editionConfirmed.set(false);
          this._selectedEdition.set(this._serverEdition.get());
        },
        { testPrefix: "edition" },
      ),
      testId("wizard"),
    );
  }

  public getSelectedEdition(): Edition | null {
    return this._selectedEdition.get();
  }

  public async apply() {
    if (!this.isDirty.get()) { return; }
    const selected = this._selectedEdition.get();
    if (!selected) { return; }
    if (this._supportsExtFullEdition) {
      await retryOnNetworkError(() => this._installAPI.updateInstallPrefs({
        envVars: { GRIST_EDITION: selected === "enterprise" ? "full" : "community" },
      }));
    } else {
      await this._configAPI.setValue({ edition: selected });
    }
    this._serverEdition.set(selected);
  }

  public get restartWaitAttempts(): number | undefined {
    if (!this._supportsExtFullEdition) { return undefined; }

    // Switching to full edition requires a ~10 MB download that the server may
    // retry a few times, so wait longer.
    return this._selectedEdition.get() === "enterprise" ? 600 : 120;
  }

  public selectEdition(edition: Edition): void {
    this._selectedEdition.set(edition);
  }

  public pendingEditionSwitch(): Edition | null {
    if (!this.isDirty.get()) { return null; }

    return this._selectedEdition.get();
  }

  public async dismiss(): Promise<void> {
    if (!this.isDirty.get()) { return; }
    this._selectedEdition.set(this._serverEdition.get());
  }

  private _chooseEdition(edition: Edition) {
    const onEditionSwitch = this._options.onEditionSwitch;
    if (onEditionSwitch) {
      onEditionSwitch(edition);
      return;
    }
    this._editionConfirmed.set(true);
    this._selectedEdition.set(edition);
  }

  private _buildView(mode: ViewMode, surface: Surface): DomContents {
    switch (mode) {
      case "full-running": return surface === "admin" ?
        this._buildFullGristRunningView() :
        this._buildFullGristView(mode, surface);
      case "full-selected": return this._buildFullGristView(mode, surface);
      case "community-running": return this._buildCommunityView(surface);
      case "community-selected": return this._buildCommunitySelectedView();
    }
  }

  private _buildForcedNote(): DomContents {
    return cssSectionDescription(t("Full Grist is enabled via environment variable."));
  }

  private _buildFullGristRunningView(): DomContents {
    return [
      cssEditionName(t("Full Grist")),
      cssSectionDescription(t(`This server runs the full edition of Grist, with advanced security, \
governance, MCP server, automations, email notifications, and collaboration features.`)),
      this._toggleEnterprise ? [this._toggleEnterprise.buildEnterpriseSection(), cssDivider()] : null,
      cssDowngradeButton(
        t("Downgrade to Community edition"),
        dom.on("click", () => this._chooseEdition("core")),
        testId("downgrade"),
      ),
    ];
  }

  private _buildFullGristView(mode: ViewMode, surface: Surface): DomContents {
    return [
      cssEditionName(t("Full Grist"), testId("full-selected")),
      cssSectionDescription(
        t("The full Grist experience, with all features enabled for improved security, \
governance, and collaboration."),
      ),
      this._showTrialNote(mode) ? cssSectionDescription(
        t("You have 30 days to enter an activation key. Free activation keys are available \
to individuals and small orgs with less than US $1 million in total annual funding. \
{{learnMoreLink}} For larger orgs, see {{pricingLink}}.", {
          learnMoreLink: cssLink(
            { href: commonUrls.helpEnterpriseOptIn, target: "_blank" },
            t("Learn more."),
          ),
          pricingLink: cssLink({ href: commonUrls.plans, target: "_blank" }, t("pricing")),
        }),
        testId("trial-note"),
      ) : null,
      mode === "full-selected" ? this._buildExtDownloadNote() : null,
      surface === "wizard" ? this._buildFullGristButtons() : null,
    ];
  }

  private _showTrialNote(mode: ViewMode): boolean {
    if (mode !== "full-running") { return true; }

    const { trial } = getGristConfig().activation ?? {};
    return Boolean(trial && trial.daysLeft > 0);
  }

  private _buildFullGristButtons(): DomContents {
    return dom.maybe(use => !use(this._editionConfirmed), () => cssEditionButtonRow(
      primaryButton(
        t("Continue with full edition"),
        dom.on("click", () => this._chooseEdition("enterprise")),
        testId("confirm-full"),
      ),
      basicButton(
        t("Switch to Community edition"),
        dom.on("click", () => this._chooseEdition("core")),
        testId("switch-to-community"),
      ),
    ));
  }

  private _buildCommunityView(surface: Surface): DomContents {
    return [
      cssEditionName(t("Community Grist"), testId("community-view")),
      cssSectionDescription(t("You are running the Grist Community edition.")),
      this.canSwitchToFull ? this._buildUpgradeWell() : this._buildManualSwitchNote(),
      this._buildExtDownloadNote(),
      this._buildCommunityButtons(surface),
    ];
  }

  private _buildCommunitySelectedView(): DomContents {
    return [
      cssEditionName(t("Community Grist"), testId("community-selected")),
      cssSectionDescription(t("Grist will switch to the Community edition after restarting, \
disabling full Grist features. You will not lose your data or need to reinstall Grist.")),
    ];
  }

  private _buildUpgradeWell(): DomContents {
    return cssCelebrate(
      cssCelebrateIcon(colorIcon("Sparks")),
      dom("div",
        cssCelebrateLead(t("Upgrade to full Grist")),
        cssCelebrateBody(
          dom("p", t("For automations, MCP server, AI assistant, OIDC support, email \
notifications, admin controls, audit logging and more, switch to the full Grist edition.")),
          dom("p", t("{{freeKeysLink}} are available to individuals and orgs under US $1M total \
annual funding. For larger orgs see {{pricingLink}}. Start your 30-day free trial today.", {
            freeKeysLink: cssLink(
              { href: commonUrls.helpEnterpriseOptIn, target: "_blank" },
              t("Free activation keys"),
            ),
            pricingLink: cssLink({ href: commonUrls.plans, target: "_blank" }, t("pricing")),
          })),
          dom("p", t("You may downgrade at any time to the Community edition. You will not lose your \
data or need to reinstall Grist.")),
        ),
      ),
      testId("upgrade-well"),
    );
  }

  private _buildExtDownloadNote(): DomContents {
    if (!this._supportsExtFullEdition) { return null; }

    return cssSectionDescription(
      t("Switching to full Grist downloads the required extensions. This may take a few \
minutes, during which the server will be unavailable."),
      testId("ext-download-note"),
    );
  }

  private _buildManualSwitchNote(): DomContents {
    return cssSectionDescription(
      t("Your installation does not bundle the Full Grist edition. \
Want Full Grist? {{enableLink}}", {
        enableLink: cssLink(
          { href: commonUrls.helpEnterpriseOptIn, target: "_blank" },
          t("See how to enable it."),
        ),
      }),
      testId("manual-switch-note"),
    );
  }

  private _buildCommunityButtons(surface: Surface): DomContents {
    if (surface === "admin") {
      if (!this.canSwitchToFull) { return null; }

      return cssEditionButtonRow(
        primaryButton(
          t("Switch to full Grist"),
          dom.on("click", () => this._chooseEdition("enterprise")),
          testId("switch-to-full"),
        ),
      );
    }

    return dom.maybe(use => !use(this._editionConfirmed), () => cssEditionButtonRow(
      this.canSwitchToFull ? primaryButton(
        t("Switch to full Grist"),
        dom.on("click", () => this._chooseEdition("enterprise")),
        testId("switch-to-full"),
      ) : null,
      (this.canSwitchToFull ? basicButton : primaryButton)(
        t("Continue with Community edition"),
        dom.on("click", () => this._chooseEdition("core")),
        testId("confirm"),
      ),
    ));
  }
}

export function editionSwitchWarning(edition: Edition): DomElementArg[] {
  if (edition === "enterprise") {
    return [dom("p", t("Switching to full Grist restarts the server, which may be briefly unavailable."))];
  } else {
    return [
      dom("p", t("Downgrading to the Community edition restarts the server, which may be briefly \
unavailable.")),
      dom("p", t("Full Grist features such as email notifications, automations, MCP server, and OIDC and \
SAML support will be disabled after restart. You may always upgrade to full Grist again.")),
    ];
  }
}

export function editionSwitchModal<T>(promise: Promise<T>): Promise<T> {
  return spinnerModal(
    t("Switching Grist edition..."),
    promise,
    { body: [
      t("Your server will restart automatically once finished."),
    ] },
  );
}

const cssEditionName = styled("div", `
  font-weight: 700;
  font-size: 18px;
  margin-bottom: 4px;
`);

const cssEditionButtonRow = styled(cssSectionButtonRow, `
  margin-top: 8px;
`);

const cssDowngradeButton = styled(textButton, `
  font-size: ${tokens.smallFontSize};
`);

const cssDivider = styled("div", `
  border-top: 1px solid ${theme.widgetBorder};
`);
