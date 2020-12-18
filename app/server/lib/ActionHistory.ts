/**
 * TODO For now, this is just a placeholder for an actual ActionHistory implementation that should
 * replace today's ActionLog. It defines all the methods that are expected from it by Sharing.ts.
 *
 * In addition, it will need to support some methods to show action history to the user, which is
 * the main purpose of ActionLog today. And it will need to allow querying a subset of history (at
 * least by table or record).
 *
 * The main difference with today's ActionLog is that it needs to mark actions either with labels,
 * or more likely with Git-like branches, so that we can distinguish shared, local-sent, and
 * local-unsent actions. And it needs to work on LocalActionBundles, which include more
 * information than what ActionLog stores. On the other hand, it can probably store actions as
 * blobs, which can simplify the database storage.
 */

import {LocalActionBundle} from 'app/common/ActionBundle';
import {ActionGroup} from 'app/common/ActionGroup';
import {createEmptyActionSummary} from 'app/common/ActionSummary';
import {getSelectionDesc, UserAction} from 'app/common/DocActions';
import {DocState} from 'app/common/UserAPI';
import toPairs = require('lodash/toPairs');
import {summarizeAction} from './ActionSummary';

export interface ActionGroupOptions {
  // If set, inspect the action in detail in order to include a summary of
  // changes made within the action.  Otherwise, the actionSummary returned is empty.
  summarize?: boolean;

  // The client for which the action group is being prepared, if known.
  client?: {clientId: string}|null;

  // Values returned by the action, if known.
  retValues?: any[];

  // Set the 'internal' flag on the created actions, as inappropriate to undo.
  internal?: boolean;
}

export abstract class ActionHistory {
  /**
   * Initialize the ActionLog by reading the database. No other methods may be used until the
   * initialization completes. If used, their behavior is undefined.
   */
  public abstract initialize(): Promise<void>;

  public abstract isInitialized(): boolean;

  /** Returns the actionNum of the next action we expect from the hub. */
  public abstract getNextHubActionNum(): number;

  /** Returns the actionNum of the next local action should have. */
  public abstract getNextLocalActionNum(): number;

  /**
   * Act as if we have already seen actionNum. getNextHubActionNum will return 1 plus this.
   * Only suitable for use if there are no unshared local actions.
   */
  public abstract skipActionNum(actionNum: number): Promise<void>;

  /** Returns whether we have local unsent actions. */
  public abstract haveLocalUnsent(): boolean;

  /** Returns whether we have any local actions that have been sent to the hub. */
  public abstract haveLocalSent(): boolean;

  /** Returns whether we have any locally-applied actions. */
  public abstract haveLocalActions(): boolean;

  /** Fetches and returns an array of all local unsent actions. */
  public abstract fetchAllLocalUnsent(): Promise<LocalActionBundle[]>;

  /** Fetches and returns an array of all local actions (sent and unsent). */
  public abstract fetchAllLocal(): Promise<LocalActionBundle[]>;

  /** Deletes all local-only actions, and resets the affected branch pointers. */
  // TODO Should we actually delete, or be more git-like, only reset local branch pointer, and let
  // cleanup of unreferenced actions happen in a separate step?
  public abstract clearLocalActions(): Promise<void>;

  /**
   * Marks all actions returned from fetchAllLocalUnsent() as sent. Actions must be consecutive
   * starting with the the first local unsent action.
   */
  public abstract markAsSent(actions: LocalActionBundle[]): Promise<void>;

  /**
   * Matches the action from the hub against the first sent local action. If it's the same action,
   * marks our action as "shared", i.e. accepted by the hub, and returns true. Else returns false.
   * If actionHash is null, accepts unconditionally.
   */
  public abstract acceptNextSharedAction(actionHash: string|null): Promise<boolean>;

  /** Records a new local unsent action, after setting action.actionNum appropriately. */
  public abstract recordNextLocalUnsent(action: LocalActionBundle): Promise<void>;

  /** Records a new action received from the hub, after setting action.actionNum appropriately. */
  public abstract recordNextShared(action: LocalActionBundle): Promise<void>;

  /**
   * Get the most recent actions from the history.  Results are ordered by
   * earliest actions first, later actions later.  If `maxActions` is supplied,
   * at most that number of actions are returned.
   *
   * This method should be avoid in production, since it may convert and keep in memory many large
   * actions. (It has in the past led to exhausting memory and crashing node.)
   */
  public abstract getRecentActions(maxActions?: number): Promise<LocalActionBundle[]>;

  /**
   * Same as getRecentActions, but converts each to an ActionGroup using asActionGroup with the
   * supplied options.
   */
  public abstract getRecentActionGroups(maxActions: number, options: ActionGroupOptions): Promise<ActionGroup[]>;

  /**
   * Get the most recent states from the history.  States are just
   * actions without any content.  Results are ordered by most recent
   * states first (careful, this is the opposite to getRecentActions).
   * If `maxStates` is supplied, at most that number of actions are
   * returned.
   */
  public abstract getRecentStates(maxStates?: number): Promise<DocState[]>;

