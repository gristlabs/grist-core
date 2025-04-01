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
import {IGristUrlState} from 'app/common/gristUrls';
import {commonUrls} from 'app/common/gristUrls';
import {getGristConfig} from "app/common/urlUtils";
import {Computed, dom, MultiHolder, Observable, styled} from 'grainjs';

const t = makeT('AdminPanel');
const testId = makeTestId('test-admin-controls-');

// Check if the AdminControls feature is available, so that we can show it as such in the UI.
export function areAdminControlsAvailable(): boolean {
  return Boolean(getGristConfig().adminControls);
}

export function buildAdminLeftPanel(owner: MultiHolder, appModel: AppModel): PageSidePanel {
  const panelOpen = Observable.create(owner, true);
  const pageObs = Computed.create(owner, use => use(urlState().state).adminPanel);

  function buildPageEntry(name: string, icon: IconName, state: IGristUrlState, available: boolean = true) {
    return css.cssPageEntry(
      css.cssPageEntry.cls('-selected', use => use(pageObs) === state.adminPanel),
      css.cssPageEntry.cls('-disabled', !available),
      css.cssPageLink(
        css.cssPageIcon(icon),
        css.cssLinkText(name),
        available ? urlState().setLinkUrl(state) : null,    // Disable link if page isn't available.
      ),
      testId('page-' + state.adminPanel),
      testId('page'),
    );
  }

  const adminControlsAvailable = areAdminControlsAvailable();
  const content = css.leftPanelBasic(appModel, panelOpen,
    dom('div',
      css.cssTools.cls('-collapsed', (use) => !use(panelOpen)),
      css.cssSectionHeader(css.cssSectionHeaderText(t("Admin area"))),
      buildPageEntry(t('Installation'), 'Home', {adminPanel: 'admin'}),
      css.cssSectionHeader(css.cssSectionHeaderText(t("Admin controls")),
        (adminControlsAvailable ?
          infoTooltip('adminControls', {popupOptions: {placement: 'bottom-start'}}) :
          cssEnterprisePill('Enterprise', testId('enterprise-tag'))
        )
      ),
      buildPageEntry(t('Users'), 'AddUser', {adminPanel: 'users'}, adminControlsAvailable),
      buildPageEntry(t('Orgs'), 'Public', {adminPanel: 'orgs'}, adminControlsAvailable),
      buildPageEntry(t('Workspaces'), 'Board', {adminPanel: 'workspaces'}, adminControlsAvailable),
      buildPageEntry(t('Docs'), 'Page', {adminPanel: 'docs'}, adminControlsAvailable),
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
