import {copyToClipboard} from 'app/client/lib/copyToClipboard';
import {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {createUserImage} from 'app/client/ui/UserImage';
import * as um from 'app/client/ui/UserManager';
import {basicButton, basicButtonLink} from 'app/client/ui2018/buttons';
import {colors, testId} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menuCssClass} from 'app/client/ui2018/menus';
import {userOverrideParams} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import * as roles from 'app/common/roles';
import {ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL, getRealAccess, UserAccessData} from 'app/common/UserAPI';
import {Disposable, dom, Observable, styled} from 'grainjs';
import {cssMenu, cssMenuWrap, defaultMenuOptions, IOpenController, setPopupToCreateDom} from 'popweasel';

const roleNames: {[role: string]: string} = {
  [roles.OWNER]: 'Owner',
  [roles.EDITOR]: 'Editor',
  [roles.VIEWER]: 'Viewer',
};

function buildUserRow(user: UserAccessData, currentUser: FullUser|null, ctl: IOpenController) {
  const isCurrentUser = Boolean(currentUser && user.id === currentUser.id);
  return cssUserItem(
    um.cssMemberImage(
      createUserImage(user, 'large')
    ),
    um.cssMemberText(
      um.cssMemberPrimary(user.name || dom('span', user.email),
        cssRole('(', roleNames[user.access!] || user.access, ')', testId('acl-user-access')),
      ),
      user.name ? um.cssMemberSecondary(user.email) : null
    ),
    basicButton(cssUserButton.cls(''), icon('Copy'), 'Copy Email',
      testId('acl-user-copy'),
      dom.on('click', async (ev, elem) => { await copyToClipboard(user.email); ctl.close(); }),
    ),
    basicButtonLink(cssUserButton.cls(''), cssUserButton.cls('-disabled', isCurrentUser),
      testId('acl-user-view-as'),
      icon('FieldLink'), 'View As',
        urlState().setHref(userOverrideParams(user.email, {docPage: undefined})),
      ),
    testId('acl-user-item'),
  );
}

function isSpecialEmail(email: string) {
  return email === ANONYMOUS_USER_EMAIL || email === EVERYONE_EMAIL;
}

export class ACLUsersPopup extends Disposable {
  public readonly isInitialized = Observable.create(this, false);
  private _usersInDoc: UserAccessData[] = [];
  private _currentUser: FullUser|null = null;

  public async init(pageModel: DocPageModel) {
    this._currentUser = pageModel.userOverride.get()?.user || pageModel.appModel.currentValidUser;
    const doc = pageModel.currentDoc.get();
    // Disabling "View as user" for forks for the moment.  The getDocAccess endpoint
    // only succeeds for documents that exist in the DB currently.
    // TODO: modify the getDocAccess endpoint to accept forks, through the kind of
    // manipulation that getDoc does.  Then we can enable this button for forks.
    if (doc && !doc.isFork) {
      const permissionData = await pageModel.appModel.api.getDocAccess(doc.id);
      if (this.isDisposed()) { return; }
      this._usersInDoc = permissionData.users.map(user => ({
        ...user,
        access: getRealAccess(user, permissionData),
      }))
      .filter(user => user.access && !isSpecialEmail(user.email));
      this.isInitialized.set(true);
    }
  }

  public attachPopup(elem: Element) {
    setPopupToCreateDom(elem, (ctl) => cssMenuWrap(cssMenu(
        dom.cls(menuCssClass),
        cssUsers.cls(''),
        dom.forEach(this._usersInDoc, user => buildUserRow(user, this._currentUser, ctl)),
        (el) => { setTimeout(() => el.focus(), 0); },
        dom.onKeyDown({Escape: () => ctl.close()}),
      )),
      {...defaultMenuOptions, placement: 'bottom-end'}
    );
  }
}

const cssUsers = styled('div', `
  max-width: unset;
`);

const cssUserItem = styled(um.cssMemberListItem, `
  width: auto;
  padding: 8px 16px;
  align-items: center;
  &:hover {
    background-color: ${colors.lightGrey};
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
    background-color: ${colors.darkGrey};
  }
  &-disabled {
    visibility: hidden;
  }
`);
