import {loadUserManager} from 'app/client/lib/imports';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {getLoginOrSignupUrl, getLoginUrl, getLogoutUrl, urlState} from 'app/client/models/gristUrlState';
import {showDocSettingsModal} from 'app/client/ui/DocumentSettings';
import {showProfileModal} from 'app/client/ui/ProfileDialog';
import {createUserImage} from 'app/client/ui/UserImage';
import * as viewport from 'app/client/ui/viewport';
import {primaryButtonLink} from 'app/client/ui2018/buttons';
import {colors, mediaDeviceNotSmall, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuDivider, menuItem, menuItemLink, menuSubHeader} from 'app/client/ui2018/menus';
import {commonUrls} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {getOrgName, Organization, SUPPORT_EMAIL} from 'app/common/UserAPI';
import {bundleChanges, Disposable, dom, DomElementArg, Observable, styled} from 'grainjs';
import {cssMenuItem} from 'popweasel';

/**
 * Render the user-icon that opens the account menu. When no user is logged in, render a Sign-in
 * button instead.
 */
export class AccountWidget extends Disposable {
  private _users = Observable.create<FullUser[]>(this, []);
  private _orgs = Observable.create<Organization[]>(this, []);

  constructor(private _appModel: AppModel, private _docPageModel?: DocPageModel) {
    super();
    // We initialize users and orgs asynchronously when we create the menu, so it will *probably* be
    // available by the time the user opens it. Even if not, we do not delay the opening of the menu.
    this._fetchUsersAndOrgs().catch(reportError);
  }

  public buildDom() {
    return cssAccountWidget(
      dom.domComputed(this._appModel.currentValidUser, (user) =>
        (user ?
          cssUserIcon(createUserImage(user, 'medium', testId('user-icon')),
            menu(() => this._makeAccountMenu(user), {placement: 'bottom-end'}),
          ) :
          primaryButtonLink('Sign in',
            {href: getLoginOrSignupUrl(), style: 'margin: 8px'},
            testId('user-signin'))
        )
      ),
      testId('dm-account'),
    );
  }

  private async _fetchUsersAndOrgs() {
    if (!this._appModel.topAppModel.isSingleOrg) {
      const data = await this._appModel.api.getSessionAll();
      if (this.isDisposed()) { return; }
      bundleChanges(() => {
        this._users.set(data.users);
        this._orgs.set(data.orgs);
      });
    }
  }

  /**
   * Renders the content of the account menu, with a list of available orgs, settings, and sign-out.
   * Note that `user` should NOT be anonymous (none of the items are really relevant).
   */
  private _makeAccountMenu(user: FullUser): DomElementArg[] {
    // Opens the user-manager for the org.
    const manageUsers = async (org: Organization) => {
      const api = this._appModel.api;
      (await loadUserManager()).showUserManagerModal(api, {
        permissionData: api.getOrgAccess(org.id),
        activeEmail: user ? user.email : null,
        resourceType: 'organization',
        resourceId: org.id
      });
    };

    const currentOrg = this._appModel.currentOrg;
    const gristDoc = this._docPageModel ? this._docPageModel.gristDoc.get() : null;
    const isBillingManager = Boolean(currentOrg && currentOrg.billingAccount &&
      (currentOrg.billingAccount.isManager || user.email === SUPPORT_EMAIL));

    return [
      cssUserInfo(
        createUserImage(user, 'large'),
        cssUserName(user.name,
          cssEmail(user.email, testId('usermenu-email'))
        )
      ),
      menuItem(() => showProfileModal(this._appModel), 'Profile Settings'),

      // Enable 'Document Settings' when there is an open document.
      (gristDoc ?
          menuItem(() => showDocSettingsModal(gristDoc.docInfo, this._docPageModel!), 'Document Settings',
          testId('dm-doc-settings')) :
        null),

      // Show 'Organization Settings' when on a home page of a valid org.
      (!this._docPageModel && currentOrg && !currentOrg.owner ?
        menuItem(() => manageUsers(currentOrg), 'Manage Users', testId('dm-org-access'),
          dom.cls('disabled', !roles.canEditAccess(currentOrg.access))) :
        // Don't show on doc pages, or for personal orgs.
        null),

      // Show link to billing pages.
      currentOrg && !currentOrg.owner ?
        // For links, disabling with just a class is hard; easier to just not make it a link.
        // TODO weasel menus should support disabling menuItemLink.
        (isBillingManager ?
          menuItemLink(urlState().setLinkUrl({billing: 'billing'}), 'Billing Account') :
          menuItem(() => null, 'Billing Account', dom.cls('disabled', true))
        ) :
        menuItemLink({href: commonUrls.plans}, 'Upgrade Plan'),

      menuItem(viewport.toggleViewport,
        cssSmallDeviceOnly.cls(''),   // Only show this toggle on small devices.
        'Toggle Mobile Mode',
        cssCheckmark('Tick', dom.show(viewport.viewportEnabled)),
        testId('usermenu-toggle-mobile'),
      ),

      // TODO Add section ("Here right now") listing icons of other users currently on this doc.
      // (See Invision "Panels" near the bottom.)

      // In case of a single-org setup, skip all the account-switching UI. We'll also skip the
      // org-listing UI below.
      this._appModel.topAppModel.isSingleOrg ? [] : [
        menuDivider(),
        menuSubHeader(dom.text((use) => use(this._users).length > 1 ? 'Switch Accounts' : 'Accounts')),
        dom.forEach(this._users, (_user) => {
          if (_user.id === user.id) { return null; }
          return menuItem(() => this._switchAccount(_user),
            cssSmallIconWrap(createUserImage(_user, 'small')),
            cssOtherEmail(_user.email, testId('usermenu-other-email')),
          );
        }),
        menuItemLink({href: getLoginUrl()}, "Add Account", testId('dm-add-account')),
      ],

      menuItemLink({href: getLogoutUrl()}, "Sign Out", testId('dm-log-out')),

      dom.maybe((use) => use(this._orgs).length > 0, () => [
        menuDivider(),
        menuSubHeader('Switch Sites'),
      ]),
      dom.forEach(this._orgs, (org) =>
        menuItemLink(urlState().setLinkUrl({org: org.domain || undefined}),
          cssOrgSelected.cls('', this._appModel.currentOrg ? org.id === this._appModel.currentOrg.id : false),
          getOrgName(org),
          cssOrgCheckmark('Tick', testId('usermenu-org-tick')),
          testId('usermenu-org'),
        )
      ),
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

const cssUserIcon = styled('div', `
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
  color: ${colors.dark};
`);

const cssEmail = styled('div', `
  margin-top: 4px;
  font-size: ${vars.smallFontSize};
  font-weight: initial;
  color: ${colors.slate};
`);

const cssSmallIconWrap = styled('div', `
  flex: none;
  margin: -4px 8px -4px 0px;
`);

const cssOtherEmail = styled('div', `
  color: ${colors.slate};
  .${cssMenuItem.className}-sel & {
    color: ${colors.light};
  }
`);

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

const cssCheckmark = styled(icon, `
  flex: none;
  margin-left: 16px;
  --icon-color: ${colors.lightGreen};
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
