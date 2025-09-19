import { ActionLogPart, computeContext, showCell } from 'app/client/components/ActionLog';
import { GristDoc } from 'app/client/components/GristDoc';
import { testId } from 'app/client/lib/dom';
import { makeT } from 'app/client/lib/localization';
import { docListHeader } from 'app/client/ui/DocMenuCss';
import { replaceTrunkWithFork } from 'app/client/ui/MakeCopyMenu';
import { buildOriginalUrlId } from 'app/client/ui/ShareMenu';
import { bigPrimaryButton } from 'app/client/ui2018/buttons';
import { mediaSmall, theme, vars } from 'app/client/ui2018/cssVars';
import { ActionSummary } from 'app/common/ActionSummary';
import { parseUrlId } from 'app/common/gristUrls';
import { DocStateComparison, DocStateComparisonDetails } from 'app/common/UserAPI';
import { Disposable, dom, Observable, styled } from 'grainjs';
import * as ko from 'knockout';

const t = makeT('ProposedChangesPage');

/**
 * This is a page to show the differences between the current document
 * (the "fork") and an original document (the "trunk"). The differences
 * are shown in ActionLog format, which at the time of writing is very
 * weak, so this page inherits that weakness.
 * TODO: improve the rendering of differences.
 *
 * The page is assumed to be shown when working on an unsaved copy. It
 * could be useful to show in other circumstances, but the goal is to
 * use it for a crowdsourcing workflow. At that point, the page will
 * have a "Propose Changes" button rather than just what it has now,
 * a "Replace Original" button.
 */
export class ProposedChangesPage extends Disposable {
  public readonly isInitalized = Observable.create(this, false);
  private _comparison?: DocStateComparison;
  private _context = ko.observable({});

  constructor(public gristDoc: GristDoc) {
    super();
    this.load();
  }

  /**
   * Use the API to compare this doc with the original.
   * TODO: make sure the comparison remains live either by recomputing
   * or by concatenating incoming changes to the computed difference.
   */
  public load() {
    const urlId = this.gristDoc.docPageModel.currentDocId.get();
    const parts = parseUrlId(urlId || '');
    if (urlId && parts.trunkId && parts.forkId) {
      const comparisonUrlId = parts.trunkId;
      this.gristDoc.appModel.api.getDocAPI(urlId).compareDoc(
        comparisonUrlId, { detail: true }
      ).then(comparison => {
        this._comparison = comparison;
        this.isInitalized.set(true);
      }).catch(reportError);
    } else if (urlId) {
      // TODO: bring in handling for trunk view. The idea is that it
      // would list proposed changes from forks. I've omitted it for now
      // to tackle that part separately. We just avoid showing the page
      // when not on a fork.
      throw new Error('ProposedChangesPage opened unexpectedly');
    }
  }

  public buildDom() {
    return cssContainer(
      cssHeader(t('Proposed Changes'), betaTag('Beta')),
      cssDataRow(
        dom.maybe((use) => use(this.isInitalized), () => {
          const details = this._comparison?.details;
          if (details) {
            return this._renderComparisonDetails(details);
          }
        })),
      cssControlRow(
        bigPrimaryButton(
          t("Replace Original"),
          dom.on('click', async () => {
            const docModel = this.gristDoc.docPageModel;
            const doc = docModel.currentDoc.get();
            if (doc) {
              const origUrlId = buildOriginalUrlId(doc.id, doc.isSnapshot);
              replaceTrunkWithFork(doc, docModel, origUrlId).catch(reportError);
            }
          }),
          testId('replace'),
        )
      )
    );
  }

  private _renderComparisonDetails(details: DocStateComparisonDetails) {
    // In the comparison, the current doc is the left (or local)
    // document, and the trunk is the right (or remote) document.
    // We want to look at the changes from their most recent
    // common ancestor and the current doc, which are the
    // "leftChanges".
    const actionSummary = details.leftChanges;
    const part = new ActionLogPartInProposal(this.gristDoc, actionSummary);
    return [
      dom('p',
          t('This is a list of changes relative to the original document.'),
         ),
      part.renderTabularDiffs(actionSummary, "", this._context),
    ];
  }
}

class ActionLogPartInProposal extends ActionLogPart {
  public constructor(
    private _gristDoc: GristDoc,
    private _summary: ActionSummary
  ) {
    super(_gristDoc);
  }

  public showForTable(): boolean {
    return true;
  }

  public async selectCell(rowId: number, colId: string, tableId: string): Promise<void> {
    await showCell(this._gristDoc, {tableId, colId, rowId});
  }

  public async getContext() {
    return computeContext(this._gristDoc, this._summary);
  }
}

const cssHeader = styled(docListHeader, `
  margin-bottom: 0;
  &:not(:first-of-type) {
    margin-top: 40px;
  }
`);

const cssDataRow = styled('div', `
  margin: 16px 0px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  width: 360px;
`);

const cssContainer = styled('div', `
  overflow-y: auto;
  position: relative;
  height: 100%;
  padding: 32px 64px 24px 64px;
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
`);

const cssControlRow = styled('div', `
  flex: none;
  margin-bottom: 16px;
  margin-top: 16px;
  display: flex;
  gap: 16px;
`);


export const betaTag = styled('span', `
  text-transform: uppercase;
  vertical-align: super;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.accentText};
`);
