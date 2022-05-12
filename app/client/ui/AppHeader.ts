import {urlState} from 'app/client/models/gristUrlState';
import {getTheme} from 'app/client/ui/CustomThemes';
import {cssLeftPane} from 'app/client/ui/PagePanels';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import * as version from 'app/common/version';
import {BindableValue, Disposable, dom, styled} from "grainjs";
import {menu, menuItem, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {Organization, SUPPORT_EMAIL} from 'app/common/UserAPI';
import {AppModel} from 'app/client/models/AppModel';
import {icon} from 'app/client/ui2018/icons';
import {DocPageModel} from 'app/client/models/DocPageModel';
import * as roles from 'app/common/roles';
import {loadUserManager} from 'app/client/lib/imports';
import {maybeAddSiteSwitcherSection} from 'app/client/ui/SiteSwitcher';


export class AppHeader extends Disposable {
  constructor(private _orgName: BindableValue<string>, private _appModel: AppModel,
              private _docPageModel?: DocPageModel) {
    super();
  }

  public buildDom() {
    const theme = getTheme(this._appModel.topAppModel.productFlavor);

    const user = this._appModel.currentValidUser;
    const currentOrg = this._appModel.currentOrg;
    const isTeamSite = Boolean(currentOrg && !currentOrg.owner);
    const isBillingManager = Boolean(currentOrg && currentOrg.billingAccount &&
      (currentOrg.billingAccount.isManager || user?.email === SUPPORT_EMAIL));

    // Opens the user-manager for the org.
    const manageUsers = async (org: Organization) => {
      const api = this._appModel.api;
      (await loadUserManager()).showUserManagerModal(api, {
        permissionData: api.getOrgAccess(org.id),
        activeEmail: user ? user.email : null,
        resourceType: 'organization',
        resourceId: org.id,
        resource: org
      });
    };

    return cssAppHeader(
      cssAppHeader.cls('-widelogo', theme.wideLogo || false),
      // Show version when hovering over the application icon.
      cssAppLogo(
        {title: `Ver ${version.version} (${version.gitcommit})`},
        urlState().setLinkUrl({}),
        testId('dm-logo')
      ),
      cssOrg(
        cssOrgName(dom.text(this._orgName)),
        this._orgName && cssDropdownIcon('Dropdown'),
        menu(() => [
          menuSubHeader(`${isTeamSite ? 'Team' : 'Personal'} Site`, testId('orgmenu-title')),
          menuItemLink(urlState().setLinkUrl({}), 'Home Page', testId('orgmenu-home-page')),

          // Show 'Organization Settings' when on a home page of a valid org.
          (!this._docPageModel && currentOrg && !currentOrg.owner ?
            menuItem(() => manageUsers(currentOrg), 'Manage Team', testId('orgmenu-manage-team'),
              dom.cls('disabled', !roles.canEditAccess(currentOrg.access))) :
            // Don't show on doc pages, or for personal orgs.
            null),

          // Show link to billing pages.
          currentOrg && !currentOrg.owner ?
            // For links, disabling with just a class is hard; easier to just not make it a link.
            // TODO weasel menus should support disabling menuItemLink.
            (isBillingManager ?
              menuItemLink(urlState().setLinkUrl({billing: 'billing'}), 'Billing Account') :
              menuItem(() => null, 'Billing Account', dom.cls('disabled', true), testId('orgmenu-billing'))
            ) :
            null,

          maybeAddSiteSwitcherSection(this._appModel),
        ], { placement: 'bottom-start' }),
        testId('dm-org'),
      ),
    );
  }
}

const cssAppHeader = styled('div', `
  display: flex;
  width: 100%;
  height: 100%;
  align-items: center;
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: ${colors.dark};
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
  flex-shrink: 0;
  margin-right: 8px;
`);

const cssOrg = styled('div', `
  display: flex;
  flex-grow: 1;
  align-items: center;
  max-width: calc(100% - 48px);
  cursor: pointer;
  height: 100%;
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
