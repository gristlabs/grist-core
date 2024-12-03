import { buildHomeBanners } from "app/client/components/Banners";
import { makeT } from "app/client/lib/localization";
import { AppModel, reportError } from "app/client/models/AppModel";
import { AuditLogsModel } from "app/client/models/AuditLogsModel";
import { urlState } from "app/client/models/gristUrlState";
import { AppHeader } from "app/client/ui/AppHeader";
import { AuditLogStreamingConfig } from "app/client/ui/AuditLogStreamingConfig";
import { OrgConfigsAPI } from "app/client/ui/ConfigsAPI";
import { createForbiddenPage, createNotFoundPage } from "app/client/ui/errorPages";
import { leftPanelBasic } from "app/client/ui/LeftPanelCommon";
import { pagePanels } from "app/client/ui/PagePanels";
import { createTopBarHome } from "app/client/ui/TopBar";
import { cssBreadcrumbs, separator } from "app/client/ui2018/breadcrumbs";
import { textButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { cssLink } from "app/client/ui2018/links";
import { commonUrls, getPageTitleSuffix } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";
import {
  Computed,
  Disposable,
  dom,
  makeTestId,
  Observable,
  styled,
  subscribe,
} from "grainjs";

const t = makeT("AuditLogsPage");

const testId = makeTestId("test-audit-logs-page-");

export class AuditLogsPage extends Disposable {
  private readonly _model = new AuditLogsModel({
    configsAPI: new OrgConfigsAPI(this._appModel.currentOrg!.id),
  });
  private readonly _currentPage = Computed.create(
    this,
    urlState().state,
    (_use, s) => s.auditLogs
  );

  constructor(private _appModel: AppModel) {
    super();
    this._setTitle();
  }

  public buildDom() {
    const { deploymentType } = getGristConfig();
    if (
      !this._appModel.isTeamSite ||
      !deploymentType ||
      !["saas", "core", "enterprise"].includes(deploymentType)
    ) {
      return createNotFoundPage(this._appModel);
    }
    if (!this._appModel.isOwner()) {
      return createForbiddenPage(
        this._appModel,
        t("Only site owners may access audit logs.")
      );
    }

    const panelOpen = Observable.create(this, false);
    return pagePanels({
      leftPanel: {
        panelWidth: Observable.create(this, 240),
        panelOpen,
        hideOpener: true,
        header: dom.create(AppHeader, this._appModel),
        content: leftPanelBasic(this._appModel, panelOpen),
      },
      headerMain: this._buildHeader(),
      contentTop: buildHomeBanners(this._appModel),
      contentMain: this._buildContent(),
    });
  }

  private _buildHeader() {
    return dom.frag(
      cssBreadcrumbs(
        { style: "margin-left: 16px;" },
        cssLink(urlState().setLinkUrl({}), t("Home"), testId("home")),
        separator(" / "),
        dom("span", t("Audit Logs"))
      ),
      createTopBarHome(this._appModel)
    );
  }

  private _buildContent() {
    return cssScrollablePage(
      cssPageContent(
        cssPageTitle(
          t("Audit logs for {{siteName}}", {
            siteName: this._appModel.currentOrgName,
          })
        ),
        cssSection(
          cssSectionTitle(t("Log streaming")),
          cssSectionBody(this._buildLogStreamingConfig())
        )
      )
    );
  }

  private _buildLogStreamingConfig() {
    const { deploymentType } = getGristConfig();
    if (deploymentType === "core") {
      return t(
        "You can set up streaming of audit events from Grist to an external " +
          "SIEM (security information and event management) system if you " +
          "enable Grist Enterprise. {{contactUsLink}} to learn more.",
        {
          contactUsLink: cssLink(
            { href: commonUrls.contact, target: "_blank" },
            t("Contact us")
          ),
        }
      );
    } else if (
      deploymentType === "saas" &&
      !this._appModel.currentFeatures?.teamAuditLogs
    ) {
      return t(
        "You can set up streaming of audit events from Grist to an external " +
          "SIEM (security information and event management) system if you " +
          "{{upgradePlanButton}}.",
        {
          upgradePlanButton: textButton(
            dom.on("click", () => this._appModel.showUpgradeModal()),
            t("upgrade your plan")
          ),
        }
      );
    } else {
      this._model.fetchStreamingDestinations().catch(reportError);
      return dom.create(AuditLogStreamingConfig, this._model);
    }
  }

  private _setTitle() {
    this.autoDispose(
      subscribe(this._currentPage, (_use, page): string => {
        const suffix = getPageTitleSuffix(getGristConfig());
        switch (page) {
          case undefined:
          case "audit-logs": {
            return (document.title = t("Audit Logs") + suffix);
          }
        }
      })
    );
  }
}

const cssScrollablePage = styled("div", `
  overflow: auto;
`);

const cssPageContent = styled("div", `
  color: ${theme.text};
  margin: 32px auto;
  max-width: 600px;
  padding: 24px;
`);

const cssPageTitle = styled("div", `
  height: 32px;
  line-height: 32px;
  margin-bottom: 16px;
  font-size: ${vars.headerControlFontSize};
  font-weight: ${vars.headerControlTextWeight};
`);

const cssSection = styled("div", `
  font-size: ${vars.introFontSize};
`);

const cssSectionTitle = styled("div", `
  font-weight: bold;
  font-size: ${vars.largeFontSize};
  margin-bottom: 16px;
`);

const cssSectionBody = styled("div", ``);
