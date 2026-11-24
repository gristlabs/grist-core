import { makeT } from "app/client/lib/localization";
import { DocPageModel } from "app/client/models/DocPageModel";
import { urlState } from "app/client/models/gristUrlState";
import {
  DropdownWithSearch, IDropdownOption, OptionItem,
} from "app/client/ui/searchDropdown";
import { createUserImage } from "app/client/ui/UserImage";
import { cssMemberImage, cssMemberListItem, cssMemberPrimary,
  cssMemberSecondary, cssMemberText } from "app/client/ui/UserItem";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import {
  gristFloatingMenuClass, menuCssClass, menuGroup, menuItemLink, registerMenuOpen,
} from "app/client/ui2018/menus";
import { PermissionDataWithExtraUsers } from "app/common/ActiveDocAPI";
import { IGristUrlState, userOverrideParams } from "app/common/gristUrls";
import { waitGrainObs } from "app/common/gutil";
import { FullUser } from "app/common/LoginSessionAPI";
import { ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL } from "app/common/UserAPI";
import { compareUsersForDisplay, getRealAccess, UserAccessData } from "app/common/UserAPI";
import { getUserRoleText } from "app/common/UserAPI";

import { Disposable, dom, DomElementMethod, Observable, styled } from "grainjs";
import mergeWith from "lodash/mergeWith";
import noop from "lodash/noop";
import { defaultMenuOptions, IMenuOptions, Menu, setPopupToFunc } from "popweasel";

const t = makeT("ACLUsers");
const userT = makeT("UserManagerModel");

/** Show a filter input once the user list is long enough that scanning is hard. */
const FILTER_THRESHOLD = 10;

function isSpecialEmail(email: string) {
  return email === ANONYMOUS_USER_EMAIL || email === EVERYONE_EMAIL;
}

