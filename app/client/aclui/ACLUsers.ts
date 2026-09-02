import { normalizeText } from "app/client/lib/ACIndex";
import { makeT } from "app/client/lib/localization";
import { DocPageModel } from "app/client/models/DocPageModel";
import { urlState } from "app/client/models/gristUrlState";
import { createUserImage } from "app/client/ui/UserImage";
import { cssMemberImage, cssMemberListItem, cssMemberPrimary,
  cssMemberSecondary, cssMemberText } from "app/client/ui/UserItem";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { cssTextInput } from "app/client/ui2018/editableLabel";
import { icon } from "app/client/ui2018/icons";
import { gristFloatingMenuClass, menu, menuCssClass, menuItemLink } from "app/client/ui2018/menus";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { PermissionDataWithExtraUsers } from "app/common/ActiveDocAPI";
import { IGristUrlState, userOverrideParams } from "app/common/gristUrls";
import { waitGrainObs } from "app/common/gutil";
import { FullUser } from "app/common/LoginSessionAPI";
import { tokens } from "app/common/ThemePrefs";
import { ANONYMOUS_USER_EMAIL, EVERYONE_EMAIL } from "app/common/UserAPI";
import { getRealAccess, UserAccessData } from "app/common/UserAPI";
import { getUserRoleText } from "app/common/UserAPI";

import { Computed, Disposable, dom, IDisposableOwner, input, Observable, styled, UseCB } from "grainjs";
import noop from "lodash/noop";
import { cssMenu, cssMenuWrap, defaultMenuOptions, IMenuOptions, IPopupOptions, setPopupToCreateDom } from "popweasel";

const t = makeT("ACLUsers");
const userT = makeT("UserManagerModel");

const FILTER_THRESHOLD = 10;

function isSpecialEmail(email: string) {
  return email === ANONYMOUS_USER_EMAIL || email === EVERYONE_EMAIL;
}

