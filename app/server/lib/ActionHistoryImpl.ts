/**
 * Minimal ActionHistory implementation
 */
import {LocalActionBundle} from 'app/common/ActionBundle';
import {ActionGroup, MinimalActionGroup} from 'app/common/ActionGroup';
import * as marshaller from 'app/common/marshal';
import {DocState} from 'app/common/UserAPI';
import {reportTimeTaken} from 'app/server/lib/reportTimeTaken';
import * as crypto from 'crypto';
import keyBy = require('lodash/keyBy');
import mapValues = require('lodash/mapValues');
import {ActionGroupOptions, ActionHistory, ActionHistoryUndoInfo, asActionGroup,
        asMinimalActionGroup} from './ActionHistory';
import {ISQLiteDB, ResultRow} from './SQLiteDB';

// History will from time to time be pruned back to within these limits
// on rows and the maximum total number of bytes in the "body" column.
// Pruning is done when the history has grown above these limits, to
// the specified factor.
const ACTION_HISTORY_MAX_ROWS = 1000;
const ACTION_HISTORY_MAX_BYTES = 1000 * 1000 * 1000;  // 1 GB.
const ACTION_HISTORY_GRACE_FACTOR = 1.25;  // allow growth to 1250 rows / 1.25 GB.
const ACTION_HISTORY_CHECK_PERIOD = 10;    // number of actions between size checks.

/**
 *
 * Encode an action as a buffer.
 *
 */
export function encodeAction(action: LocalActionBundle): Buffer {
  const encoder = new marshaller.Marshaller({version: 2});
  encoder.marshal(action);
  return encoder.dumpAsBuffer();
}

/**
 *
 * Decode an action from a buffer.  Throws an error if buffer doesn't look plausible.
 *
 */
export function decodeAction(blob: Buffer | Uint8Array): LocalActionBundle {
  return marshaller.loads(blob) as LocalActionBundle;
}


/**
 *
 * Decode an action from an ActionHistory row. Row must include body, actionNum, actionHash fields.
 *
 */
function decodeActionFromRow(row: ResultRow): LocalActionBundle {
    const body = decodeAction(row.body);
    // Reset actionNum and actionHash, just to have one fewer thing to worry about.
    body.actionNum = row.actionNum;
    body.actionHash = row.actionHash;
    return body;
  }

/**
 *
 * Generate an action checksum from a LocalActionBundle
 * Needs to be in sync with Hub/Sharing.
 *
 */
export function computeActionHash(action: LocalActionBundle): string {
  const shaSum = crypto.createHash('sha256');
  const encoder = new marshaller.Marshaller({version: 2});
  encoder.marshal(action.actionNum);
  encoder.marshal(action.parentActionHash);
  encoder.marshal(action.info);
  encoder.marshal(action.stored);
  const buf = encoder.dumpAsBuffer();
  shaSum.update(buf);
  return shaSum.digest('hex');
}


/** The important identifiers associated with an action */
interface ActionIdentifiers {
  /**
   *
   * actionRef is the SQLite-allocated row id in the main ActionHistory table.
   * See:
   *   https://www.sqlite.org/rowidtable.html
   *   https://sqlite.org/autoinc.html
   * for background on how this works.
   *
   */
  actionRef: number|null;

  /**
   *
   * actionHash is a checksum computed from salient parts of an ActionBundle.
   *
   */
  actionHash: string|null;

  /**
   *
   * actionNum is the depth in history from the root, starting from 1 for the first
   * action.
   *
   */
  actionNum: number|null;

  /**
   *
   * The name of a branch where we found this action.
   *
   */
  branchName: string;
}

/** An organized view of the standard branches: shared, local_sent, local_unsent */
interface StandardBranches {
  shared: ActionIdentifiers;
  local_sent: ActionIdentifiers;
  local_unsent: ActionIdentifiers;
}

/** Tweakable parameters for storing the action history */
interface ActionHistoryOptions {
  maxRows: number;   // maximum number of rows to aim for
  maxBytes: number;  // maximum total "body" bytes to aim for
  graceFactor: number;  // allow this amount of slop in limits
  checkPeriod: number;  // number of actions between checks
}

const defaultOptions: ActionHistoryOptions = {
  maxRows: ACTION_HISTORY_MAX_ROWS,
  maxBytes: ACTION_HISTORY_MAX_BYTES,
  graceFactor: ACTION_HISTORY_GRACE_FACTOR,
  checkPeriod: ACTION_HISTORY_CHECK_PERIOD,
};

