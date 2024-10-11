import {getWelcomeHomeUrl, urlState} from 'app/client/models/gristUrlState';
import {getTheme} from 'app/client/ui/CustomThemes';
import {cssLeftPane} from 'app/client/ui/PagePanels';
import {colors, theme, vars} from 'app/client/ui2018/cssVars';
import * as version from 'app/common/version';
import {menu, menuItem, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {commonUrls} from 'app/common/gristUrls';
import {getOrgName, isTemplatesOrg, Organization} from 'app/common/UserAPI';
import {AppModel} from 'app/client/models/AppModel';
import {icon} from 'app/client/ui2018/icons';
import {DocPageModel} from 'app/client/models/DocPageModel';
import * as roles from 'app/common/roles';
import {manageTeamUsersApp} from 'app/client/ui/OpenUserManager';
import {maybeAddSiteSwitcherSection} from 'app/client/ui/SiteSwitcher';
import {Computed, Disposable, dom, DomContents, styled} from 'grainjs';
import {makeT} from 'app/client/lib/localization';
import {getGristConfig} from 'app/common/urlUtils';
import {makeTestId} from 'app/client/lib/domUtils';
import {createUserImage, cssUserImage} from 'app/client/ui/UserImage';

const t = makeT('AppHeader');
const testId = makeTestId('test-dm-');

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

interface AppLogoOrgNameAndLink {
  name: string;
  link: AppLogoLink;
  org?: string;
  href?: string;
}

type AppLogoLink = AppLogoOrgDomain | AppLogoHref;

interface AppLogoOrgDomain {
  type: 'domain';
  domain: string;
}

interface AppLogoHref {
  type: 'href';
  href: string;
}

export class AppHeader extends Disposable {
  private _currentOrg = this._appModel.currentOrg;

  /**
   * The name and link of the site shown next to the logo.
   *
   * The last visited site is used, if known. Otherwise, the current site is used.
   */
  private _appLogoOrg = Computed.create<AppLogoOrgNameAndLink>(this, (use) => {
    const availableOrgs = use(this._appModel.topAppModel.orgs);
    const currentOrgName = (this._appModel.currentOrgName ||
      (this._docPageModel && use(this._docPageModel.currentOrgName))) ?? '';
    const lastVisitedOrgDomain = use(this._appModel.lastVisitedOrgDomain);
    return this._getAppLogoOrgNameAndLink({availableOrgs, currentOrgName, lastVisitedOrgDomain});
  });

  private _appLogoOrgName = Computed.create(this, this._appLogoOrg, (_use, {name}) => name);

  private _appLogoOrgLink = Computed.create(this, this._appLogoOrg, (_use, {link}) => link);

  constructor(
    private _appModel: AppModel,
    private _docPageModel?: DocPageModel|null) {
    super();
  }

  public buildDom() {
    // Check if we have a custom image.
    const customImage = this._appModel.currentOrg?.orgPrefs?.customLogoUrl;

    const variant = () => [cssUserImage.cls('-border'), cssUserImage.cls('-square')];

    // Personal avatar is shown only for logged in users.
    const personalAvatar = () => !this._appModel.currentValidUser
                            ? cssAppLogo.cls('-grist-logo')
                            : createUserImage(this._appModel.currentValidUser, 'medium', variant());

    // Team avatar is shown only for team sites (even for anonymous users).
    const teamAvatar = () => cssAppLogo.cls('-grist-logo');

    // Depending on site the avatar is either personal or team.
    const avatar = () => this._appModel.isPersonal
                            ? personalAvatar()
                            : teamAvatar();

    // Show the image if it's set, otherwise show the avatar.
    const image = () => customImage
                          ? dom.style('background-image', customImage ? `url(${customImage})` : '')
                          : avatar();


    // Maybe we should show custom logo and make it wide (without site switcher).
    const productFlavor = getTheme(this._appModel.topAppModel.productFlavor);
    const content = () => productFlavor.wideLogo
                          ? null
                          : image();

    const title = `Version ${version.version}` +
          ((version.gitcommit as string) !== 'unknown' ? ` (${version.gitcommit})` : '');

    return cssAppHeader(
      cssAppHeader.cls('-widelogo', productFlavor.wideLogo || false),
      cssAppHeaderBox(
        dom.domComputed(this._appLogoOrgLink, orgLink => cssAppLogo(
          // Show version when hovering over the application icon.
          // Include gitcommit when known. Cast version.gitcommit since, depending
          // on how Grist is compiled, tsc may believe it to be a constant and
          // believe that testing it is unnecessary.
          {title},
          this._setHomePageUrl(orgLink),
          content(),
          testId('logo'),
        )),
        this._buildOrgLinkOrMenu(),
      ),
    );
  }

  private _buildOrgLinkOrMenu() {
    const {currentValidUser, isTemplatesSite} = this._appModel;
    const {deploymentType} = getGristConfig();
    if (deploymentType === 'saas' && !currentValidUser && isTemplatesSite) {
      // When signed out and on the templates site (in SaaS Grist), link to the templates page.
      return cssOrgLink(
        cssOrgName(dom.text(this._appLogoOrgName), testId('orgname')),
        {href: commonUrls.templates},
        testId('org'),
      );
    } else {
      return cssOrg(
        cssOrgName(dom.text(this._appLogoOrgName), testId('orgname')),
        productPill(this._currentOrg),
        dom.maybe(this._appLogoOrgName, () => [
          cssSpacer(),
          cssDropdownIcon('Dropdown'),
        ]),
        menu(() => [
          menuSubHeader(
            this._appModel.isPersonal
              ? t("Personal Site") + (this._appModel.isLegacySite ? ` (${t("Legacy")})` : '')
              : t("Team Site"),
            testId('orgmenu-title'),
          ),
          menuItemLink(urlState().setLinkUrl({}), t("Home Page"), testId('orgmenu-home-page')),

          // Show 'Organization Settings' when on a home page of a valid org.
          (!this._docPageModel && this._currentOrg && !this._currentOrg.owner ?
            menuItem(() => manageTeamUsersApp({app: this._appModel}),
              t('Manage Team'), testId('orgmenu-manage-team'),
              dom.cls('disabled', !roles.canEditAccess(this._currentOrg.access))) :
            // Don't show on doc pages, or for personal orgs.
            null),

          this._maybeBuildBillingPageMenuItem(),
          this._maybeBuildActivationPageMenuItem(),

          maybeAddSiteSwitcherSection(this._appModel),
        ], { placement: 'bottom-start' }),
        testId('org'),
      );
    }
  }

  private _setHomePageUrl(link: AppLogoLink) {
    if (link.type === 'href') {
      return {href: link.href};
    } else {
      return urlState().setLinkUrl({org: link.domain});
    }
  }

  private _maybeBuildBillingPageMenuItem() {
    const {deploymentType} = getGristConfig();
    if (deploymentType !== 'saas') { return null; }

    const {currentOrg} = this._appModel;
    const isBillingManager = this._appModel.isBillingManager() || this._appModel.isSupport();
    return currentOrg && !currentOrg.owner ?
      // For links, disabling with just a class is hard; easier to just not make it a link.
      // TODO weasel menus should support disabling menuItemLink.
      (isBillingManager
        ? menuItemLink(
          urlState().setLinkUrl({billing: 'billing'}),
          t('Billing Account'),
          testId('orgmenu-billing'),
        )
        : menuItem(
          () => null,
          t('Billing Account'),
          dom.cls('disabled', true),
          testId('orgmenu-billing'),
        )
      ) :
      null;
  }

  private _maybeBuildActivationPageMenuItem() {
    const {deploymentType} = getGristConfig();
    if (deploymentType !== 'enterprise' || !this._appModel.isInstallAdmin()) {
      return null;
    }

    return menuItemLink('Activation', urlState().setLinkUrl({activation: 'activation'}));
  }

  private _getAppLogoOrgNameAndLink(params: {
    availableOrgs: Organization[],
    currentOrgName: string,
    lastVisitedOrgDomain: string|null,
  }): AppLogoOrgNameAndLink {
    const {
      currentValidUser,
      isTemplatesSite,
    } = this._appModel;
    const {deploymentType} = getGristConfig();
    if (deploymentType === 'saas' && !currentValidUser && isTemplatesSite) {
      // When signed out and on the templates site (in SaaS Grist), link to the templates page.
      return {
        name: t('Grist Templates'),
        link: {
          type: 'href',
          href: commonUrls.templates,
        },
      };
    }

    const {availableOrgs, currentOrgName, lastVisitedOrgDomain} = params;
    if (lastVisitedOrgDomain) {
      const lastVisitedOrg = availableOrgs.find(({domain}) => domain === lastVisitedOrgDomain);
      if (lastVisitedOrg) {
        return {
          name: getOrgName(lastVisitedOrg),
          link: {
            type: 'domain',
            domain: lastVisitedOrgDomain,
          },
        };
      }
    }

    return {
      name: currentOrgName ?? '',
      link: {
        type: 'href',
        href: getWelcomeHomeUrl(),
      },
    };
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
    testId('product-pill'));
}


const cssAppHeader = styled('div._cssAppHeader', `
  width: 100%;
  height: 100%;
  background-color: ${theme.leftPanelBg};
  padding: 0px;
  padding: 8px;

  .${cssLeftPane.className}-open & {
    padding: 8px 16px;
  }
  &-widelogo {
    padding: 0px !important;
  }
  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: ${theme.text};
  }
`);

const cssAppHeaderBox = styled('div._cssAppHeaderBox', `
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: ${theme.appHeaderBg};
  border-radius: 4px;
  overflow: hidden;
  &:hover{
    --middle-border-color: ${theme.appHeaderBorderHover};
  }
  .${cssAppHeader.className}-widelogo & {
    border: none !important;
    overflow: visible;
  }
`);

const cssAppLogo = styled('a._cssAppLogo', `
  flex: none;
  height: 100%;
  aspect-ratio: 1 / 1;
  text-decoration: none;
  background-repeat: no-repeat;
  background-position: center;
  background-color: inherit;
  background-size: cover;

  border: 1px solid ${theme.appHeaderBorder};
  border-radius: 4px;
  overflow: hidden;
  border-right-color: var(--middle-border-color, ${theme.appHeaderBorder});

  &-grist-logo {
    background-image: var(--icon-GristLogo);
    background-color: ${vars.logoBg};
    background-size: ${vars.logoSize};
  }

  .${cssAppHeader.className}-widelogo & {
    width: 100%;
    background-size: contain;
    background-origin: content-box;
    padding: 8px;
    border-right: none !important;
    background-size: contain;
    border: 0px !important;
  }
  .${cssLeftPane.className}-open .${cssAppHeader.className}-widelogo & {
    background-image: var(--icon-GristWideLogo, var(--icon-GristLogo));
    background-size: contain;
  }
  &:hover {
    border-color: ${theme.appHeaderBorderHover};
    text-decoration: none;
  }
  .${cssLeftPane.className}-open & {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
`);

const cssOrg = styled('div._cssOrg', `
  display: none;
  flex-grow: 1;
  flex-basis: 0px;
  overflow: hidden;
  align-items: center;
  cursor: pointer;
  height: 100%;
  font-weight: 500;

  border: 1px solid ${theme.appHeaderBorder};
  border-radius: 4px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: 0px;

  &:hover {
    border-color: ${theme.appHeaderBorderHover};
  }
  .${cssLeftPane.className}-open & {
    display: flex;
  }
`);

const cssDropdownIcon = styled(icon, `
  --icon-color: ${theme.text};
  flex-shrink: 0;
  margin-right: 8px;
`);

const cssSpacer = styled('div', `
  display: none;
  flex: 1;
  display: block;
`);

const cssOrgLink = styled('a.cssOrgLink', `
  display: none;
  flex-grow: 1;
  align-items: center;
  max-width: calc(100% - 32px);
  cursor: pointer;
  height: 100%;
  font-weight: 500;
  color: ${theme.text};
  user-select: none;


  border: 1px solid ${theme.appHeaderBorder};
  border-radius: 4px;
  border-left-width: 0;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;

  &, &:hover, &:focus {
    text-decoration: none;
  }

  .${cssLeftPane.className}-open & {
    border-left: 1px solid ${theme.appHeaderBorder};
  }

  &:hover {
    color: ${theme.text};
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
