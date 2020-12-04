import { GristDoc } from "app/client/components/GristDoc";
import { urlState } from "app/client/models/gristUrlState";
import { showExampleCard } from 'app/client/ui/ExampleCard';
import { examples } from 'app/client/ui/ExampleInfo';
import { createHelpTools, cssSectionHeader, cssSpacer, cssTools } from 'app/client/ui/LeftPanelCommon';
import { cssLinkText, cssPageEntry, cssPageIcon, cssPageLink } from 'app/client/ui/LeftPanelCommon';
import { colors } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { Disposable, dom, makeTestId, Observable, styled } from "grainjs";

const testId = makeTestId('test-tools-');

export function tools(owner: Disposable, gristDoc: GristDoc, leftPanelOpen: Observable<boolean>): Element {
  const aclUIEnabled = Boolean(urlState().state.get().params?.aclUI);

  return cssTools(
    cssTools.cls('-collapsed', (use) => !use(leftPanelOpen)),
    cssSectionHeader("TOOLS"),

    (aclUIEnabled ?
      cssPageEntry(
        cssPageEntry.cls('-selected', (use) => use(gristDoc.activeViewId) === 'acl'),
        cssPageLink(cssPageIcon('EyeShow'),
          cssLinkText('Access Rules'),
          urlState().setLinkUrl({docPage: 'acl'})
        ),
        testId('access-rules'),
      ) :
      null
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
    // TODO: polish repl and add it back.
    dom.maybe((use) => use(gristDoc.app.features).replTool, () =>
      cssPageEntry(
        cssPageLink(cssPageIcon('Repl'), cssLinkText('REPL'), testId('repl'),
          dom.on('click', () => gristDoc.showTool('repl'))))
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
`);
