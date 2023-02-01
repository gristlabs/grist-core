import {DocPageModel} from 'app/client/models/DocPageModel';
import {urlState} from 'app/client/models/gristUrlState';
import {createUserImage} from 'app/client/ui/UserImage';
import {cssMemberImage, cssMemberListItem, cssMemberPrimary,
        cssMemberSecondary, cssMemberText} from 'app/client/ui/UserItem';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {PermissionDataWithExtraUsers} from 'app/common/ActiveDocAPI';
import {menu, menuCssClass, menuItemLink} from 'app/client/ui2018/menus';
import {IGristUrlState, userOverrideParams} from 'app/common/gristUrls';
import {FullUser} from 'app/common/LoginSessionAPI';
import {ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL} from 'app/common/UserAPI';
import {getRealAccess, UserAccessData} from 'app/common/UserAPI';
import {Disposable, dom, Observable, styled} from 'grainjs';
import {cssMenu, cssMenuWrap, defaultMenuOptions, IMenuOptions, IPopupOptions, setPopupToCreateDom} from 'popweasel';
import {getUserRoleText} from 'app/common/UserAPI';
import {makeT} from 'app/client/lib/localization';
import {waitGrainObs} from 'app/common/gutil';
import noop from 'lodash/noop';

const t = makeT("ViewAsDropdown");

function isSpecialEmail(email: string) {
  return email === ANONYMOUS_USER_EMAIL || email === EVERYONE_EMAIL;
}

export class ACLUsersPopup extends Disposable {
  public readonly isInitialized = Observable.create(this, false);
  public readonly allUsers = Observable.create<UserAccessData[]>(this, []);
  private _shareUsers: UserAccessData[] = [];           // Users doc is shared with.
  private _attributeTableUsers: UserAccessData[] = [];  // Users mentioned in attribute tables.
  private _exampleUsers: UserAccessData[] = [];         // Example users.
  private _currentUser: FullUser|null = null;

  constructor(public pageModel: DocPageModel,
              public fetch: () => Promise<PermissionDataWithExtraUsers|null> = () => this._fetchData()) {
    super();
  }

  public async load() {
    const permissionData = await this.fetch();
    if (this.isDisposed()) { return; }
    this.init(permissionData);
  }

  public getUsers() {
    const users = [...this._shareUsers, ...this._attributeTableUsers];
    if (this._showExampleUsers()) { users.push(...this._exampleUsers); }
    return users;
  }

  public init(permissionData: PermissionDataWithExtraUsers|null) {
    const pageModel = this.pageModel;
    this._currentUser = pageModel.userOverride.get()?.user || pageModel.appModel.currentValidUser;

    if (permissionData) {
      this._shareUsers = permissionData.users.map(user => ({
        ...user,
        access: getRealAccess(user, permissionData),
      }))
        .filter(user => user.access && !isSpecialEmail(user.email))
        .filter(user => this._currentUser?.id !== user.id);
      this._attributeTableUsers = permissionData.attributeTableUsers;
      this._exampleUsers = permissionData.exampleUsers;
      this.allUsers.set(this.getUsers());
      this.isInitialized.set(true);
    }
  }

