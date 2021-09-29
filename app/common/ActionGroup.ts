import {ActionSummary} from 'app/common/ActionSummary';

/**
 * This is the action representation the client works with, for the purposes of undos/redos.
 */
export interface MinimalActionGroup {
  actionNum: number;
  actionHash: string;
  fromSelf: boolean;
  linkId: number;
  otherId: number;
  rowIdHint: number;      // If non-zero, this is a rowId that would be a good place to put
                          // the cursor after an undo.
  isUndo: boolean;        // True if the first user action is ApplyUndoActions.
}

/**
 * This is the action representation the client works with, for the purposes of document
 * history and undos/redos.
 */
export interface ActionGroup extends MinimalActionGroup {
  desc?: string;
  actionSummary: ActionSummary;
  time: number;
  user: string;
  primaryAction: string;  // The name of the first user action in the ActionGroup.
  internal: boolean;      // True if it is inappropriate to log/undo the action.
}
