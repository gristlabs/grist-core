import { makeT } from "app/client/lib/localization";
import { DocPageModel } from "app/client/models/DocPageModel";
import { urlState } from "app/client/models/gristUrlState";
import { createUserImage } from "app/client/ui/UserImage";
import { cssMemberImage, cssMemberListItem, cssMemberPrimary,
  cssMemberSecondary, cssMemberText } from "app/client/ui/UserItem";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { menu, menuGroup, menuItemLink } from "app/client/ui2018/menus";
import { PermissionDataWithExtraUsers } from "app/common/ActiveDocAPI";
import { IGristUrlState, userOverrideParams } from "app/common/gristUrls";
import { waitGrainObs } from "app/common/gutil";
import { FullUser } from "app/common/LoginSessionAPI";
import { ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL } from "app/common/UserAPI";
import { compareUsersForDisplay, getRealAccess, UserAccessData } from "app/common/UserAPI";
import { getUserRoleText } from "app/common/UserAPI";

import { Disposable, dom, Observable, styled } from "grainjs";
import noop from "lodash/noop";
import { IMenuOptions } from "popweasel";

const t = makeT("ACLUsers");
const userT = makeT("UserManagerModel");

function isSpecialEmail(email: string) {
  return email === ANONYMOUS_USER_EMAIL || email === EVERYONE_EMAIL;
}

export class ACLUsersPopup extends Disposable {
  public readonly isInitialized = Observable.create(this, false);
  public readonly allUsers = Observable.create<UserAccessData[]>(this, []);
  private _shareUsers: UserAccessData[] = [];           // Users doc is shared with.
  private _attributeTableUsers: UserAccessData[] = [];  // Users mentioned in attribute tables.
  private _exampleUsers: UserAccessData[] = [];         // Example users.
  private _currentUser: FullUser | null = null;

  constructor(public pageModel: DocPageModel,
    private _fetch: () => Promise<PermissionDataWithExtraUsers | null> = () => this._fetchData()) {
    super();
  }

  public async load() {
    const permissionData = await this._fetch();
    if (this.isDisposed()) { return; }
    this.init(permissionData);
  }

  public getUsers() {
    const users = [...this._shareUsers, ...this._attributeTableUsers];
    if (this._showExampleUsers()) { users.push(...this._exampleUsers); }
    return users;
  }

  public init(permissionData: PermissionDataWithExtraUsers | null) {
    const pageModel = this.pageModel;
    this._currentUser = pageModel.userOverride.get()?.user || pageModel.appModel.currentValidUser;

    if (permissionData) {
      this._shareUsers = permissionData.users.map(user => ({
        ...user,
        access: getRealAccess(user, permissionData),
      }))
        .filter(user => user.access && !isSpecialEmail(user.email))
        .filter(user => this._currentUser?.id !== user.id)
        .sort(compareUsersForDisplay);
      this._attributeTableUsers = [...permissionData.attributeTableUsers].sort(compareUsersForDisplay);
      // Example users are kept in their original order (owner, editor, viewer).
      this._exampleUsers = permissionData.exampleUsers;
      this.allUsers.set(this.getUsers());
      this.isInitialized.set(true);
    }
  }

  // Optionally have document page reverts to the default page upon activation of the view as mode
  // by setting `options.resetDocPage` to true.
  public attachPopup(elem: HTMLElement, options: IMenuOptions & { resetDocPage?: boolean }) {
    const { resetDocPage, ...menuOptions } = options;
    menu(() => {
      const buildRow =
        (user: UserAccessData) => this._buildUserRow(user, { resetDocPage });
      const buildExampleUserRow =
        (user: UserAccessData) => this._buildUserRow(user, { isExampleUser: true, resetDocPage });
      return [
        cssUsers.cls(""),
        this._shareUsers.length > 0 ? menuGroup(
          t("Shared users"),
          dom.forEach(this._shareUsers, buildRow),
        ) : null,
        this._attributeTableUsers.length > 0 ? menuGroup(
          t("Other users from table"),
          dom.forEach(this._attributeTableUsers, buildExampleUserRow),
        ) : null,
        // Include example users only if there are not many "real" users.
        // It might be better to have an expandable section with these users, collapsed
        // by default, but that's beyond my UI ken.
        this._showExampleUsers() && this._exampleUsers.length > 0 ? menuGroup(
          t("Example Users"),
          dom.forEach(this._exampleUsers, buildExampleUserRow),
        ) : null,
      ];
    }, menuOptions)(elem);
  }

  // See 'attachPopup' for more info on the 'resetDocPage' option.
  public menu(options: IMenuOptions) {
    return menu(() => {
      this.load().catch(noop);
      return [
        { "aria-labelledby": "view-as-menu-header" },
        cssMenuHeader("view as", {
          id: "view-as-menu-header",
          role: "presentation",
        }),
        dom.forEach(this.allUsers, user => menuItemLink(
          `${user.name || user.email} (${getUserRoleText(user)})`,
          testId("acl-user-access"),
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

  private _buildUserRow(user: UserAccessData, opt: { isExampleUser?: boolean, resetDocPage?: boolean } = {}) {
    return menuItemLink(
      cssUserItem.cls(""),
      cssMemberImage(
        createUserImage(opt.isExampleUser ? "exampleUser" : user, "large"),
      ),
      cssMemberText(
        cssMemberPrimary(user.name || dom("span", user.email),
          cssRole("(", userT(getUserRoleText(user)), ")", testId("acl-user-access")),
        ),
        user.name ? cssMemberSecondary(user.email) : null,
      ),
      this._viewAs(user, opt.resetDocPage),
      testId("acl-user-item"),
    );
  }

  private _viewAs(user: UserAccessData, resetDocPage: boolean = false) {
    const extraState: IGristUrlState = {};
    if (resetDocPage) { extraState.docPage = undefined; }
    if (this.pageModel?.isPrefork.get() &&
      this.pageModel?.currentDoc.get()?.access !== "owners") {
      // "View As" is restricted to document owners on the back-end. Non-owners can be
      // permitted to pretend to be owners of a pre-forked document, but if they want
      // to do "View As", that would be layering pretence over pretense. Better to just
      // go ahead and create the fork, so the user becomes a genuine owner, so the
      // back-end doesn't have to become too metaphysical (and maybe hard to review).
      return dom.on("click", async () => {
        const forkResult = await this.pageModel?.gristDoc.get()?.docComm.fork();
        if (!forkResult) { throw new Error("Failed to create fork"); }
        window.location.assign(urlState().makeUrl(userOverrideParams(user.email,
          { ...extraState, doc: forkResult.urlId })));
      });
    } else {
      // When forking isn't needed, we return a direct link to be maximally transparent
      // about where button will go.
      return urlState().setHref(userOverrideParams(user.email, extraState));
    }
  }
}

const cssUsers = styled("div", `
  max-width: unset;
`);

const cssUserItem = styled(cssMemberListItem, `
  width: auto;
  padding: 8px 16px;
  align-items: center;
`);

const cssRole = styled("span", `
  margin: 0 8px;
  font-weight: normal;
`);

const cssMenuHeader = styled("div", `
  margin: 8px 24px;
  margin-bottom: 4px;
  font-weight: 700;
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.darkText};
`);
