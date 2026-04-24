import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { Notifier } from "app/client/models/NotifyModel";
import { showEnterpriseToggle } from "app/client/ui/ActivationPage";
import {
  AdminPanelControls,
  buildConfirmedRow,
  cssHappyText,
  cssSectionButtonRow,
  cssSectionContainer,
  cssSectionDescription,
  cssValueLabel,
} from "app/client/ui/AdminPanelCss";
import { ConfigSection } from "app/client/ui/DraftChanges";
import { ToggleEnterpriseWidget } from "app/client/ui/ToggleEnterpriseWidget";
import { primaryButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { cssLink } from "app/client/ui2018/links";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { ConfigAPI } from "app/common/ConfigAPI";
import { commonUrls } from "app/common/gristUrls";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled } from "grainjs";

const t = makeT("EditionSection");
const testId = makeTestId("test-edition-");

type Edition = "enterprise" | "core";

interface EditionSectionOptions {
  controls?: AdminPanelControls;
  notifier?: Notifier;
  /** Override runtime detection of edition availability; used by storybook. */
  availability?: {
    fullGristAvailable: boolean;
    communityAvailable: boolean;
  };
}

export class EditionSection extends Disposable implements ConfigSection {
  /**
   * Short description shown next to the item name in the admin panel
   * collapsed row. Exposed so stubs (e.g. the legacy "Enterprise" item)
   * can use the same wording without duplication.
   */
  public static description(): string {
    return t("Choose which edition of Grist to run on this server");
  }

  public canProceed: Computed<boolean>;
  public isDirty: Computed<boolean>;

  public readonly fullGristAvailable: boolean;
  public readonly communityAvailable: boolean;
  public readonly editionForced: boolean;
  public readonly needsRestart = true;

  private _selectedEdition = Observable.create<Edition | null>(this, null);
  private _serverEdition = Observable.create<Edition>(this, "core");
  // Pre-confirmed in admin-panel mode so the confirm/edit flow only runs in the wizard.
  private _editionConfirmed = Observable.create<boolean>(this, !!this._options.controls);

  // Only created in admin-panel mode (requires a notifier).
  private _toggleEnterprise: ToggleEnterpriseWidget | null;
  private _configAPI = new ConfigAPI(getHomeUrl());

  constructor(private _options: EditionSectionOptions = {}) {
    super();

    if (_options.availability) {
      this.fullGristAvailable = _options.availability.fullGristAvailable;
      this.communityAvailable = _options.availability.communityAvailable;
    } else {
      this.fullGristAvailable = showEnterpriseToggle();
      this.communityAvailable = true;
    }

    this.editionForced = !!getGristConfig().forceEnableEnterprise;

    const notifier = this._options.notifier;
    this._toggleEnterprise = notifier ?
      ToggleEnterpriseWidget.create(this, notifier) :
      null;

    this._serverEdition.set(
      this._toggleEnterprise?.getEnterpriseToggleObservable().get() ? "enterprise" : "core",
    );

    // In admin-panel mode, start selection at the server's current edition so
    // the section isn't dirty before the user acts. In wizard mode, default to
    // Full Grist when available (or when community isn't); the user can change
    // it via the buttons. Done here rather than in `_buildSelector` so a
    // re-render can't reset it.
    this._selectedEdition.set(this._options.controls ?
      this._serverEdition.get() :
      (this.fullGristAvailable || !this.communityAvailable) ? "enterprise" : "core",
    );

    this.canProceed = Computed.create(this, use => use(this._editionConfirmed));
    this.isDirty = Computed.create(this, (use) => {
      if (!use(this._editionConfirmed)) { return false; }
      const selected = use(this._selectedEdition);
      if (selected === null) { return false; }
      return selected !== use(this._serverEdition);
    });
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

  public buildDom(): DomContents {
    return cssSectionContainer(
      this._buildCore(),
      this.fullGristAvailable && !this.editionForced && this._toggleEnterprise ?
        this._toggleEnterprise.buildEnterpriseSection() :
        null,
      testId("section"),
    );
  }

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

  /** Undefined in wizard mode (no ToggleEnterpriseWidget). */
  public getEnterpriseToggleObservable() {
    return this._toggleEnterprise?.getEnterpriseToggleObservable();
  }

  /** Null on community builds (no `/api/activation/status` endpoint). */
  public getInstallationIdObservable() {
    return this._toggleEnterprise?.getInstallationIdObservable() ?? null;
  }

  public async apply() {
    if (!this.isDirty.get()) { return; }
    const selected = this._selectedEdition.get();
    if (!selected) { return; }
    await this._configAPI.setValue({ edition: selected });
    this._serverEdition.set(selected);
  }

  public describeChange() {
    const selected = this._selectedEdition.get();
    return {
      label: t("Edition"),
      value: selected === "enterprise" ? t("Full Grist") : t("Community Edition"),
    };
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

    if (!this.fullGristAvailable) {
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
          t("Community Edition"),
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
          ];
        }
        if (!this.communityAvailable) {
          return [
            cssSectionDescription(
              t("The free and open-source heart of Grist, with everything you need to open and edit \
Grist documents, control access, create forms, connect to single sign-on (SSO) \
providers, and much more."),
            ),
            cssSectionDescription(
              t("Community Edition is not available in this installation."),
            ),
          ];
        }
        return cssSectionDescription(
          t("The free and open-source heart of Grist, with everything you need to open and edit \
Grist documents, control access, create forms, connect to single sign-on (SSO) \
providers, and much more."),
        );
      }),
      dom.domComputed((use) => {
        const ed = use(selectedEdition);
        const confirmed = use(this._editionConfirmed);
        if (ed === "core" && !this.communityAvailable) { return null; }
        if (confirmed) { return null; }
        return cssSectionButtonRow(
          primaryButton(
            t("Confirm edition"),
            dom.on("click", () => {
              this._editionConfirmed.set(true);
            }),
            testId("confirm"),
          ),
        );
      }),
    ];
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
          t("Community Edition"),
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
                t("I understand I am running Grist Community Edition"),
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
