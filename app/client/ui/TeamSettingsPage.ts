import { makeT } from "app/client/lib/localization";
import { AppModel, reportError } from "app/client/models/AppModel";
import { urlState } from "app/client/models/gristUrlState";
import { AppHeader } from "app/client/ui/AppHeader";
import { BillingLogoEditor } from "app/client/ui/BillingLogoEditor";
import { leftPanelBasic } from "app/client/ui/LeftPanelCommon";
import { pagePanels } from "app/client/ui/PagePanels";
import { createTopBarHome } from "app/client/ui/TopBar";
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { isOrgInPathOnly } from "app/common/gristUrls";
import { tokens } from "app/common/ThemePrefs";
import { getGristConfig } from "app/common/urlUtils";

import { Disposable, dom, input, Observable, styled } from "grainjs";

const t = makeT("TeamSettingsPage");

export class TeamSettingsPage extends Disposable {
  private _editMode = Observable.create(this, false);
  private _name = Observable.create(this, "");
  private _domain = Observable.create(this, "");
  private _saving = Observable.create(this, false);
  private _error = Observable.create(this, "");

  constructor(private _appModel: AppModel) {
    super();
  }

  public buildDom() {
    const org = this._appModel.currentOrg;
    if (!org || !this._appModel.isTeamSite) { return dom("div", "No org or not a team site"); }

    const panelOpen = Observable.create(this, false);
    return pagePanels({
      leftPanel: {
        panelWidth: Observable.create(this, 240),
        panelOpen,
        hideOpener: true,
        header: dom.create(AppHeader, this._appModel),
        content: leftPanelBasic(this._appModel, panelOpen),
      },
      headerMain: createTopBarHome(this._appModel),
      contentMain: this._buildMainContent(),
    });
  }

  private _onChangeInfoClick() {
    const org = this._appModel.currentOrg!;
    this._name.set(org.name);
    this._domain.set(org.domain ?? "");
    this._error.set("");
    this._editMode.set(true);
  }

  private _onBack() {
    this._editMode.set(false);
  }

  private async _changeLogo(url: string) {
    const org = this._appModel.currentOrg!;
    await this._appModel.api.updateOrg(org.id, { orgPrefs: { customLogoUrl: url || null } });
    this._appModel.topAppModel.initialize();
  }

  private _buildOrgUrl(domain: string): (string | HTMLElement)[] {
    const { baseDomain, homeUrl } = getGristConfig();
    if (baseDomain && !isOrgInPathOnly()) {
      return [dom("strong", domain), baseDomain];
    }
    const base = (homeUrl ?? "").replace(/\/$/, "");
    return [`${base}/o/`, dom("strong", domain)];
  }

  private async _save() {
    const org = this._appModel.currentOrg!;
    this._saving.set(true);
    this._error.set("");
    try {
      const newDomain = this._domain.get();
      const domainChanged = newDomain !== org.domain;
      if (domainChanged) {
        const check = await this._appModel.api.checkDomain(newDomain);
        if (!check.valid) {
          this._saving.set(false);
          this._error.set(t("Invalid domain."));
          return;
        } else if (!check.available) {
          this._saving.set(false);
          this._error.set(t("Domain is already taken."));
          return;
        }
      }
      await this._appModel.api.updateOrg(org.id, { name: this._name.get(), domain: newDomain });
      if (domainChanged) {
        window.location.assign(urlState().makeUrl({ org: newDomain, siteSettings: "site-settings" }));
      } else {
        // order here matters, the `initialize` call will dispose lot of things.
        this._saving.set(false);
        this._editMode.set(false);
        this._appModel.topAppModel.initialize();
      }
    } catch (e) {
      this._saving.set(false);
      this._error.set((e as Error).message);
    }
  }

  private _buildMainContent() {
    return cssPage(
      dom.domComputed(this._editMode, editing =>
        editing ? this._buildEditView() : this._buildSummaryView(),
      ),
    );
  }