function userMatchesFilter(user: UserAccessData, filter: string): boolean {
  if (!filter) { return true; }
  const q = normalizeText(filter);
  return normalizeText(user.name || "").includes(q) ||
    normalizeText(user.email || "").includes(q);
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
        .filter(user => this._currentUser?.id !== user.id);
      this._attributeTableUsers = permissionData.attributeTableUsers;
      this._exampleUsers = permissionData.exampleUsers;
      this.allUsers.set(this.getUsers());
      this.isInitialized.set(true);
    }
  }

  // Render a popup to select a user to "view as", listing users in groups (shared, attribute table, example users).
  // Optionally have document page reverts to the default page upon activation of the view as mode
  // by setting `options.resetDocPage` to true.
  public attachPopup(elem: Element, options: IPopupOptions & { resetDocPage?: boolean }) {
    setPopupToCreateDom(elem, (ctl) => {
      const buildRow =
        (user: UserAccessData) => this._buildUserRow(user, options);
      const buildExampleUserRow =
        (user: UserAccessData) => this._buildUserRow(user, { isExampleUser: true, ...options });

      const filter = this._createUserFilter(ctl);
      const shareUsers = filter.filterUsers(this._shareUsers);
      const attributeTableUsers = filter.filterUsers(this._attributeTableUsers);
      const exampleUsers = filter.filterUsers(this._exampleUsers);
      const showExampleUsers = this._showExampleUsers();

      return cssMenuWrap(cssMenu(
        dom.cls(menuCssClass),
        dom.cls(gristFloatingMenuClass),
        cssUsers.cls(""),
        // Drop the menu's top padding so sticky can sit at top: 0 without jitter.
        cssUsers.cls("-with-sticky-heading", filter.showFilter),
        filter.filterDom,
        cssHeader(t("Shared users"),
          dom.show(use => use(shareUsers).length > 0)),
        dom.forEach(shareUsers, buildRow),
        cssHeader(t("Other users from table"),
          dom.show(use => use(attributeTableUsers).length > 0)),
        dom.forEach(attributeTableUsers, buildExampleUserRow),
        // Include example users only if there are not many "real" users.
        // It might be better to have an expandable section with these users, collapsed
        // by default, but that's beyond my UI ken.
        showExampleUsers ? [
          cssHeader(t("Example Users"),
            dom.show(use => use(exampleUsers).length > 0)),
          dom.forEach(exampleUsers, buildExampleUserRow),
        ] : null,
        filter.noResults(use =>
          use(shareUsers).length === 0 &&
          use(attributeTableUsers).length === 0 &&
          (!showExampleUsers || use(exampleUsers).length === 0)),
        ...filter.openArgs(),
      ));
    }, { ...defaultMenuOptions, ...options });
  }

  // Render a popup to select a user to "view as", listing all users without any grouping.
  // See 'attachPopup' for more info on the 'resetDocPage' option.
  public menu(options: IMenuOptions) {
    return menu((ctl) => {
      this.load().catch(noop);

      const filter = this._createUserFilter(ctl);
      const filteredUsers = filter.filterUsers(this.allUsers);

      return [
        filter.filterDom,
        // When the filter is shown, its sticky header replaces this label.
        filter.showFilter ? null : cssMenuHeader("view as"),
        dom.forEach(filteredUsers, user => menuItemLink(
          `${user.name || user.email} (${getUserRoleText(user)})`,
          testId("acl-user-access"),
          this._viewAs(user),
        )),
        filter.noResults(use => use(filteredUsers).length === 0),
        // Standard menus keep cssMenuElem top padding; clear it so sticky spacing matches attachPopup.
        ...filter.openArgs({ clearPaddingTop: true }),
      ];
    }, options);
  }

  /**
   * Shared filter state/UI for the "view as" menus (attachPopup and menu).
   */
  private _createUserFilter(ctl: IDisposableOwner & { close(): void }) {
    const showFilter = this.getUsers().length > FILTER_THRESHOLD;
    const filterText = Observable.create(ctl, "");
    let filterInput: HTMLInputElement | undefined;

    return {
      showFilter,
      /** Filter a static list or an observable list of users. */
      filterUsers: (users: UserAccessData[] | Observable<UserAccessData[]>) =>
        Computed.create(ctl, (use) => {
          const list = Array.isArray(users) ? users : use(users);
          const q = use(filterText).trim();
          return q ? list.filter(u => userMatchesFilter(u, q)) : list;
        }),
      /** Sticky filter input, or null when below the threshold. */
      filterDom: showFilter ? this._buildFilter(filterText, (el) => { filterInput = el; }) : null,
      /** Empty-state message when a filter is active and isEmpty is true. */
      noResults: (isEmpty: (use: UseCB) => boolean) => {
        const noMatching = Computed.create(ctl, use =>
          Boolean(use(filterText).trim()) && isEmpty(use));
        return dom.maybe(noMatching, () =>
          cssNoResults(t("No matching users"), testId("acl-user-filter-empty")),
        );
      },
      /** Focus/width lock and Escape-to-clear, applied to the menu root. */
      openArgs: (options: { clearPaddingTop?: boolean } = {}) => [
        (el: HTMLElement) => {
          setTimeout(() => {
            if (showFilter) {
              if (options.clearPaddingTop) {
                el.style.paddingTop = "0";
              }
              // Lock width to the initial layout so filtering doesn't shrink/grow the popup.
              el.style.width = `${el.getBoundingClientRect().width}px`;
            }
            // Bypass weasel.menu's auto-focus on the menu container to focus the filter input.
            // The better way to handle that for accessibility purpose would be to stop using weasel.menu directly
            setTimeout(() => (filterInput || el).focus(), 0);
          }, 0);
        },
        dom.onKeyDown({
          Escape$: (ev) => {
            if (filterText.get()) {
              filterText.set("");
              filterInput?.focus();
              ev.stopPropagation();
            } else {
              ctl.close();
            }
          },
        }),
      ],
    };
  }

  private _buildFilter(
    filterText: Observable<string>,
    onInputCreated: (el: HTMLInputElement) => void,
  ) {
    let filterInput: HTMLInputElement;
    return cssStickyFilterContainer(
      cssFilterHeader(t("Search users"), { id: "acl-user-filter-header" }),
      cssFilterInputContainer(
        filterInput = cssFilterInput(filterText, { onInput: true },
          dom.cls(cssTextInput.className),
          {
            "type": "search",
            "placeholder": t("Filter by name or email"),
            "aria-labelledby": "acl-user-filter-header",
          },
          (el) => { onInputCreated(el); },
          testId("acl-user-filter"),
        ),
        dom.maybe(filterText, () => cssFilterClearButton(
          icon("CrossSmall"),
          { "aria-label": t("Clear filter") },
          testId("acl-user-filter-clear"),
          dom.on("click", () => {
            filterText.set("");
            filterInput.focus();
          }),
        )),
        // Prevent clicks on the filter from closing the menu.
        dom.on("click", ev => ev.stopPropagation()),
      ),
    );
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
    return dom("a",
      { class: cssMemberListItem.className + " " + cssUserItem.className },
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
  &-with-sticky-heading {
    /* Cancel cssMenuElem's top padding; sticky header owns that spacing instead. */
    padding: 0 0 16px 0;
  }
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

const cssRole = styled("span", `
  margin: 0 8px;
  font-weight: normal;
`);

const cssStickyFilterContainer = styled("div", `
  position: sticky;
  top: 0;
  z-index: 1;
  /* Replaces the menu's top padding so spacing is inside the sticky layer. */
  padding-top: 8px;
  background-color: ${theme.menuBg};
  padding-bottom: 16px;
  border-bottom: 1px solid ${tokens.decorationSecondary};
  margin-bottom: 11px;
`);

const cssHeader = styled("div", `
  margin: 11px 24px 14px 24px;
  font-weight: 700;
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.darkText};

  .${cssStickyFilterContainer.className} + & {
    margin-top: 16px;
  }
`);

const cssMenuHeader = styled("div", `
  margin: 8px 24px;
  margin-bottom: 4px;
  font-weight: 700;
  text-transform: uppercase;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.darkText};
`);

const cssFilterHeader = styled(cssHeader, `
  margin: 0;
  padding: 11px 24px 14px 24px;
`);

const cssFilterInputContainer = styled("div", `
  position: relative;
  display: flex;
  align-items: center;
  margin: 0 24px;
`);

const cssFilterInput = styled(input, `
  flex: 1 1 auto;
  min-width: 0;
  width: auto;

  &::-webkit-search-cancel-button {
    -webkit-appearance: none;
  }
`);

const cssFilterClearButton = styled(unstyledButton, `
  --icon-color: ${theme.lightText};
  position: absolute;
  top: 0;
  right: 8px;
  bottom: 0;
  margin: auto;
  display: flex;
  align-items: center;
  cursor: pointer;
`);

const cssNoResults = styled("div", `
  margin: 8px 24px 0 24px;
  font-style: italic;
  color: ${theme.lightText};
`);
