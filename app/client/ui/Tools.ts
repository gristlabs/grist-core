import {ACLUsersPopup} from 'app/client/aclui/ACLUsers';
import {makeT} from 'app/client/lib/localization';
import {GristDoc} from 'app/client/components/GristDoc';
import {urlState} from 'app/client/models/gristUrlState';
import {getUserOrgPrefObs, markAsSeen} from 'app/client/models/UserPrefs';
import {showExampleCard} from 'app/client/ui/ExampleCard';
import {buildExamples} from 'app/client/ui/ExampleInfo';
import {createHelpTools, cssLinkText, cssMenuTrigger, cssPageEntry, cssPageEntryMain, cssPageEntrySmall,
        cssPageIcon, cssPageLink, cssSectionHeader, cssSpacer, cssSplitPageEntry,
        cssTools} from 'app/client/ui/LeftPanelCommon';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {confirmModal} from 'app/client/ui2018/modals';
import {isOwner} from 'app/common/roles';
import {Disposable, dom, makeTestId, Observable, observable, styled} from 'grainjs';
import noop from 'lodash/noop';

const testId = makeTestId('test-tools-');
const t = makeT('Tools');

export function tools(owner: Disposable, gristDoc: GristDoc, leftPanelOpen: Observable<boolean>): Element {
  const docPageModel = gristDoc.docPageModel;
  const isDocOwner = isOwner(docPageModel.currentDoc.get());
  const isOverridden = Boolean(docPageModel.userOverride.get());
  const canViewAccessRules = observable(false);
  function updateCanViewAccessRules() {
    canViewAccessRules.set((isDocOwner && !isOverridden) ||
                           gristDoc.docModel.rules.getNumRows() > 0);
  }
  owner.autoDispose(gristDoc.docModel.rules.tableData.tableActionEmitter.addListener(updateCanViewAccessRules));
  updateCanViewAccessRules();
  return cssTools(
    cssTools.cls('-collapsed', (use) => !use(leftPanelOpen)),
    cssSectionHeader(t("TOOLS")),
    cssPageEntry(
      cssPageEntry.cls('-selected', (use) => use(gristDoc.activeViewId) === 'acl'),
      cssPageEntry.cls('-disabled', (use) => !use(canViewAccessRules)),
      dom.domComputedOwned(canViewAccessRules, (computedOwner, _canViewAccessRules) => {
        const aclUsers = ACLUsersPopup.create(computedOwner, docPageModel);
        if (_canViewAccessRules) {
          aclUsers.load()
          // getUsersForViewAs() could fail for couple good reasons (access deny to anon user,
          // `document not found` when anon creates a new empty document, ...), users can have more
          // info by opening acl page, so let's silently fail here.
            .catch(noop);
        }
        return cssPageLink(
          cssPageIcon('EyeShow'),
          cssLinkText(t("Access Rules")),
          _canViewAccessRules ? urlState().setLinkUrl({docPage: 'acl'}) : null,
          cssMenuTrigger(
            icon('Dots'),
            aclUsers.menu({
              placement: 'bottom-start',
              parentSelectorToMark: '.' + cssPageEntry.className
            }),

            // Clicks on the menu trigger shouldn't follow the link that it's contained in.
            dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
            testId('access-rules-trigger'),
            dom.show(use => use(aclUsers.isInitialized) && _canViewAccessRules),
          ),
        );
      }),
      testId('access-rules'),
    ),
    cssPageEntry(
      cssPageEntry.cls('-selected', (use) => use(gristDoc.activeViewId) === 'data'),
      cssPageLink(
        cssPageIcon('Database'),
        cssLinkText(t("Raw Data")),
        testId('raw'),
        urlState().setLinkUrl({docPage: 'data'})
      )
    ),
    cssPageEntry(
      cssPageLink(cssPageIcon('Log'), cssLinkText(t("Document History")), testId('log'),
        dom.on('click', () => gristDoc.showTool('docHistory')))
    ),
    // TODO: polish validation and add it back
    dom.maybe((use) => use(gristDoc.app.features).validationsTool, () =>
      cssPageEntry(
        cssPageLink(cssPageIcon('Validation'), cssLinkText(t("Validate Data")), testId('validate'),
          dom.on('click', () => gristDoc.showTool('validations'))))
    ),
    cssPageEntry(
      cssPageEntry.cls('-selected', (use) => use(gristDoc.activeViewId) === 'code'),
      cssPageLink(cssPageIcon('Code'),
        cssLinkText(t("Code View")),
        urlState().setLinkUrl({docPage: 'code'})
      ),
      testId('code'),
    ),
    cssPageEntry(
      cssPageEntry.cls('-selected', (use) => use(gristDoc.activeViewId) === 'settings'),
      cssPageLink(cssPageIcon('Settings'),
        cssLinkText(t("Settings")),
        urlState().setLinkUrl({docPage: 'settings'})
      ),
      testId('settings'),
    ),
    cssSpacer(),
    dom.maybe(docPageModel.currentDoc, (doc) => {
      const ex = buildExamples().find(e => e.urlId === doc.urlId);
      if (!ex || !ex.tutorialUrl) { return null; }
      return cssPageEntry(
        cssPageLink(cssPageIcon('Page'), cssLinkText(t("How-to Tutorial")), testId('tutorial'),
          {href: ex.tutorialUrl, target: '_blank'},
          cssExampleCardOpener(
            icon('TypeDetails'),
            testId('welcome-opener'),
            automaticHelpTool(
              (info) => showExampleCard(ex, info),
              gristDoc,
              "seenExamples",
              ex.id
            ),
          ),
        ),
      );
    }),
    // Show the 'Tour of this Document' button if a GristDocTour table exists.
    dom.maybe(use => use(gristDoc.docModel.hasDocTour) && !use(gristDoc.docModel.isTutorial), () =>
      cssSplitPageEntry(
        cssPageEntryMain(
          cssPageLink(cssPageIcon('Page'),
            cssLinkText(t("Tour of this Document")),
            urlState().setLinkUrl({docTour: true}),
            testId('doctour'),
          ),
        ),
        !isDocOwner ? null : cssPageEntrySmall(
          cssPageLink(cssPageIcon('Remove'),
            dom.on('click', () => confirmModal(t("Delete document tour?"), t("Delete"), () =>
              gristDoc.docData.sendAction(['RemoveTable', 'GristDocTour']))
            ),
            testId('remove-doctour')
          ),
        )
      ),
    ),
    createHelpTools(docPageModel.appModel),
  );
}

