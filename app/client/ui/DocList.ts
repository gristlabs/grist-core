import { stopEvent } from "app/client/lib/domUtils";
import { loadUserManager } from "app/client/lib/imports";
import { makeT } from "app/client/lib/localization";
import { getTimeFromNow } from "app/client/lib/timeUtils";
import { docUrl, urlState } from "app/client/models/gristUrlState";
import { HomeModel, ViewSettings } from "app/client/models/HomeModel";
import { workspaceName } from "app/client/models/WorkspaceInfo";
import { contextMenu } from "app/client/ui/contextMenu";
import { buildDocIcon } from "app/client/ui/DocIcon";
import { STICKY_HEADER_HEIGHT_PX } from "app/client/ui/DocMenuCss";
import { showRenameDocModal } from "app/client/ui/RenameDocModal";
import { shadowScroll } from "app/client/ui/shadowScroll";
import { makeShareDocUrl } from "app/client/ui/ShareMenu";
import {
  isNarrowScreenObs,
  mediaMedium,
  theme,
  vars,
} from "app/client/ui2018/cssVars";
import { IconName } from "app/client/ui2018/IconList";
import { icon as cssIcon } from "app/client/ui2018/icons";
import { menu, menuItem, select } from "app/client/ui2018/menus";
import { confirmModal, saveModal } from "app/client/ui2018/modals";
import { HomePageTab } from "app/common/gristUrls";
import { SortPref } from "app/common/Prefs";
import * as roles from "app/common/roles";
import { Document } from "app/common/UserAPI";
import {
  Computed,
  Disposable,
  dom,
  makeTestId,
  Observable,
  styled,
} from "grainjs";
import sortBy from "lodash/sortBy";

const t = makeT("DocList");

const testId = makeTestId("test-dm-");

interface DocListOptions {
  home: HomeModel;
  viewSettings?: ViewSettings;
}

export class DocList extends Disposable {
  private readonly _home = this._options.home;
  private readonly _tabs: Computed<HomePageTab[]> = Computed.create(
    this,
    this._home.currentPage,
    (_use, page) => {
      if (page === "all") {
        return ["recent", "pinned", "all"];
      } else {
        return ["all", "pinned"];
      }
    }
  );
  private readonly _viewSettings =
    this._options.viewSettings ?? this._options.home;
  private readonly _tab = Computed.create(
    this,
    this._tabs,
    urlState().state,
    (_use, tabs, { homePageTab }) => {
      return homePageTab && tabs.includes(homePageTab) ? homePageTab : tabs[0];
    }
  );
  private readonly _tabIconsAndLabels = getTabIconsAndLabels();
  private readonly _showWorkspace = Computed.create(
    this,
    this._home.currentPage,
    (_use, page) => {
      return page !== "workspace";
    }
  );

  constructor(private _options: DocListOptions) {
    super();
  }

  public buildDom() {
    return dom("div", this._buildHeader(), this._buildBody());
  }

  private _buildHeader() {
    return cssHeader(
      cssTabs(dom.forEach(this._tabs, (tab) => this._buildTab(tab))),
      this._buildViewSettings()
    );
  }

  private _buildTab(homePageTab: HomePageTab) {
    const { icon, label } = this._tabIconsAndLabels[homePageTab];
    return cssTab(
      cssIconAndLabel(cssTabIcon(icon, dom.hide(isNarrowScreenObs())),
        // The combination with spacer makes the label as wide as its bold version,
        // to avoid slight shifts of other labels when switching tabs.
        dom('div', label, cssBoldLabelSpacer(label))),
      cssTab.cls("-selected", (use) => use(this._tab) === homePageTab),
      urlState().setLinkUrl({ homePageTab }, { replace: true }),
      testId("tab")
    );
  }

