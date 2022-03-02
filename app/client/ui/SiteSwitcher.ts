import {commonUrls, getSingleOrg} from 'app/common/gristUrls';
import {getOrgName} from 'app/common/UserAPI';
import {dom, makeTestId, styled} from 'grainjs';
import {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {menuDivider, menuIcon, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {icon} from 'app/client/ui2018/icons';
import {colors} from 'app/client/ui2018/cssVars';

const testId = makeTestId('test-site-switcher-');

/**
 * Adds a menu divider and a site switcher, if there is need for one.
 */
export function maybeAddSiteSwitcherSection(appModel: AppModel) {
  const orgs = appModel.topAppModel.orgs;
  return dom.maybe((use) => use(orgs).length > 0 && !getSingleOrg(), () => [
    menuDivider(),
    buildSiteSwitcher(appModel),
  ]);
}

/**
 * Builds a menu sub-section that displays a list of orgs/sites that the current
 * valid user has access to, with buttons to navigate to them.
 *
 * Used by AppHeader and AccountWidget.
 */
export function buildSiteSwitcher(appModel: AppModel) {
  const orgs = appModel.topAppModel.orgs;

  return [
    menuSubHeader('Switch Sites'),
    dom.forEach(orgs, (org) =>
      menuItemLink(urlState().setLinkUrl({ org: org.domain || undefined }),
        cssOrgSelected.cls('', appModel.currentOrg ? org.id === appModel.currentOrg.id : false),
        getOrgName(org),
        cssOrgCheckmark('Tick', testId('org-tick')),
        testId('org'),
      )
    ),
    menuItemLink(
      { href: commonUrls.createTeamSite },
      menuIcon('Plus'),
      'Create new team site',
      testId('create-new-site'),
    ),
  ];
}

const cssOrgSelected = styled('div', `
  background-color: ${colors.dark};
  color: ${colors.light};
`);

const cssOrgCheckmark = styled(icon, `
  flex: none;
  margin-left: 16px;
  --icon-color: ${colors.light};
  display: none;
  .${cssOrgSelected.className} > & {
    display: block;
  }
`);
