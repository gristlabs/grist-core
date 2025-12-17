import { ActionLogPart, computeContext, showCell } from 'app/client/components/ActionLog';
import { cssBannerLink } from 'app/client/components/Banner';
import { GristDoc } from 'app/client/components/GristDoc';
import { makeT } from 'app/client/lib/localization';
import { getTimeFromNow } from 'app/client/lib/timeUtils';
import { urlState } from 'app/client/models/gristUrlState';
import { docListHeader } from 'app/client/ui/DocMenuCss';
import { buildOriginalUrlId } from 'app/client/ui/ShareMenu';
import { basicButton, bigBasicButton, bigPrimaryButton, primaryButton } from 'app/client/ui2018/buttons';
import { labeledSquareCheckbox } from 'app/client/ui2018/checkbox';
import { colors, mediaSmall, theme, vars } from 'app/client/ui2018/cssVars';
import { icon } from 'app/client/ui2018/icons';
import { cssLink } from 'app/client/ui2018/links';
import { loadingSpinner } from 'app/client/ui2018/loaders';
import { rebaseSummary } from 'app/common/ActionSummarizer';
import {
  DocStateComparison,
  DocStateComparisonDetails,
  removeMetadataChangesFromDetails,
} from 'app/common/DocState';
import { buildUrlId, commonUrls, parseUrlId } from 'app/common/gristUrls';
import { isLongerThan } from 'app/common/gutil';
import { Proposal } from 'app/common/UserAPI';
import {
  Computed, Disposable, dom, makeTestId, MutableObsArray,
  obsArray, Observable, styled
} from 'grainjs';
import * as ko from 'knockout';

const t = makeT('ProposedChangesPage');

const testId = makeTestId('test-proposals-');

/**
 * This is a page to show the differences between the current document
 * (the "fork") and an original document (the "trunk"). The differences
 * are shown in ActionLog format, which at the time of writing is very
 * weak, so this page inherits that weakness.
 * TODO: improve the rendering of differences.
 *
 */
export class ProposedChangesPage extends Disposable {
  public body: ProposedChangesTrunkPage | ProposedChangesForkPage;
  public readonly isInitialized: Observable<boolean|'slow'> = Observable.create(this, false);

  constructor(public gristDoc: GristDoc) {
    super();
    const urlId = this.gristDoc.docPageModel.currentDocId.get();
    const parts = parseUrlId(urlId || '');
    const isFork = Boolean(urlId && parts.trunkId && parts.forkId);

    this.body = this.autoDispose(
      isFork ?
          ProposedChangesForkPage.create(null, gristDoc) :
          ProposedChangesTrunkPage.create(null, gristDoc));

    const loader = this.body.load();
    loader.then(result => {
      if (result) { this.isInitialized.set(true); }
    }).catch(reportError);
    isLongerThan(loader, 100).then((slow) => slow && this.isInitialized.set("slow")).catch(() => {});
  }

  public buildDom() {
    const content = cssContainer(
      cssHeader(this.body.title(), betaTag(t('experiment'))),
      dom.maybe(this.isInitialized, (init) => {
        if (init === 'slow') {
          return loadingSpinner();
        } else {
          return this.body.buildDom();
        }
      })
    );
    // Common pattern on other pages to avoid clipboard deactivation.
    return dom('div.clipboard',
               {tabIndex: "-1"},
               content);
  }
}

export class ProposedChangesTrunkPage extends Disposable {
  private _proposalsObs: MutableObsArray<Proposal> = this.autoDispose(obsArray());
  private _proposals?: Proposal[];

  private _proposalCount = Computed.create(
    this, this._proposalsObs,
    (_owner, ps) => ps.length,
  );
  private _showDismissed = Observable.create(this, false);
  private _userProposalsObs = Computed.create(
    this, this.gristDoc.currentUser, this._proposalsObs, this._showDismissed,
    (_owner, user, ps, showDismissed) => {
      const proposals = ps
        .filter(p => p.srcDoc.creator.id === user?.id && !user?.anonymous)
        .filter(p => p.status.status !== 'dismissed' || showDismissed);
      return (proposals.length > 0) ? proposals : null;
    }
  );

  constructor(public gristDoc: GristDoc) {
    super();
  }