  // Optionnally have document page reverts to the default page upon activation of the view as mode
  // by setting `options.resetDocPage` to true.
  public attachPopup(elem: Element, options: IPopupOptions & {resetDocPage?: boolean}) {
    setPopupToCreateDom(elem, (ctl) => {
      const buildRow =
        (user: UserAccessData) => this._buildUserRow(user, options);
      const buildExampleUserRow =
        (user: UserAccessData) => this._buildUserRow(user, {isExampleUser: true, ...options});
      return cssMenuWrap(cssMenu(
        dom.cls(menuCssClass),
        cssUsers.cls(''),
        cssHeader(t('View As'), dom.show(this._shareUsers.length > 0)),
        dom.forEach(this._shareUsers, buildRow),
        (this._attributeTableUsers.length > 0) ? cssHeader(t("Users from table")) : null,
        dom.forEach(this._attributeTableUsers, buildExampleUserRow),
        // Include example users only if there are not many "real" users.
        // It might be better to have an expandable section with these users, collapsed
        // by default, but that's beyond my UI ken.
        this._showExampleUsers() ? [
          (this._exampleUsers.length > 0) ? cssHeader(t("Example Users")) : null,
          dom.forEach(this._exampleUsers, buildExampleUserRow)
        ] : null,
        (el) => { setTimeout(() => el.focus(), 0); },
        dom.onKeyDown({Escape: () => ctl.close()}),
      ));
    }, {...defaultMenuOptions, ...options});
  }

  // See 'attachPopup' for more info on the 'resetDocPage' option.
  public menu(options: IMenuOptions) {
    return menu(() => {
      this.load().catch(noop);
      return [
        cssMenuHeader('view as'),
        dom.forEach(this.allUsers, user => menuItemLink(
          `${user.name || user.email} (${getUserRoleText(user)})`,
          testId('acl-user-access'),
          this._viewAs(user),
        )),
      ];
    }, options);
  }

  private async _fetchData() {
    const doc = this.pageModel.currentDoc.get();
    const gristDoc = await waitGrainObs(this.pageModel.gristDoc);
    return doc && gristDoc.docComm.getUsersForViewAs();
  }

  private _showExampleUsers() {
    return this._shareUsers.length + this._attributeTableUsers.length < 5;
  }

  private _buildUserRow(user: UserAccessData, opt: {isExampleUser?: boolean, resetDocPage?: boolean} = {}) {
    return dom('a',
      {class: cssMemberListItem.className + ' ' + cssUserItem.className},
      cssMemberImage(
        createUserImage(opt.isExampleUser ? 'exampleUser' : user, 'large')
      ),
      cssMemberText(
        cssMemberPrimary(user.name || dom('span', user.email),
          cssRole('(', getUserRoleText(user), ')', testId('acl-user-access')),
        ),
        user.name ? cssMemberSecondary(user.email) : null
      ),
      this._viewAs(user, opt.resetDocPage),
      testId('acl-user-item'),
    );
  }

  private _viewAs(user: UserAccessData, resetDocPage: boolean = false) {
    const extraState: IGristUrlState = {};
    if (resetDocPage) { extraState.docPage = undefined; }
    if (this.pageModel?.isPrefork.get() &&
        this.pageModel?.currentDoc.get()?.access !== 'owners') {
      // "View As" is restricted to document owners on the back-end. Non-owners can be
      // permitted to pretend to be owners of a pre-forked document, but if they want
      // to do "View As", that would be layering pretence over pretense. Better to just
      // go ahead and create the fork, so the user becomes a genuine owner, so the
      // back-end doesn't have to become too metaphysical (and maybe hard to review).
      return dom.on('click', async () => {
        const forkResult = await this.pageModel?.gristDoc.get()?.docComm.fork();
        if (!forkResult) { throw new Error('Failed to create fork'); }
        window.location.assign(urlState().makeUrl(userOverrideParams(user.email,
                                                                     {...extraState, doc: forkResult.urlId})));
      });
    } else {
      // When forking isn't needed, we return a direct link to be maximally transparent
      // about where button will go.
      return urlState().setHref(userOverrideParams(user.email, extraState));
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
  &, &:hover, &:focus {
    text-decoration: none;
  }
`);

const cssRole = styled('span', `
  margin: 0 8px;
  font-weight: normal;
`);

const cssHeader = styled('div', `
  margin: 11px 24px 14px 24px;
  font-weight: 700;
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.darkText};
`);

const cssMenuHeader = styled('div', `
  margin: 8px 24px;
  margin-bottom: 4px;
  font-weight: 700;
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.darkText};
`);
