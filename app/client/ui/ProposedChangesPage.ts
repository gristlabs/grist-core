import { ActionLogPart, computeContext, showCell } from 'app/client/components/ActionLog';
import { cssBannerLink } from 'app/client/components/Banner';
import { GristDoc } from 'app/client/components/GristDoc';
import { makeT } from 'app/client/lib/localization';
import { getTimeFromNow } from 'app/client/lib/timeUtils';
import { urlState } from 'app/client/models/gristUrlState';
import { docListHeader } from 'app/client/ui/DocMenuCss';
import { buildOriginalUrlId } from 'app/client/ui/ShareMenu';
import { basicButton, bigPrimaryButton, primaryButton } from 'app/client/ui2018/buttons';
import { labeledSquareCheckbox } from 'app/client/ui2018/checkbox';
import { mediaSmall, testId, theme, vars } from 'app/client/ui2018/cssVars';
import {
  DocStateComparison,
  DocStateComparisonDetails,
  removeMetadataChangesFromDetails,
} from 'app/common/DocState';
import { buildUrlId, parseUrlId } from 'app/common/gristUrls';
import { Proposal } from 'app/common/UserAPI';
import { Computed, Disposable, dom, MutableObsArray, obsArray, Observable, styled } from 'grainjs';
import * as ko from 'knockout';

const t = makeT('ProposedChangesPage');

/**
 * This is a page to show the differences between the current document
 * (the "fork") and an original document (the "trunk"). The differences
 * are shown in ActionLog format, which at the time of writing is very
 * weak, so this page inherits that weakness.
 * TODO: improve the rendering of differences.
 *
 */
export class ProposedChangesPage extends Disposable {
  // This page shows information pulled from an API call, which
  // takes a little time to fetch. This flag tracks whether
  // everything needed has been fetched.
  public readonly isInitialized = Observable.create(this, false);

