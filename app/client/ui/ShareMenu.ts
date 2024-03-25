import {hooks} from 'app/client/Hooks';
import {loadUserManager} from 'app/client/lib/imports';
import {AppModel, reportError} from 'app/client/models/AppModel';
import {DocInfo, DocPageModel} from 'app/client/models/DocPageModel';
import {docUrl, getLoginOrSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {downloadDocModal, makeCopy, replaceTrunkWithFork} from 'app/client/ui/MakeCopyMenu';
import {sendToDrive} from 'app/client/ui/sendToDrive';
import {hoverTooltip, withInfoTooltip} from 'app/client/ui/tooltips';
import {cssHoverCircle, cssTopBarBtn} from 'app/client/ui/TopBarCss';
import {primaryButton} from 'app/client/ui2018/buttons';
import {mediaXSmall, testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuAnnotate, menuDivider, menuIcon, menuItem, menuItemLink, menuItemSubmenu,
        menuText} from 'app/client/ui2018/menus';
import {buildUrlId, isFeatureEnabled, parseUrlId} from 'app/common/gristUrls';
import * as roles from 'app/common/roles';
import {Document} from 'app/common/UserAPI';
import {dom, DomContents, styled} from 'grainjs';
import {cssMenuItem, MenuCreateFunc} from 'popweasel';
import {makeT} from 'app/client/lib/localization';

const t = makeT('ShareMenu');

function buildOriginalUrlId(urlId: string, isSnapshot: boolean): string {
  const parts = parseUrlId(urlId);
  return isSnapshot ? buildUrlId({...parts, snapshotId: undefined}) : parts.trunkId;
}

/**
 * Builds the content of the export menu. The menu button and contents render differently for
 * different modes (normal, pre-fork, fork, snapshot).
 */
export function buildShareMenuButton(pageModel: DocPageModel): DomContents {
  // The menu needs pageModel.currentDoc to render the button. It further needs pageModel.gristDoc
  // to render its contents, but we handle by merely skipping such content if gristDoc is not yet
  // available (a user quick enough to open the menu in this state would have to re-open it).
  return dom.maybe(pageModel.currentDoc, (doc) => {
    const saveCopy = () => handleSaveCopy({pageModel, doc, modalTitle: t("Save Document")});
    if (doc.isSnapshot) {
      const backToCurrent = () => urlState().pushUrl({doc: buildOriginalUrlId(doc.id, true)});
      return shareButton(t("Back to Current"), () => [
        menuManageUsers(doc, pageModel),
        menuSaveCopy({pageModel, doc, saveActionTitle: t("Save Copy")}),
        menuOriginal(doc, pageModel, {isSnapshot: true}),
        menuExports(doc, pageModel),
      ], {buttonAction: backToCurrent});
    } else if (doc.isTutorialFork) {
      return shareButton(t("Save Copy"), () => [
        menuSaveCopy({pageModel, doc, saveActionTitle: t("Save Copy")}),
        menuOriginal(doc, pageModel, {isTutorialFork: true}),
        menuExports(doc, pageModel),
      ], {buttonAction: saveCopy});
    } else if (doc.isPreFork || doc.isBareFork) {
      // A new unsaved document, or a fiddle, or a public example.
      const saveActionTitle = doc.isBareFork ? t("Save Document") : t("Save Copy");
      return shareButton(saveActionTitle, () => [
        menuManageUsers(doc, pageModel),
        menuSaveCopy({pageModel, doc, saveActionTitle}),
        menuExports(doc, pageModel),
      ], {buttonAction: saveCopy});
    } else if (doc.isFork) {
      // For forks, the main actions are "Replace Original" and "Save Copy". When "Replace
      // Original" is unavailable (for samples, forks of public docs, etc), we'll consider "Save
      // Copy" primary and keep it as an action button on top. Otherwise, show a tag without a
      // default action; click opens the menu where the user can choose.
      if (!roles.canEdit(doc.trunkAccess || null)) {
        return shareButton(t("Save Copy"), () => [
          menuManageUsers(doc, pageModel),
          menuSaveCopy({pageModel, doc, saveActionTitle: t("Save Copy")}),
          menuOriginal(doc, pageModel),
          menuExports(doc, pageModel),
        ], {buttonAction: saveCopy});
      } else {
        return shareButton(t("Unsaved"), () => [
          menuManageUsers(doc, pageModel),
          menuSaveCopy({pageModel, doc, saveActionTitle: t("Save Copy")}),
          menuOriginal(doc, pageModel),
          menuExports(doc, pageModel),
        ]);
      }
    } else {
      return shareButton(null, () => [
        menuManageUsers(doc, pageModel),
        menuSaveCopy({pageModel, doc, saveActionTitle: t("Duplicate Document")}),
        menuWorkOnCopy(pageModel),
        menuExports(doc, pageModel),
      ]);
    }
  });
}

/**
 * Render the share button, possibly as a text+icon pair when buttonText is not null. The text
 * portion can be an independent action button (when buttonAction is given), or simply a more
 * visible extension of the icon that opens the menu.
 */
function shareButton(buttonText: string|null, menuCreateFunc: MenuCreateFunc,
                     options: {buttonAction?: () => void} = {},
) {
  if (!buttonText) {
    // Regular circular button that opens a menu.
    return cssHoverCircle({ style: `margin: 5px;` },
      cssTopBarBtn('Share', dom.cls('tour-share-icon')),
      menu(menuCreateFunc, {placement: 'bottom-end'}),
      hoverTooltip(t('Share'), {key: 'topBarBtnTooltip'}),
      testId('tb-share'),
    );
  } else if (options.buttonAction) {
    // Split button: the left text part calls `buttonAction`, and the circular icon opens menu.
    return cssShareButton(
      cssShareAction(buttonText,
        dom.on('click', options.buttonAction),
        testId('tb-share-action'),
      ),
      cssShareCircle(
        cssShareIcon('Share'),
        menu(menuCreateFunc, {placement: 'bottom-end'}),
        hoverTooltip(t('Share'), {key: 'topBarBtnTooltip'}),
        testId('tb-share'),
      ),
    );
  } else {
    // Combined button: the left text part and circular icon open the menu as a single button.
    return cssShareButton(
      cssShareButton.cls('-combined'),
      cssShareAction(buttonText),
      cssShareCircle(
        cssShareIcon('Share')
      ),
      menu(menuCreateFunc, {placement: 'bottom-end'}),
      hoverTooltip(t('Share'), {key: 'topBarBtnTooltip'}),
      testId('tb-share'),
    );
  }
}

async function handleSaveCopy(options: {
  pageModel: DocPageModel,
  doc: Document,
  modalTitle: string,
}) {
  const {pageModel} = options;
  const {appModel} = pageModel;
  if (!appModel.currentValidUser) {
    pageModel.clearUnsavedChanges();
    window.location.href = getLoginOrSignupUrl({srcDocId: urlState().state.get().doc});
    return;
  }

  return makeCopy(options);
}

// Renders "Manage Users" menu item.
function menuManageUsers(doc: DocInfo, pageModel: DocPageModel) {
  return [
    menuItem(() => manageUsers(doc, pageModel),
      roles.canEditAccess(doc.access) ? t("Manage Users") : t("Access Details"),
      dom.cls('disabled', doc.isFork),
      testId('tb-share-option')
    ),
    menuDivider(),
  ];
}

interface MenuOriginalOptions {
  /** Defaults to false. */
  isSnapshot?: boolean;
  /** Defaults to false. */
  isTutorialFork?: boolean;
}

/**
 * Renders "Return to Original" and "Replace Original" menu items.
 *
 * When used with snapshots, we say "Current Version" in place of the word "Original".
 *
 * When used with tutorial forks, the "Return to Original" and "Compare to Original" menu
 * items are excluded. Note that it's still possible to return to the original by manually
 * setting the open mode in the URL to "/m/default" - if the menu item were to ever be included
 * again, it should likely be a shortcut to setting the open mode back to default.
 */
function menuOriginal(doc: Document, pageModel: DocPageModel, options: MenuOriginalOptions = {}) {
  const {isSnapshot = false, isTutorialFork = false} = options;
  const termToUse = isSnapshot ? t("Current Version") : t("Original");
  const origUrlId = buildOriginalUrlId(doc.id, isSnapshot);
  const originalUrl = urlState().makeUrl({doc: origUrlId});

  // When comparing forks, show changes from the original to the fork. When comparing a snapshot,
  // show changes from the snapshot to the original, which seems more natural. The per-snapshot
  // comparison links in DocHistory use the same order.
  const [leftDocId, rightDocId] = isSnapshot ? [doc.id, origUrlId] : [origUrlId, doc.id];

  // Preserve the current state in order to stay on the selected page. TODO: Should auto-switch to
  // first page when the requested page is not in the document.
  const compareHref = dom.attr('href', (use) => urlState().makeUrl({
    ...use(urlState().state), doc: leftDocId, params: {compare: rightDocId}}));

  const compareUrlId = urlState().state.get().params?.compare;
  const comparingSnapshots: boolean = isSnapshot && Boolean(compareUrlId && parseUrlId(compareUrlId).snapshotId);

  function replaceOriginal() {
    replaceTrunkWithFork(doc, pageModel, origUrlId).catch(reportError);
  }
  return [
    isTutorialFork ? null : cssMenuSplitLink({href: originalUrl},
      cssMenuSplitLinkText(t("Return to {{termToUse}}", {termToUse})),
      cssMenuIconLink({href: originalUrl, target: '_blank'},
        cssMenuIcon('FieldLink'),
        testId('open-original'),
      ),
      dom.on('click', () => { pageModel.clearUnsavedChanges(); }),
      testId('return-to-original'),
    ),
    menuItem(replaceOriginal, t("Replace {{termToUse}}...", {termToUse}),
      // Disable if original is not writable, and also when comparing snapshots (since it's
      // unclear which of the versions to use).
      dom.cls('disabled', !roles.canEdit(doc.trunkAccess || null) || comparingSnapshots),
      testId('replace-original'),
    ),
    isTutorialFork ? null : menuItemLink(compareHref, {target: '_blank'}, t("Compare to {{termToUse}}", {termToUse}),
      menuAnnotate('Beta'),
      dom.on('click', () => { pageModel.clearUnsavedChanges(); }),
      testId('compare-original'),
    ),
  ];
}

// Renders "Save Copy..." and "Copy as Template..." menu items. The name of the first action is
// specified in saveActionTitle.
function menuSaveCopy(options: {
  pageModel: DocPageModel,
  doc: Document,
  saveActionTitle: string,
}) {
  const {pageModel, doc, saveActionTitle} = options;
  const saveCopy = () => handleSaveCopy({pageModel, doc, modalTitle: saveActionTitle});
  return [
    // TODO Disable these when user has no accessible destinations.
    menuItem(saveCopy, `${saveActionTitle}...`, testId('save-copy')),
  ];
}

// Renders "Work on a Copy" menu item.
function menuWorkOnCopy(pageModel: DocPageModel) {
  const gristDoc = pageModel.gristDoc.get();
  if (!gristDoc) { return null; }

  const makeUnsavedCopy = async function() {
    const {urlId} = await gristDoc.docComm.fork();
    await urlState().pushUrl({doc: urlId});
  };

  return [
    menuItem(makeUnsavedCopy, t("Work on a Copy"), testId('work-on-copy')),
    menuText(
      withInfoTooltip(
        t("Edit without affecting the original"),
        'workOnACopy',
        {popupOptions: {attach: null}}
      )
    ),
  ];
}

/**
 * The part of the menu with "Download" and "Export as..." items.
 */
function menuExports(doc: Document, pageModel: DocPageModel) {
  const isElectron = (window as any).isRunningUnderElectron;
  const gristDoc = pageModel.gristDoc.get();
  if (!gristDoc) { return null; }

  // Note: This line adds the 'show in folder' option for electron and a download option for hosted.
  return [
    menuDivider(),
    (isElectron ?
      menuItem(() => gristDoc.app.comm.showItemInFolder(doc.name),
        t("Show in folder"), testId('tb-share-option')) :
        menuItem(() => downloadDocModal(doc, pageModel),
        menuIcon('Download'), t("Download..."), testId('tb-share-option'))
    ),
    menuItemSubmenu(
      () => [
        menuItemLink(hooks.maybeModifyLinkAttrs({ href: gristDoc.getCsvLink(), target: '_blank', download: ''}),
          t("Comma Separated Values (.csv)"), testId('tb-share-option')),
        menuItemLink(hooks.maybeModifyLinkAttrs({ href: gristDoc.getTsvLink(), target: '_blank', download: ''}),
          t("Tab Separated Values (.tsv)"), testId('tb-share-option')),
        menuItemLink(hooks.maybeModifyLinkAttrs({ href: gristDoc.getDsvLink(), target: '_blank', download: ''}),
          t("DOO Separated Values (.dsv)"), testId('tb-share-option')),
        menuItemLink(hooks.maybeModifyLinkAttrs({
          href: pageModel.appModel.api.getDocAPI(doc.id).getDownloadXlsxUrl(),
          target: '_blank', download: ''
        }), t("Microsoft Excel (.xlsx)"), testId('tb-share-option')),
      ],
      {},
      menuIcon('Download'),
      t("Export as..."),
      testId('tb-share-option'),
    ),
    (!isFeatureEnabled("sendToDrive") ? null : menuItem(() => sendToDrive(doc, pageModel),
      menuIcon('Download'), t("Send to Google Drive"), testId('tb-share-option'))),
  ];
}

/**
 * Opens the user-manager for the doc.
 */
async function manageUsers(doc: DocInfo, docPageModel: DocPageModel) {
  const appModel: AppModel = docPageModel.appModel;
  const api = appModel.api;
  const user = appModel.currentValidUser;
  (await loadUserManager()).showUserManagerModal(api, {
    permissionData: api.getDocAccess(doc.id),
    activeUser: user,
    resourceType: 'document',
    resourceId: doc.id,
    resource: doc,
    docPageModel,
    appModel: docPageModel.appModel,
    linkToCopy: makeShareDocUrl(doc),
    // On save, re-fetch the document info, to toggle the "Public Access" icon if it changed.
    // Skip if personal, since personal cannot affect "Public Access", and the only
    // change possible is to remove the user (which would make refreshCurrentDoc fail)
    onSave: async (personal) => !personal && docPageModel.refreshCurrentDoc(doc),
    reload: () => api.getDocAccess(doc.id),
  });
}

export function makeShareDocUrl(doc: Document) {
  const url = new URL(urlState().makeUrl(docUrl(doc)));
  url.searchParams.set('utm_id', 'share-doc');
  return url.href;
}

const cssShareButton = styled('div', `
  display: flex;
  align-items: center;
  position: relative;
  z-index: 0;
  margin: 5px;
  white-space: nowrap;

  --share-btn-bg: ${theme.controlPrimaryBg};
  &-combined:hover, &-combined.weasel-popup-open {
    --share-btn-bg: ${theme.controlPrimaryHoverBg};
  }
`);

// Hide this on very small screens, since it takes up a lot of space and its action is also
// available in the associated menu.
const cssShareAction = styled(primaryButton, `
  margin-right: -16px;
  padding-right: 24px;
  background-color: var(--share-btn-bg);
  border-color:     var(--share-btn-bg);

  @media ${mediaXSmall} {
    & {
      display: none !important;
    }
  }
`);

const cssShareCircle = styled(cssHoverCircle, `
  z-index: 1;
  background-color: var(--share-btn-bg);
  border: 1px solid ${theme.topHeaderBg};
  &:hover, &.weasel-popup-open {
    background-color: ${theme.controlPrimaryHoverBg};
  }
`);

const cssShareIcon = styled(cssTopBarBtn, `
  background-color: ${theme.controlPrimaryFg};
  height: 30px;
  width: 30px;
`);

const cssMenuSplitLink = styled(menuItemLink, `
  padding: 0;
  align-items: stretch;
`);

const cssMenuSplitLinkText = styled('div', `
  flex: auto;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  &:not(:hover) {
    background-color: ${theme.menuBg};
    color: ${theme.menuItemFg};
  }
`);

const cssMenuIconLink = styled('a', `
  display: block;
  flex: none;
  padding: 8px 24px;
  --icon-color: ${theme.controlFg};

  .${cssMenuItem.className}-sel > & {
    --icon-color: ${theme.menuItemIconSelectedFg};
  }

  .${cssMenuItem.className}.disabled & {
    --icon-color: ${theme.menuItemDisabledFg};
  }
`);

const cssMenuIcon = styled(icon, `
  display: block;
`);
