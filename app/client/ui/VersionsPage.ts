/**
 * This module export a component for editing some document settings consisting of the timezone,
 * (new settings to be added here ...).
 */
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
//import {reportError} from 'app/client/models/AppModel';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {mediaSmall, theme, vars} from 'app/client/ui2018/cssVars';
import { TableDelta } from 'app/common/ActionSummary';
import { parseUrlId } from 'app/common/gristUrls';
import { DocStateComparison, DocStateComparisonDetails } from 'app/common/UserAPI';
import { Disposable, dom, obsArray, Observable, styled} from 'grainjs';
import { cloneDeep } from 'lodash';
import { ActionLogPart, traceCell } from '../components/ActionLog';
import { testId } from '../lib/dom';
import { basicButton, bigPrimaryButton, primaryButton } from '../ui2018/buttons';

const t = makeT('VersionsPage');

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

export class VersionsPage extends Disposable {
  public readonly isInitalized = Observable.create(this, false);
  public readonly isTrunk = Observable.create(this, false);
  private comparison?: DocStateComparison;
  private _offers = this.autoDispose(obsArray<OfferInfo>());

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
      this.gristDoc.appModel.api.getDocAPI(urlId).getOffers().then(v => {
        for (const x of v.result as OfferInfoCore[]) {
          this._offers.push(new OfferInfo(x));
        }
        this.isTrunk.set(true);
        this.isInitalized.set(true);
        console.log("????!!!!!!!!", {v});
      });
    }
  }

  public buildDom() {
    //const docPageModel = this._gristDoc.docPageModel;

    return cssContainer(
      cssHeader(t('Offered Versions')),
      cssDataRow(
        dom.maybe((use) => use(this.isInitalized), () => {
          console.log("MAYBE!!!");
          const details = this.comparison?.details;
          if (details) {
            const part = new ActionLogPart(() => true, () => Promise.resolve());
            return part.renderTabularDiffs(details.leftChanges, "");
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
                  await applyChanges(det, this.gristDoc, vv);
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
            basicButton(
              'Reset',
              dom.on('click', async () => {
                // should just remove all accepts
                // cmp.details?.leftChanges;
                delete (cmp as any).detailsNew;
                console.log("ZAIP");
              })
            ),
                        ));
          return parts;
        }));
      }),
      dom.maybe((use) => use(this.isTrunk), () => {
        return cssDataRow('ISTRUNK');
      }),
      dom.maybe((use) => !use(this.isTrunk), () => {
        return cssControlRow(
          bigPrimaryButton(
            t("Make Offer"),
            dom.on('click', async () => {
              const urlId = this.gristDoc.docPageModel.currentDocId.get();
              await this.gristDoc.appModel.api.getDocAPI(urlId!).makeOffer();
              window.alert('done');
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

async function applyChanges(details: DocStateComparisonDetails,
                            gristDoc: GristDoc,
                            element: HTMLDivElement) {
  const changer = new Changer(gristDoc);
  const changes = await changer.applyChanges(details);
  console.log(changes);
  element.innerHTML = '';
  for (const change of changes) {
    element.appendChild(dom('div', dom.text(change.msg)));
  }
}

interface Change {
  msg: string;
  fail?: boolean;
}

type Changes = Change[];

class Changer {
  public constructor(public gristDoc: GristDoc) {}

  public async change(delta: TableDelta, tableId: string, rowId: number, colId: string,
                      pre: any, post: any): Promise<Change> {
    await this.gristDoc.appModel.api.applyUserActions(
      this.gristDoc.docId(), [
        ['UpdateRecord', tableId, rowId, { [colId]: post }],
      ]);
    delta.accepted ||= {};
    delta.accepted.updateRows ||= [];
    delta.accepted.updateRows.push(rowId);
    return {
      msg: 'did an update',
    };
  }

  public async doAdd(delta: TableDelta, tableId: string, rowId: number, rec: Record<string, any>): Promise<Change> {
    if (rec.manualSort) {
      delete rec.manualSort;
    }
    await this.gristDoc.appModel.api.applyUserActions(
      this.gristDoc.docId(), [
        ['AddRecord', tableId, null, rec],
      ]);
    delta.accepted ||= {};
    delta.accepted.addRows ||= [];
    delta.accepted.addRows.push(rowId);
    return {
      msg: 'did an add',
    };
  }
  
  public async doRemove(delta: TableDelta, tableId: string, rowId: number, rec: Record<string, any>): Promise<Change> {
    await this.gristDoc.appModel.api.applyUserActions(
      this.gristDoc.docId(), [
        ['RemoveRecord', tableId, rowId],
      ]);
    delta.accepted ||= {};
    delta.accepted.removeRows ||= [];
    delta.accepted.removeRows.push(rowId);
    return {
      msg: 'did a remove',
    };
  }

  public async applyChanges(details: DocStateComparisonDetails): Promise<Changes> {
    const changes: Changes = [];
    const summary = details.leftChanges;
    console.log("in applyChanges", {summary});
    if (summary.tableRenames.length > 0) {
      changes.push({
        msg: 'table renames ignored',
      });
    }
    for (const [tableId, delta] of Object.entries(summary.tableDeltas)) {
      console.log("delta", {tableId, delta});
      if (tableId.startsWith('_grist_')) {
        console.log("skip _grist_*");
        continue;
      }
      if (delta.columnRenames.length > 0) {
        changes.push({
          msg: 'column renames ignored',
        });
      }
      if (delta.removeRows.length > 0) {
        changes.push(...await this.removeRows(tableId, delta));
      }
      if (delta.updateRows.length > 0) {
        // throw new Error('cannot update rows yet');
        changes.push(...await this.updateRows(tableId, delta));
      }
      if (delta.addRows.length > 0) {
        changes.push(...await this.addRows(tableId, delta));
      }
    }
    return changes;
  }

  public async updateRows(tableId: string, delta: TableDelta): Promise<Changes> {
    const changes: Changes = [];
    const rows = remaining(delta.updateRows, delta.accepted?.updateRows);
    const columnDeltas = delta.columnDeltas;
    for (const row of rows) {
      for (const [colId, columnDelta] of Object.entries(columnDeltas)) {
        const cellDelta = columnDelta[row];
        if (!cellDelta) {
          changes.push({
            msg: 'there is a row that does not exist anymore',
          });
          break;
        }
        console.log("WORKING ON", {row, cellDelta, tableId});
        const pre = cellDelta[0]?.[0];
        const post = cellDelta[1]?.[0];
        console.log(tableId, row, colId, pre, post);
        changes.push(await this.change(delta, tableId, row, colId, pre, post));
      }
    }
    return changes;
  }

  public async addRows(tableId: string, delta: TableDelta): Promise<Changes> {
    const changes: Changes = [];
    const rows = remaining(delta.addRows, delta.accepted?.addRows);
    const columnDeltas = delta.columnDeltas;
    for (const row of rows) {
      const rec: Record<string, any> = {};
      for (const [colId, columnDelta] of Object.entries(columnDeltas)) {
        const cellDelta = columnDelta[row];
        if (!cellDelta) {
          changes.push({
            msg: 'there is a row that does not exist anymore',
          });
          break;
        }
        console.log("WORKING ON addRows", {row, cellDelta, colId, tableId});
        rec[colId] = cellDelta[1]?.[0];
      }
      console.log("ADD", {row, rec});
      changes.push(await this.doAdd(delta, tableId, row, rec));
    }
    return changes;
  }

  public async removeRows(tableId: string, delta: TableDelta): Promise<Changes> {
    const changes: Changes = [];
    const rows = remaining(delta.removeRows, delta.accepted?.removeRows);
    const columnDeltas = delta.columnDeltas;
    for (const row of rows) {
      const rec: Record<string, any> = {};
      for (const [colId, columnDelta] of Object.entries(columnDeltas)) {
        const cellDelta = columnDelta[row];
        if (!cellDelta) {
          changes.push({
            msg: 'there is a row that does not exist anymore',
          });
          break;
        }
        console.log("WORKING ON removeRows", {row, cellDelta, colId, tableId});
        rec[colId] = cellDelta[0]?.[0];
      }
      console.log("REMOVE", {row, rec});
      changes.push(await this.doRemove(delta, tableId, row, rec));
    }
    return changes;
  }
}


function remaining(proposed: number[], accepted: number[]|undefined): number[] {
  const a = new Set(accepted);
  return proposed.filter(n => !a.has(n));
}
