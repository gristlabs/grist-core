import {
  ActionBundle,
  ActionInfo,
  Envelope,
  getEnvContent,
  LocalActionBundle,
  UserActionBundle
} from 'app/common/ActionBundle';
import {DocAction, getNumRows, UserAction} from 'app/common/DocActions';
import {allToken} from 'app/common/sharing';
import * as log from 'app/server/lib/log';
import {LogMethods} from "app/server/lib/LogMethods";
import {shortDesc} from 'app/server/lib/shortDesc';
import * as assert from 'assert';
import {Mutex} from 'async-mutex';
import * as Deque from 'double-ended-queue';
import {ActionHistory, asActionGroup, getActionUndoInfo} from './ActionHistory';
import {ActiveDoc} from './ActiveDoc';
import {makeExceptionalDocSession, OptDocSession} from './DocSession';
import {WorkCoordinator} from './WorkCoordinator';

// Describes the request to apply a UserActionBundle. It includes a Client (so that broadcast
// message can set `.fromSelf` property), and methods to resolve or reject the promise for when
// the action is applied. Note that it may not be immediate in case we are in the middle of
// processing hub actions or rebasing.
interface UserRequest {
  action: UserActionBundle;
  docSession: OptDocSession|null;
  resolve(result: UserResult): void;
  reject(err: Error): void;
}

// The result of applying a UserRequest, used to resolve the promise. It includes the retValues
// (one for each UserAction in the bundle) and the actionNum of the applied LocalActionBundle.
interface UserResult {
  actionNum: number;
  retValues: any[];
  isModification: boolean;
}

// Internally-used enum to distinguish if applied actions should be logged as local or shared.
enum Branch { Local, Shared }

// Don't log details of action bundles in production.
const LOG_ACTION_BUNDLE = (process.env.NODE_ENV !== 'production');

export class Sharing {
  protected _activeDoc: ActiveDoc;
  protected _actionHistory: ActionHistory;
  protected _hubQueue: Deque<ActionBundle> = new Deque();
  protected _pendingQueue: Deque<UserRequest> = new Deque();
  protected _workCoordinator: WorkCoordinator;

  private _log = new LogMethods('Sharing ', (s: OptDocSession|null) => this._activeDoc.getLogMeta(s));

  constructor(activeDoc: ActiveDoc, actionHistory: ActionHistory, private _modificationLock: Mutex) {
    // TODO actionHistory is currently unused (we use activeDoc.actionLog).
    assert(actionHistory.isInitialized());

    this._activeDoc = activeDoc;
    this._actionHistory = actionHistory;
    this._workCoordinator = new WorkCoordinator(() => this._doNextStep());
  }

  /**
   * Returns whether this doc is shared. It's shared if and only if HubDocClient is set (though it
   * may be disconnected).
   */
  public isShared(): boolean { return false; }

  public isSharingActivated(): boolean { return false; }

  /** Returns the instanceId if the doc is shared or null otherwise. */
  public get instanceId(): string|null { return null; }

  public isOwnEnvelope(recipients: string[]): boolean { return true; }

  public async sendLocalAction(): Promise<void> {
    throw new Error('sendLocalAction not implemented');
  }

  public async removeInstanceFromDoc(): Promise<string> {
    throw new Error('removeInstanceFromDoc not implemented');
  }

  /**
   * The only public interface. This may be called at any time, including while rebasing.
   * WorkCoordinator ensures that actual work will only happen once other work finishes.
   */
  public addUserAction(userRequest: UserRequest) {
    this._pendingQueue.push(userRequest);
    this._workCoordinator.ping();
  }

  // Returns a promise if there is some work happening, or null if there isn't.
  private _doNextStep(): Promise<void>|null {
    if (this._hubQueue.isEmpty()) {
      if (!this._pendingQueue.isEmpty()) {
        return this._applyLocalAction();
      } else if (this.isSharingActivated() && this._actionHistory.haveLocalUnsent()) {
        return this.sendLocalAction();
      } else {
        return null;
      }
    } else {
      if (!this._actionHistory.haveLocalActions()) {
        return this._applyHubAction();
      } else {
        return this._mergeInHubAction();
      }
    }
  }

  private async _applyLocalAction(): Promise<void> {
    assert(this._hubQueue.isEmpty() && !this._pendingQueue.isEmpty());
    const userRequest: UserRequest = this._pendingQueue.shift()!;
    try {
      const ret = await this._doApplyUserActionBundle(userRequest.action, userRequest.docSession);
      userRequest.resolve(ret);
    } catch (e) {
      this._log.warn(userRequest.docSession, "Unable to apply action...", e);
      userRequest.reject(e);
    }
  }

