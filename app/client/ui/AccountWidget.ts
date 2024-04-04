import {AppModel} from 'app/client/models/AppModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {getLoginOrSignupUrl, getLoginUrl, getLogoutUrl, getSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {getAdminPanelName} from 'app/client/ui/AdminPanel';
import {manageTeamUsers} from 'app/client/ui/OpenUserManager';
import {createUserImage} from 'app/client/ui/UserImage';
import * as viewport from 'app/client/ui/viewport';
import {bigPrimaryButtonLink, primaryButtonLink} from 'app/client/ui2018/buttons';
import {mediaDeviceNotSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuDivider, menuItem, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {commonUrls, isFeatureEnabled} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {Disposable, dom, DomElementArg, styled} from 'grainjs';
import {cssMenuItem} from 'popweasel';
import {maybeAddSiteSwitcherSection} from 'app/client/ui/SiteSwitcher';
import {makeT} from 'app/client/lib/localization';
import {getGristConfig} from 'app/common/urlUtils';

const t = makeT('AccountWidget');

/**
 * Render the user-icon that opens the account menu.
 *
 * When no user is logged in, render "Sign In" and "Sign Up" buttons.
 *
 * When no user is logged in and a template document is open, render a "Use This Template"
 * button.
 */
export class AccountWidget extends Disposable {
  constructor(private _appModel: AppModel, private _docPageModel?: DocPageModel) {
    super();
  }

  public buildDom() {
    return cssAccountWidget(
      dom.domComputed(use => {
        const isTemplate = Boolean(this._docPageModel && use(this._docPageModel.isTemplate));
        const user = this._appModel.currentValidUser;
        if (!user && isTemplate) {
          return this._buildUseThisTemplateButton();
        } else if (!user) {
          return this._buildSignInAndSignUpButtons();
        } else {
          return this._buildAccountMenuButton(user);
        }
      }),
      testId('dm-account'),
    );
  }

  private _buildAccountMenuButton(user: FullUser|null) {
    return cssUserIcon(
      createUserImage(user, 'medium', testId('user-icon')),
      menu(() => this._makeAccountMenu(user), {placement: 'bottom-end'}),
    );
  }

  private _buildSignInAndSignUpButtons() {
    return [
      cssSigninButton(t('Sign In'),
        cssSigninButton.cls('-secondary'),
        dom.on('click', () => { this._docPageModel?.clearUnsavedChanges(); }),
        dom.attr('href', use => {
          // Keep the redirect param of the login URL fresh.
          use(urlState().state);
          return getLoginUrl();
        }),
        testId('user-sign-in'),
      ),
      cssSigninButton(t('Sign Up'),
        dom.on('click', () => { this._docPageModel?.clearUnsavedChanges(); }),
        dom.attr('href', use => {
          // Keep the redirect param of the signup URL fresh.
          use(urlState().state);
          return getSignupUrl();
        }),
        testId('user-sign-up'),
      ),
    ];
  }

  private _buildUseThisTemplateButton() {
    return cssUseThisTemplateButton(t('Use This Template'),
      dom.attr('href', use => {
        const {doc: srcDocId} = use(urlState().state);
        return getLoginOrSignupUrl({srcDocId});
      }),
      dom.on('click', () => { this._docPageModel?.clearUnsavedChanges(); }),
      testId('dm-account-use-this-template'),
    );
  }

  /**
   * Renders the content of the account menu, with a list of available orgs, settings, and sign-out.
   * Note that `user` should NOT be anonymous (none of the items are really relevant).
   */
  private _makeAccountMenu(user: FullUser|null): DomElementArg[] {
    const currentOrg = this._appModel.currentOrg;

    // The 'Document Settings' item, when there is an open document.
    const documentSettingsItem = this._docPageModel ? menuItemLink(
      urlState().setLinkUrl({docPage: 'settings'}),
      t("Document Settings"),
      testId('dm-doc-settings')
    ) : null;

    // The item to toggle mobile mode (presence of viewport meta tag).
    const mobileModeToggle = menuItem(viewport.toggleViewport,
      cssSmallDeviceOnly.cls(''),   // Only show this toggle on small devices.
      t("Toggle Mobile Mode"),
      cssCheckmark('Tick', dom.show(viewport.viewportEnabled)),
      testId('usermenu-toggle-mobile'),
    );

    if (!user) {
      return [
        menuItemLink({href: getLoginOrSignupUrl()}, t("Sign in")),
        menuDivider(),
        documentSettingsItem,
        menuItemLink({href: commonUrls.plans}, t("Pricing")),
        mobileModeToggle,
      ];
    }

    const users = this._appModel.topAppModel.users;
    const isExternal = user?.loginMethod === 'External';
    return [
      cssUserInfo(
        createUserImage(user, 'large'),
        cssUserName(dom('span', user.name, testId('usermenu-name')),
          cssEmail(user.email, testId('usermenu-email'))
        )
      ),
      menuItemLink(urlState().setLinkUrl({account: 'account'}), t("Profile Settings"), testId('dm-account-settings')),

      documentSettingsItem,

      // Show 'Organization Settings' when on a home page of a valid org.
      (!this._docPageModel && currentOrg && this._appModel.isTeamSite ?
        menuItem(() => manageTeamUsers(currentOrg, user, this._appModel.api),
                 roles.canEditAccess(currentOrg.access) ? t("Manage Team") : t("Access Details"),
                 testId('dm-org-access')) :
        // Don't show on doc pages, or for personal orgs.
        null),

      this._maybeBuildBillingPageMenuItem(),
      this._maybeBuildActivationPageMenuItem(),
      this._maybeBuildAdminPanelMenuItem(),
      this._maybeBuildSupportGristButton(),
      mobileModeToggle,

      // TODO Add section ("Here right now") listing icons of other users currently on this doc.
      // (See Invision "Panels" near the bottom.)

      // In case of a single-org setup, skip all the account-switching UI. We'll also skip the
      // org-listing UI below.
      this._appModel.topAppModel.isSingleOrg || !isFeatureEnabled("multiAccounts") ? [] : [
        menuDivider(),
        menuSubHeader(dom.text((use) => use(users).length > 1 ? t("Switch Accounts") : t("Accounts"))),
        dom.forEach(users, (_user) => {
          if (_user.id === user.id) { return null; }
          return menuItem(() => this._switchAccount(_user),
            cssSmallIconWrap(createUserImage(_user, 'small')),
            cssOtherEmail(_user.email, testId('usermenu-other-email')),
          );
        }),
        isExternal ? null : menuItemLink({href: getLoginUrl()}, t("Add Account"), testId('dm-add-account')),
      ],

      menuItemLink({href: getLogoutUrl()}, t("Sign Out"), testId('dm-log-out')),

      maybeAddSiteSwitcherSection(this._appModel),
    ];
  }

  // Switch BrowserSession to use the given user for the currently loaded org.
  private async _switchAccount(user: FullUser) {
    await this._appModel.switchUser(user);
    if (urlState().state.get().doc) {
      // Document access level may have changed.
      // If it was not accessible but now is, we currently need to reload the page to get
      // a complete gristConfig for the document from the server.
      // If it was accessible but now is not, it would suffice to reconnect the web socket.
      // For simplicity, just reload from server in either case.
      // TODO: get fancier here to avoid reload.
      window.location.reload(true);
      return;
    }
    this._appModel.topAppModel.initialize();
  }

  private _maybeBuildBillingPageMenuItem() {
    const {deploymentType} = getGristConfig();
    if (deploymentType !== 'saas') { return null; }

    const {currentValidUser, currentOrg, isTeamSite} = this._appModel;
    const isBillingManager = Boolean(currentOrg && currentOrg.billingAccount &&
      (currentOrg.billingAccount.isManager || currentValidUser?.isSupport));

    return isTeamSite ?
      // For links, disabling with just a class is hard; easier to just not make it a link.
      // TODO weasel menus should support disabling menuItemLink.
      (isBillingManager ?
        menuItemLink(urlState().setLinkUrl({billing: 'billing'}), t('Billing Account')) :
        menuItem(() => null, t('Billing Account'), dom.cls('disabled', true))
      ) :
      menuItem(() => this._appModel.showUpgradeModal(), t('Upgrade Plan'));
  }

  private _maybeBuildActivationPageMenuItem() {
    const {deploymentType} = getGristConfig();
    if (deploymentType !== 'enterprise' || !this._appModel.isInstallAdmin()) {
      return null;
    }

    return menuItemLink(t('Activation'), urlState().setLinkUrl({activation: 'activation'}));
  }

  private _maybeBuildAdminPanelMenuItem() {
    // Only show Admin Panel item to the installation admins.
    if (this._appModel.currentUser?.isInstallAdmin) {
      return menuItemLink(
        getAdminPanelName(),
        urlState().setLinkUrl({adminPanel: 'admin'}),
        testId('usermenu-admin-panel'),
      );
    }
  }

  private _maybeBuildSupportGristButton() {
    const {deploymentType} = getGristConfig();
    const isEnabled = (deploymentType === 'core') && isFeatureEnabled("supportGrist");
    if (isEnabled) {
      return menuItemLink(t('Support Grist'), ' 💛',
        {href: commonUrls.githubSponsorGristLabs, target: '_blank'},
        testId('usermenu-support-grist'),
      );
    }
  }
}

const cssAccountWidget = styled('div', `
  display: flex;
  margin-right: 16px;
  white-space: nowrap;
`);

export const cssUserIcon = styled('div', `
  height: 48px;
  width: 48px;
  padding: 8px;
  cursor: pointer;
`);

const cssUserInfo = styled('div', `
  padding: 12px 24px 12px 16px;
  min-width: 200px;
  display: flex;
  align-items: center;
`);

const cssUserName = styled('div', `
  margin-left: 8px;
  font-size: ${vars.mediumFontSize};
  font-weight: ${vars.headerControlTextWeight};
  color: ${theme.text};
`);

const cssEmail = styled('div', `
  margin-top: 4px;
  font-size: ${vars.smallFontSize};
  font-weight: initial;
  color: ${theme.lightText};
`);

const cssSmallIconWrap = styled('div', `
  flex: none;
  margin: -4px 8px -4px 0px;
`);

const cssOtherEmail = styled('div', `
  color: ${theme.lightText};
  .${cssMenuItem.className}-sel & {
    color: ${theme.menuItemSelectedFg};
  }
`);

const cssCheckmark = styled(icon, `
  flex: none;
  margin-left: 16px;
  --icon-color: ${theme.accentIcon};
`);

// Note that this css class hides the item when the device width is small (not based on viewport
// width, which may be larger). This only appropriate for when to enable the "mobile mode" toggle.
const cssSmallDeviceOnly = styled(menuItem, `
  @media ${mediaDeviceNotSmall} {
    & {
      display: none;
    }
  }
`);

const cssSigninButton = styled(bigPrimaryButtonLink, `
  display: flex;
  align-items: center;
  font-weight: 700;
  min-height: unset;
  height: 36px;
  padding: 8px 16px 8px 16px;
  font-size: ${vars.mediumFontSize};

  &-secondary, &-secondary:hover {
    background-color: transparent;
    border-color: transparent;
    color: ${theme.text};
  }
`);

const cssUseThisTemplateButton = styled(primaryButtonLink, `
  margin: 8px;
`);