function userSearchLabel(user: UserAccessData): string {
  return user.name ? `${user.name} (${user.email})` : user.email;
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
    const { resetDocPage = false, ...menuOptions } = options;
    this._attachViewAsPopup(elem, menuOptions, { resetDocPage, richRows: true });
  }

  // See 'attachPopup' for more info on the 'resetDocPage' option.
  public menu(options: IMenuOptions): DomElementMethod {
    return (elem) => {
      this._attachViewAsPopup(elem, options, { resetDocPage: false, richRows: false });
    };
  }

  /**
   * Attaches either a plain weasel menu (few users) or a searchable combobox dropdown (many users).
   * The choice is made when the popup opens, so it sees users after `load()` has completed.
   */
  private _attachViewAsPopup(
    elem: HTMLElement,
    menuOptions: IMenuOptions,
    opt: { resetDocPage: boolean, richRows: boolean },
  ) {
    const popupOptions = mergeWith(
      {},
      defaultMenuOptions,
      {
        menuCssClass: `${menuCssClass} ${gristFloatingMenuClass}`,
      },
      menuOptions,
      (_objValue: any, srcValue: any) => Array.isArray(srcValue) ? srcValue : undefined,
    );

    setPopupToFunc(elem, (ctl) => {
      registerMenuOpen(ctl);
      this.load().catch(noop);

      if (this.getUsers().length > FILTER_THRESHOLD) {
        return (DropdownWithSearch<UserAccessData>).create(null, ctl, this._buildSearchOptions(opt));
      }

      return Menu.create(null, ctl, this._buildPlainMenuContent(opt), popupOptions);
    }, popupOptions);
  }

  private _buildSearchOptions(opt: { resetDocPage: boolean, richRows: boolean }) {
    return {
      // Filter in place (hide non-matches, keep order) — same as former searchableMenu.
      searchMode: "filter" as const,
      placeholder: t("Filter by name or email"),
      searchInputArgs: [testId("acl-user-filter")],
      buildEmptyMessage: () => dom("span", t("No matching users"), testId("acl-user-filter-empty")),
      options: () => opt.richRows ?
        this._buildGroupedSearchOptions() :
        this.getUsers().map(user => ({
          label: userSearchLabel(user),
          value: user,
        })),
      action: (user: UserAccessData) => { this._activateViewAs(user, opt.resetDocPage); },
      renderItem: opt.richRows ?
        (item: OptionItem<UserAccessData>) => cssUserItemInSearch(
          this._buildUserRowContent(item.value, {
            // Attribute-table and example users use the example avatar (matches plain menu).
            isExampleUser: this._usesExampleAvatar(item.value),
          }),
        ) :
        (item: OptionItem<UserAccessData>) => dom("span",
          `${item.value.name || item.value.email} (${getUserRoleText(item.value)})`,
          testId("acl-user-access"),
        ),
    };
  }

  /**
   * Grouped options for the ACL-page "View as" popup: section headers plus users.
   * Headers are skipped by search indexing and re-inserted above matching users.
   */
  private _buildGroupedSearchOptions(): IDropdownOption<UserAccessData>[] {
    const items: IDropdownOption<UserAccessData>[] = [];
    const addGroup = (heading: string, users: UserAccessData[]) => {
      if (users.length === 0) { return; }
      items.push({ label: heading, header: true });
      for (const user of users) {
        items.push({ label: userSearchLabel(user), value: user });
      }
    };

    addGroup(t("Shared users"), this._shareUsers);
    addGroup(t("Other users from table"), this._attributeTableUsers);
    if (this._showExampleUsers()) {
      addGroup(t("Example Users"), this._exampleUsers);
    }
    return items;
  }

  private _usesExampleAvatar(user: UserAccessData): boolean {
    return this._exampleUsers.includes(user) || this._attributeTableUsers.includes(user);
  }

  private _buildPlainMenuContent(opt: { resetDocPage: boolean, richRows: boolean }) {
    if (opt.richRows) {
      const buildRow =
        (user: UserAccessData) => this._buildUserRow(user, { resetDocPage: opt.resetDocPage });
      const buildExampleUserRow =
        (user: UserAccessData) => this._buildUserRow(user, {
          isExampleUser: true,
          resetDocPage: opt.resetDocPage,
        });
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
        this._showExampleUsers() && this._exampleUsers.length > 0 ? menuGroup(
          t("Example Users"),
          dom.forEach(this._exampleUsers, buildExampleUserRow),
        ) : null,
      ];
    }

    return [
      { "aria-labelledby": "view-as-menu-header" },
      cssMenuHeader("view as", {
        id: "view-as-menu-header",
        role: "presentation",
      }),
      dom.forEach(this.allUsers, user => menuItemLink(
        `${user.name || user.email} (${getUserRoleText(user)})`,
        testId("acl-user-access"),
        this._viewAsHref(user),
      )),
    ];
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
      ...this._buildUserRowContent(user, opt),
      this._viewAsHref(user, opt.resetDocPage),
    );
  }

  private _buildUserRowContent(user: UserAccessData, opt: { isExampleUser?: boolean } = {}) {
    return [
      cssMemberImage(
        createUserImage(opt.isExampleUser ? "exampleUser" : user, "large"),
      ),
      cssMemberText(
        cssMemberPrimary(user.name || dom("span", user.email),
          cssRole("(", userT(getUserRoleText(user)), ")", testId("acl-user-access")),
        ),
        user.name ? cssMemberSecondary(user.email) : null,
      ),
      testId("acl-user-item"),
    ];
  }

  /** Used by the searchable dropdown, which has no `<a href>` — navigate on select. */
  private _activateViewAs(user: UserAccessData, resetDocPage: boolean = false) {
    const extraState = this._viewAsExtraState(resetDocPage);
    if (this._viewAsNeedsFork()) {
      void this._forkThenViewAs(user, extraState);
    } else {
      window.location.assign(urlState().makeUrl(userOverrideParams(user.email, extraState)));
    }
  }

  /**
   * Used by plain menu rows. Prefer a real href when possible so the destination
   * is visible; fall back to a click handler when a fork must be created first.
   */
  private _viewAsHref(user: UserAccessData, resetDocPage: boolean = false) {
    const extraState = this._viewAsExtraState(resetDocPage);
    if (this._viewAsNeedsFork()) {
      // "View As" is restricted to document owners on the back-end. Non-owners can be
      // permitted to pretend to be owners of a pre-forked document, but if they want
      // to do "View As", that would be layering pretence over pretense. Better to just
      // go ahead and create the fork, so the user becomes a genuine owner, so the
      // back-end doesn't have to become too metaphysical (and maybe hard to review).
      return dom.on("click", () => this._forkThenViewAs(user, extraState));
    }
    // When forking isn't needed, return a direct link to be maximally transparent
    // about where the button will go.
    return urlState().setHref(userOverrideParams(user.email, extraState));
  }

  private _viewAsExtraState(resetDocPage: boolean): IGristUrlState {
    return resetDocPage ? { docPage: undefined } : {};
  }

  private _viewAsNeedsFork(): boolean {
    return Boolean(
      this.pageModel?.isPrefork.get() &&
      this.pageModel?.currentDoc.get()?.access !== "owners",
    );
  }

  private async _forkThenViewAs(user: UserAccessData, extraState: IGristUrlState) {
    const forkResult = await this.pageModel?.gristDoc.get()?.docComm.fork();
    if (!forkResult) { throw new Error("Failed to create fork"); }
    window.location.assign(urlState().makeUrl(userOverrideParams(user.email,
      { ...extraState, doc: forkResult.urlId })));
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

/** User row inside dropdownWithSearch: cancel the option-row's own padding. */
const cssUserItemInSearch = styled(cssUserItem, `
  margin: -8px -24px;
  min-height: unset;
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