  private async _applyHubAction(): Promise<void> {
    assert(!this._hubQueue.isEmpty() && !this._actionHistory.haveLocalActions());
    const action: ActionBundle = this._hubQueue.shift()!;
    try {
      await this._doApplySharedActionBundle(action);
    } catch (e) {
      this._log.error(null, "Unable to apply hub action... skipping");
    }
  }

  private async _mergeInHubAction(): Promise<void> {
    assert(!this._hubQueue.isEmpty() && this._actionHistory.haveLocalActions());

    const action: ActionBundle = this._hubQueue.peekFront()!;
    try {
      const accepted = await this._actionHistory.acceptNextSharedAction(action.actionHash);
      if (accepted) {
        this._hubQueue.shift();
      } else {
        await this._rebaseLocalActions();
      }
    } catch (e) {
      this._log.error(null, "Unable to apply hub action... skipping");
    }
  }

  private async _rebaseLocalActions(): Promise<void> {
    const rebaseQueue: Deque<UserActionBundle> = new Deque<UserActionBundle>();
    try {
      this._createCheckpoint();
      const actions: LocalActionBundle[] = await this._actionHistory.fetchAllLocal();
      assert(actions.length > 0);
      await this._doApplyUserActionBundle(this._createUndo(actions), null);
      rebaseQueue.push(...actions.map((a) => getUserActionBundle(a)));
      await this._actionHistory.clearLocalActions();
    } catch (e) {
      this._log.error(null, "Can't undo local actions; sharing is off");
      this._rollbackToCheckpoint();
      // TODO this.disconnect();
      // TODO errorState = true;
      return;
    }
    assert(!this._actionHistory.haveLocalActions());

    while (!this._hubQueue.isEmpty()) {
      await this._applyHubAction();
    }
    const rebaseFailures: Array<[UserActionBundle, UserActionBundle]> = [];
    while (!rebaseQueue.isEmpty()) {
      const action: UserActionBundle = rebaseQueue.shift()!;
      const adjusted: UserActionBundle = this._mergeAdjust(action);
      try {
        await this._doApplyUserActionBundle(adjusted, null);
      } catch (e) {
        this._log.warn(null, "Unable to apply rebased action...");
        rebaseFailures.push([action, adjusted]);
      }
    }
    if (rebaseFailures.length > 0) {
      this._createBackupAtCheckpoint();
      // TODO we should notify the user too.
      this._log.error(null, 'Rebase failed to reapply some of your actions, backup of local at...');
    }
    this._releaseCheckpoint();
  }

  // ======================================================================

  private _doApplySharedActionBundle(action: ActionBundle): Promise<UserResult> {
    const userActions: UserAction[] = [
      ['ApplyDocActions', action.stored.map(envContent => envContent[1])]
    ];
    return this._doApplyUserActions(action.info[1], userActions, Branch.Shared, null);
  }

  private _doApplyUserActionBundle(action: UserActionBundle, docSession: OptDocSession|null): Promise<UserResult> {
    return this._doApplyUserActions(action.info, action.userActions, Branch.Local, docSession);
  }