  public async load() {
    const urlId = this.gristDoc.docPageModel.currentDocId.get();
    if (!urlId) { return; }
    const proposals = await this.gristDoc.appModel.api.getDocAPI(urlId).getProposals();
    if (this.isDisposed()) { return; }
    this._proposals = proposals.proposals.filter(p => p.status.status !== 'retracted');
    this._proposalsObs.splice(0);
    this._proposalsObs.push(...this._proposals);
    return true;
  }

  public title() {
    return t('Suggestions');
  }

  public buildDom() {
    return this.buildTrunkDom();
  }

  public buildTrunkDom() {
    if (!this._proposals) { return null; }
    const isReadOnly = this.gristDoc.docPageModel.currentDoc.get()?.isReadonly;
    return [
      dom.domComputed(this._showDismissed, showDismissed => {
        return [
          dom.maybe(this._userProposalsObs, userProposals => {
            return dom(
              'p',
              cssSuggestionLabel(
                t('Your suggestions'),
              ),
              ...userProposals.map(p => [
                cssSuggestionLink(this._linkProposal(p)),
              ]),
            );
          }),
          dom.maybe((use) => use(this._proposalCount) === 0, () => {
            return [
              cssWarningMessage(
                cssWarningIcon('Warning'),
                dom('div',
                    `This is an experimental feature, with many limitations,
and is subject to change and withdrawal.`,
                    ' ',
                    cssLink(t("Learn more"), {
                      href: commonUrls.helpSuggestions,
                      target: "_blank",
                    }),
                   ),
              ),
              dom('p', 'There are currently no suggestions.'),
            ];
          }),
          isReadOnly ? [
            dom('p', 'Would you like to suggest some changes?'),
            bigPrimaryButton(
              t("Work on a copy"),
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
              return labeledSquareCheckbox(this._showDismissed, 'Show dismissed suggestions.');
            }
          }),
          dom(
            'div',
            dom.forEach(this._proposalsObs, (proposal) => {
              const details = proposal.comparison.comparison?.details;
              if (!details) { return null; }
              const applied = proposal.status.status === 'applied';
              const dismissed = proposal.status.status === 'dismissed';
              if (dismissed && !showDismissed) { return null; }
              return dom('div', [
                cssProposalHeader(
                  this._linkProposal(proposal),
                  ' | ',
                  proposal.srcDoc.creator.name || proposal.srcDoc.creator.email, ' | ',
                  getProposalActionSummary(proposal),
                  testId('header'),
                ),
                renderComparisonDetails(this.gristDoc, details, proposal.comparison.comparison),
                proposal.status.status === 'dismissed' ? 'DISMISSED' : null,
                isReadOnly ? null : cssDataRow(
                  applied ? null : primaryButton(
                    t("Accept"),
                    dom.on('click', async () => {
                      const outcome = await this.gristDoc.docComm.applyProposal(proposal.shortId);
                      this._updateProposal(proposal, outcome.proposal);
                      // For the moment, send debug information to console
                      for (const change of outcome.log.changes) {
                        if (change.fail) {
                          reportError(new Error(change.msg));
                        }
                        console.log(change);
                      }
                    }),
                    testId('apply'),
                  ),
                  ' ',
                  (isReadOnly || proposal.status.status === 'dismissed') ? null : basicButton(
                    t("Dismiss"),
                    dom.on('click', async () => {
                      const result = await this.gristDoc.docComm.applyProposal(proposal.shortId, {
                        dismiss: true,
                      });
                      this._updateProposal(proposal, result.proposal);
                    }),
                    testId('dismiss'),
                  ),
                ),
              ], testId('patch'));
            }),
            testId('patches'),
          ),
        ];
      })
    ];
  }

  private _updateProposal(oldProposal: Proposal, newProposal: Proposal) {
    const proposals = this._proposalsObs.get();
    const idx = proposals.findIndex(p => p === oldProposal);
    this._proposalsObs.splice(idx, 1, newProposal);
  }

  private _linkProposal(proposal: Proposal) {
    const name = `#${proposal.shortId}`;
    return proposal.srcDoc.id !== 'hidden' ?
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
            docPage: 'suggestions',
          })
        ) : name;
  }
}

export class ProposedChangesForkPage extends Disposable {
  // This will hold a comparison between this document and another version.
  private _comparison?: DocStateComparison;

  private _proposalObs: Observable<Proposal|null> = Observable.create(this, null);
  private _outOfDateObs: Computed<boolean>;