/**
 *
 * An implementation of the ActionHistory interface, using SQLite tables.
 *
 * The history of Grist actions is essentially linear.  We have a notion of
 * action branches only to track certain "subhistories" of those actions,
 * specifically:
 *   - those actions that have been "shared"
 *   - those actions that have been "sent" (but not yet declared "shared")
 * The "shared" branch reaches from the beginning of history to the last known
 * shared action.  The "local_sent" branch reaches at least to that point, and
 * potentially on to other actions that have been "sent" but not "shared".
 * All remaining branches -- just one right now, called "local_unsent" --
 * continue on from there.  We may in the future permit multiple such
 * branches.  In this case, this part of the action history could actually
 * form a tree and not be linear.
 *
 * For all branches, we track their "tip", the most recent action on
 * that branch.
 *
 * TODO: links to parent actions stored in bundles are not currently
 * updated in the database when those parent actions are deleted.  If this
 * is an issue, it might be best to remove such information from the bundles
 * when stored and add it back as it is retrieved, or treat it separately.
 *
 */
export class ActionHistoryImpl implements ActionHistory {

  private _sharedActionNum: number = 1;       // track depth in tree of shared actions
  private _localActionNum: number = 1;        // track depth in tree of local actions
  private _haveLocalSent: boolean = false;    // cache for this.haveLocalSent()
  private _haveLocalUnsent: boolean = false;  // cache for this.haveLocalUnsent()
  private _initialized: boolean = false;      // true when initialize() has completed
  private _actionUndoInfo = new Map<string, ActionHistoryUndoInfo>();  // transient cache of undo info

  constructor(private _db: ISQLiteDB, private _options: ActionHistoryOptions = defaultOptions) {
  }

  /** remove any existing data from ActionHistory - useful during testing. */
  public async wipe() {
    await this._db.run("UPDATE _gristsys_ActionHistoryBranch SET actionRef = NULL");
    await this._db.run("DELETE FROM _gristsys_ActionHistory");
    this._actionUndoInfo.clear();
  }

  public async initialize(): Promise<void> {
    const branches = await this._getBranches();
    if (branches.shared.actionNum) {
      this._sharedActionNum = branches.shared.actionNum + 1;
    }
    if (branches.local_unsent.actionNum) {
      this._localActionNum = branches.local_unsent.actionNum + 1;
    }
    // Record whether we currently have local actions (sent or unsent).
    const sharedActionNum = branches.shared.actionNum || -1;
    const localSentActionNum = branches.local_sent.actionNum || -1;
    const localUnsentActionNum = branches.local_unsent.actionNum || -1;
    this._haveLocalUnsent = localUnsentActionNum > localSentActionNum;
    this._haveLocalSent = localSentActionNum > sharedActionNum;
    this._initialized = true;
    // Apply any limits on action history size.
    await this._pruneLargeHistory(sharedActionNum);
  }

  public isInitialized(): boolean {
    return this._initialized;
  }

  public getNextHubActionNum(): number {
    return this._sharedActionNum;
  }

  public getNextLocalActionNum(): number {
    return this._localActionNum;
  }