  private async _doApplyUserActions(info: ActionInfo, userActions: UserAction[],
                                   branch: Branch, docSession: OptDocSession|null): Promise<UserResult> {
    const client = docSession && docSession.client;

    if (docSession?.linkId) {
      info.linkId = docSession.linkId;
    }

    const {sandboxActionBundle, undo, accessControl} =
      await this._modificationLock.runExclusive(() => this._applyActionsToDataEngine(docSession, userActions));

    try {

      const isCalculate = (userActions.length === 1 &&
                           (userActions[0][0] === 'Calculate' || userActions[0][0] === 'UpdateCurrentTime'));
      // `internal` is true if users shouldn't be able to undo the actions. Applies to:
      // - Calculate/UpdateCurrentTime because it's not considered as performed by a particular client.
      // - Adding attachment metadata when uploading attachments,
      //   because then the attachment file may get hard-deleted and redo won't work properly.
      const internal = isCalculate || userActions.every(a => a[0] === "AddRecord" && a[1] === "_grist_Attachments");

      // A trivial action does not merit allocating an actionNum,
      // logging, and sharing. It's best not to log the
      // action that calculates formula values when the document is opened cold
      // (without cached ActiveDoc) if it doesn't change anything - otherwise we'll end up with spam
      // log entries for each time the document is opened cold.
      const trivial = internal && sandboxActionBundle.stored.length === 0;

      const actionNum = trivial ? 0 :
        (branch === Branch.Shared ? this._actionHistory.getNextHubActionNum() :
         this._actionHistory.getNextLocalActionNum());

      const localActionBundle: LocalActionBundle = {
        actionNum,
        // The ActionInfo should go into the envelope that includes all recipients.
        info: [findOrAddAllEnvelope(sandboxActionBundle.envelopes), info],
        envelopes: sandboxActionBundle.envelopes,
        stored: sandboxActionBundle.stored,
        calc: sandboxActionBundle.calc,
        undo,
        userActions,
        actionHash: null,        // Gets set below by _actionHistory.recordNext...
        parentActionHash: null,  // Gets set below by _actionHistory.recordNext...
      };

      const altSessionId = client?.getAltSessionId();
      const logMeta = {
        actionNum,
        linkId: info.linkId,
        otherId: info.otherId,
        numDocActions: localActionBundle.stored.length,
        numRows: localActionBundle.stored.reduce((n, env) => n + getNumRows(env[1]), 0),
        author: info.user,
        ...(altSessionId ? {session: altSessionId}: {}),
      };
      this._log.rawLog('debug', docSession, '_doApplyUserActions', logMeta);
      if (LOG_ACTION_BUNDLE) {
        this._logActionBundle(`_doApplyUserActions (${Branch[branch]})`, localActionBundle);
      }

      // TODO Note that the sandbox may produce actions which are not addressed to us (e.g. when we
      // have EDIT permission without VIEW). These are not sent to the browser or the database. But
      // today they are reflected in the sandbox. Should we (or the sandbox) immediately undo the
      // full change, and then redo only the actions addressed to ourselves? Let's cross that bridge
      // when we come to it. For now we only log skipped envelopes as "alien" in _logActionBundle().
      const ownActionBundle: LocalActionBundle = this._filterOwnActions(localActionBundle);

      // If the document has shut down in the meantime, and this was just a "Calculate" action,
      // return a trivial result.  This is just to reduce noisy warnings in migration tests.
      if (this._activeDoc.isShuttingDown && isCalculate) {
        return {
          actionNum: localActionBundle.actionNum,
          retValues: [],
          isModification: false
        };
      }

      // Apply the action to the database, and record in the action log.
      if (!trivial) {
        await this._activeDoc.docStorage.execTransaction(async () => {
          await this._activeDoc.docStorage.applyStoredActions(getEnvContent(ownActionBundle.stored));
          if (this.isShared() && branch === Branch.Local) {
            // this call will compute an actionHash for localActionBundle
            await this._actionHistory.recordNextLocalUnsent(localActionBundle);
          } else {
            // Before sharing is enabled, actions are immediately marked as "shared" (as if accepted
            // by the hub). The alternative of keeping actions on the "local" branch until sharing is
            // enabled is less suitable, because such actions could have empty envelopes, and cannot
            // be shared. Once sharing is enabled, we would share a snapshot at that time.
            await this._actionHistory.recordNextShared(localActionBundle);
          }
          if (client && client.clientId && !internal) {
            this._actionHistory.setActionUndoInfo(
              localActionBundle.actionHash!,
              getActionUndoInfo(localActionBundle, client.clientId, sandboxActionBundle.retValues));
          }
        });
      }
      await this._activeDoc.processActionBundle(ownActionBundle);

      const actionSummary = await this._activeDoc.handleTriggers(localActionBundle);

      await this._activeDoc.updateRowCount(sandboxActionBundle.rowCount, docSession);

      // Broadcast the action to connected browsers.
      const actionGroup = asActionGroup(this._actionHistory, localActionBundle, {
        clientId: client?.clientId,
        retValues: sandboxActionBundle.retValues,
        internal,
      });
      actionGroup.actionSummary = actionSummary;
      await accessControl.appliedBundle();
      await accessControl.sendDocUpdateForBundle(actionGroup, this._activeDoc.docUsage);
      if (docSession) {
        docSession.linkId = docSession.shouldBundleActions ? localActionBundle.actionNum : 0;
      }
      return {
        actionNum: localActionBundle.actionNum,
        retValues: sandboxActionBundle.retValues,
        isModification: sandboxActionBundle.stored.length > 0
      };
    } finally {
      // Make sure the bundle is marked as complete, even if some miscellaneous error occurred.
      await accessControl.finishedBundle();
    }
  }