  constructor(public gristDoc: GristDoc) {
    super();
    this._outOfDateObs = Computed.create(
      this, gristDoc.latestActionState, this._proposalObs,
      (_owner, actionState, proposal) => {
        const proposed = proposal?.comparison.comparison?.left;
        return Boolean(proposed && actionState && proposed.h !== actionState.h);
      }
    );
  }

  public title() {
    return t('Suggest Changes');
  }

  /**
   * Use the API to compare this doc with the original.
   * TODO: make sure the comparison remains live either by recomputing
   * or by concatenating incoming changes to the computed difference.
   */
  public async load() {
    const urlId = this.gristDoc.docPageModel.currentDocId.get();
    if (!urlId) { return; }
    const parts = parseUrlId(urlId || '');
    const comparisonUrlId = parts.trunkId;
    const comparison = await this.gristDoc.appModel.api.getDocAPI(urlId).compareDoc(
      comparisonUrlId, { detail: true }
    );
    if (this.isDisposed()) { return; }
    this._comparison = comparison;
    const proposals = await this.gristDoc.appModel.api.getDocAPI(urlId).getProposals({
      outgoing: true
    });
    if (this.isDisposed()) { return; }
    this._proposalObs.set(proposals.proposals[0] || null);
    return true;
  }

  public buildDom() {
    const details = this._comparison?.details;
    const isSnapshot = this.gristDoc.docPageModel.isSnapshot.get();
    const docId = this.gristDoc.docId();
    const origUrlId = buildOriginalUrlId(docId, isSnapshot);
    const isReadOnly = this.gristDoc.docPageModel.currentDoc.get()?.isReadonly;
    const maybeHasChanges =
        Object.keys(details?.leftChanges.tableDeltas || {}).length !== 0 ||
        details?.leftChanges.tableRenames.length !== 0;
    const trunkAcceptsProposals =
        this.gristDoc.docPageModel.currentDoc?.get()?.options?.proposedChanges?.acceptProposals;
    return dom.domComputed(
      (use) => [use(this._proposalObs), use(this._outOfDateObs)] as const, ([proposal, outOfDate]) => {
        const hasProposal = Boolean(proposal?.updatedAt && proposal?.status?.status === undefined);
        return [
          dom.maybe(!trunkAcceptsProposals, () => {
            return cssWarningMessage(
              cssWarningIcon('Warning'),
              t(`The original document isn't asking for proposed changes.`)
            );
          }),
          dom('p',
              t('This is a list of changes relative to the {{originalDocument}}.', {
                originalDocument: cssBannerLink(
                  t('original document'),
                  urlState().setLinkUrl({
                    doc: origUrlId,
                    docPage: 'suggestions',
                  }, {
                    beforeChange: () => {
                      const user = this.gristDoc.currentUser.get();
                      // If anonymous, be careful, proposal list won't
                      // give a link back to this URL since that would
                      // let anyone edit it.
                      if (user?.anonymous) { return; }
                      // If a proposal hasn't been saved, or is retracted,
                      // also be careful, since there won't be a back-link.
                      if (!proposal?.updatedAt ||
                          proposal.status.status  === 'retracted') { return; }
                      // Otherwise, don't worry about losing the link
                      // to this page, you can get it from the original
                      // document.
                      this.gristDoc.docPageModel.clearUnsavedChanges();
                    }
                  })
                )
              }),
             ),
          dom.maybe(!maybeHasChanges, () => {
            return dom('p', t('No changes found to suggest. Please make some edits.'));
          }),
          cssDataRow(
            details ? renderComparisonDetails(this.gristDoc, details, this._comparison) : null,
          ),
          [
            dom('p',
                getProposalActionSummary(proposal),
                testId('status'),
               ),
            this._getProposalRelativeToCurrent(),
            (isReadOnly || !maybeHasChanges) ? null : cssControlRow(
              (hasProposal && !outOfDate) ? null : bigPrimaryButton(
                hasProposal ? t('Update Suggestion') : t('Suggest Change'),
                dom.on('click', async () => {
                  const urlId = this.gristDoc.docPageModel.currentDocId.get();
                  await this.gristDoc.appModel.api.getDocAPI(urlId!).makeProposal();
                  await this.update();
                }),
                testId('propose'),
              ),
              (proposal?.updatedAt && (proposal?.status.status !== 'retracted')) ? bigBasicButton(
                t("Retract Suggestion"),
                dom.on('click', async () => {
                  const urlId = this.gristDoc.docPageModel.currentDocId.get();
                  await this.gristDoc.appModel.api.getDocAPI(urlId!).makeProposal({retracted: true});
                  await this.update();
                }),
                testId('retract'),
              ) : null
            )
          ]
        ];
      });
  }