  private _buildSummaryView() {
    const org = this._appModel.currentOrg!;
    return cssCard(
      testId("ts-page"),
      cssTitle("Site settings"),
      cssSummaryColumns(
        dom("div",
          cssSectionHeader("Team Info"),
          cssInfoRow("Your team name: ", dom("strong", org.name, testId("ts-name"))),
          org.domain ? cssInfoRow("Your team site URL: ",
            ...this._buildOrgUrl(org.domain),
          ) : null,
          cssChangeButton(
            dom.on("click", () => this._onChangeInfoClick()),
            icon("Settings"),
            " Change info",
            testId("ts-change"),
          ),
        ),
        dom("div",
          cssSectionHeader("Custom Logo"),
          dom.create(BillingLogoEditor,
            org.orgPrefs?.customLogoUrl,
            (url: string) => this._changeLogo(url).catch(reportError),
          ),
        ),
      ),
    );
  }

  private _buildEditView() {
    const org = this._appModel.currentOrg!;
    return cssCard(
      testId("ts-edit"),
      cssTitle("Update Name"),
      cssField(
        cssLabel("Team name"),
        cssInput(this._name, { onInput: true }, testId("ts-name-input")),
      ),
      cssField(
        cssLabel("Team subdomain"),
        cssDomainRow(
          cssInput(this._domain, { onInput: true },
            testId("ts-domain-input"),
          ),
          cssDomainSuffix(getGristConfig().baseDomain ?? ""),
        ),
        dom.maybe(use => use(this._domain) !== org.domain, () =>
          cssDomainWarning("Any saved links will need updating if the URL changes"),
        ),
        dom.maybe(this._error, msg => cssError(msg)),
      ),
      cssButtons(
        bigBasicButton("Back",
          dom.on("click", () => this._onBack()),
          dom.boolAttr("disabled", this._saving),
          testId("ts-back"),
        ),
        bigPrimaryButton("Update Name",
          dom.on("click", () => this._save()),
          dom.boolAttr("disabled", this._saving),
          testId("ts-save"),
        ),
      ),
    );
  }
}

const cssPage = styled("div", `
  padding: 32px 48px;
  max-width: 720px;
`);

const cssCard = styled("div", `
  border-radius: 8px;
  padding: 24px;
`);

const cssTitle = styled("div", `
  font-size: 24px;
  font-weight: 600;
  color: ${theme.text};
  margin-bottom: 24px;
`);

const cssSectionHeader = styled("div", `
  font-size: ${vars.mediumFontSize};
  font-weight: 600;
  color: ${theme.text};
  margin-bottom: 12px;
`);

const cssInfoRow = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  margin-bottom: 6px;
`);

const cssChangeButton = styled("div", `
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  cursor: pointer;
  font-size: ${vars.mediumFontSize};
  &:hover { text-decoration: underline; }
`);

const cssSummaryColumns = styled("div", `
  display: flex;
  gap: 48px;
`);

const cssField = styled("div", `
  margin-bottom: 16px;
`);

const cssLabel = styled("div", `
  font-size: ${vars.mediumFontSize};
  font-weight: 500;
  color: ${theme.text};
  margin-bottom: 6px;
`);

const cssInput = styled(input, `
  width: 100%;
  padding: 8px 10px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 4px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  outline: none;
  box-sizing: border-box;
  &:focus { border-color: ${theme.controlFg}; }
`);

const cssDomainRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
`);

const cssDomainSuffix = styled("div", `
  font-size: ${vars.mediumFontSize};
  color: ${theme.lightText};
  white-space: nowrap;
`);

const cssButtons = styled("div", `
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
`);

const cssError = styled("div", `
  color: ${theme.errorText};
  font-size: ${vars.smallFontSize};
  margin-top: 4px;
`);

const cssDomainWarning = styled("div", `
  color: ${tokens.warningLight};
  font-size: ${vars.smallFontSize};
  margin-top: 4px;
`);