  public async skipActionNum(actionNum: number): Promise<void> {
    if (this._localActionNum !== this._sharedActionNum) {
      throw new Error("Tried to skip to an actionNum with unshared local actions");
    }

    if (actionNum < this._sharedActionNum) {
      if (actionNum === this._sharedActionNum - 1) {
        // that was easy
        return;
      }
      throw new Error("Tried to skip to an actionNum we've already passed");
    }

    // Force the actionNum to the desired value
    this._localActionNum = this._sharedActionNum = actionNum;

    // We store a row as we would for recordNextShared()
    const action: LocalActionBundle = {
      actionHash: null,
      parentActionHash: null,
      actionNum: this._sharedActionNum,
      userActions: [],
      undo: [],
      envelopes: [],
      info: [0, {time: 0, user: "grist", inst: "", desc: "root", otherId: 0, linkId: 0}],
      stored: [],
      calc: []
    };
    await this._db.execTransaction(async () => {
      const branches = await this._getBranches();
      if (branches.shared.actionRef !== branches.local_sent.actionRef ||
          branches.shared.actionRef !== branches.local_unsent.actionRef) {
        throw new Error("skipActionNum not defined when branches not in sync");
      }
      const actionRef = await this._addAction(action, branches.shared);
      this._noteSharedAction(action.actionNum);
      await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = ?
                            WHERE name IN ('local_unsent', 'local_sent')`,
                         actionRef);
    });
  }

  public haveLocalUnsent(): boolean {
    return this._haveLocalUnsent;
  }

  public haveLocalSent(): boolean {
    return this._haveLocalSent;
  }

  public haveLocalActions(): boolean {
    return this._haveLocalSent || this._haveLocalUnsent;
  }

  public async fetchAllLocalUnsent(): Promise<LocalActionBundle[]> {
    const branches = await this._getBranches();
    return this._fetchActions(branches.local_sent, branches.local_unsent);
  }

  public async fetchAllLocal(): Promise<LocalActionBundle[]> {
    const branches = await this._getBranches();
    return this._fetchActions(branches.shared, branches.local_unsent);
  }

  public async clearLocalActions(): Promise<void> {
    await this._db.execTransaction(async () => {
      const branches = await this._getBranches();
      const rows = await this._fetchParts(branches.shared, branches.local_unsent,
                                          "_gristsys_ActionHistory.id, actionHash");
      await this._deleteRows(rows);
      await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = ?
                            WHERE name IN ('local_unsent', 'local_sent')`,
                         branches.shared.actionRef);
      this._haveLocalSent = false;
      this._haveLocalUnsent = false;
      this._localActionNum = this._sharedActionNum;
    });
  }

  public async markAsSent(actions: LocalActionBundle[]): Promise<void> {
    const branches = await this._getBranches();
    const candidates = await this._fetchParts(branches.local_sent,
                                              branches.local_unsent,
                                              "_gristsys_ActionHistory.id, actionHash");
    let tip: number|undefined;
    try {
      for (const act of actions) {
        if (candidates.length === 0) {
          throw new Error("markAsSent() called but nothing local and unsent");
        }
        const candidate = candidates[0];
        // act and act2 must be one and the same
        if (act.actionHash !== candidate.actionHash) {
          throw new Error("markAsSent() got an unexpected action");
        }
        tip = candidate.id;
        candidates.shift();
        if (candidates.length === 0) {
          this._haveLocalUnsent = false;
        }
        this._haveLocalSent = true;
      }
    } finally {
      if (tip) {
        await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = ?
                              WHERE name = 'local_sent'`,
                           tip);
      }
    }
  }

  public async acceptNextSharedAction(actionHash: string|null): Promise<boolean> {
    const branches = await this._getBranches();
    const candidates = await this._fetchParts(branches.shared,
                                              branches.local_sent,
                                              "_gristsys_ActionHistory.id, actionHash, actionNum",
                                              2);
    if (candidates.length === 0) {
      return false;
    }
    const candidate = candidates[0];
    if (actionHash != null) {
      if (candidate.actionHash !== actionHash) {
        return false;
      }
    }
    await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = ?
                          WHERE name = 'shared'`,
                       candidate.id);
    if (candidates.length === 1) {
      this._haveLocalSent = false;
    }
    this._noteSharedAction(candidate.actionNum);
    await this._pruneLargeHistory(candidate.actionNum);
    return true;
  }

  /** This will populate action.actionHash and action.parentActionHash */
  public async recordNextLocalUnsent(action: LocalActionBundle): Promise<void> {
    const branches = await this._getBranches();
    await this._addAction(action, branches.local_unsent);
    this._noteLocalAction(action.actionNum);
    this._haveLocalUnsent = true;
  }

  public async recordNextShared(action: LocalActionBundle): Promise<void> {
    // I think, reading Sharing.ts, that these actions should be added to all
    // the system branches - it is just a shortcut for getting to shared
    await this._db.execTransaction(async () => {
      const branches = await this._getBranches();
      if (branches.shared.actionRef !== branches.local_sent.actionRef ||
          branches.shared.actionRef !== branches.local_unsent.actionRef) {
        throw new Error("recordNextShared not defined when branches not in sync");
      }
      const actionRef = await this._addAction(action, branches.shared);
      this._noteSharedAction(action.actionNum);
      await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = ?
                            WHERE name IN ('local_unsent', 'local_sent')`,
                         actionRef);
    });
    await this._pruneLargeHistory(action.actionNum);
  }

  public async getRecentActions(maxActions?: number): Promise<LocalActionBundle[]> {
    const actions = await this._getRecentActionRows(maxActions);
    return reportTimeTaken("getRecentActions", () => actions.map(decodeActionFromRow));
  }

  public async getRecentActionGroups(maxActions: number, options: ActionGroupOptions): Promise<ActionGroup[]> {
    const actions = await this._getRecentActionRows(maxActions);
    return reportTimeTaken("getRecentActionGroups",
      () => actions.map(row => asActionGroup(this, decodeActionFromRow(row), options)));
  }

  public async getRecentMinimalActionGroups(maxActions: number, clientId?: string): Promise<MinimalActionGroup[]> {
    // Don't look at content of actions.
    const actions = await this._getRecentActionRows(maxActions, false);
    return reportTimeTaken(
      "getRecentMinimalActionGroups",
      () => actions.map(row => asMinimalActionGroup(
        this,
        {actionHash: row.actionHash, actionNum: row.actionNum},
        clientId)));
  }

  public async getRecentStates(maxStates?: number): Promise<DocState[]> {
    const branches = await this._getBranches();
    const states = await this._fetchParts(null,
                                          branches.local_unsent,
                                          "_gristsys_ActionHistory.id, actionNum, actionHash",
                                          maxStates,
                                          true);
    return states.map(row => ({n: row.actionNum, h: row.actionHash}));
  }

  public async getActions(actionNums: number[]): Promise<Array<LocalActionBundle|undefined>> {
    const actions = await this._db.all(
      `SELECT actionHash, actionNum, body FROM _gristsys_ActionHistory
       where actionNum in (${actionNums.map(x => '?').join(',')})`,
      ...actionNums);
    return reportTimeTaken("getActions", () => {
      const actionsByActionNum = keyBy(actions, 'actionNum');
      return actionNums
        .map(n => actionsByActionNum[n])
        .map((row) => row ? decodeActionFromRow(row) : undefined);
    });
  }

  /**
   * Helper function to remove all stored actions except the last keepN and run the VACUUM command
   * to reduce the size of the SQLite file.
   *
   * @param {Int} keepN - The number of most recent actions to keep. The value must be at least 1, and
   *  will default to 1 if not given.
   * @returns {Promise} - A promise for the SQL execution.
   *
   * NOTE: Only keeps actions after maxActionNum - keepN, which might be less than keepN actions if
   *  actions are not sequential in the file.
   */
  public async deleteActions(keepN: number): Promise<void> {
    await this._db.execTransaction(async () => {
      const branches = await this._getBranches();
      const rows = await this._fetchParts(null,
                                          branches.local_unsent,
                                          "_gristsys_ActionHistory.id, actionHash",
                                          keepN,
                                          true);
      const ids = await this._deleteRows(rows, true);
      // By construction, we are removing all rows from the start of history to a certain point.
      // So, if any of the removed actions are mentioned as the tip of a branch, that tip should
      // now simply become null/empty.
      await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = NULL WHERE actionRef NOT IN (${ids})`);
      await this._db.requestVacuum();
    });
  }

  public setActionUndoInfo(actionHash: string, undoInfo: ActionHistoryUndoInfo): void {
    this._actionUndoInfo.set(actionHash, undoInfo);
  }

  public getActionUndoInfo(actionHash: string): ActionHistoryUndoInfo | undefined {
    return this._actionUndoInfo.get(actionHash);
  }

  /**
   * Fetches the most recent action row from the history, ordered with earlier actions first.
   * If `maxActions` is supplied, at most that number of actions are returned.
   */
  private async _getRecentActionRows(maxActions: number|undefined,
                                     withBody: boolean = true): Promise<ResultRow[]> {
    const branches = await this._getBranches();
    const columns = '_gristsys_ActionHistory.id, actionNum, actionHash' + (withBody ? ', body' : '');
    const result = await this._fetchParts(null,
                                          branches.local_unsent,
                                          columns,
                                          maxActions,
                                          true);
    result.reverse();  // Implementation note: this could be optimized away when `maxActions`
                       // is not specified, by simply asking _fetchParts for ascending order.
    return result;
  }

  /** Check if we need to update the next shared actionNum */
  private _noteSharedAction(actionNum: number): void {
    if (actionNum >= this._sharedActionNum) {
      this._sharedActionNum = actionNum + 1;
    }
    this._noteLocalAction(actionNum);
  }

  /** Check if we need to update the next local actionNum */
  private _noteLocalAction(actionNum: number): void {
    if (actionNum >= this._localActionNum) {
      this._localActionNum = actionNum + 1;
    }
  }

  /** Append an action to a branch. */
  private async _addAction(action: LocalActionBundle,
                           branch: ActionIdentifiers): Promise<number> {
    action.parentActionHash = branch.actionHash;
    if (!action.actionHash) {
      action.actionHash = computeActionHash(action);
    }
    const buf = encodeAction(action);
    return this._db.execTransaction(async () => {
      // Add the action.  We let SQLite fill in the "id" column, which is an alias for
      // the SQLite rowid in this case: https://www.sqlite.org/rowidtable.html
      const id = await this._db.runAndGetId(`INSERT INTO _gristsys_ActionHistory
                                               (actionHash, parentRef, actionNum, body)
                                               VALUES (?, ?, ?, ?)`,
                                            action.actionHash,
                                            branch.actionRef,
                                            action.actionNum,
                                            buf);
      await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = ?
                            WHERE name = ?`,
                         id, branch.branchName);
      return id;
    });
  }

  /** Get the current status of the standard branches: shared, local_sent, and local_unsent */
  private async _getBranches(): Promise<StandardBranches> {
    const rows = await this._db.all(`SELECT name, actionNum, actionHash, Branch.actionRef
                                       FROM _gristsys_ActionHistoryBranch as Branch
                                       LEFT JOIN _gristsys_ActionHistory as History
                                         ON History.id = Branch.actionRef
                                       WHERE name in ('shared', 'local_sent', 'local_unsent')`);
    const bits = mapValues(keyBy(rows, 'name'), this._asActionIdentifiers);
    const missing = { actionHash: null, actionRef: null, actionNum: null } as ActionIdentifiers;
    return {
      shared: bits.shared || missing,
      local_sent: bits.local_sent || missing,
      local_unsent: bits.local_unsent || missing
    };
  }

  /** Cast an sqlite result row into a structure with the IDs we care about */
  private _asActionIdentifiers(row: ResultRow|null): ActionIdentifiers|null {
    if (!row) {
      return null;
    }
    return {
      actionRef: row.actionRef,
      actionHash: row.actionHash,
      actionNum: row.actionNum,
      branchName: row.name
    };
  }

  /**
   *
   * Fetch selected parts of a range of actions.  We do a recursive query
   * working backwards from the action identified by `end`, following a
   * chain of ancestors via `parentRef` links, until we reach the action
   * identified by `start` or run out of ancestors.  The action identified
   * by `start` is NOT included in the results.  Results are returned in
   * ascending order of `actionNum` - in other words results closer to the
   * beginning of history are returned first.
   *
   * @param start - identifiers of an action not to include in the results.
   * @param end - identifiers of an action to include in the results
   * @param selection - SQLite SELECT result-columns to return
   * @param limit - optional cap on the number of results to return.
   * @param desc - optional - if true, invert order of results, starting
   * from highest `actionNum` rather than lowest.
   *
   * @return a list of ResultRows, containing whatever was requested in
   * the `selection` parameter for each action found.
   *
   */
  private async _fetchParts(start: ActionIdentifiers|null,
                            end: ActionIdentifiers|null,
                            selection: string,
                            limit?: number,
                            desc?: boolean): Promise<ResultRow[]> {
    if (!end) { return []; }

    // Collect all actions, Starting at the branch tip, and working
    // backwards until we hit a delimiting actionNum.
    // See https://sqlite.org/lang_with.html for details of recursive CTEs.
    const rows = await this._db.all(`WITH RECURSIVE
                                       actions(id) AS (
                                         VALUES(?)
                                         UNION ALL
                                           SELECT parentRef FROM _gristsys_ActionHistory, actions
                                             WHERE _gristsys_ActionHistory.id = actions.id
                                               AND parentRef IS NOT NULL
                                               AND _gristsys_ActionHistory.id IS NOT ?)
                                     SELECT ${selection} from actions
                                       JOIN _gristsys_ActionHistory
                                         ON actions.id = _gristsys_ActionHistory.id
                                       WHERE _gristsys_ActionHistory.id IS NOT ?
                                       ORDER BY actionNum ${desc ? "DESC " : ""}
                                       ${limit ? ("LIMIT " + limit) : ""}`,
                                    end.actionRef,
                                    start ? start.actionRef : null,
                                    start ? start.actionRef : null);
    return rows;
  }

  /**
   *
   * Fetch a range of actions as LocalActionBundles.  We do a recursive query
   * working backwards from the action identified by `end`, following a
   * chain of ancestors via `parentRef` links, until we reach the action
   * identified by `start` or run out of ancestors.  The action identified
   * by `start` is NOT included in the results.  Results are returned in
   * ascending order of `actionNum` - in other words results closer to the
   * beginning of history are returned first.
   *
   * @param start - identifiers of an action not to include in the results.
   * @param end - identifiers of an action to include in the results
   *
   * @return a list of LocalActionBundles.
   *
   */
  private async _fetchActions(start: ActionIdentifiers|null,
                              end: ActionIdentifiers|null): Promise<LocalActionBundle[]> {
    const rows = await this._fetchParts(start, end, "body, actionNum, actionHash");
    return reportTimeTaken("_fetchActions", () => rows.map(decodeActionFromRow));
  }

  /**
   * Delete rows in the ActionHistory.  Any client id association is also removed for
   * the given rows.  Branch information is not updated, it is the responsibility of
   * the caller to keep that synchronized.
   *
   * @param rows: The rows to delete. Should have at least id and actionHash fields.
   * @param invert: True if all but the listed rows should be deleted.
   *
   * Returns the list of ids of the supplied rows.
   */
  private async _deleteRows(rows: ResultRow[], invert?: boolean): Promise<number[]> {
    // There's no great solution for passing a long list of numbers to sqlite for a
    // single query.  Here, we concatenate them with comma separators and embed them
    // in the SQL string.
    // TODO: deal with limit on max length of sql statement https://www.sqlite.org/limits.html
    const ids = rows.map(row => row.id);
    const idList = ids.join(',');
    await this._db.run(`DELETE FROM _gristsys_ActionHistory
                          WHERE id ${invert ? 'NOT' : ''} IN (${idList})`);
    for (const row of rows) {
      this._actionUndoInfo.delete(row.actionHash);
    }
    return ids;
  }

  /**
   * Deletes rows in the ActionHistory if there are too many of them or they hold too
   * much data.
   */
  private async _pruneLargeHistory(actionNum: number): Promise<void> {
    // We check history size occasionally, not on every single action.  The check
    // requires summing a blob length over up to roughly ACTION_HISTORY_MAX_ROWS rows.
    // For a 2GB test db with 3 times this number of rows, the check takes < 10 ms.
    // But there's no need to add that tax to every action.
    if (actionNum % this._options.checkPeriod !== 0) {
      return;
    }
    // Do a quick check on the history size.  We work on the "shared" branch, to
    // avoid the possibility of deleting history that has not yet been shared.
    let branches = await this._getBranches();
    const checks = (await this._fetchParts(null,
                                           branches.shared,
                                           "count(*) as count, sum(length(body)) as bytes",
                                           undefined,
                                           true))[0];
    if (checks.count <= this._options.maxRows * this._options.graceFactor &&
        checks.bytes <= this._options.maxBytes * this._options.graceFactor) {
      return; // Nothing to do, size is ok.
    }
    // Too big!  Check carefully what needs to be done.
    await this._db.execTransaction(async () => {
      // Make sure branches are up to date within this transaction.
      branches = await this._getBranches();
      const rows = await this._fetchParts(null,
                                          branches.shared,
                                          "_gristsys_ActionHistory.id, actionHash, actionNum, length(body) as bytes",
                                          undefined,
                                          true);
      // Scan to find the first row that pushes us over a limit.
      let count: number = 0;
      let bytes: number = 0;
      let first: number = -1;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        count++;
        bytes += row.bytes;
        if (count > 1 && (bytes > this._options.maxBytes || count > this._options.maxRows)) {
          first = i;
          break;
        }
      }
      if (first === -1) { return; }
      // Delete remaining rows - in batches because _deleteRows has limited capacity.
      const batchLength: number = 100;
      for (let i = first; i < rows.length; i += batchLength) {
        const batch = rows.slice(i, i + batchLength);
        const ids = await this._deleteRows(batch);
        // We are removing all rows from the start of history to a certain point.
        // So, if any of the removed actions are mentioned as the tip of a branch,
        // that tip should now simply become null/empty.
        await this._db.run(`UPDATE _gristsys_ActionHistoryBranch SET actionRef = NULL WHERE actionRef IN (${ids})`);
      }
      // At this point, to recover the maximum memory, we could VACUUM the document.
      // But vacuuming is an unacceptably slow operation for large documents (e.g.
      // 30 secs for a 2GB doc) so it is obnoxious to do that while the user is waiting.
      // Without vacuuming, the document will grow due to fragmentation, but this should
      // be at a lower rate than it would grow if we were simply retaining full history.
      // TODO: occasionally VACUUM large documents while they are not being used.
    });
  }
}
