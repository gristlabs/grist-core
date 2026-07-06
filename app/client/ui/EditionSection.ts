import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { Notifier } from "app/client/models/NotifyModel";
import { retryOnNetworkError } from "app/client/models/ToggleEnterpriseModel";
import { showEnterpriseToggle } from "app/client/ui/ActivationPage";
import {
  buildConfirmedRow,
  cssHappyText,
  cssSectionButtonRow,
  cssSectionContainer,
  cssSectionDescription,
} from "app/client/ui/AdminPanelCss";
import { ConfigSection, DraftChangeDescription } from "app/client/ui/DraftChanges";
import { cssValueLabel } from "app/client/ui/SettingsLayout";
import { ToggleEnterpriseWidget } from "app/client/ui/ToggleEnterpriseWidget";
import { basicButton, primaryButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { confirmModal, spinnerModal } from "app/client/ui2018/modals";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { ConfigAPI } from "app/common/ConfigAPI";
import { AdminPageConfig, commonUrls } from "app/common/gristUrls";
import { InstallAPIImpl } from "app/common/InstallAPI";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("EditionSection");
const testId = makeTestId("test-edition-");

type Edition = "enterprise" | "core";

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
}

export class EditionSection extends Disposable implements ConfigSection {
  public canProceed: Computed<boolean>;
  public isDirty: Computed<boolean>;
  public describeChange: Computed<DraftChangeDescription[]>;

  public readonly fullGristAvailable: boolean;
  public readonly editionForced: boolean;
  public readonly needsRestart = true;

  private readonly _supportsExtFullEdition: boolean;
  private readonly _installAPI = new InstallAPIImpl(getHomeUrl());

  private _selectedEdition = Observable.create<Edition | null>(this, null);
  private _serverEdition = Observable.create<Edition>(this, "core");
  // Pre-confirmed in admin-panel mode so the confirm/edit flow only runs in the wizard.
  private _editionConfirmed = Observable.create<boolean>(this, !!this._options.inAdminPanel);
  private _downgradeConfirming = Observable.create<boolean>(this, false);

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

    const notifier = this._options.notifier;
    this._toggleEnterprise = notifier ?
      ToggleEnterpriseWidget.create(this, notifier) :
      null;

    this._serverEdition.set(
      overrides.initialServerEdition ??
      (this._supportsExtFullEdition ?
        (getGristConfig().deploymentType === "enterprise" ? "enterprise" : "core") :
        (this._toggleEnterprise?.getEnterpriseToggleObservable().get() ? "enterprise" : "core")),
    );

    // In admin-panel mode, start selection at the server's current edition so
    // the section isn't dirty before the user acts. In wizard mode, default to
    // Full Grist when available; the user can change it via the buttons.
    // Done here rather than in `_buildSelector` so a re-render can't reset it.
    this._selectedEdition.set(this._options.inAdminPanel || this._supportsExtFullEdition ?
      this._serverEdition.get() :
      this.fullGristAvailable ? "enterprise" : "core",
    );

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
      return cssValueLabel(cssHappyText(t("On")));
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

  // Admin panel dom (but the first part is shared with the wizard).
  public buildDom(): DomContents {
    const toggle = this._toggleEnterprise;
    if (this.editionForced || !this.fullGristAvailable) {
      return cssSectionContainer(this._buildCore(), testId("section"));
    }
    return cssSectionContainer(
      dom.domComputed(this._serverEdition, (edition) => {
        if (edition === "enterprise" && toggle) {
          return [
            this._buildFullGristHeader(),
            toggle.buildEnterpriseSection(),
            cssDivider(),
            this._buildDowngrade(),
          ];
        }
        return this._buildCommunityView();
      }),
      dom.maybe(this.isDirty, () => cssPendingRestart(
        icon("Warning"),
        t("Restart Grist to apply this change."),
        testId("pending"),
      )),
      testId("section"),
    );
  }

