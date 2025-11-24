/**
 * ActionLog manages the list of actions from server and displays them in the side bar.
 */

import {GristDoc} from 'app/client/components/GristDoc';
import * as dispose from 'app/client/lib/dispose';
import koArray from 'app/client/lib/koArray';
import {KoArray} from 'app/client/lib/koArray';
import * as koDom from 'app/client/lib/koDom';
import {makeT} from 'app/client/lib/localization';
import {ClientTimeData} from 'app/client/models/TimeQuery';
import {basicButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {theme} from 'app/client/ui2018/cssVars';
import {ActionGroup} from 'app/common/ActionGroup';
import {concatenateSummaryPair} from 'app/common/ActionSummarizer';
import {
  ActionSummary, asTabularDiffs, createEmptyActionSummary, defunctTableName, getAffectedTables,
  LabelDelta
} from 'app/common/ActionSummary';
import {CellDelta, TabularDiff} from 'app/common/TabularDiff';
import {timeFormat} from 'app/common/timeFormat';
import {ResultRow, TimeCursor, TimeQuery} from 'app/common/TimeQuery';
import {dom, DomContents, fromKo, IDomComponent, styled} from 'grainjs';
import * as ko from 'knockout';
import takeWhile = require('lodash/takeWhile');

/**
 *
 * Actions that are displayed in the log get a state observable
 * to track if they are undone/buried.
 *
 * Also for each table shown in the log, we create an observable
 * to track its name.  References to these observables are stored
 * with each action, by the name of the table at that time (the
 * name of a table can change).
 *
 */
export interface ActionGroupWithState extends ActionGroup {
  state?: ko.Observable<string>;  // is action undone/buried
  tableFilters?: {[tableId: string]: ko.Observable<string>};  // current names of tables
  affectedTableIds?: Array<ko.Observable<string>>; // names of tables affecting this ActionGroup
  context?: ko.Observable<ActionContext>;  // extra cell information, computed on demand
}

export type ActionContext = Record<string, ResultRow[]>;

const gristNotify = window.gristNotify!;

// Action display state enum.
const state = {
  UNDONE: 'undone',
  BURIED: 'buried',
  DEFAULT: 'default'
};

const t = makeT('ActionLog');

export class ActionLog extends dispose.Disposable implements IDomComponent {
  public displayStack: KoArray<ActionGroupWithState>;
  public selectedTableId: ko.Computed<string>;
  public showAllTables: ko.Observable<boolean>;      // should all tables be visible?

  private _gristDoc: GristDoc|null;

  private _pending: ActionGroupWithState[] = [];  // cache for actions that arrive while loading log
  private _loaded: boolean = false;               // flag set once log is loaded
  private _loading: ko.Observable<boolean>;  // flag set while log is loading
  private _censored: ko.Observable<boolean>;

  /**
   * Create an ActionLog.
   * @param options - supplies the GristDoc holding the log, if we have one, so that we
   *   can cross-reference with it.  We may not have a document, if used from the
   *   command line renderActions utility, in which case we don't set up cross-references.
   */
  public create(options: {gristDoc: GristDoc|null}) {
    // By default, just show actions for the currently viewed table.
    this.showAllTables = ko.observable(false);
    // We load the ActionLog lazily now, when it is first viewed.
    this._loading = ko.observable(false);
    this._censored = ko.observable(false);

    this._gristDoc = options.gristDoc;

    // TODO: displayStack grows without bound within a single session.
    // Stack of actions as they should be displayed to the user.
    this.displayStack = koArray<ActionGroupWithState>();

    // Computed for the tableId of the table currently being viewed.
    this.selectedTableId = this.autoDispose(ko.computed(() => {
      if (!this._gristDoc || this._gristDoc.viewModel.isDisposed()) { return ""; }
      const section = this._gristDoc.viewModel.activeSection();
      if (!section || section.isDisposed()) { return ""; }
      const table = section.table();
      return table && !table.isDisposed() ? table.tableId() : "";
    }));
  }

  public buildDom() {
    return this._buildLogDom();
  }

  /**
   * Figure out what has changed in the document after the given
   * action (and not including it).
   */
  public async getChangesSince(actionNum: number): Promise<ActionSummary> {
    return takeWhile(this.displayStack.all(), item => item.actionNum > actionNum)
      .reduce((summary, item) => concatenateSummaryPair(item.actionSummary, summary), createEmptyActionSummary());
  }

  /**
   * Pushes actions as they are received from the server to the display stack.
   * @param {Object} actionGroup - ActionGroup instance from the server.
   */
  public pushAction(ag: ActionGroupWithState): void {
    if (this._loading()) {
      this._pending.push(ag);
      return;
    }

    ag.context = ko.observable({});
    this._setupFilters(ag, this.displayStack.at(0) || undefined);
    const otherAg = ag.otherId ? this.displayStack.all().find(a => a.actionNum === ag.otherId) : null;

    if (otherAg) {
      // Undo/redo action.
      if (otherAg.state) {
        otherAg.state(ag.isUndo ? state.UNDONE : state.DEFAULT);
      }
    } else {
      // Any (non-link) action.
      if (ag.fromSelf) {
        // Bury all undos immediately preceding this action since they can no longer
        // be redone. This is triggered by normal actions and undo/redo actions whose
        // targets are not recent (not in the stack).
        for (let i = 0; i < this.displayStack.peekLength; i++) {
          const prevAction = this.displayStack.at(i)!;
          if (!prevAction.state) { continue; }
          const prevState = prevAction.state();
          if (prevAction.fromSelf && prevState === state.DEFAULT) {
            // When a normal action is found, stop looking to bury previous actions.
            break;
          } else if (prevAction.fromSelf && prevState === state.UNDONE) {
            // The previous action was undone, so now it has become buried.
            prevAction.state(state.BURIED);
          }
        }
      }
      if (!ag.otherId) {
        ag.state = ko.observable(state.DEFAULT);
        this.displayStack.unshift(ag);
      }
    }
  }

  /**
   * Render a description of an action prepared on the server.
   * @param {TabularDiffs} act - a collection of table changes
   * @param {string} txt - a textual description of the action
   * @param {ActionGroupWithState} ag - the full action information we have
   */
  public renderTabularDiffs(sum: ActionSummary, txt: string, ag?: ActionGroupWithState): HTMLElement {
    const part = new ActionLogPartInList(
      this._gristDoc,
      ag,
      this
    );
    return part.renderTabularDiffs(sum, txt, ag?.context);
  }

  /**
   * Decorate an ActionGroup with observables for controlling visibility of any
   * table information rendered from it.  Observables are shared with the previous
   * ActionGroup, and simply stored under a new name as needed.
   */
  private _setupFilters(ag: ActionGroupWithState, prev?: ActionGroupWithState): void {
    const filt: {[name: string]: ko.Observable<string>} = ag.tableFilters = {};

    // First, bring along observables for tables from previous actions.
    if (prev) {
      // Tables are renamed from time to time - prepare dictionary of updates.
      const renames = new Map(ag.actionSummary.tableRenames);
      for (const name of Object.keys(prev.tableFilters!)) {
        if (name.startsWith('-')) {
          // skip
        } else if (renames.has(name)) {
          const newName = renames.get(name) || defunctTableName(name);
          filt[newName] = prev.tableFilters![name];
          filt[newName](newName);   // Update the observable with the new name.
        } else {
          filt[name] = prev.tableFilters![name];
        }
      }
    }
    // Add any more observables that we need for this action.
    const names = getAffectedTables(ag.actionSummary);
    for (const name of names) {
      if (!filt[name]) { filt[name] = ko.observable(name); }
    }
    // Record the observables that affect this ActionGroup specifically
    ag.affectedTableIds = names.map(name => ag.tableFilters![name]).filter(obs => obs);
  }

  /**
   * Helper function that returns true if any table touched by the ActionGroup
   * is set to be visible.
   */
  private _hasSelectedTable(ag: ActionGroupWithState): boolean {
    if (!this._gristDoc) { return true; }
    return ag.affectedTableIds!.some(tableId => tableId() === this.selectedTableId());
  }

  private _buildLogDom() {
    this._loadActionSummaries().catch(() => gristNotify(t("Action Log failed to load")));
    return dom('div.action_log',
        {tabIndex: '-1'},
        dom.maybe(this._censored, () => {
          return cssHistoryCensored(dom(
            'p',
            t('History blocked because of access rules.'),
          ));
        }),
        // currently, if censored, no history at all available - so drop checkbox
        dom.maybe((use) => !use(this._censored), () => {
          return dom('div',
            labeledSquareCheckbox(fromKo(this.showAllTables),
              t('All tables'),
            ),
          );
        }),
        dom('div.action_log_load',
          koDom.show(() => this._loading()),
          'Loading...'),
        koDom.foreach(this.displayStack, (ag: ActionGroupWithState) => {
        const timestamp = ag.time ? timeFormat("D T", new Date(ag.time)) : "";
        let desc: DomContents = ag.desc || "";
        if (ag.actionSummary) {
          desc = this.renderTabularDiffs(ag.actionSummary, desc, ag);
        }
        return dom('div.action_log_item',
          koDom.cssClass(ag.state),
          koDom.show(() => this.showAllTables() || this._hasSelectedTable(ag)),
          dom('div.action_info',
            dom('span.action_info_action_num', `#${ag.actionNum}`),
            ag.user ? dom('span.action_info_user',
              ag.user,
              koDom.toggleClass('action_info_from_self', ag.fromSelf)
            ) : '',
            dom('span.action_info_timestamp', timestamp)),
          dom('span.action_desc', desc)
        );
      })
    );
  }

  /**
   * Fetch summaries of recent actions (with summaries) from the server.
   */
  private async _loadActionSummaries() {
    if (this._loaded || !this._gristDoc) { return; }
    this._loading(true);
    // Returned actions are ordered with earliest actions first.
    const {actions: result, censored} = await this._gristDoc.docComm.getActionSummaries();
    this._censored(censored);
    this._loading(false);
    this._loaded = true;
    // Add the actions to our action log.
    result.forEach(item => this.pushAction(item));
    // Add any actions that came in while we were fetching.  Unlikely, but
    // perhaps possible?
    const top = result.length > 0 ? result[result.length - 1].actionNum : 0;
    for (const item of this._pending) {
      if (item.actionNum > top) { this.pushAction(item); }
    }
    this._pending.length = 0;
  }
}


/**
 * Factor out the display of a single action group, since that
 * is useful elsewhere in the UI now. This is an abstract class,
 * we will connect it with ActionLog in ActionLogPartInList.
 */
export abstract class ActionLogPart {
  public constructor(
    private _gristDocBase: GristDoc|null,
  ) {}

  /**
   * This is used in the ActionLog to selectively show entries in the
   * log that are relevant to a particular table. This could simply
   * return true if everything should be shown.
   */
  public abstract showForTable(tableName: string): boolean;

  /**
   * When the user clicks on the specified cell within this entry,
   * this should bring the user to that cell elsewhere in the UI,
   * so they can see its full current context.
   */
  public abstract selectCell(rowId: number, colId: string, tableId: string): Promise<void>;

  /**
   * Should return completions for the rows mentioned in this entry.
   */
  public abstract getContext(): Promise<ActionContext|undefined>;

  /**
   * Render a description of an action prepared on the server.
   * @param {TabularDiffs} act - a collection of table changes
   * @param {string} txt - a textual description of the action
   * @param {Observable} context - extra information about the action
   */
  public renderTabularDiffs(sum: ActionSummary, txt?: string, contextObs?: ko.Observable<ActionContext>): HTMLElement {
    const editDom = koDom.scope(contextObs, (context: ActionContext) => {
      const act = asTabularDiffs(sum, {
        context,
        order: this._naiveColumnOrder.bind(this),
      });
      return dom(
        'div',
        this._renderTableSchemaChanges(sum),
        this._renderColumnSchemaChanges(sum),
        Object.entries(act).map(([table, tdiff]: [string, TabularDiff]) => {
          if (tdiff.cells.length === 0) { return dom('div'); }
          return dom(
            'table.action_log_table',
            koDom.show(() => this.showForTable(table)),
            dom('caption',
                this._renderTableName(table),
                // Add a little button to show or hide extra context.
                // This is a baby step, there's a lot more that could
                // and should be done here.
                contextObs ? cssBasicButton(
                  context[table] ? ' <' : ' >',
                  dom.on('click', async () => {
                    if (context[table]) {
                      await this._resetContext(contextObs, table, context);
                    } else {
                      await this._setContext(contextObs, table, context);
                    }
                  })) : null,
                dom.style('text-align', 'left'),
               ),
            dom(
              'tr',
              dom('th'),
              tdiff.header.map(diff => {
                return dom('th', this._renderCell(diff));
              })),
            tdiff.cells.map(
              row => {
                return dom(
                  'tr',
                  dom('td', this._renderCell(row.type)),
                  row.cellDeltas.map((diff, idx: number) => {
                    return dom('td',
                               this._renderCell(diff),
                               dom.on('click', () => {
                                 return this.selectCell(row.rowId, act[table].header[idx], table);
                               }));
                  }));
              }));
        }),
        txt ? dom('span.action_comment', txt) : null,
      );
    });
    return dom('div',
               editDom);
  }
  /**
   * Prepare dom element(s) for a cell that has been created, destroyed,
   * or modified.
   *
   * @param {CellDelta|string|null} cell - a structure with before and after values,
   *   or a plain string, or null
   *
   */
  private _renderCell(cell: CellDelta|string|null) {
    // we'll show completely empty cells as "..."
    if (cell === null) {
      return "...";
    }
    // strings are shown as themselves
    if (typeof(cell) === 'string') {
      return cell;
    }
    if (!Array.isArray(cell)) {
      return cell;
    }
    // by elimination, we have a TabularDiff.CellDelta with before and after values.
    const [pre, post] = cell;
    if (!pre && !post) {
      // very boring before + after values :-)
      return "";
    } else if (pre && !post) {
      // this is a cell that was removed
      return dom('span.action_log_cell_remove', pre[0]);
    } else if (post && (pre === null || (pre[0] === null || pre[0] === ''))) {
      // this is a cell that was added, or modified from a previously empty value
      return dom('span.action_log_cell_add', post[0]);
    } else if (pre && post) {
      // a modified cell
      return dom('div',
                 dom('span.action_log_cell_remove.action_log_cell_pre', pre[0]),
                 dom('span.action_log_cell_add', post[0]));
    }
    return JSON.stringify(cell);
  }

  /**
   * Choose a table name to show.  For now, we show diffs of metadata tables also.
   * For those tables, we show "_grist_Foo_bar" as "[Foo.bar]".
   * @param {string} name - tableId of table
   * @returns {string} a friendlier name for the table
   */
  private _renderTableName(name: string): string {
    if (name.indexOf('_grist_') !== 0) {
      // Ordinary data table.  Ideally, we would look up
      // a friendly name from a raw data view - TODO.
      return name;
    }
    const metaName = name.split('_grist_')[1].replace(/_/g, '.');
    return `[${metaName}]`;
  }

  /**
   * Show an ActionLog item when a column or table is renamed, added, or removed.
   * Make sure the item is only shown when the affected table is not filtered out.
   *
   * @param scope: blank for tables, otherwise "<tablename>."
   * @param pair: the rename/addition/removal in LabelDelta format: [null, name1]
   * for addition of name1, [name2, null] for removal of name2, [name1, name2]
   * for a rename of name1 to name2.
   * @return a filtered dom element.
   */
  private _renderSchemaChange(scope: string, pair: LabelDelta) {
    const [pre, post] = pair;
    // ignore addition/removal of manualSort column
    if ((pre || post) === 'manualSort') { return dom('div'); }
    return dom('div.action_log_rename',
      koDom.show(() => this.showForTable(post || defunctTableName(pre!))),
      (!post ? ["Remove ", scope, dom("span.action_log_rename_pre", pre)] :
       (!pre ? ["Add ", scope, dom("span.action_log_rename_post", post)] :
        ["Rename ", scope, dom("span.action_log_rename_pre", pre),
         " to ", dom("span.action_log_rename_post", post)])));
  }

  /**
   * Show any table additions/removals/renames.
   */
  private _renderTableSchemaChanges(sum: ActionSummary) {
    return dom('div',
               sum.tableRenames.map(pair => this._renderSchemaChange("", pair)));
  }

  /**
   * Show any column additions/removals/renames.
   */
  private _renderColumnSchemaChanges(sum: ActionSummary) {
    return dom('div',
               Object.keys(sum.tableDeltas).filter(key => !key.startsWith('-')).map(key =>
                 dom('div',
                     koDom.show(() => this.showForTable(key)),
                     sum.tableDeltas[key].columnRenames.map(pair =>
                        this._renderSchemaChange(key + ".", pair)))));
  }

  private async _resetContext(contextObs: ko.Observable<ActionContext>, tableId: string, context: ActionContext) {
    delete context[tableId];
    contextObs(context);
  }

  private async _setContext(contextObs: ko.Observable<ActionContext>, tableId: string, context: ActionContext) {
    const result = await this.getContext();
    // table may have changed name
    tableId = Object.keys(result || {})[0] || tableId;
    if (result) {
      contextObs({...context, [tableId]: result[tableId]});
    }
  }

  private _naiveColumnOrder(tableId: string, colIds: string[]) {
    // Naively, if there is currently a table matching the name,
    // use its columns for ordering. It might not be the same table!
    // Columns may have changed since! But the consequence of getting
    // order wrong in some cases isn't that bad, compared to getting
    // it wrong in regular case of unchanged schema.
    // TODO: remove this method and replace with something that uses
    // TimeQuery or related machinery.
    const refColIds = this._gristDocBase?.docData.getTable(tableId)?.getColIds();
    if (!refColIds) { return colIds; }
    const order = new Map(refColIds.map((id, i) => [id, i]));
    order.set('id', 0);
    return [...colIds].sort((a, b) => {
      const ai = order.get(a);
      const bi = order.get(b);
      if (ai === undefined && bi === undefined) { return 0; }
      if (ai === undefined) { return 1; }
      if (bi === undefined) { return -1; }
      return ai - bi;
    });
  }
}

/**
 * Connect ActionLogPart back to ActionLog. The only non-trivial
 * work is relating cells within it to current state, via the
 * action stack.
 */
class ActionLogPartInList extends ActionLogPart {
  public constructor(
    private _gristDoc: GristDoc|null,
    private _actionGroup: ActionGroupWithState|undefined,
    private _actionLog: ActionLog,
  ) {
    super(_gristDoc);
  }

  public showForTable(tableName: string): boolean {
    return this._showForTable(tableName, this._actionGroup);
  }

  public async selectCell(rowId: number, colId: string, tableId: string): Promise<void> {
    if (!this._gristDoc) { return; }
    if (!this._actionGroup) { return; }
    const actionNum = this._actionGroup.actionNum;

    // Find action in the stack.
    const index = this._actionLog.displayStack.peek().findIndex(a => a.actionNum === actionNum);
    if (index < 0) { throw new Error(`Cannot find action ${actionNum} in the action log.`); }

    // Found the action. Now trace forward to find current tableId, colId, rowId.
    for (let i = index; i >= 0; i--) {
      const action = this._actionLog.displayStack.at(i)!;
      const sum = action.actionSummary;
      const cell = traceCell({rowId, colId, tableId}, sum, (deletedObj: DeletedObject) => {
        reportDeletedObject(deletedObj, action.actionNum);
      });
      if (cell) {
        tableId = cell.tableId;
        colId = cell.colId;
        rowId = cell.rowId;
      }
    }
    await showCell(this._gristDoc, {tableId, colId, rowId});
  }

  public async getContext(): Promise<ActionContext|undefined> {
    if (!this._gristDoc) { return; }
    if (!this._actionGroup) { return; }
    const base = this._actionGroup.actionSummary;
    const actionNum = this._actionGroup.actionNum;
    return await computeContext(this._gristDoc, base, (cursor) => {
      // Find action in the stack.
      const index = this._actionLog.displayStack.peek().findIndex(a => a.actionNum === actionNum);
      if (index < 0) { throw new Error(`Cannot find action ${actionNum} in the action log.`); }
      // Found the action. Now find mapping to current doc, just
      // after this action.
      for (let i = index - 1; i >= 0; i--) {
        const action = this._actionLog.displayStack.at(i)!;
        cursor.append(action.actionSummary);
      }
    });
  }

  /**
   * Return a koDom.show clause that activates when the named table is not
   * filtered out.
   */
  private _showForTable(tableName: string, ag?: ActionGroupWithState): boolean {
    if (!ag) { return true; }
    const obs = ag.tableFilters![tableName];
    return this._actionLog.showAllTables() || !obs || obs() === this._actionLog.selectedTableId();
  }
}

/**
 * Trace a cell through a change. The row, column, or table may be
 * deleted, in which case reportDeletion is called and null is returned.
 * Column and table renames are tracked, with updated names returned.
 */
export function traceCell(cell: {rowId: number, colId: string, tableId: string},
                          summary: ActionSummary,
                          reportDeletion: (deletedObj: DeletedObject) => void) {
  let {tableId, colId} = cell;
  const {rowId} = cell;
  // Check if this table was renamed / removed.
  const tableRename: LabelDelta|undefined = summary.tableRenames.find(r => r[0] === tableId);
  if (tableRename) {
    const newName = tableRename[1];
    if (!newName) {
      reportDeletion({tableId});
      return null;
    }
    tableId = newName;
  }
  const td = summary.tableDeltas[tableId];
  if (!td) {
    return {tableId, rowId, colId};
  }

  // Check is this row was removed - if so there's no reason to go on.
  if (td.removeRows.indexOf(rowId) >= 0) {
    reportDeletion({thisRow: true});
    return null;
  }

  // Check if this column was renamed / added.
  const columnRename: LabelDelta|undefined = td.columnRenames.find(r => r[0] === colId);
  if (columnRename) {
    const newName = columnRename[1];
    if (!newName) {
      reportDeletion({colId});
      return null;
    }
    colId = newName;
  }
  return {tableId, rowId, colId};
}

/**
 * Show a cell in the UI. That is pretty ambiguous! The same
 * rowId/colId/tableId cell might be shown in many places.  The logic
 * here is ancient, written before the Raw Data page existed for
 * example, but for simple cases where the cell appears just once on a
 * user-created page, it works okay. A lot that could be done here.
 */
export async function showCell(gristDoc: GristDoc, cell: {
  tableId: string,
  colId: string,
  rowId: number,
}) {
  const {tableId, colId, rowId} = cell;

  // Find the table model of interest.
  const tableModel = gristDoc.getTableModel(tableId);
  if (!tableModel) { return; }

  // Get its "primary" view.
  const viewRow = tableModel.tableMetaRow.primaryView();
  const viewId = viewRow.getRowId();

  // Switch to that view.
  await gristDoc.openDocPage(viewId);

  // Now let's pick a reasonable section in that view.
  const viewSection = viewRow.viewSections().peek().find((s: any) => s.table().tableId() === tableId);
  if (!viewSection) { return; }
  const sectionId = viewSection.getRowId();

  // Within that section, find the column of interest if possible.
  const fieldIndex = viewSection.viewFields().peek().findIndex((f: any) => f.colId.peek() === colId);

  // Finally, move cursor position to the section, column (if we found it), and row.
  gristDoc.moveToCursorPos({rowId, sectionId, fieldIndex}).catch(() => { /* do nothing */ });
}

/**
 * Look up the information in other cells on the same row as changed
 * cells. This is useful to help the user understand what row it is.
 * This is not robust code, or much tested, and should be seen as a
 * placeholder for some systematic work.
 */
export async function computeContext(gristDoc: GristDoc, base: ActionSummary, init?: (cursor: TimeCursor) => void) {
  if (!gristDoc) { return; }

  const data = new ClientTimeData(gristDoc.docData);
  const cursor = new TimeCursor(data);

  init?.(cursor);

  async function getTable(tableId: string, rowIds: number[]) {
    const query = new TimeQuery(cursor, tableId, '*', rowIds);
    await query.update();
    return query.all();
  }

  const result: ActionContext = {};
  for (const [tableId, tableDelta] of Object.entries(base.tableDeltas)) {
    const rowIds = new Set([...tableDelta.addRows,
                            ...tableDelta.updateRows]);
    const rows = await getTable(tableId, [...rowIds]);
    result[tableId] = rows;
  }
  return result;
}

const cssBasicButton = styled(basicButton, `
  padding: 0;
  margin-left: 5px;
  border: none;
`);

function reportDeletedObject(obj: DeletedObject, actionNum: number) {
  // This is written to avoid code changes that require retranslating these messages.
  if (obj.tableId) {
    gristNotify(t(
      "Table {{tableId}} was subsequently removed in action #{{actionNum}}",
      {tableId: obj.tableId, actionNum}
    ));
  }
  if (obj.colId) {
      gristNotify(t(
        "Column {{colId}} was subsequently removed in action #{{actionNum}}",
        {colId: obj.colId, actionNum}
      ));
  }
  if (obj.thisRow) {
    gristNotify(t("This row was subsequently removed in action {{actionNum}}", {actionNum}));
  }
}

interface DeletedObject {
  thisRow?: boolean;
  colId?: string;
  tableId?: string;
}

const cssHistoryCensored = styled('div', `
  margin: 8px 16px;
  text-align: center;
  color: ${theme.text};
`);
