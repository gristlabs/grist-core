import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {theme} from 'app/client/ui2018/cssVars';
import {Document, Workspace} from 'app/common/UserAPI';
import {dom, makeTestId, styled} from 'grainjs';
import {HomeModel, ViewSettings} from 'app/client/models/HomeModel';
import * as css from 'app/client/ui/DocMenuCss';
import {buildPinnedDoc} from 'app/client/ui/PinnedDocs';
import sortBy = require('lodash/sortBy');

const testId = makeTestId('test-dm-');

/**
 * Builds all `templateDocs` according to the specified `viewSettings`.
 */
 export function buildTemplateDocs(home: HomeModel, templateDocs: Document[], viewSettings: ViewSettings) {
  const {currentView, currentSort} = viewSettings;
  return dom.domComputed((use) => [use(currentView), use(currentSort)] as const, (opts) => {
    const [view, sort] = opts;
    // Template docs are sorted by name in HomeModel. We only re-sort if we want a different order.
    let sortedDocs = templateDocs;
    if (sort === 'date') {
      sortedDocs = sortBy(templateDocs, (d) => d.removedAt || d.updatedAt).reverse();
    }
    return cssTemplateDocs(dom.forEach(sortedDocs, d => buildTemplateDoc(home, d, d.workspace, view)));
  });
}

/**
 * Build a single template doc according to `view`.
 *
 * If `view` is set to 'list', the template will be rendered
 * as a clickable row that includes a title and description.
 *
 * If `view` is set to 'icons', the template will be rendered
 * as a clickable tile that includes a title, image and description.
 */
function buildTemplateDoc(home: HomeModel, doc: Document, workspace: Workspace, view: 'list'|'icons') {
  if (view === 'icons') {
    return buildPinnedDoc(home, doc, workspace, true);
  } else {
    return css.docRowWrapper(
      cssDocRowLink(
        urlState().setLinkUrl({...docUrl(doc), org: workspace.orgDomain}),
        cssDocName(doc.name, testId('template-doc-title')),
        doc.options?.description ? cssDocRowDetails(doc.options.description, testId('template-doc-description')) : null,
      ),
      testId('template-doc'),
    );
  }
}

const cssDocRowLink = styled(css.docRowLink, `
  display: block;
  height: unset;
  line-height: 1.6;
  padding: 8px 0;
`);

const cssDocName = styled(css.docName, `
  margin: 0 16px;
`);

const cssDocRowDetails = styled('div', `
  margin: 0 16px;
  line-height: 1.6;
  color: ${theme.lightText};
`);

const cssTemplateDocs = styled('div', `
  margin-bottom: 16px;
`);