/**
 * Helper for showing users some kind of help (example cards or document tours)
 * automatically if they haven't seen it before, or if they click
 * on some element to explicitly show it again. Put this in said dom element,
 * and it will provide the onclick handler and a handler which automatically
 * shows when the dom element is attached, both by calling showFunc.
 *
 * prefKey is a key for a list of identifiers saved in user preferences.
 * itemId should be a single identifier that fits in that list.
 * If itemId is already present then the help will not be shown automatically,
 * otherwise it will be added to the list and saved under prefKey
 * when info.markAsSeen() is called.
 */
function automaticHelpTool(
  showFunc: (info: AutomaticHelpToolInfo) => void,
  gristDoc: GristDoc,
  prefKey: 'seenExamples' | 'seenDocTours',
  itemId: number | string
) {
  function show(elem: HTMLElement, reopen: boolean) {
    const prefObs: Observable<typeof itemId[] | undefined> = getUserOrgPrefObs(gristDoc.userOrgPrefs, prefKey);
    const seenIds = prefObs.get() || [];

    // If this help was previously dismissed, don't show it again, unless the user is reopening it.
    if (!reopen && seenIds.includes(itemId)) {
      return;
    }

    showFunc({elem, reopen, markAsSeen: () => markAsSeen(prefObs, itemId)});
  }

  return [
    dom.on('click', (ev, elem) => {
      ev.preventDefault();
      show(elem as HTMLElement, true);
    }),
    (elem: HTMLElement) => {
      // Once the trigger element is attached to DOM, show the help
      setTimeout(() => show(elem, false), 0);
    }
  ];
}

/** Values which may be useful when showing an automatic help tool */
export interface AutomaticHelpToolInfo {
  // Element where automaticHelpTool is attached, typically a button,
  // which shows the help when clicked
  elem: HTMLElement;

  // true if the help was shown explicitly by clicking elem,
  // false if it's being shown automatically to new users
  reopen: boolean;

  // Call this when the user explicitly dismisses the help to
  // remember this in user preferences and not show it automatically on next load
  markAsSeen: () => void;
}

const cssExampleCardOpener = styled('div', `
  cursor: pointer;
  margin-right: 4px;
  margin-left: auto;
  border-radius: 16px;
  border-radius: 3px;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  --icon-color: ${theme.iconButtonFg};
  background-color: ${theme.iconButtonPrimaryBg};
  &:hover {
    background-color: ${theme.iconButtonPrimaryHoverBg};
  }
  .${cssTools.className}-collapsed & {
    display: none;
  }
`);