  private _buildViewSettings() {
    return dom.maybe(
      (use) => use(this._tab) !== "recent",
      () =>
        cssViewSettings(
          dom.update(
            select<SortPref>(
              this._viewSettings.currentSort,
              [
                { value: "name", label: t("Sort by name") },
                { value: "date", label: t("Sort by date") },
              ],
              { buttonCssClass: cssSortSelect.className }
            ),
            testId("sort-mode")
          )
        )
    );
  }

  private _buildBody() {
    const { currentSort } = this._viewSettings;
    return [
      dom.domComputed(
        (use) => ({
          docs: use(this._home.currentWSDocs),
          sort: use(currentSort),
          tab: use(this._tab),
        }),
        ({ docs, sort, tab }) => {
          docs = sortAndFilterDocs(docs, { sort, tab });
          if (docs.length === 0) {
            return cssNoDocsMessage(
              cssNoDocsImage({ src: "img/create-document.svg" }),
              dom("div", cssParagraph(t("No documents to show."))),
              testId("no-docs-message")
            );
          }

          return [
            cssDocHeaderRow(
              dom.hide(isNarrowScreenObs()),
              cssNameColumn(t("Name")),
              cssWorkspaceColumn(t("Workspace"), dom.show(this._showWorkspace)),
              cssEditedAtColumn(t("Last edited")),
              cssOptionsColumn()
            ),
            dom.forEach(docs, (doc) => {
              return cssDocRow(
                cssDoc(
                  urlState().setLinkUrl(docUrl(doc)),
                  cssDoc.cls("-no-access", !roles.canView(doc.access)),
                  cssDocIconAndName(
                    buildDocIcon(
                      {
                        docId: doc.id,
                        docName: doc.name,
                        icon: doc.options?.appearance?.icon,
                      },
                      testId("doc-icon")
                    ),
                    cssDocNameAndBadges(
                      cssDocName(doc.name, testId("doc-name")),
                      cssDocBadges(
                        !doc.isPinned
                          ? null
                          : cssPinIcon("Pin2", testId("doc-pinned")),
                        !doc.public
                          ? null
                          : cssWorldIcon("World", testId("doc-public"))
                      )
                    )
                  ),
                  cssDocWorkspace(
                    dom.show(this._showWorkspace),
                    workspaceName(this._home.app, doc.workspace),
                    testId("doc-workspace")
                  ),
                  cssDocEditedAt(
                    t("Edited {{at}}", { at: getTimeFromNow(doc.updatedAt) }),
                    testId("doc-edited-at")
                  ),
                  cssDocDetailsCompact(
                    cssDocName(doc.name),
                    cssDocEditedAt(
                      t("Edited {{at}}", {
                        at: getTimeFromNow(doc.updatedAt),
                      })
                    ),
                    cssDocBadges(
                      !doc.isPinned
                        ? null
                        : cssPinIcon("Pin2"),
                      !doc.public
                        ? null
                        : cssWorldIcon("World")
                    )
                  ),
                  cssDocOptions(
                    cssDotsIcon("Dots"),
                    menu(() => makeDocOptionsMenu(this._home, doc), {
                      placement: "bottom-start",
                      // Keep the document highlighted while the menu is open.
                      parentSelectorToMark: "." + cssDocRow.className,
                    }),
                    dom.on("click", (ev) => stopEvent(ev)),
                    testId("doc-options")
                  ),
                  contextMenu(() => makeDocOptionsMenu(this._home, doc), {
                    // Keep the document highlighted while the menu is open.
                    parentSelectorToMark: "." + cssDocRow.className,
                  }),
                  testId("doc")
                )
              );
            }),
          ];
        }
      ),
    ];
  }
}

