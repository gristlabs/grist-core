import {DocPageModel} from 'app/client/models/DocPageModel';
import {testId} from 'app/client/ui2018/cssVars';
import {tokens} from 'app/common/ThemePrefs';
import {dom, MultiHolder, Observable, styled} from 'grainjs';


export function createBottomBarDoc(owner: MultiHolder, pageModel: DocPageModel, leftPanelOpen: Observable<boolean>,
  rightPanelOpen: Observable<boolean>) {
  return dom.maybe(pageModel.gristDoc, gristDoc => (
    cssPageName(
      dom.text(gristDoc.currentPageName),
      dom.on('click', () => { rightPanelOpen.set(false); leftPanelOpen.set(true); }),
      testId('page-name'),
    )
  ));
}

const cssPageName = styled('div', `
  color: ${tokens.body};
  margin: 0 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
`);
