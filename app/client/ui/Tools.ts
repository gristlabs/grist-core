import { GristDoc } from "app/client/components/GristDoc";
import { urlState } from "app/client/models/gristUrlState";
import { showExampleCard } from 'app/client/ui/ExampleCard';
import { examples } from 'app/client/ui/ExampleInfo';
import { createHelpTools, cssSectionHeader, cssSpacer, cssTools } from 'app/client/ui/LeftPanelCommon';
import { cssLinkText, cssPageEntry, cssPageIcon, cssPageLink } from 'app/client/ui/LeftPanelCommon';
import { hoverTooltip, tooltipCloseButton } from 'app/client/ui/tooltips';
import { colors } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { cssLink } from 'app/client/ui2018/links';
import { menuAnnotate } from 'app/client/ui2018/menus';
import { userOverrideParams } from 'app/common/gristUrls';
import { Disposable, dom, makeTestId, Observable, observable, styled } from "grainjs";

const testId = makeTestId('test-tools-');

export function tools(owner: Disposable, gristDoc: GristDoc, leftPanelOpen: Observable<boolean>): Element {
  const isOwner = gristDoc.docPageModel.currentDoc.get()?.access === 'owners';
  const isOverridden = Boolean(gristDoc.docPageModel.userOverride.get());
  const canViewAccessRules = observable(false);
  function updateCanViewAccessRules() {
    canViewAccessRules.set((isOwner && !isOverridden) ||
                           gristDoc.docModel.rules.getNumRows() > 0);
  }
  owner.autoDispose(gristDoc.docModel.rules.tableData.tableActionEmitter.addListener(updateCanViewAccessRules));
  updateCanViewAccessRules();
  return cssTools(
    cssTools.cls('-collapsed', (use) => !use(leftPanelOpen)),
    cssSectionHeader("TOOLS"),

    cssPageEntry(
      cssPageEntry.cls('-selected', (use) => use(gristDoc.activeViewId) === 'acl'),
      cssPageEntry.cls('-disabled', (use) => !use(canViewAccessRules)),
      dom.domComputed(canViewAccessRules, (_canViewAccessRules) => {
        return cssPageLink(
          cssPageIcon('EyeShow'),
          cssLinkText('Access Rules',
            menuAnnotate('Beta', cssBetaTag.cls(''))
          ),
          _canViewAccessRules ? urlState().setLinkUrl({docPage: 'acl'}) : null,
          isOverridden ? addRevertViewAsUI() : null,
        );
      }),
      testId('access-rules'),
    ),

    cssPageEntry(
      cssPageLink(cssPageIcon('Log'), cssLinkText('Document History'), testId('log'),
        dom.on('click', () => gristDoc.showTool('docHistory')))
    ),
    // TODO: polish validation and add it back
    dom.maybe((use) => use(gristDoc.app.features).validationsTool, () =>
      cssPageEntry(
        cssPageLink(cssPageIcon('Validation'), cssLinkText('Validate Data'), testId('validate'),
          dom.on('click', () => gristDoc.showTool('validations'))))
    ),
    cssPageEntry(
      cssPageEntry.cls('-selected', (use) => use(gristDoc.activeViewId) === 'code'),
      cssPageLink(cssPageIcon('Code'),
        cssLinkText('Code View'),
        urlState().setLinkUrl({docPage: 'code'})
      ),
      testId('code'),
    ),
    cssSpacer(),
    dom.maybe(gristDoc.docPageModel.currentDoc, (doc) => {
      if (!doc.workspace.isSupportWorkspace) { return null; }
      const ex = examples.find((e) => e.matcher.test(doc.name));
      if (!ex || !ex.tutorialUrl) { return null; }
      const appModel = gristDoc.docPageModel.appModel;
      return cssPageEntry(
        cssPageLink(cssPageIcon('Page'), cssLinkText('How-to Tutorial'), testId('tutorial'),
          {href: ex.tutorialUrl, target: '_blank'},
          cssExampleCardOpener(
            icon('TypeDetails'),
            dom.on('click', (ev, elem) => {
              ev.preventDefault();
              showExampleCard(ex, appModel, elem, true);
            }),
            testId('welcome-opener'),
            (elem) => {
              // Once the trigger element is attached to DOM, show the card.
              setTimeout(() => showExampleCard(ex, appModel, elem), 0);
            },
          ),
        ),
      );
    }),
    createHelpTools(gristDoc.docPageModel.appModel, false)
  );
}

// When viewing a page as another user, the "Access Rules" page link includes a button to revert
// the user and open the page, and a click on the page link shows a tooltip to revert.
function addRevertViewAsUI() {
  return [
    // A button that allows reverting back to yourself.
    dom('a',
      cssExampleCardOpener.cls(''),
      cssRevertViewAsButton.cls(''),
      icon('Convert'),
      urlState().setHref(userOverrideParams(null, {docPage: 'acl'})),
      dom.on('click', (ev) => ev.stopPropagation()),    // Avoid refreshing the tooltip.
      testId('revert-view-as'),
    ),

    // A tooltip that allows reverting back to yourself.
    hoverTooltip((ctl) =>
      cssConvertTooltip(icon('Convert'),
        cssLink('Return to viewing as yourself',
          urlState().setHref(userOverrideParams(null, {docPage: 'acl'})),
        ),
        tooltipCloseButton(ctl),
      ),
      {openOnClick: true}
    ),
  ];
}

const cssConvertTooltip = styled('div', `
  display: flex;
  align-items: center;
  --icon-color: ${colors.lightGreen};

  & > .${cssLink.className} {
    margin-left: 8px;
  }
`);

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
  --icon-color: ${colors.light};
  background-color: ${colors.lightGreen};
  &:hover {
    background-color: ${colors.darkGreen};
  }
  .${cssTools.className}-collapsed & {
    display: none;
  }
`);

const cssRevertViewAsButton = styled(cssExampleCardOpener, `
  background-color: ${colors.darkGrey};
  &:hover {
    background-color: ${colors.slate};
  }
`);

const cssBetaTag = styled('div', `
  .${cssPageEntry.className}-disabled & {
    opacity: 0.4;
  }
`);