export function makeDocOptionsMenu(home: HomeModel, doc: Document) {
  const org = home.app.currentOrg;
  const orgAccess: roles.Role | null = org ? org.access : null;

  function deleteDoc() {
    confirmModal(
      t("Delete {{name}}", { name: doc.name }),
      t("Delete"),
      () => home.deleteDoc(doc.id, false).catch(reportError),
      { explanation: t("Document will be moved to Trash.") }
    );
  }

  async function manageUsers() {
    const api = home.app.api;
    const user = home.app.currentUser;
    (await loadUserManager()).showUserManagerModal(api, {
      permissionData: api.getDocAccess(doc.id),
      activeUser: user,
      resourceType: "document",
      resourceId: doc.id,
      resource: doc,
      linkToCopy: makeShareDocUrl(doc),
      reload: () => api.getDocAccess(doc.id),
      onSave: () => home.updateWorkspaces(),
      appModel: home.app,
    });
  }

  return [
    menuItem(
      () => showRenameDocModal({ home, doc }),
      t("Rename and set icon"),
      dom.cls("disabled", !roles.isOwner(doc)),
      testId("rename-doc")
    ),
    menuItem(
      () => showMoveDocModal(home, doc),
      t("Move"),
      // Note that moving the doc requires ACL access on the doc. Moving a doc to a workspace
      // that confers descendant ACL access could otherwise increase the user's access to the doc.
      // By requiring the user to have ACL edit access on the doc to move it prevents using this
      // as a tool to gain greater access control over the doc.
      // Having ACL edit access on the doc means the user is also powerful enough to remove
      // the doc, so this is the only access check required to move the doc out of this workspace.
      // The user must also have edit access on the destination, however, for the move to work.
      dom.cls("disabled", !roles.canEditAccess(doc.access)),
      testId("move-doc")
    ),
    menuItem(
      deleteDoc,
      t("Delete"),
      dom.cls("disabled", !roles.isOwner(doc)),
      testId("delete-doc")
    ),
    menuItem(
      () => home.pinUnpinDoc(doc.id, !doc.isPinned).catch(reportError),
      doc.isPinned ? t("Unpin") : t("Pin"),
      dom.cls("disabled", !roles.canEdit(orgAccess)),
      testId("pin-doc")
    ),
    menuItem(
      manageUsers,
      roles.canEditAccess(doc.access) ? t("Manage users") : t("Access details"),
      testId("doc-access")
    ),
  ];
}

function showMoveDocModal(home: HomeModel, doc: Document) {
  saveModal((_ctl, owner) => {
    const selected: Observable<number | null> = Observable.create(owner, null);
    const body = cssMoveDocModalBody(
      shadowScroll(
        dom.forEach(home.workspaces, (ws) => {
          if (ws.isSupportWorkspace) {
            return null;
          }
          const isCurrent = Boolean(ws.docs.find((_doc) => _doc.id === doc.id));
          const isEditable = roles.canEdit(ws.access);
          const disabled = isCurrent || !isEditable;
          return cssMoveDocListItem(
            cssMoveDocListText(workspaceName(home.app, ws)),
            isCurrent ? cssMoveDocListHintText(t("Current workspace")) : null,
            !isEditable
              ? cssMoveDocListHintText(t("Requires edit permissions"))
              : null,
            cssMoveDocListItem.cls("-disabled", disabled),
            cssMoveDocListItem.cls(
              "-selected",
              (use) => use(selected) === ws.id
            ),
            dom.on("click", () => disabled || selected.set(ws.id)),
            testId("dest-ws")
          );
        })
      )
    );
    return {
      title: t("Move {{name}} to workspace", { name: doc.name }),
      body,
      saveDisabled: Computed.create(owner, (use) => !use(selected)),
      saveFunc: async () =>
        !selected.get() ||
        home.moveDoc(doc.id, selected.get()!).catch(reportError),
      saveLabel: t("Move"),
    };
  });
}

interface IconAndLabel {
  icon: IconName;
  label: string;
}

function getTabIconsAndLabels(): Record<HomePageTab, IconAndLabel> {
  return {
    recent: {
      icon: "Clock",
      label: t("Recent"),
    },
    pinned: {
      icon: "Pin2",
      label: t("Pinned"),
    },
    all: {
      icon: "Layers",
      label: t("All"),
    },
  };
}

interface SortAndFilterOptions {
  sort: SortPref;
  tab: HomePageTab;
}

