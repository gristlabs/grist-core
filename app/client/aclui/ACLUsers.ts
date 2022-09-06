import {copyToClipboard} from 'app/client/lib/copyToClipboard';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {createUserImage} from 'app/client/ui/UserImage';
import {cssMemberImage, cssMemberListItem, cssMemberPrimary,
        cssMemberSecondary, cssMemberText} from 'app/client/ui/UserItem';
import {basicButton, basicButtonLink} from 'app/client/ui2018/buttons';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass, menuDivider} from 'app/client/ui2018/menus';
import {PermissionDataWithExtraUsers} from 'app/common/ActiveDocAPI';
import {userOverrideParams} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL} from 'app/common/UserAPI';
import {getRealAccess, UserAccessData} from 'app/common/UserAPI';
import {Disposable, dom, Observable, styled} from 'grainjs';
import {cssMenu, cssMenuWrap, defaultMenuOptions, IOpenController, setPopupToCreateDom} from 'popweasel';

const roleNames: {[role: string]: string} = {
  [roles.OWNER]: 'Owner',
  [roles.EDITOR]: 'Editor',
  [roles.VIEWER]: 'Viewer',
};

function isSpecialEmail(email: string) {
  return email === ANONYMOUS_USER_EMAIL || email === EVERYONE_EMAIL;
}

export class ACLUsersPopup extends Disposable {
  public readonly isInitialized = Observable.create(this, false);
  private _shareUsers: UserAccessData[] = [];           // Users doc is shared with.
  private _attributeTableUsers: UserAccessData[] = [];  // Users mentioned in attribute tables.
  private _exampleUsers: UserAccessData[] = [];         // Example users.
  private _currentUser: FullUser|null = null;
  private _pageModel: DocPageModel|null = null;

  public init(pageModel: DocPageModel, permissionData: PermissionDataWithExtraUsers|null) {
    this._currentUser = pageModel.userOverride.get()?.user || pageModel.appModel.currentValidUser;
    this._pageModel = pageModel;
    if (permissionData) {
      this._shareUsers = permissionData.users.map(user => ({
        ...user,
        access: getRealAccess(user, permissionData),
      }))
      .filter(user => user.access && !isSpecialEmail(user.email));
      this._attributeTableUsers = permissionData.attributeTableUsers;
      this._exampleUsers = permissionData.exampleUsers;
      this.isInitialized.set(true);
    }
  }

  public attachPopup(elem: Element) {
    setPopupToCreateDom(elem, (ctl) => {
      const buildRow = (user: UserAccessData) => this._buildUserRow(user, this._currentUser, ctl);
      return cssMenuWrap(cssMenu(
        dom.cls(menuCssClass),
        cssUsers.cls(''),
        dom.forEach(this._shareUsers, buildRow),
        // Add a divider between users-from-shares and users from attribute tables.
        (this._attributeTableUsers.length > 0) ? menuDivider() : null,
        dom.forEach(this._attributeTableUsers, buildRow),
        // Include example users only if there are not many "real" users.
        // It might be better to have an expandable section with these users, collapsed
        // by default, but that's beyond my UI ken.
        (this._shareUsers.length + this._attributeTableUsers.length < 5) ? [
          (this._exampleUsers.length > 0) ? menuDivider() : null,
          dom.forEach(this._exampleUsers, buildRow)
        ] : null,
        (el) => { setTimeout(() => el.focus(), 0); },
        dom.onKeyDown({Escape: () => ctl.close()}),
      ));
    }, {...defaultMenuOptions, placement: 'bottom-end'});
  }

  private _buildUserRow(user: UserAccessData, currentUser: FullUser|null, ctl: IOpenController) {
    const isCurrentUser = Boolean(currentUser && user.id === currentUser.id);
    return cssUserItem(
      cssMemberImage(
        createUserImage(user, 'large')
      ),
      cssMemberText(
        cssMemberPrimary(user.name || dom('span', user.email),
          cssRole('(', roleNames[user.access!] || user.access || 'no access', ')', testId('acl-user-access')),
        ),
        user.name ? cssMemberSecondary(user.email) : null
      ),
      basicButton(cssUserButton.cls(''), icon('Copy'), 'Copy Email',
        testId('acl-user-copy'),
        dom.on('click', async (ev, elem) => { await copyToClipboard(user.email); ctl.close(); }),
      ),
      basicButtonLink(cssUserButton.cls(''), cssUserButton.cls('-disabled', isCurrentUser),
        testId('acl-user-view-as'),
          icon('FieldLink'), 'View As',
          this._viewAs(user),
        ),
      testId('acl-user-item'),
    );
  }

  private _viewAs(user: UserAccessData) {
    if (this._pageModel?.isPrefork.get() &&
        this._pageModel?.currentDoc.get()?.access !== 'owners') {
      // "View As" is restricted to document owners on the back-end. Non-owners can be
      // permitted to pretend to be owners of a pre-forked document, but if they want
      // to do "View As", that would be layering pretence over pretense. Better to just
      // go ahead and create the fork, so the user becomes a genuine owner, so the
      // back-end doesn't have to become too metaphysical (and maybe hard to review).
      return dom.on('click', async () => {
        const forkResult = await this._pageModel?.gristDoc.get()?.docComm.fork();
        if (!forkResult) { throw new Error('Failed to create fork'); }
        window.location.assign(urlState().makeUrl(userOverrideParams(user.email,
                                                                     {doc: forkResult.urlId,
                                                                      docPage: undefined})));
      });
    } else {
      // When forking isn't needed, we return a direct link to be maximally transparent
      // about where button will go.
      return urlState().setHref(userOverrideParams(user.email, {docPage: undefined}));
    }
  }
}

const cssUsers = styled('div', `
  max-width: unset;
`);

const cssUserItem = styled(cssMemberListItem, `
  width: auto;
  padding: 8px 16px;
  align-items: center;
  &:hover {
    background-color: ${theme.lightHover};
  }
`);

const cssRole = styled('span', `
  margin: 0 8px;
  font-weight: normal;
`);

const cssUserButton = styled('div', `
  margin: 0 8px;
  border: none;
  display: inline-flex;
  white-space: nowrap;
  gap: 4px;
  &:hover {
    --icon-color: ${theme.controlFg};
    color: ${theme.controlFg};
    background-color: ${theme.hover};
  }
  &-disabled {
    visibility: hidden;
  }
`);
