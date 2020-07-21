import {ActionSummary} from 'app/common/ActionSummary';

/** This is the action representation the client works with. */
export interface ActionGroup {
  actionNum: number;
  actionHash: string;
  desc?: string;
  actionSummary: ActionSummary;
  fromSelf: boolean;
  linkId: number;
  otherId: number;
  time: number;
  user: string;
  rowIdHint: number;      // If non-zero, this is a rowId that would be a good place to put
                          // the cursor after an undo.
  primaryAction: string;  // The name of the first user action in the ActionGroup.
  isUndo: boolean;        // True if the first user action is ApplyUndoActions.
  internal: boolean;      // True if it is inappropriate to log/undo the action.
}