function sortAndFilterDocs(
  docs: Document[],
  { sort, tab }: SortAndFilterOptions
) {
  if (tab === "pinned") {
    docs = docs.filter(({ isPinned }) => isPinned);
  }
  if (sort === "date" || tab === "recent") {
    docs = sortBy(docs, (doc) => doc.removedAt || doc.updatedAt).reverse();
  } else {
    docs = sortBy(docs, (doc) => doc.name.toLowerCase());
  }
  return docs;
}

export async function renameDoc(home: HomeModel, doc: Document, val: string) {
  if (val !== doc.name) {
    try {
      await home.renameDoc(doc.id, val);
    } catch (err) {
      reportError(err as Error);
    }
  }
}

const cssHeader = styled("div", `
  position: sticky;
  top: ${STICKY_HEADER_HEIGHT_PX}px;
  background-color: ${theme.mainPanelBg};
  z-index: ${vars.stickyHeaderZIndex};
  display: flex;
  column-gap: 24px;
  margin-bottom: 8px;
`);

const cssTabs = styled("div", `
  flex-grow: 1;
  display: flex;
  border-bottom: 1px solid ${theme.tableBodyBorder};
`);

const cssTab = styled("a", `
  display: block;
  padding: 8px 16px;
  color: ${theme.mediumText};
  --icon-color: ${theme.lightText};
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;

  &:hover, &:focus {
    color: ${theme.mediumText};
    text-decoration: none;
  }

  &-selected {
    --icon-color: ${theme.controlFg};
    font-weight: 700;
    border-bottom: 2px solid ${theme.controlFg};
    margin-bottom: -1px;
  }
`);

const cssIconAndLabel = styled("div", `
  display: flex;
  align-items: center;
  column-gap: 8px;
`);

const cssBoldLabelSpacer = styled("div", `
  font-weight: bold;
  height: 1px;
  color: transparent;
  overflow: hidden;
  visibility: hidden;
`);

const cssTabIcon = styled(cssIcon, `
  width: 20px;
  height: 20px;
`);

const cssViewSettings = styled("div", `
  display: flex;
  align-items: flex-end;
  min-width: 0;
`);

const cssSortSelect = styled("div", `
  border: none;
  display: inline-flex;
  column-gap: 6px;
  height: unset;
  line-height: unset;
  align-items: center;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  background-color: unset;
  font-size: 14px;
  font-weight: 500;
  padding: 0;

  &:hover, &:focus, &.weasel-popup-open {
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
    outline: none;
    box-shadow: none;
  }
`);

const cssParagraph = styled("div", `
  color: ${theme.text};
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
  margin-bottom: 12px;
  text-align: center;
`);

const cssNoDocsMessage = styled("div", `
  margin-top: 70px;
  display: flex;
  flex-direction: column;
  row-gap: 16px;
  align-items: center;
  justify-content: center;
`);

const cssNoDocsImage = styled("img", `
  display: flex;
  align-items: center;
  justify-content: center;
`);

const cssDocHeaderRow = styled("div", `
  display: flex;
  padding: 0px 8px;
  color: ${theme.lightText};

  @media ${mediaMedium} {
    & {
      display: none;
    }
  }
`);

const cssNameColumn = styled("div", `
  flex: 1 0 50%;
`);

const cssWorkspaceColumn = styled("div", `
  flex: 1 1 20%;
  margin-right: 40px;
  max-width: 200px;
`);

const cssEditedAtColumn = styled("div", `
  flex: 1 1 30%;
  margin-right: 16px;
  max-width: 250px;
`);

const cssOptionsColumn = styled("div", `
  flex: none;
  width: 44px;
  margin: 0 4px 0 auto;
  padding: 4px;
  display: flex;
`);

const cssDocRow = styled("div", `
  position: relative;
  border-radius: 3px;
  font-size: 14px;
  color: ${theme.text};
  --icon-color: ${theme.lightText};

  &:hover, &.weasel-popup-open {
    background-color: ${theme.lightHover};
  }
`);