  // This will hold a comparison between this document and another version.
  private _comparison?: DocStateComparison;
  private _proposals?: Proposal[];
  private _proposalsObs: MutableObsArray<Proposal> = this.autoDispose(obsArray());
  private _proposalCount = Computed.create(
    this, this._proposalsObs,
    (_owner, ps) => ps.length,
  );
  private _showDismissed = Observable.create(this, false);

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
    const doc = this.gristDoc.docPageModel.currentDoc.get();
    const mayHaveProposals = doc?.options?.proposedChanges?.acceptProposals;
    const parts = parseUrlId(urlId || '');
    if (urlId && parts.trunkId && parts.forkId) {
      const comparisonUrlId = parts.trunkId;
      this.gristDoc.appModel.api.getDocAPI(urlId).compareDoc(
        comparisonUrlId, { detail: true }
      ).then(comparison => {
        if (this.isDisposed()) { return; }
        this._comparison = comparison;
        this.gristDoc.appModel.api.getDocAPI(urlId).getProposals({
          outgoing: true
        }).then(proposals => {
          if (this.isDisposed()) { return; }
          this._proposalsObs.push(...proposals);
          this.isInitialized.set(true);
        }).catch(reportError);
      }).catch(reportError);
    } else if (urlId && mayHaveProposals) {
      // TODO: bring in handling for trunk view. The idea is that it
      // would list proposed changes from forks. I've omitted it for now
      // to tackle that part separately. We just avoid showing the page
      // when not on a fork.
      this.gristDoc.appModel.api.getDocAPI(urlId).getProposals().then(proposals => {
        if (this.isDisposed()) { return; }
        this._proposals = proposals.filter(p => p.status.status !== 'retracted');
        this._proposalsObs.splice(0);
        this._proposalsObs.push(...this._proposals);
        this.isInitialized.set(true);
      }).catch(reportError);
    } else {
      console.error('ProposedChangesPage opened unexpectedly');
    }
  }

  public update() {
    const urlId = this.gristDoc.docPageModel.currentDocId.get();
    if (!urlId) { return; }
    this.gristDoc.appModel.api.getDocAPI(urlId).getProposals({
      outgoing: true
    }).then(proposals => {
      if (this.isDisposed()) { return; }
      this._proposalsObs.splice(0, undefined, ...proposals);
    }).catch(reportError);
  }

  public buildDom() {
    return cssContainer(
      cssHeader(t('Proposed Changes'), betaTag('Beta')),
      dom.maybe(this.isInitialized, () => {
        if (this._proposals !== undefined) {
          return this.buildTrunkDom();
        } else {
          return this.buildForkDom();
        }
      })
    );
  }

  public buildForkDom() {
    const details = this._comparison?.details;
    const isSnapshot = this.gristDoc.docPageModel.isSnapshot.get();
    const docId = this.gristDoc.docId();
    const origUrlId = buildOriginalUrlId(docId, isSnapshot);
    const isReadOnly = this.gristDoc.docPageModel.currentDoc.get()?.isReadonly;

    return [
      dom('p',
          t('This is a list of changes relative to the {{originalDocument}}.', {
            originalDocument: cssBannerLink(
              t('original document'),
              urlState().setLinkUrl({
                doc: origUrlId,
                docPage: 'proposals',
              }, {
                extraStep: () => this.gristDoc.docPageModel.clearUnsavedChanges()
              }),
              dom.on('click', () => {
                this.gristDoc.docPageModel.clearUnsavedChanges();
              }),
            )
          }),
         ),
      cssDataRow(
        details ? this._renderComparisonDetails(details) : null,
      ),
      dom.maybe(this._proposalsObs, proposals => {
        const proposal = proposals[0];
        return [
          dom('p',
              getProposalActionSummary(proposal)
             ),
          isReadOnly ? null : cssControlRow(
            bigPrimaryButton(
              proposal?.updatedAt ? t('Update Change') : t('Propose Change'),
              dom.on('click', async () => {
                const urlId = this.gristDoc.docPageModel.currentDocId.get();
                await this.gristDoc.appModel.api.getDocAPI(urlId!).makeProposal();
                this.update();
              }),
              testId('propose'),
            ),
            (proposal?.updatedAt && (proposal?.status.status !== 'retracted')) ? bigPrimaryButton(
              t("Retract Change"),
              dom.on('click', async () => {
                const urlId = this.gristDoc.docPageModel.currentDocId.get();
                await this.gristDoc.appModel.api.getDocAPI(urlId!).makeProposal({retracted: true});
                this.update();
              }),
              testId('propose'),
            ) : null
          )
        ];
      })
    ];
  }

  public buildTrunkDom() {
    if (!this._proposals) { return null; }
    const isReadOnly = this.gristDoc.docPageModel.currentDoc.get()?.isReadonly;
    return [
      dom.domComputed(this._showDismissed, showDismissed => {
        return [
          dom.maybe((use) => use(this._proposalCount) === 0, () => {
            return [
              dom('p', 'There are no proposed changes.'),
            ];
          }),
          isReadOnly ? [
            dom('p', 'Would you like to propose some changes?'),
            bigPrimaryButton(
              t("Work on a Copy"),
              dom.on('click', async () => {
                const {urlId} = await this.gristDoc.docComm.fork();
                await urlState().pushUrl({doc: urlId});
              }),
              testId('fork'),
            ),
          ] : null,
          dom.maybe(this._proposalsObs, proposals => {
            if (proposals.some(p => p.status.status === 'dismissed')) {
              if (isReadOnly) { return null; }
              return labeledSquareCheckbox(this._showDismissed, 'Show dismissed proposals');
            }
          }),
          // this seems silly, shouldn't there be something special for arrays
          dom.maybe(this._proposalsObs, proposals => {
            return proposals.map((proposal, idx) => {
              const details = proposal.comparison.comparison?.details;
              if (!details) { return null; }
              const applied = proposal.status.status === 'applied';
              const dismissed = proposal.status.status === 'dismissed';
              if (dismissed && !showDismissed) { return null; }
              const name = `# ${proposal.shortId}`;
              return [
                cssProposalHeader(
                  proposal.srcDoc.id !== 'hidden' ?
                      cssBannerLink(
                        name,
                        urlState().setLinkUrl({
                          doc: buildUrlId({
                            trunkId: this.gristDoc.docId(),
                            forkId: proposal.srcDoc.id,
                            ...(proposal.srcDoc.creator.anonymous ? {} : {
                              forkUserId: proposal.srcDoc.creator.id,
                            })
                          }),
                          docPage: 'proposals',
                        })
                      ) : name,
                  ' | ',
                  proposal.srcDoc.creator.name || proposal.srcDoc.creator.email, ' | ',
                  getProposalActionSummary(proposal),
                ),
                this._renderComparisonDetails(details),
                proposal.status.status === 'dismissed' ? 'DISMISSED' : null,
                isReadOnly ? null : cssDataRow(
                  primaryButton(
                    applied ? t("Reapply") : t("Apply"),
                    dom.on('click', async () => {
                      const outcome = await this.gristDoc.docComm.applyProposal(proposal.shortId);
                      this._proposalsObs.splice(idx, 1, outcome.proposal);
                      // For the moment, send debug information to console
                      for (const change of outcome.log.changes) {
                        if (change.fail) {
                          reportError(new Error(change.msg));
                        }
                        console.log(change);
                      }
                    }),
                    testId('propose'),
                  ),
                  ' ',
                  (isReadOnly || proposal.status.status === 'dismissed') ? null : basicButton(
                    t("Dismiss"),
                    dom.on('click', async () => {
                      const result = await this.gristDoc.docComm.applyProposal(proposal.shortId, {
                        dismiss: true,
                      });
                      this._proposalsObs.splice(idx, 1, result.proposal);
                    }),
                    testId('dismiss'),
                  ),
                ),
              ];
            });
          })
        ];
      })
    ];
  }

  private _renderComparisonDetails(origDetails: DocStateComparisonDetails) {
    // The change we want to render is based on a calculation
    // done on the fork document. The calculation treated the
    // fork as the local/left document, and the trunk as the
    // remote/right document.
    const {details, leftHadMetadata} = removeMetadataChangesFromDetails(origDetails);
    console.log({details, leftHadMetadata});
    // We want to look at the changes from their most recent
    // common ancestor and the current doc.
    const part = new ActionLogPartInProposal(this.gristDoc, details);
    // This holds any extra context known about the comparison. Computed on
    // request. It is managed by ActionLogPart.
    // TODO: does this need ownership of some kind for disposal?
    const context = ko.observable({});
    return [
      leftHadMetadata ? dom('p', "(some changes we can't deal with yet were ignored)") : null,
      part.renderTabularDiffs(details.leftChanges, "", context),
    ];
  }
}

class ActionLogPartInProposal extends ActionLogPart {
  public constructor(
    private _gristDoc: GristDoc,
    private _details: DocStateComparisonDetails
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
    return computeContext(this._gristDoc, this._details.leftChanges);
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

const cssProposalHeader = styled('h3', `
  padding-top: 20px;
  border-top: 1px solid black;
`);

function getProposalActionSummary(proposal: Proposal) {
  return proposal?.updatedAt ? dom.text(
    proposal?.status.status === 'retracted' ?
        t("Retracted {{at}}", {at: getTimeFromNow(proposal.updatedAt)}) :
        proposal?.status.status === 'dismissed' ?
        t("Dismissed {{at}}", {at: getTimeFromNow(proposal.updatedAt)}) :
        proposal?.status.status === 'applied' && proposal.appliedAt ?
        t("Applied {{at}}", {at: getTimeFromNow(proposal.appliedAt)}) :
        t("Proposed {{at}}", {at: getTimeFromNow(proposal.updatedAt)}),
  ) : null;
}