  private _mergeAdjust(action: UserActionBundle): UserActionBundle {
    // TODO: This is where we adjust actions after rebase, e.g. add delta to rowIds and such.
    return action;
  }

  /**
   * Creates a UserActionBundle with a single 'ApplyUndoActions' action, which combines the undo
   * actions addressed to ourselves from all of the passed-in LocalActionBundles.
   */
  private _createUndo(localActions: LocalActionBundle[]): UserActionBundle {
    assert(localActions.length > 0);
    const undo: DocAction[] = [];
    for (const local of localActions) {
      undo.push(...local.undo);
    }
    const first = localActions[0];
    return {
      info: {
        time: Date.now(),
        user: first.info[1].user,
        inst: first.info[1].inst,
        desc: "UNDO BEFORE REBASE",
        otherId: 0,
        linkId: 0,
      },
      userActions: [['ApplyUndoActions', undo]]
    };
  }

  // Our beautiful little checkpointing interface, used to handle errors during rebase.
  private _createCheckpoint() { /* TODO */ }
  private _releaseCheckpoint() { /* TODO */ }
  private _rollbackToCheckpoint() { /* TODO */ }
  private _createBackupAtCheckpoint() { /* TODO */ }

  /**
   * Reduces a LocalActionBundle down to only those actions addressed to ourselves.
   */
  private _filterOwnActions(localActionBundle: LocalActionBundle): LocalActionBundle {
    const includeEnv: boolean[] = localActionBundle.envelopes.map(
      (e) => this.isOwnEnvelope(e.recipients));

    return Object.assign({}, localActionBundle, {
      stored: localActionBundle.stored.filter((ea) => includeEnv[ea[0]]),
      calc: localActionBundle.calc.filter((ea) => includeEnv[ea[0]]),
    });
  }

  /** Log an action bundle to the debug log. */
  private _logActionBundle(prefix: string, actionBundle: ActionBundle) {
    const includeEnv = actionBundle.envelopes.map((e) => this.isOwnEnvelope(e.recipients));
    actionBundle.stored.forEach((envAction, i) =>
      log.debug("%s: stored #%s [%s%s]: %s", prefix, i, envAction[0],
        (includeEnv[envAction[0]] ? "" : " alien"),
        shortDesc(envAction[1])));
    actionBundle.calc.forEach((envAction, i) =>
      log.debug("%s: calc #%s [%s%s]: %s", prefix, i, envAction[0],
        (includeEnv[envAction[0]] ? "" : " alien"),
        shortDesc(envAction[1])));
  }

  private async _applyActionsToDataEngine(docSession: OptDocSession|null, userActions: UserAction[]) {
    const sandboxActionBundle = await this._activeDoc.applyActionsToDataEngine(docSession, userActions);
    const undo = getEnvContent(sandboxActionBundle.undo);
    const docActions = getEnvContent(sandboxActionBundle.stored).concat(
      getEnvContent(sandboxActionBundle.calc));
    const isDirect = getEnvContent(sandboxActionBundle.direct);

    const accessControl = this._activeDoc.getGranularAccessForBundle(
      docSession || makeExceptionalDocSession('share'), docActions, undo, userActions, isDirect
    );
    try {
      // TODO: see if any of the code paths that have no docSession are relevant outside
      // of tests.
      await accessControl.canApplyBundle();
    } catch (e) {
      // should not commit.  Don't write to db.  Remove changes from sandbox.
      try {
        await this._activeDoc.applyActionsToDataEngine(docSession, [['ApplyUndoActions', undo]]);
      } finally {
        await accessControl.finishedBundle();
      }
      throw e;
    }
    return {sandboxActionBundle, undo, docActions, accessControl};
  }
}

/**
 * Returns the index of the envelope containing the '#ALL' recipient, adding such an envelope to
 * the provided array if it wasn't already there.
 */
export function findOrAddAllEnvelope(envelopes: Envelope[]): number {
  const i = envelopes.findIndex(e => e.recipients.includes(allToken));
  if (i >= 0) { return i; }
  envelopes.push({recipients: [allToken]});
  return envelopes.length - 1;
}

/**
 * Extract a UserActionBundle from a LocalActionBundle, which contains a superset of data.
 */
function getUserActionBundle(localAction: LocalActionBundle): UserActionBundle {
  return {
    info: localAction.info[1],
    userActions: localAction.userActions
  };
}