const cssDoc = styled("a", `
  display: flex;
  align-items: center;
  border-radius: 3px;
  outline: none;
  padding: 8px;

  &, &:hover, &:focus {
    text-decoration: none;
    outline: none;
    color: inherit;
  }

  &-no-access, &-no-access:hover, &-no-access:focus {
    color: ${theme.disabledText};
    cursor: not-allowed;
  }

  @media ${mediaMedium} {
    & {
      align-items: initial;
      column-gap: 16px;
    }
  }
`);

const cssDocDetailsCompact = styled("div", `
  display: none;
  flex: 1 1 auto;
  flex-direction: column;
  row-gap: 8px;
  column-gap: 40px;
  min-width: 0px;
  align-items: flex-start;

  @media ${mediaMedium} {
    & {
      display: flex;
    }
  }
`);

const cssDocIconAndName = styled(cssNameColumn, `
  display: flex;
  align-items: center;
  column-gap: 16px;
  overflow: hidden;

  @media ${mediaMedium} {
    & {
      align-items: initial;
      flex: none;
    }
  }
`);

const cssDocNameAndBadges = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-right: 40px;
  overflow: hidden;

  @media ${mediaMedium} {
    & {
      display: none;
    }
  }
`);

const noAccessStyles = `
  .${cssDoc.className}-no-access &,
  .${cssDoc.className}-no-access:hover &,
  .${cssDoc.className}-no-access:focus & {
    color: ${theme.disabledText};
  }
`;

const cssDocName = styled("div", `
  font-size: 14px;
  flex: 0 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: ${theme.text};
  font-weight: 600;

  ${noAccessStyles}

  @media ${mediaMedium} {
    & {
      width: 100%;
    }
  }
`);

const cssDocBadges = styled("div", `
  display: flex;
  align-items: center;
  flex-shrink: 0;
  column-gap: 8px;
  margin-left: auto;
  min-height: 16px;

  @media ${mediaMedium} {
    & {
      margin-left: initial;
    }
  }
`);

const cssPinIcon = styled(cssIcon, `
  flex: none;
  --icon-color: ${theme.lightText};
`);

const cssWorldIcon = styled(cssIcon, `
  width: 24px;
  height: 24px;
  flex: none;
  --icon-color: ${theme.accentIcon};
`);

const secondaryColumnStyles = `
  color: ${theme.mediumText};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: normal;
  ${noAccessStyles}

  @media ${mediaMedium} {
    .${cssDoc.className} > & {
      display: none;
    }
  }
`;

const cssDocWorkspace = styled(cssWorkspaceColumn, secondaryColumnStyles);

const cssDocEditedAt = styled(cssEditedAtColumn, `
  ${secondaryColumnStyles};

  @media ${mediaMedium} {
    & {
      width: 100%;
    }
  }
`);

const cssDocOptions = styled("div", `
  flex: none;
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 0 4px 0 auto;
  height: 44px;
  width: 44px;
  padding: 4px;
  line-height: 0px;
  border-radius: 4px;
  --icon-color: ${theme.controlFg};

  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`);

const cssDotsIcon = styled(cssIcon, `
  --icon-color: ${theme.controlFg};
  width: 19.2px;
  height: 19.2px;
`);

const cssMoveDocModalBody = styled("div", `
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid ${theme.modalBorderDark};
  margin: 0 -64px;
  height: 200px;
`);

const cssMoveDocListItem = styled("div", `
  display: flex;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  padding: 12px 64px;
  cursor: pointer;
  font-size: ${vars.mediumFontSize};

  &-selected {
    background-color: ${theme.moveDocsSelectedBg};
    color: ${theme.moveDocsSelectedFg};
  }
  &-disabled {
    color: ${theme.moveDocsDisabledFg};
    cursor: default;
  }
`);

const cssMoveDocListText = styled("div", `
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  justify-content: center;
`);

const cssMoveDocListHintText = styled(cssMoveDocListText, `
  text-align: right;
`);
