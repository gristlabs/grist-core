/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
//import {reportError} from 'app/client/models/AppModel';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {mediaSmall, theme, vars} from 'app/client/ui2018/cssVars';
import { parseUrlId } from 'app/common/gristUrls';
import { DocStateComparison } from 'app/common/UserAPI';
import { Disposable, dom, obsArray, Observable, styled} from 'grainjs';
import { cloneDeep } from 'lodash';
import { ActionLogPart, computeContext, traceCell } from '../components/ActionLog';
import { testId } from '../lib/dom';
import { basicButton, bigPrimaryButton, primaryButton } from '../ui2018/buttons';

import * as ko from 'knockout';
import { replaceTrunkWithFork } from './MakeCopyMenu';

import { buildOriginalUrlId } from './ShareMenu';

const t = makeT('ProposedChangesPage');

export interface OfferInfoCore {
  offer?: any;
  doc?: any;
}

class OfferInfo extends Disposable {
  public info: Observable<OfferInfoCore|null>;
  public constructor(i?: OfferInfoCore) {
    super();
    this.info = Observable.create<OfferInfoCore|null>(this, i||null);
  }
}

export class ProposedChangesPage extends Disposable {
  public readonly isInitalized = Observable.create(this, false);
  public readonly isTrunk = Observable.create(this, false);
  private comparison?: DocStateComparison;
  private _offers = this.autoDispose(obsArray<OfferInfo>());
  private _context = ko.observable({});

  constructor(public gristDoc: GristDoc) {
    super();
    console.log("!!!!INIT!!!!");
    this.load();
  }

  public load() {
    const urlId = this.gristDoc.docPageModel.currentDocId.get();
    const parts = parseUrlId(urlId || '');
    console.log({urlId, parts});
    if (urlId && parts.trunkId && parts.forkId) {
      const comparisonUrlId = parts.trunkId;
      this.gristDoc.appModel.api.getDocAPI(urlId).compareDoc(comparisonUrlId, { detail: true }).then(v => {
        this.comparison = v;
        this.isTrunk.set(false);
        this.isInitalized.set(true);
        console.log("!!!!!!!!", {v});
      }).catch(e => console.error(e));
    } else if (urlId) {
      /*
      this.gristDoc.appModel.api.getDocAPI(urlId).getOffers().then(v => {
        for (const x of v.result as OfferInfoCore[]) {
          this._offers.push(new OfferInfo(x));
        }
        this.isTrunk.set(true);
        this.isInitalized.set(true);
        console.log("????!!!!!!!!", {v});
        });
        
        }
      */
    }
  }

  public buildDom() {
    //const docPageModel = this._gristDoc.docPageModel;

    return cssContainer(
      cssHeader(t('Proposed Changes'), betaTag('Beta')),
      cssDataRow(
        dom.maybe((use) => use(this.isInitalized), () => {
          console.log("MAYBE!!!");
          const details = this.comparison?.details;
          if (details) {
            const part = new ActionLogPart(
              () => true,
              () => Promise.resolve(),
              async (_actionNum, base) => {
                console.log("THINKING!!!");
                const result = await computeContext(this.gristDoc, base);
                console.log("THOUGHT", {result});
                return result;
              }
            );
            return [
              dom('p',
                  'This is a list of changes relative to the original document.'
                 ),
              part.renderTabularDiffs(details.leftChanges, "", {
                actionNum: 0,
                actionHash: '',
                fromSelf: false,
                linkId: 0,
                otherId: 0,
                rowIdHint: 0,
                isUndo: false,
                context: this._context,
              actionSummary: details.leftChanges,
                time: 0,
                user: '',
                primaryAction: 'unknown',
                internal: false,
              })
            ];
          }
        })),
      dom.forEach(this._offers, offer1 => {
        return cssDataRow2(dom.maybe(offer1.info, offer => {
          // const vs = this.available.result;
          console.log("RENDERING", offer);
          const parts = [];
          const v = offer;
          console.log({v});
          const cmp = v.offer.comparison as DocStateComparison;
          const name = v.doc?.creator?.name;
          parts.push(dom(
            'p',
            `From: `,
            dom('b', name),
          ));
          const part = new ActionLogPart(
            () => true,
            async (rowId, colId, tableId) => {
              console.log("CLICK", {rowId, colId, tableId});
              const sum = cmp.details?.leftChanges;
              if (!sum) { return; }
              const cell2 = traceCell({rowId, colId, tableId}, sum, 0, () => 1);
              console.log("cell2", {cell2});
            },
            () => Promise.resolve({})
          );
          parts.push(part.renderTabularDiffs(cmp.details!.leftChanges, ""));
          const vv = dom('div');
          parts.push(
            vv
          );
          parts.push(dom(
            'div',
            dom.style('text-align', 'right'),
            primaryButton(
              'Apply',
              dom.on('click', async () => {
                console.log("applying");
                console.log(cmp.details);
                const pdet = cmp.details;
                if (pdet) {
                  const det = cloneDeep(pdet);
                  // await applyChanges(det, this.gristDoc, vv);
                  console.log("HERE IS THE SITCH");
                  console.log(JSON.stringify(det));
                  console.log(JSON.stringify(pdet));
                  if (JSON.stringify(det) !== JSON.stringify(pdet)) {
                    (cmp as any).details = det;
                    console.log("CHANGE!!");
                    offer1.info.setAndTrigger(offer);
                  }
                }
              })
            ),
            ' ',
            //basicButton(
            //'Reset',
            //dom.on('click', async () => {
                // should just remove all accepts
                // cmp.details?.leftChanges;
            //delete (cmp as any).detailsNew;
            //console.log("ZAIP");
          //})
          //),
            ' ',
            basicButton(
              'Remove',
              // This is fake for now
              dom.on('click', async () => {
                console.log("ZAIPER");
                offer1.info.setAndTrigger(null);
              })
            ),
                        ));
          return parts;
        }));
      }),
      dom.maybe((use) => use(this.isTrunk), () => {
        return cssDataRow('');
      }),
      dom.maybe((use) => !use(this.isTrunk), () => {
        return cssControlRow(
          bigPrimaryButton(
            t("Replace Original"),
            dom.on('click', async () => {
              // const urlId = this.gristDoc.docPageModel.currentDocId.get();
              // await this.gristDoc.appModel.api.getDocAPI(urlId!).makeOffer();
              // window.alert('Your change has not been proposed.');
              const docModel = this.gristDoc.docPageModel;
              const doc = docModel.currentDoc.get();
              if (doc) {
                const origUrlId = buildOriginalUrlId(doc.id, doc.isSnapshot);
                replaceTrunkWithFork(doc, docModel, origUrlId).catch(reportError);
              }
            }),
            testId('offer'),
          )
        );
      }),
    );
  }

  public offer() {
    console.log("making offer - hit endpoint, no info needed other than docid");
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

const cssDataRow2 = styled('div', `
  margin: 16px 0px;
  font-size: ${vars.mediumFontSize};
  color: ${theme.text};
  border: 1px solid gray;
  padding: 16px;
  background-color: #f8f8f8;
  max-width: 450px;
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
