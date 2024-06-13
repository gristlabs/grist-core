import {dom, input, makeTestId, MutableObsArray, obsArray, Observable, styled} from 'grainjs';
import {getSingleOrg, isFeatureEnabled} from 'app/common/gristUrls';
import {getOrgName, Organization} from 'app/common/UserAPI';
import {makeT} from 'app/client/lib/localization';
import {AppModel} from 'app/client/models/AppModel';
import {urlState} from 'app/client/models/gristUrlState';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {menuDivider, menuIcon, menuItem, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {icon} from 'app/client/ui2018/icons';
import {menuItemStatic} from "app/client/ui2018/menus";
import {cssMenuItem} from "popweasel";
import {ACIndexImpl, normalizeText} from "app/client/lib/ACIndex";

const t = makeT('SiteSwitcher');

const testId = makeTestId('test-site-switcher-');

/**
 * Adds a menu divider and a site switcher, if there is need for one.
 */
export function maybeAddSiteSwitcherSection(appModel: AppModel) {
  const orgs = appModel.topAppModel.orgs;
  return dom.maybe((use) => use(orgs).length > 0 && !getSingleOrg() && isFeatureEnabled("multiSite"), () => [
    buildSiteSwitcher(appModel),
  ]);
}

/**
 * Always display the selected site on first position.
 * @param orgs Array of sites
 * @param currentOrg Selected site
 */
function setFirstSelectedItem(orgs: MutableObsArray<Organization>, currentOrg: Organization | null) {
  if (currentOrg != null) {
    const currentOrgIndex = orgs.get().findIndex((org) => org.id === currentOrg.id);

    if (currentOrgIndex > 0) {
      const org = orgs.get()[currentOrgIndex];
      orgs.splice(currentOrgIndex, 1);
      orgs.unshift(org);
    }
  }
}

/**
 * Builds a menu sub-section that displays a list of orgs/sites that the current
 * valid user has access to, with buttons to navigate to them.
 *
 * Used by AppHeader and AccountWidget.
 */
export function buildSiteSwitcher(appModel: AppModel) {
  const orgs = appModel.topAppModel.orgs;
  const searchValue = Observable.create(null, '');
  const searchResult: MutableObsArray<Organization> = obsArray(orgs.get());

  setFirstSelectedItem(searchResult, appModel.currentOrg);

  return [
    dom.maybe(() => isFeatureEnabled("createSite"), () => [
      menuItem(
        () => appModel.showNewSiteModal(),
        menuIcon('Plus'),
        t("Create new team site"),
        testId('create-new-site'),
      )
    ]),
    cssMenuItem(
      menuItemStatic(
        menuIcon('SearchSmall'),
        cssSearch(
          searchValue,
          { onInput: true },
          { type: 'search', placeholder: t('Search site') },
          dom.on("input", (e) => {
            const searchText = (<HTMLInputElement>e.target).value;

            if (searchText) {
              const items = new ACIndexImpl(orgs.get().map((org) => ({
                ...org,
                label: getOrgName(org),
                cleanText: normalizeText(getOrgName(org))
              })));

              searchResult.set(items.search(searchText).items);
            } else {
              searchResult.set(orgs.get());
              setFirstSelectedItem(searchResult, appModel.currentOrg);
            }
          })
        ),
      )
    ),
    menuDivider(),
    menuSubHeader(
      t("Switch Sites"),
      cssOrgNumber(String(orgs.get().length))
    ),
    cssOrgList(
      dom.forEach(searchResult, (org) =>
        menuItemLink(urlState().setLinkUrl({ org: org.domain || undefined }),
          cssOrgSelected.cls('', appModel.currentOrg ? org.id === appModel.currentOrg.id : false),
          getOrgName(org),
          cssOrgCheckmark('Tick', testId('org-tick')),
          testId('org'),
          dom.on("mouseover", (e) => {
            (<HTMLElement>e.target).classList.add(cssMenuItem.className + '-sel');
          }),
          dom.on("mouseleave", (e) => {
            (<HTMLElement>e.target).classList.remove(cssMenuItem.className + '-sel');
          })
        )
      )
    )
  ];
}

const cssOrgList = styled('div', `
  overflow-y: auto;
  max-height: 330px;
`);

const cssOrgSelected = styled('div', `
  background-color: ${theme.siteSwitcherActiveBg};
  color: ${theme.siteSwitcherActiveFg};
`);

const cssOrgCheckmark = styled(icon, `
  flex: none;
  margin-left: auto;
  --icon-color: ${theme.siteSwitcherActiveFg};
  display: none;
  .${cssOrgSelected.className} > & {
    display: block;
  }
`);

const cssOrgNumber = styled('span', `
  float: right;
  color: ${theme.lightText}
`);

const cssSearch = styled(input, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  flex-grow: 1;
  min-width: 1px;
  -webkit-appearance: none;
  -moz-appearance: none;

  font-size: ${vars.mediumFontSize};

  padding: 0px;
  border: none;
  outline: none;

  &::placeholder {
    color: ${theme.inputFg};
  }
`);