  // Wizard dom
  public buildWizardDom(): DomContents {
    return cssSectionContainer(
      this._buildCore(),
      // No confirmed row when edition is forced by env -- nothing to edit.
      this.editionForced ? null : buildConfirmedRow(
        this._editionConfirmed,
        () => { this._editionConfirmed.set(false); },
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
      await retryOnNetworkError(() =>
        this._installAPI.updateInstallPrefs({ useExtFullEdition: selected === "enterprise" }));
    } else {
      await this._configAPI.setValue({ edition: selected });
    }
    this._serverEdition.set(selected);
  }

  public get restartWaitAttempts(): number | undefined {
    if (!this._supportsExtFullEdition) { return undefined; }

    // Switching to full edition requires a 100 MB+ download that the server may
    // retry a few times, so wait longer.
    return this._selectedEdition.get() === "enterprise" ? 3600 : 120;
  }

  public pendingEditionSwitch(): "enable" | "disable" | null {
    if (!this._supportsExtFullEdition || !this.isDirty.get()) { return null; }

    return this._selectedEdition.get() === "enterprise" ? "enable" : "disable";
  }

  public async dismiss(): Promise<void> {
    if (!this.isDirty.get()) { return; }
    this._selectedEdition.set(this._serverEdition.get());
  }

  private _buildFullGristHeader(): DomContents {
    return [
      cssEditionName(t("Full Grist")),
      cssSectionDescription(t(`This server runs the full edition of Grist, with advanced security, \
governance, MCP server, automations, email notifications, and collaboration features.`)),
    ];
  }

  // Staging "core" flips the section dirty; the draft bar handles restart, dismiss() reverts it.
  private _buildDowngrade(): DomContents {
    return dom.domComputed(this._downgradeConfirming, (confirming) => {
      if (!confirming) {
        return cssDowngradeLink(
          t("Downgrade to Community Edition"),
          dom.on("click", () => this._downgradeConfirming.set(true)),
          testId("downgrade"),
        );
      }
      return [
        cssDowngradePrompt(
          t("Downgrade to Community edition? Full Grist features are disabled after restart. \
This is reversible."),
          testId("downgrade-prompt"),
        ),
        cssDowngradeButtons(
          primaryButton(
            t("Downgrade"),
            dom.on("click", () => {
              this._selectedEdition.set("core");
              this._downgradeConfirming.set(false);
            }),
            testId("downgrade-confirm"),
          ),
          basicButton(
            t("Cancel"),
            dom.on("click", () => this._downgradeConfirming.set(false)),
            testId("downgrade-cancel"),
          ),
        ),
      ];
    });
  }

  private _buildCommunityView(): DomContents {
    return [
      cssEditionName(t("Community")),
      cssSectionDescription(t("You are running the Grist Community edition.")),
      cssSectionDescription(t("For automations, MCP server, AI assistant, OIDC/SAML support, email \
notifications, admin controls, audit logging and more, switch to the full Grist edition.")),
      cssSectionDescription(
        t("{{freeKeysLink}} are available to individuals and small orgs under US $1 million total annual \
funding. For larger orgs, see {{pricingLink}}.", {
          freeKeysLink: cssLink(
            { href: commonUrls.helpEnterpriseOptIn, target: "_blank" },
            t("Free activation keys"),
          ),
          pricingLink: cssLink({ href: commonUrls.plans, target: "_blank" }, t("pricing")),
        }),
      ),
      cssSwitchRow(
        primaryButton(
          t("Switch to Full Grist"),
          dom.on("click", () => this._selectedEdition.set("enterprise")),
          testId("switch-to-full"),
        ),
      ),
    ];
  }

  /**
   * Shared core: description, edition selector tabs, per-selection text.
   * Used by both admin panel and wizard.
   */
  private _buildCore(): DomContents {
    if (this.editionForced) {
      this._editionConfirmed.set(true);
      return cssSectionDescription(t("Full Grist is enabled via environment variable."));
    }

    if (!this.fullGristAvailable && !this._supportsExtFullEdition) {
      return this._buildUnavailableCore();
    }

    return this._buildSelector();
  }

  private _buildSelector(): DomContents {
    const selectedEdition = this._selectedEdition;
    return [
      cssSectionDescription(
        t("Choose which edition of Grist to run on this server."),
      ),
      cssEditionButtons(
        cssEditionButton(
          t("Full Grist"),
          cssEditionButton.cls("-selected", use => use(selectedEdition) === "enterprise"),
          dom.on("click", () => { selectedEdition.set("enterprise"); this._editionConfirmed.set(false); }),
          testId("full-grist"),
        ),
        cssEditionButton(
          t("Community edition"),
          cssEditionButton.cls("-selected", use => use(selectedEdition) === "core"),
          dom.on("click", () => { selectedEdition.set("core"); this._editionConfirmed.set(false); }),
          testId("community"),
        ),
      ),
      dom.domComputed((use) => {
        const ed = use(selectedEdition);
        if (ed === "enterprise") {
          return [
            cssSectionDescription(
              t("The full Grist experience, with all features enabled for improved security, \
governance, and collaboration."),
            ),
            !this.editionForced && use(this._serverEdition) !== "enterprise" ? cssSectionDescription(
              t("You have 30 days to enter an activation key. Free activation keys are available \
to individuals and small orgs with less than US $1 million in total annual funding. \
{{learnMoreLink}} For larger orgs, see {{pricingLink}}.", {
                learnMoreLink: cssLink(
                  { href: commonUrls.helpEnterpriseOptIn, target: "_blank" },
                  t("Learn more."),
                ),
                pricingLink: cssLink({ href: commonUrls.plans, target: "_blank" }, t("pricing")),
              }),
            ) : null,
            this._supportsExtFullEdition && use(this._serverEdition) === "core" ?
              cssSectionDescription(
                t("Switching downloads the full edition and restarts the server."),
              ) : null,
          ];
        }
        return [
          cssSectionDescription(
            t("The free and open-source heart of Grist, with everything you need to open and edit \
Grist documents, control access, create forms, connect to single sign-on (SSO) \
providers, and much more."),
          ),
          this._supportsExtFullEdition && use(this._serverEdition) === "enterprise" ?
            cssSectionDescription(
              t("Switching to the community edition restarts the server."),
            ) : null,
        ];
      }),
      dom.domComputed((use) => {
        if (use(this._editionConfirmed)) { return null; }

        const selected = use(selectedEdition);
        if (selected === null) { return null; }

        if (this._supportsExtFullEdition && selected !== use(this._serverEdition)) {
          const enabling = selected === "enterprise";
          return cssSectionButtonRow(
            primaryButton(
              enabling ? t("Switch to full edition") : t("Switch to community edition"),
              dom.on("click", () => this._confirmExtFullEditionSwitch(enabling)),
            ),
          );
        }
        return cssSectionButtonRow(
          primaryButton(
            t("Confirm edition"),
            dom.on("click", () => { this._editionConfirmed.set(true); }),
            testId("confirm"),
          ),
        );
      }),
    ];
  }

  private _confirmExtFullEditionSwitch(enabling: boolean): void {
    const title = enabling ? t("Switch to full edition") : t("Switch to community edition");
    const description = extFullEditionSwitchWarning(enabling ? "enable" : "disable");
    confirmModal(
      title,
      [t("Switch"), testId("confirm-switch")],
      () => { this._editionConfirmed.set(true); },
      { explanation: cssSectionDescription(description) },
    );
  }

  private _buildUnavailableCore(): DomContents {
    const selectedTab = Observable.create(this, "core");
    return [
      cssSectionDescription(
        t("Choose which edition of Grist to run on this server."),
      ),
      cssEditionButtons(
        cssEditionButton(
          t("Full Grist"),
          cssEditionButton.cls("-selected", use => use(selectedTab) === "enterprise"),
          dom.on("click", () => { selectedTab.set("enterprise"); this._editionConfirmed.set(false); }),
          testId("full-grist"),
        ),
        cssEditionButton(
          t("Community edition"),
          cssEditionButton.cls("-selected", use => use(selectedTab) === "core"),
          dom.on("click", () => { selectedTab.set("core"); this._editionConfirmed.set(false); }),
          testId("community"),
        ),
      ),
      dom.domComputed(selectedTab, (tab) => {
        if (tab === "enterprise") {
          return [
            cssSectionDescription(
              t("The full Grist experience, with all features enabled for improved security, \
governance, and collaboration."),
            ),
            cssSectionDescription(
              t("Your installation does not bundle the Full Grist edition. \
Want Full Grist? {{enableLink}}", {
                enableLink: cssLink(
                  { href: commonUrls.helpEnterpriseOptIn, target: "_blank" },
                  t("See how to enable it."),
                ),
              }),
            ),
            dom.maybe(use => !use(this._editionConfirmed), () =>
              labeledSquareCheckbox(this._editionConfirmed,
                t("I understand I am running Grist Community edition"),
                testId("acknowledge"),
              ),
            ),
          ];
        }
        return [
          cssSectionDescription(
            t("The free and open-source heart of Grist, with everything you need to open and edit \
Grist documents, control access, create forms, connect to single sign-on (SSO) \
providers, and much more."),
          ),
          dom.maybe(use => !use(this._editionConfirmed), () => cssSectionButtonRow(
            primaryButton(
              t("Confirm edition"),
              dom.on("click", () => {
                this._editionConfirmed.set(true);
              }),
              testId("confirm"),
            ),
          )),
        ];
      }),
    ];
  }
}

export function extFullEditionSwitchWarning(kind: "enable" | "disable"): string {
  return kind === "enable" ?
    t("Switching downloads a complete copy of the full edition and restarts the server. The \
server will be unavailable until the download completes, which can take a while.") :
    t("Switching restarts the server, which may be briefly unavailable.");
}

export function extFullEditionSwitchModal<T>(promise: Promise<T>): Promise<T> {
  return spinnerModal(
    t("Switching edition..."),
    promise,
    { body: [
      t("Your server will restart automatically. This can take a while."),
      testId("switching"),
    ] },
  );
}

const cssEditionName = styled("div", `
  font-weight: 700;
  font-size: 18px;
  margin-bottom: 4px;
`);

const cssDowngradeLink = styled("div", `
  color: ${tokens.secondary};
  cursor: pointer;
  font-size: ${tokens.smallFontSize};
  width: fit-content;
  &:hover {
    color: ${tokens.body};
  }
`);

const cssDivider = styled("div", `
  border-top: 1px solid ${theme.widgetBorder};
`);

const cssDowngradePrompt = styled("div", `
  color: ${tokens.secondary};
  margin-top: 8px;
`);

const cssDowngradeButtons = styled(cssSectionButtonRow, `
  margin-top: 8px;
`);

const cssSwitchRow = styled("div", `
  margin-top: 8px;
`);

const cssPendingRestart = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  color: ${theme.dangerText};
  --icon-color: ${theme.dangerText};
  font-size: ${tokens.smallFontSize};
`);

const cssEditionButtons = styled("div", `
  background: ${tokens.bgTertiary};
  border-radius: 10px;
  display: flex;
  column-gap: 3px;
  margin-bottom: 16px;
  padding: 3px;
`);

const cssEditionButton = styled(unstyledButton, `
  border-radius: 7px;
  color: ${tokens.secondary};
  cursor: pointer;
  flex: 1;
  font-weight: 500;
  padding: 8px 6px;
  text-align: center;
  transition: color 0.2s, background 0.2s, box-shadow 0.2s;

  &:hover, &-selected {
    color: ${tokens.body};
  }

  &:focus-visible {
    outline: 3px solid ${tokens.primary};
    outline-offset: 2px;
  }

  &-selected {
    background: ${tokens.bg};
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.15),
      0 1px 2px rgba(0, 0, 0, 0.1);
    font-weight: 600;
  }

  &-disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`);
