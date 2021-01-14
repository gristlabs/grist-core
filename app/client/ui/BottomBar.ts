import {DocPageModel} from 'app/client/models/DocPageModel';
import {dom, MultiHolder, styled} from 'grainjs';


export function createBottomBarDoc(owner: MultiHolder, pageModel: DocPageModel) {
  return dom.maybe(pageModel.gristDoc, (gristDoc) => (
    cssPageName(dom.text(gristDoc.currentPageName))
  ));
}

const cssPageName = styled('div', `
  margin: 0 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);