  /**
   * Get a list of actions, identified by their actionNum.  Any actions that could not be
   * found are returned as undefined.
   */
  public abstract getActions(actionNums: number[]): Promise<Array<LocalActionBundle|undefined>>;

  /**
   * Associates an action with a client. This association is expected to be transient, rather
   * than persistent.  It should survive a client-side reload but not a server-side restart.
   */
  public abstract setActionClientId(actionHash: string, clientId: string): void;

  /** Check for any client associated with an action, identified by checksum */
  public abstract getActionClientId(actionHash: string): string | undefined;

  /**
   * Remove all stored actions except the last keepN and run the VACUUM command
   * to reduce the size of the SQLite file.
   *
   * @param {Int} keepN - The number of most recent actions to keep. The value must be at least 1, and
   *  will default to 1 if not given.
   */
  public abstract deleteActions(keepN: number): Promise<void>;
}


/**
 * Old helper to display the actionGroup in a human-readable way.  Being maintained
 * to avoid having to change too much at once.
 */
export function humanDescription(actions: UserAction[]): string {
  const action = actions[0];
  if (!action) { return ""; }
  let output = '';
  // Common names for various action parameters
  const name    = action[0];
  const table   = action[1];
  const rows    = action[2];
  const colId   = action[2];
  const columns: any = action[3];  // TODO - better typing - but code may evaporate
  switch (name) {
  case 'UpdateRecord':
  case 'BulkUpdateRecord':
  case 'AddRecord':
  case 'BulkAddRecord':
    output = name + ' ' + getSelectionDesc(action, columns);
    break;
  case 'ApplyUndoActions':
    // Currently cannot display information about what action was undone, as the action comes
    // with the description of the "undo" message, which might be very different
    // Also, cannot currently properly log redos as they are not distinguished from others in any way
    // TODO: make an ApplyRedoActions type for redoing actions
    output = 'Undo Previous Action';
    break;
  case 'InitNewDoc':
    output = 'Initialized new Document';
    break;
  case 'AddColumn':
    output = 'Added column ' + colId + ' to ' + table;
    break;
  case 'RemoveColumn':
    output = 'Removed column ' + colId + ' from ' + table;
    break;
  case 'RemoveRecord':
  case 'BulkRemoveRecord':
    output = 'Removed record(s) ' + rows + ' from ' + table;
    break;
  case 'EvalCode':
    output = 'Evaluated Code ' + action[1];
    break;
  case 'AddTable':
    output = 'Added table ' + table;
    break;
  case 'RemoveTable':
    output = 'Removed table ' + table;
    break;
  case 'ModifyColumn':
    // TODO: The Action Log currently only logs user actions,
    // But ModifyColumn/Rename Column are almost always triggered from the client
    // through a meta-table UpdateRecord.
    // so, this is a case where making use of explicit sandbox engine 'looged' actions
    // may be useful
    output = 'Modify column ' + colId + ", ";
    for (const [col, val] of toPairs(columns)) {
      output += col + ": " + val + ", ";
    }
    output += ' in table ' + table;
    break;
  case 'RenameColumn': {
    const newColId = action[3];
    output = 'Renamed Column ' + colId + ' to ' + newColId + ' in ' + table;
    break;
  }
  default:
    output = name + ' [No Description]';
  }
  // A period for good grammar
  output += '.';
  return output;
}

/**
 * Convert an ActionBundle into an ActionGroup.  ActionGroups are the representation of
 * actions on the client.
 * @param history: interface to action history
 * @param act: action to convert
 * @param options: options to construct the ActionGroup; see its documentation above.
 */
export function asActionGroup(history: ActionHistory,
                              act: LocalActionBundle,
                              options: ActionGroupOptions): ActionGroup {
  const {summarize, client, retValues} = options;
  const info = act.info[1];
  const fromSelf = (client && client.clientId && act.actionHash) ?
    (history.getActionClientId(act.actionHash) === client.clientId) : false;

  let rowIdHint = 0;
  if (retValues) {
    // A hint for cursor position.  This logic used to live on the client, but now trying to
    // limit how much the client looks at the internals of userActions.
    // In case of AddRecord, the returned value is rowId, which is the best cursorPos for Redo.
    for (let i = 0; i < act.userActions.length; i++) {
      const name = act.userActions[i][0];
      const retValue = retValues[i];
      if (name === 'AddRecord') {
        rowIdHint = retValue;
        break;
      } else if (name === 'BulkAddRecord') {
        rowIdHint = retValue[0];
        break;
      }
    }
  }

  const primaryAction: string = String((act.userActions[0] || [""])[0]);
  const isUndo = primaryAction === 'ApplyUndoActions';

  return {
    actionNum: act.actionNum,
    actionHash: act.actionHash || "",
    desc: info.desc || humanDescription(act.userActions),
    actionSummary: summarize ? summarizeAction(act) : createEmptyActionSummary(),
    fromSelf,
    linkId: info.linkId,
    otherId: info.otherId,
    time: info.time,
    user: info.user,
    rowIdHint,
    primaryAction,
    isUndo,
    internal: options.internal || false,
  };
}
