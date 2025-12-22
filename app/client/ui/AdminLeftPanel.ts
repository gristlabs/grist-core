import {makeTestId} from 'app/client/lib/domUtils';
import {makeT} from 'app/client/lib/localization';
import type {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import * as css from 'app/client/ui/LeftPanelCommon';
import {PageSidePanel} from 'app/client/ui/PagePanels';
import {AppHeader} from 'app/client/ui/AppHeader';
import {infoTooltip} from 'app/client/ui/tooltips';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {IconName} from 'app/client/ui2018/IconList';
import {cssLink} from 'app/client/ui2018/links';
import {AdminPanelPage} from 'app/common/gristUrls';
import {commonUrls} from 'app/common/gristUrls';
import {getGristConfig} from "app/common/urlUtils";
import {Computed, dom, DomContents, MultiHolder, Observable, styled} from 'grainjs';

const t = makeT('AdminPanel');
const testId = makeTestId('test-admin-controls-');

// Check if the AdminControls feature is available, so that we can show it as such in the UI.
export function areAdminControlsAvailable(): boolean {
  return Boolean(getGristConfig().adminControls);
}

// Collects and exposes translations, used for buildAdminLeftPanel() below, and for breadcrumbs in
// AdminPanel.ts.
export function getPageNames() {
  const settings: DomContents = t('Settings');
  const adminControls: DomContents = t('Admin Controls');
  return {
    settings,
    adminControls,
    pages: {
      admin: {section: settings, name: t('Installation')},
      users: {section: adminControls, name: t('Users')},
      orgs: {section: adminControls, name: t('Orgs')},
      workspaces: {section: adminControls, name: t('Workspaces')},
      docs: {section: adminControls, name: t('Docs')},
    } as {[key in AdminPanelPage]: {section: DomContents, name: DomContents}}
  };
}

export function buildAdminLeftPanel(owner: MultiHolder, appModel: AppModel): PageSidePanel {
  const panelOpen = Observable.create(owner, true);
  const pageObs = Computed.create(owner, use => use(urlState().state).adminPanel);
  const pageNames = getPageNames();

  function buildPageEntry(page: AdminPanelPage, icon: IconName, available: boolean = true) {
    return css.cssPageEntry(
      css.cssPageEntry.cls('-selected', use => use(pageObs) === page),
      css.cssPageEntry.cls('-disabled', !available),
      css.cssPageLink(
        css.cssPageIcon(icon),
        css.cssLinkText(pageNames.pages[page].name),
        available ? urlState().setLinkUrl({adminPanel: page}) : null,    // Disable link if page isn't available.
      ),
      testId('page-' + page),
      testId('page'),
    );
  }

  const adminControlsAvailable = areAdminControlsAvailable();
  const content = css.leftPanelBasic(appModel, panelOpen,
    dom('div',
      css.cssTools.cls('-collapsed', use => !use(panelOpen)),
      css.cssSectionHeader(css.cssSectionHeaderText(pageNames.settings)),
      buildPageEntry('admin', 'Home'),
      css.cssSectionHeader(css.cssSectionHeaderText(pageNames.adminControls),
        (adminControlsAvailable ?
          infoTooltip('adminControls', {popupOptions: {placement: 'bottom-start'}}) :
          cssEnterprisePill('Enterprise', testId('enterprise-tag'))
        )
      ),
      buildPageEntry('users', 'AddUser', adminControlsAvailable),
      buildPageEntry('orgs', 'Public', adminControlsAvailable),
      buildPageEntry('workspaces', 'Board', adminControlsAvailable),
      buildPageEntry('docs', 'Page', adminControlsAvailable),
      (adminControlsAvailable ? null :
        cssPanelLink(cssLearnMoreLink(
          {href: commonUrls.helpAdminControls, target: "_blank"},
          t("Learn more"), css.cssPageIcon('FieldLink'),
          testId('learn-more'),
        ))
      ),
    )
  );

  return {
    panelWidth: Observable.create(owner, 240),
    panelOpen: panelOpen,
    content,
    header: dom.create(AppHeader, appModel),
  };
}

const cssEnterprisePill = styled('div', `
  display: inline;
  padding: 2px 4px;
  margin: 0 8px;
  border-radius: 4px;
  vertical-align: middle;
  font-size: ${vars.smallFontSize};
  background-color: ${colors.orange};
  color: white;
`);

const cssPanelLink = styled('div', `
  margin: 8px 24px;
  .${css.cssTools.className}-collapsed > & {
    visibility: hidden;
  }
`);

const cssLearnMoreLink = styled(cssLink, `
  display: inline-flex;
  gap: 8px;
  align-items: center;
`);
