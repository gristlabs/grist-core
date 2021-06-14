import {docUrl, urlState} from 'app/client/models/gristUrlState';
import {getTimeFromNow, HomeModel} from 'app/client/models/HomeModel';
import {makeDocOptionsMenu, makeRemovedDocOptionsMenu} from 'app/client/ui/DocMenu';
import {IExampleInfo} from 'app/client/ui/ExampleInfo';
import {transientInput} from 'app/client/ui/transientInput';
import {colors, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu} from 'app/client/ui2018/menus';
import * as roles from 'app/common/roles';
import {Document, Workspace} from 'app/common/UserAPI';
import {computed, dom, makeTestId, observable, styled} from 'grainjs';

const testId = makeTestId('test-dm-');

/**
 * PinnedDocs builds the dom at the top of the doclist showing all the pinned docs in the
 * selectedOrg. Builds nothing if there are no pinned docs.
 *
 * Used only by DocMenu.
 */
export function createPinnedDocs(home: HomeModel) {
  return pinnedDocList(
    dom.forEach(home.currentWSPinnedDocs, doc => buildPinnedDoc(home, doc, doc.workspace)),
    testId('pinned-doc-list'),
  );
}

/**
 * Build a single doc card with a preview and name. A misnomer because it's now used not only for
 * pinned docs, but also for the thumnbails (aka "icons") view mode.
 */
export function buildPinnedDoc(home: HomeModel, doc: Document, workspace: Workspace,
                               example?: IExampleInfo): HTMLElement {
  const renaming = observable<Document|null>(null);
  const isRenamingDoc = computed((use) => use(renaming) === doc);
  const docTitle = example?.title || doc.name;
  return pinnedDocWrapper(
    dom.autoDispose(isRenamingDoc),
    dom.domComputed(isRenamingDoc, (isRenaming) =>
      pinnedDoc(
        isRenaming || doc.removedAt ? null : urlState().setLinkUrl(docUrl(doc)),
        pinnedDoc.cls('-no-access', !roles.canView(doc.access)),
        pinnedDocPreview(
          example?.bgColor ? dom.style('background-color', example.bgColor) : null,
          (example?.imgUrl ?
            cssImage({src: example.imgUrl}) :
            [docInitials(docTitle), pinnedDocThumbnail()]
          ),
          (doc.public && !example ? cssPublicIcon('PublicFilled', testId('public')) : null),
        ),
        pinnedDocFooter(
          (isRenaming ?
            pinnedDocEditorInput({
              initialValue: doc.name || '',
              save: async (val) => (val !== doc.name) ? home.renameDoc(doc.id, val) : undefined,
              close: () => renaming.set(null),
            }, testId('doc-name-editor'))
            :
            pinnedDocTitle(
              dom.text(docTitle),
              testId('pinned-doc-name'),
              // Mostly for the sake of tests, allow .test-dm-pinned-doc-name to find documents in
              // either 'list' or 'icons' views.
              testId('doc-name')
            )
          ),
          cssPinnedDocDesc(
            example?.desc || capitalizeFirst(getTimeFromNow(doc.removedAt || doc.updatedAt)),
            testId('pinned-doc-desc')
          )
        )
      )
    ),
    example ? null : (doc.removedAt ?
      [
        // For deleted documents, attach the menu to the entire doc icon, and include the
        // "Dots" icon just to clarify that there are options.
        menu(() => makeRemovedDocOptionsMenu(home, doc, workspace),
          {placement: 'right-start'}),
        pinnedDocOptions(icon('Dots'), testId('pinned-doc-options')),
      ] :
      pinnedDocOptions(icon('Dots'),
        menu(() => makeDocOptionsMenu(home, doc, renaming),
          {placement: 'bottom-start'}),
        // Clicks on the menu trigger shouldn't follow the link that it's contained in.
        dom.on('click', (ev) => { ev.stopPropagation(); ev.preventDefault(); }),
        testId('pinned-doc-options'),
      )
    ),
    testId('pinned-doc')
  );
}

function docInitials(docTitle: string) {
  return cssDocInitials(docTitle.slice(0, 2), testId('pinned-initials'));
}

// Capitalizes the first letter in the given string.
function capitalizeFirst(str: string): string {
  return str.replace(/^[a-z]/gi, c => c.toUpperCase());
}

const pinnedDocList = styled('div', `
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 16px;
  margin: 0 0 28px 0;
`);

export const pinnedDocWrapper = styled('div', `
  display: inline-block;
  flex: 0 0 auto;
  position: relative;
  width: 210px;
  margin: 16px 24px 16px 0;
  border: 1px solid ${colors.mediumGrey};
  border-radius: 1px;
  vertical-align: top;
  &:hover {
    border: 1px solid ${colors.slate};
  }
`);

const pinnedDoc = styled('a', `
  display: flex;
  flex-direction: column;
  width: 100%;
  color: black;
  text-decoration: none;
  cursor: pointer;

  &:hover {
    color: black;
    text-decoration: none;
  }
  &-no-access, &-no-access:hover {
    color: ${colors.slate};
    cursor: not-allowed;
  }
`);

const pinnedDocPreview = styled('div', `
  position: relative;
  flex: none;
  width: 100%;
  height: 131px;
  background-color: ${colors.dark};
  min-height: 0;

  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: center;

  .${pinnedDoc.className}-no-access > & {
    opacity: 0.8;
  }
`);

const pinnedDocThumbnail = styled('div', `
  position: absolute;
  right: 20px;
  bottom: 20px;
  height: 48px;
  width: 48px;
  background-image: var(--icon-ThumbPreview);
  background-size: 48px 48px;
  background-repeat: no-repeat;
  background-position: center;
`);

const cssDocInitials = styled('div', `
  position: absolute;
  left: 20px;
  bottom: 20px;
  font-size: 32px;
  border: 1px solid ${colors.lightGreen};
  color: ${colors.mediumGreyOpaque};
  border-radius: 3px;
  padding: 4px 0;
  width: 48px;
  height: 48px;
  text-align: center;
`);

const pinnedDocOptions = styled('div', `
  position: absolute;
  top: 12px;
  right: 12px;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: default;
  visibility: hidden;
  background-color: ${colors.mediumGrey};
  --icon-color: ${colors.light};

  .${pinnedDocWrapper.className}:hover &, &.weasel-popup-open {
    visibility: visible;
  }
`);

const pinnedDocFooter = styled('div', `
  width: 100%;
  font-size: ${vars.mediumFontSize};
`);

const pinnedDocTitle = styled('div', `
  margin: 16px 16px 0px 16px;
  font-weight: bold;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`);

export const pinnedDocEditorInput = styled(transientInput, `
  margin: 16px 16px 0px 16px;
  font-weight: bold;
  min-width: 0px;
  color: initial;
  font-size: inherit;
  line-height: inherit;
  appearance: none;
  -moz-appearance: none;
  padding: 0;
  border: none;
  outline: none;
  background-color: ${colors.mediumGrey};
`);

const cssPinnedDocDesc = styled('div', `
  margin: 8px 16px 16px 16px;
  color: ${colors.slate};
`);

const cssImage = styled('img', `
  position: relative;
  max-height: 100%;
  max-width: 100%;
`);

const cssPublicIcon = styled(icon, `
  position: absolute;
  top: 16px;
  left: 16px;
  --icon-color: ${colors.lightGreen};
`);
