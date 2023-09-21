/**
 * ActionLog manages the list of actions from server and displays them in the side bar.
 */

import * as dispose from 'app/client/lib/dispose';
import dom from 'app/client/lib/dom';
import {timeFormat} from 'app/common/timeFormat';
import * as ko from 'knockout';

import koArray from 'app/client/lib/koArray';
import {KoArray} from 'app/client/lib/koArray';
import * as koDom from 'app/client/lib/koDom';

import {GristDoc} from 'app/client/components/GristDoc';
import {ActionGroup} from 'app/common/ActionGroup';
import {ActionSummary, asTabularDiffs, defunctTableName, getAffectedTables,
        LabelDelta} from 'app/common/ActionSummary';
import {CellDelta, TabularDiff} from 'app/common/TabularDiff';
import {DomContents, fromKo, IDomComponent} from 'grainjs';
import {makeT} from 'app/client/lib/localization';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';

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
}

const gristNotify = (window as any).gristNotify;

// Action display state enum.
const state = {
  UNDONE: 'undone',
  BURIED: 'buried',
  DEFAULT: 'default'
};

const t = makeT('ActionLog');

export class ActionLog extends dispose.Disposable implements IDomComponent {

  private _displayStack: KoArray<ActionGroupWithState>;
  private _gristDoc: GristDoc|null;
  private _selectedTableId: ko.Computed<string>;
  private _showAllTables: ko.Observable<boolean>;      // should all tables be visible?

  private _pending: ActionGroupWithState[] = [];  // cache for actions that arrive while loading log
  private _loaded: boolean = false;               // flag set once log is loaded
  private _loading: ko.Observable<boolean>;  // flag set while log is loading

