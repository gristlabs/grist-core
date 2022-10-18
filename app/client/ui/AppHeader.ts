import {urlState} from 'app/client/models/gristUrlState';
import {buildAppMenuBillingItem} from 'app/client/ui/BillingButtons';
import {getTheme} from 'app/client/ui/CustomThemes';
import {cssLeftPane} from 'app/client/ui/PagePanels';
import {colors, testId, theme, vars} from 'app/client/ui2018/cssVars';
import * as version from 'app/common/version';
import {menu, menuItem, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {isTemplatesOrg, Organization} from 'app/common/UserAPI';
import {AppModel} from 'app/client/models/AppModel';
import {icon} from 'app/client/ui2018/icons';
import {DocPageModel} from 'app/client/models/DocPageModel';
import * as roles from 'app/common/roles';
import {manageTeamUsersApp} from 'app/client/ui/OpenUserManager';
import {maybeAddSiteSwitcherSection} from 'app/client/ui/SiteSwitcher';
import {BindableValue, Disposable, dom, DomContents, styled} from 'grainjs';
import {t} from 'app/client/lib/localization';

const translate = (x: string, args?: any): string => t(`AppHeader.${x}`, args);

// Maps a name of a Product (from app/gen-server/entity/Product.ts) to a tag (pill) to show next
// to the org name.
const productPills: {[name: string]: string|null} = {
  // TODO We don't label paid team plans with a tag yet, but we should label as "Pro" once we
  // update our pricing pages to refer to paid team plans as Pro plans.
  "professional": null,   // Deprecated but used in development.
  "team": null,           // Used for the paid team plans.
  "teamFree": "Free",     // The new free team plan.
  // Other plans are either personal, or grandfathered, or for testing.
};

export class AppHeader extends Disposable {
  constructor(private _orgName: BindableValue<string>, private _appModel: AppModel,
              private _docPageModel?: DocPageModel) {
    super();
  }

  public buildDom() {
    const productFlavor = getTheme(this._appModel.topAppModel.productFlavor);

    const currentOrg = this._appModel.currentOrg;

    return cssAppHeader(
      cssAppHeader.cls('-widelogo', productFlavor.wideLogo || false),
      // Show version when hovering over the application icon.
      // Include gitcommit when known. Cast version.gitcommit since, depending
      // on how Grist is compiled, tsc may believe it to be a constant and
      // believe that testing it is unnecessary.
      cssAppLogo(
        {title: `Version ${version.version}` +
          ((version.gitcommit as string) !== 'unknown' ? ` (${version.gitcommit})` : '')},
        urlState().setLinkUrl({}),
        testId('dm-logo')
      ),
      cssOrg(
        cssOrgName(dom.text(this._orgName), testId('dm-orgname')),
        productPill(currentOrg),
        this._orgName && cssDropdownIcon('Dropdown'),
        menu(() => [
          menuSubHeader(
            this._appModel.isTeamSite ? translate('TeamSite') : translate('PersonalSite')
              + (this._appModel.isLegacySite ? ` (${translate('Legacy')})` : ''),
            testId('orgmenu-title'),
          ),
          menuItemLink(urlState().setLinkUrl({}), translate('HomePage'), testId('orgmenu-home-page')),

          // Show 'Organization Settings' when on a home page of a valid org.
          (!this._docPageModel && currentOrg && !currentOrg.owner ?
            menuItem(() => manageTeamUsersApp(this._appModel),
              'Manage Team', testId('orgmenu-manage-team'),
              dom.cls('disabled', !roles.canEditAccess(currentOrg.access))) :
            // Don't show on doc pages, or for personal orgs.
            null),

          buildAppMenuBillingItem(this._appModel, testId('orgmenu-billing')),

          maybeAddSiteSwitcherSection(this._appModel),
        ], { placement: 'bottom-start' }),
        testId('dm-org'),
      ),
    );
  }
}

export function productPill(org: Organization|null, options: {large?: boolean} = {}): DomContents {
  if (!org || isTemplatesOrg(org)) {
    return null;
  }
  const product = org?.billingAccount?.product.name;
  const pillTag = product && productPills[product];
  if (!pillTag) {
    return null;
  }
  return cssProductPill(cssProductPill.cls('-' + pillTag),
    options.large ? cssProductPill.cls('-large') : null,
    pillTag,
    testId('appheader-product-pill'));
}


const cssAppHeader = styled('div', `
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  background-color: ${theme.leftPanelBg};
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: ${theme.text};
  }
`);

const cssAppLogo = styled('a', `
  flex: none;
  height: 48px;
  width: 48px;
  background-image: var(--icon-GristLogo);
  background-size: ${vars.logoSize};
  background-repeat: no-repeat;
  background-position: center;
  background-color: ${vars.logoBg};
  .${cssAppHeader.className}-widelogo & {
    width: 100%;
    background-size: contain;
    background-origin: content-box;
    padding: 8px;
  }
  .${cssLeftPane.className}-open .${cssAppHeader.className}-widelogo & {
    background-image: var(--icon-GristWideLogo, var(--icon-GristLogo));
  }
`);

const cssDropdownIcon = styled(icon, `
  --icon-color: ${theme.text};
  flex-shrink: 0;
  margin-right: 8px;
`);

const cssOrg = styled('div', `
  display: none;
  flex-grow: 1;
  align-items: center;
  max-width: calc(100% - 48px);
  cursor: pointer;
  height: 100%;
  font-weight: 500;

  &:hover {
    background-color: ${theme.hover};
  }

  .${cssLeftPane.className}-open & {
    display: flex;
  }
`);

const cssOrgName = styled('div', `
  padding-left: 16px;
  padding-right: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  .${cssAppHeader.className}-widelogo & {
    display: none;
  }
`);

const cssProductPill = styled('div', `
  border-radius: 4px;
  font-size: ${vars.smallFontSize};
  padding: 2px 4px;
  display: inline;
  vertical-align: middle;

  &-Free {
    background-color: ${colors.orange};
    color: white;
  }
  &-Pro {
    background-color: ${colors.lightGreen};
    color: white;
  }
  &-large {
    padding: 4px 8px;
    margin-left: 16px;
    font-size: ${vars.mediumFontSize};
  }
`);
