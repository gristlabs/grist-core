import {loadGristDoc} from 'app/client/lib/imports';
import {AppModel} from 'app/client/models/AppModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {getLoginOrSignupUrl, getLoginUrl, getLogoutUrl, urlState} from 'app/client/models/gristUrlState';
import {buildUserMenuBillingItem} from 'app/client/ui/BillingButtons';
import {manageTeamUsers} from 'app/client/ui/OpenUserManager';
import {createUserImage} from 'app/client/ui/UserImage';
import * as viewport from 'app/client/ui/viewport';
import {primaryButton} from 'app/client/ui2018/buttons';
import {mediaDeviceNotSmall, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuDivider, menuItem, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {commonUrls, shouldHideUiElement} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {Disposable, dom, DomElementArg, styled} from 'grainjs';
import {cssMenuItem} from 'popweasel';
import {maybeAddSiteSwitcherSection} from 'app/client/ui/SiteSwitcher';
import {t} from 'app/client/lib/localization';

/**
 * Render the user-icon that opens the account menu. When no user is logged in, render a Sign-in
 * button instead.
 */

 const translate = (x: string, args?: any): string => t(`AccountWidget.${x}`, args);
export class AccountWidget extends Disposable {
  constructor(private _appModel: AppModel, private _docPageModel?: DocPageModel) {
    super();
  }

  public buildDom() {
    return cssAccountWidget(
      dom.domComputed(this._appModel.currentValidUser, (user) =>
        (user ?
          cssUserIcon(createUserImage(user, 'medium', testId('user-icon')),
            menu(() => this._makeAccountMenu(user), {placement: 'bottom-end'}),
          ) :
          cssSignInButton(translate('SignIn'), icon('Collapse'), testId('user-signin'),
            menu(() => this._makeAccountMenu(user), {placement: 'bottom-end'}),
          )
        )
      ),
      testId('dm-account'),
    );
  }


  /**
   * Renders the content of the account menu, with a list of available orgs, settings, and sign-out.
   * Note that `user` should NOT be anonymous (none of the items are really relevant).
   */
  private _makeAccountMenu(user: FullUser|null): DomElementArg[] {
    const currentOrg = this._appModel.currentOrg;
    const gristDoc = this._docPageModel ? this._docPageModel.gristDoc.get() : null;

    // The 'Document Settings' item, when there is an open document.
    const documentSettingsItem = (gristDoc ?
      menuItem(async () => (await loadGristDoc()).showDocSettingsModal(gristDoc.docInfo, this._docPageModel!),
        translate('DocumentSettings'),
        testId('dm-doc-settings')) :
      null);

    // The item to toggle mobile mode (presence of viewport meta tag).
    const mobileModeToggle = menuItem(viewport.toggleViewport,
      cssSmallDeviceOnly.cls(''),   // Only show this toggle on small devices.
      translate('ToggleMobileMode'),
      cssCheckmark('Tick', dom.show(viewport.viewportEnabled)),
      testId('usermenu-toggle-mobile'),
    );

    if (!user) {
      return [
        menuItemLink({href: getLoginOrSignupUrl()}, translate('SignIn')),
        menuDivider(),
        documentSettingsItem,
        menuItemLink({href: commonUrls.plans}, translate('Pricing')),
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
      menuItemLink(urlState().setLinkUrl({account: 'account'}), translate('ProfileSettings')),

      documentSettingsItem,

      // Show 'Organization Settings' when on a home page of a valid org.
      (!this._docPageModel && currentOrg && this._appModel.isTeamSite ?
        menuItem(() => manageTeamUsers(currentOrg, user, this._appModel.api),
                 roles.canEditAccess(currentOrg.access) ? translate('ManageTeam') : translate('AccessDetails'),
                 testId('dm-org-access')) :
        // Don't show on doc pages, or for personal orgs.
        null),

      buildUserMenuBillingItem(this._appModel),

      mobileModeToggle,

      // TODO Add section ("Here right now") listing icons of other users currently on this doc.
      // (See Invision "Panels" near the bottom.)

      // In case of a single-org setup, skip all the account-switching UI. We'll also skip the
      // org-listing UI below.
      this._appModel.topAppModel.isSingleOrg || shouldHideUiElement("multiAccounts") ? [] : [
        menuDivider(),
        menuSubHeader(dom.text((use) => use(users).length > 1 ? translate('SwitchAccounts') : 'Accounts')),
        dom.forEach(users, (_user) => {
          if (_user.id === user.id) { return null; }
          return menuItem(() => this._switchAccount(_user),
            cssSmallIconWrap(createUserImage(_user, 'small')),
            cssOtherEmail(_user.email, testId('usermenu-other-email')),
          );
        }),
        isExternal ? null : menuItemLink({href: getLoginUrl()}, translate("AddAccount"), testId('dm-add-account')),
      ],

      menuItemLink({href: getLogoutUrl()}, translate("SignOut"), testId('dm-log-out')),

      maybeAddSiteSwitcherSection(this._appModel),
    ];
  }

  // Switch BrowserSession to use the given user for the currently loaded org.
  private async _switchAccount(user: FullUser) {
    await this._appModel.api.setSessionActive(user.email);
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
}

const cssAccountWidget = styled('div', `
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

const cssSignInButton = styled(primaryButton, `
  display: flex;
  margin: 8px;
  gap: 4px;
`);