  /**
   * Create an ActionLog.
   * @param options - supplies the GristDoc holding the log, if we have one, so that we
   *   can cross-reference with it.  We may not have a document, if used from the
   *   command line renderActions utility, in which case we don't set up cross-references.
   */
  public create(options: {gristDoc: GristDoc|null}) {
    // By default, just show actions for the currently viewed table.
    this._showAllTables = ko.observable(false);
    // We load the ActionLog lazily now, when it is first viewed.
    this._loading = ko.observable(false);

    this._gristDoc = options.gristDoc;

    // TODO: _displayStack grows without bound within a single session.
    // Stack of actions as they should be displayed to the user.
    this._displayStack = koArray<ActionGroupWithState>();

    // Computed for the tableId of the table currently being viewed.
    this._selectedTableId = this.autoDispose(ko.computed(() => {
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
   * Pushes actions as they are received from the server to the display stack.
   * @param {Object} actionGroup - ActionGroup instance from the server.
   */
  public pushAction(ag: ActionGroupWithState): void {
    if (this._loading()) {
      this._pending.push(ag);
      return;
    }

    this._setupFilters(ag, this._displayStack.at(0) || undefined);
    const otherAg = ag.otherId ? this._displayStack.all().find(a => a.actionNum === ag.otherId) : null;

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
        for (let i = 0; i < this._displayStack.peekLength; i++) {
          const prevAction = this._displayStack.at(i)!;
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
        this._displayStack.unshift(ag);
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
    const act = asTabularDiffs(sum);
    const editDom = dom('div',
      this._renderTableSchemaChanges(sum, ag),
      this._renderColumnSchemaChanges(sum, ag),
      Object.entries(act).map(([table, tdiff]: [string, TabularDiff]) => {
        if (tdiff.cells.length === 0) { return dom('div'); }
        return dom('table.action_log_table',
          koDom.show(() => this._showForTable(table, ag)),
          dom('caption',
            this._renderTableName(table)),
          dom('tr',
            dom('th'),
            tdiff.header.map(diff => {
              return dom('th', this._renderCell(diff));
            })),
            tdiff.cells.map(row => {
            return dom('tr',
              dom('td', this._renderCell(row[0])),
                row[2].map((diff, idx: number) => {
                return dom('td',
                           this._renderCell(diff),
                           dom.on('click', () => {
                             return this._selectCell(row[1], act[table].header[idx], table,
                                              ag ? ag.actionNum : 0);
                           }));
              }));
            }));
      }),
      dom('span.action_comment', txt));
    return editDom;
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
    return ag.affectedTableIds!.some(tableId => tableId() === this._selectedTableId());
  }

  /**
   * Return a koDom.show clause that activates when the named table is not
   * filtered out.
   */
  private _showForTable(tableName: string, ag?: ActionGroupWithState): boolean {
    if (!ag) { return true; }
    const obs = ag.tableFilters![tableName];
    return this._showAllTables() || !obs || obs() === this._selectedTableId();
  }

  private _buildLogDom() {
    this._loadActionSummaries().catch(() => gristNotify(t("Action Log failed to load")));
    return dom('div.action_log',
        {tabIndex: '-1'},
        dom('div',
          labeledSquareCheckbox(fromKo(this._showAllTables),
            t('All tables'),
            dom.testId('ActionLog_allTables'),
          ),
        ),
        dom('div.action_log_load',
          koDom.show(() => this._loading()),
          'Loading...'),
        koDom.foreach(this._displayStack, (ag: ActionGroupWithState) => {
        const timestamp = ag.time ? timeFormat("D T", new Date(ag.time)) : "";
        let desc: DomContents = ag.desc || "";
        if (ag.actionSummary) {
          desc = this.renderTabularDiffs(ag.actionSummary, desc, ag);
        }
        return dom('div.action_log_item',
          koDom.cssClass(ag.state),
          koDom.show(() => this._showAllTables() || this._hasSelectedTable(ag)),
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
    const result = await this._gristDoc.docComm.getActionSummaries();
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
  private _renderSchemaChange(scope: string, pair: LabelDelta, ag?: ActionGroupWithState) {
    const [pre, post] = pair;
    // ignore addition/removal of manualSort column
    if ((pre || post) === 'manualSort') { return dom('div'); }
    return dom('div.action_log_rename',
      koDom.show(() => this._showForTable(post || defunctTableName(pre!), ag)),
      (!post ? ["Remove ", scope, dom("span.action_log_rename_pre", pre)] :
       (!pre ? ["Add ", scope, dom("span.action_log_rename_post", post)] :
        ["Rename ", scope, dom("span.action_log_rename_pre", pre),
         " to ", dom("span.action_log_rename_post", post)])));
  }

  /**
   * Show any table additions/removals/renames.
   */
  private _renderTableSchemaChanges(sum: ActionSummary, ag?: ActionGroupWithState) {
    return dom('div',
               sum.tableRenames.map(pair => this._renderSchemaChange("", pair, ag)));
  }

  /**
   * Show any column additions/removals/renames.
   */
  private _renderColumnSchemaChanges(sum: ActionSummary, ag?: ActionGroupWithState) {
    return dom('div',
               Object.keys(sum.tableDeltas).filter(key => !key.startsWith('-')).map(key =>
                 dom('div',
                     koDom.show(() => this._showForTable(key, ag)),
                     sum.tableDeltas[key].columnRenames.map(pair =>
                        this._renderSchemaChange(key + ".", pair)))));
  }

  /**
   * Move cursor to show a given cell of a given table. Uses primary view of table.
   */
  private async _selectCell(rowId: number, colId: string, tableId: string, actionNum: number) {
    if (!this._gristDoc) { return; }

    // Find action in the stack.
    const index = this._displayStack.peek().findIndex(a => a.actionNum === actionNum);
    if (index < 0) { throw new Error(`Cannot find action ${actionNum} in the action log.`); }

    // Found the action. Now trace forward to find current tableId, colId, rowId.
    for (let i = index; i >= 0; i--) {
      const action = this._displayStack.at(i)!;
      const sum = action.actionSummary;

      // Check if this table was renamed / removed.
      const tableRename: LabelDelta|undefined = sum.tableRenames.find(r => r[0] === tableId);
      if (tableRename) {
        const newName = tableRename[1];
        if (!newName) {
          // TODO - find a better way to send informative notifications.
          gristNotify(t(
            "Table {{tableId}} was subsequently removed in action #{{actionNum}}",
            {tableId:tableId, actionNum: action.actionNum}
          ));
          return;
        }
        tableId = newName;
      }
      const td = sum.tableDeltas[tableId];
      if (!td) { continue; }

      // Check is this row was removed - if so there's no reason to go on.
      if (td.removeRows.indexOf(rowId) >= 0) {
          // TODO - find a better way to send informative notifications.
        gristNotify(t("This row was subsequently removed in action {{action.actionNum}}", {actionNum}));
        return;
      }

      // Check if this column was renamed / added.
      const columnRename: LabelDelta|undefined = td.columnRenames.find(r => r[0] === colId);
      if (columnRename) {
        const newName = columnRename[1];
        if (!newName) {
          // TODO - find a better way to send informative notifications.
          gristNotify(t(
            "Column {{colId}} was subsequently removed in action #{{action.actionNum}}",
            {colId, actionNum: action.actionNum}
          ));
          return;
        }
        colId = newName;
      }
    }

    // Find the table model of interest.
    const tableModel = this._gristDoc.getTableModel(tableId);
    if (!tableModel) { return; }

    // Get its "primary" view.
    const viewRow = tableModel.tableMetaRow.primaryView();
    const viewId = viewRow.getRowId();

    // Switch to that view.
    await this._gristDoc.openDocPage(viewId);

    // Now let's pick a reasonable section in that view.
    const viewSection = viewRow.viewSections().peek().find((s: any) => s.table().tableId() === tableId);
    if (!viewSection) { return; }
    const sectionId = viewSection.getRowId();

    // Within that section, find the column of interest if possible.
    const fieldIndex = viewSection.viewFields().peek().findIndex((f: any) => f.colId.peek() === colId);

    // Finally, move cursor position to the section, column (if we found it), and row.
    this._gristDoc.moveToCursorPos({rowId, sectionId, fieldIndex}).catch(() => { /* do nothing */ });
  }

}