  public async update() {
    const urlId = this.gristDoc.docPageModel.currentDocId.get();
    if (!urlId) { return; }
    const proposals = await this.gristDoc.appModel.api.getDocAPI(urlId).getProposals({
      outgoing: true
    });
    if (this.isDisposed()) { return; }
    this._proposalObs.set(proposals.proposals[0] || null);
  }

  private _getProposalRelativeToCurrent() {
    return dom.maybe(this._outOfDateObs, outOfDate => {
      if (outOfDate) {
        return dom(
          'p',
          t(`There are fresh changes that haven't been added to the suggestion yet.`)
        );
      }
    });
  }
}


class ActionLogPartInProposal extends ActionLogPart {
  public constructor(
    private _gristDoc: GristDoc,
    private _details: DocStateComparisonDetails,
    private _comparison: DocStateComparison|undefined,
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
    const parentActionNum = this._comparison?.parent?.n;
    const summary = this._details.leftChanges;
    if (parentActionNum) {
      const actionLog = this._gristDoc.getActionLog();
      const ref = await actionLog.getChangesSince(parentActionNum);
      rebaseSummary(ref, summary);
    }
    return computeContext(this._gristDoc, summary);
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

const cssSuggestionLabel = styled('span', `
  display: inline-block;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 5px;
`);

const cssSuggestionLink = styled('span', `
  display: inline-block;
  margin-left: 10px;
  padding: 5px;
  border-top-left-radius: 20px;
  border-bottom-right-radius: 20px;
  background-color: ${theme.accessRulesTableHeaderBg};
  color: ${theme.accessRulesTableHeaderFg};
  min-width: 30px;
`);

const cssProposalHeader = styled('h3', `
  padding: 5px;
  padding-top: 20px;
  padding-bottom: 5px;
  border-top-left-radius: 20px;
  border-bottom-right-radius: 20px;
  background-color: ${theme.accessRulesTableHeaderBg};
  color: ${theme.accessRulesTableHeaderFg};
`);

export const cssWarningMessage = styled('div', `
  margin-top: 8px;
  margin-bottom: 8px;
  padding: 8px;
  display: flex;
  align-items: center;
  column-gap: 8px;
  max-width: 400px;
  border: 1px solid ${theme.accessRulesTableHeaderFg};
`);

export const cssWarningIcon = styled(icon, `
  --icon-color: ${colors.warning};
  flex-shrink: 0;
`);


function getProposalActionSummary(proposal: Proposal|null) {
  return proposal?.updatedAt ? dom.text(
    proposal?.status.status === 'retracted' ?
        t("Retracted {{at}}.", {at: getTimeFromNow(proposal.updatedAt)}) :
        proposal?.status.status === 'dismissed' ?
        t("Dismissed {{at}}.", {at: getTimeFromNow(proposal.updatedAt)}) :
        proposal?.status.status === 'applied' && proposal.appliedAt ?
        t("Accepted {{at}}.", {at: getTimeFromNow(proposal.appliedAt)}) :
        t("Suggestion made {{at}}.", {at: getTimeFromNow(proposal.updatedAt)}),
  ) : null;
}


function renderComparisonDetails(gristDoc: GristDoc, origDetails: DocStateComparisonDetails,
                                 origComparison: DocStateComparison|undefined) {
  // The change we want to render is based on a calculation
  // done on the fork document. The calculation treated the
  // fork as the local/left document, and the trunk as the
  // remote/right document.
  const {details, leftHadMetadata} = removeMetadataChangesFromDetails(origDetails);
  // We want to look at the changes from their most recent
  // common ancestor and the current doc.
  const part = new ActionLogPartInProposal(gristDoc, details, origComparison);
  // This holds any extra context known about the comparison. Computed on
  // request. It is managed by ActionLogPart.
  // TODO: does this need ownership of some kind for disposal?
  const context = ko.observable({});
  return [
    leftHadMetadata ? dom('p', "(some changes we can't deal with yet were ignored)") : null,
    part.renderTabularDiffs(details.leftChanges, "", context),
  ];
}
