import {ActionBundle, LocalActionBundle, UserActionBundle} from 'app/common/ActionBundle';
import {ActionInfo, Envelope, getEnvContent} from 'app/common/ActionBundle';
import {DocAction, UserAction} from 'app/common/DocActions';
import {allToken, Peer} from 'app/common/sharing';
import {timeFormat} from 'app/common/timeFormat';
import * as log from 'app/server/lib/log';
import {shortDesc} from 'app/server/lib/shortDesc';
import * as assert from 'assert';
import * as Deque from 'double-ended-queue';
import {ActionHistory, asActionGroup} from './ActionHistory';
import {ActiveDoc} from './ActiveDoc';
import {Client} from './Client';
import {WorkCoordinator} from './WorkCoordinator';

// Describes the request to apply a UserActionBundle. It includes a Client (so that broadcast
// message can set `.fromSelf` property), and methods to resolve or reject the promise for when
// the action is applied. Note that it may not be immediate in case we are in the middle of
// processing hub actions or rebasing.
interface UserRequest {
  action: UserActionBundle;
  client: Client|null;
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

export class Sharing {
  protected _activeDoc: ActiveDoc;
  protected _actionHistory: ActionHistory;
  protected _hubQueue: Deque<ActionBundle> = new Deque();
  protected _pendingQueue: Deque<UserRequest> = new Deque();
  protected _workCoordinator: WorkCoordinator;

  constructor(activeDoc: ActiveDoc, actionHistory: ActionHistory) {
    // TODO actionHistory is currently unused (we use activeDoc.actionLog).
    assert(actionHistory.isInitialized());

    this._activeDoc = activeDoc;
    this._actionHistory = actionHistory;
    this._workCoordinator = new WorkCoordinator(() => this._doNextStep());
  }

  /** Initialize the sharing for a previously-shared doc. */
  public async openSharedDoc(hub: any, docId: string): Promise<void> {
    throw new Error('openSharedDoc not implemented');
  }

  /** Initialize the sharing for a newly-shared doc. */
  public async createSharedDoc(hub: any, docId: string, docName: string, peers: Peer[]): Promise<void> {
    throw new Error('openSharedDoc not implemented');
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

  public async shareDoc(docName: string, peers: Peer[]): Promise<void> {
    throw new Error('shareDoc not implemented');
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
      const ret = await this.doApplyUserActionBundle(userRequest.action, userRequest.client);
      userRequest.resolve(ret);
    } catch (e) {
      log.warn("Unable to apply action...", e);
      userRequest.reject(e);
    }
  }

  private async _applyHubAction(): Promise<void> {
    assert(!this._hubQueue.isEmpty() && !this._actionHistory.haveLocalActions());
    const action: ActionBundle = this._hubQueue.shift()!;
    try {
      await this.doApplySharedActionBundle(action);
    } catch (e) {
      log.error("Unable to apply hub action... skipping");
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
      log.error("Unable to apply hub action... skipping");
    }
  }

  private async _rebaseLocalActions(): Promise<void> {
    const rebaseQueue: Deque<UserActionBundle> = new Deque<UserActionBundle>();
    try {
      await this.createCheckpoint();
      const actions: LocalActionBundle[] = await this._actionHistory.fetchAllLocal();
      assert(actions.length > 0);
      await this.doApplyUserActionBundle(this._createUndo(actions), null);
      rebaseQueue.push(...actions.map((a) => getUserActionBundle(a)));
      await this._actionHistory.clearLocalActions();
    } catch (e) {
      log.error("Can't undo local actions; sharing is off");
      await this.rollbackToCheckpoint();
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
        await this.doApplyUserActionBundle(adjusted, null);
      } catch (e) {
        log.warn("Unable to apply rebased action...");
        rebaseFailures.push([action, adjusted]);
      }
    }
    if (rebaseFailures.length > 0) {
      await this.createBackupAtCheckpoint();
      // TODO we should notify the user too.
      log.error('Rebase failed to reapply some of your actions, backup of local at...');
    }
    await this.releaseCheckpoint();
  }

  // ======================================================================

  private doApplySharedActionBundle(action: ActionBundle): Promise<UserResult> {
    const userActions: UserAction[] = [
      ['ApplyDocActions', action.stored.map(envContent => envContent[1])]
    ];
    return this.doApplyUserActions(action.info[1], userActions, Branch.Shared, null);
  }

  private doApplyUserActionBundle(action: UserActionBundle, client: Client|null): Promise<UserResult> {
    return this.doApplyUserActions(action.info, action.userActions, Branch.Local, client);
  }

  private async doApplyUserActions(info: ActionInfo, userActions: UserAction[],
                                   branch: Branch, client: Client|null): Promise<UserResult> {
    const sandboxActionBundle = await this._activeDoc.applyActionsToDataEngine(userActions);
    // A trivial action does not merit allocating an actionNum,
    // logging, and sharing.  Since we currently don't store
    // calculated values in the database, it is best not to log the
    // action that initializes them when the document is opened cold
    // (without cached ActiveDoc) - otherwise we'll end up with spam
    // log entries for each time the document is opened cold.

    const isCalculate = (userActions.length === 1 &&
                         userActions[0][0] === 'Calculate');
    const trivial = isCalculate && sandboxActionBundle.stored.length === 0;

    const actionNum = trivial ? 0 :
      (branch === Branch.Shared ? this._actionHistory.getNextHubActionNum() :
       this._actionHistory.getNextLocalActionNum());

    const undo = getEnvContent(sandboxActionBundle.undo);
    const localActionBundle: LocalActionBundle = {
      actionNum,
      // The ActionInfo should go into the envelope that includes all recipients.
      info: [findOrAddAllEnvelope(sandboxActionBundle.envelopes), info],
      envelopes: sandboxActionBundle.envelopes,
      stored: sandboxActionBundle.stored,
      calc: sandboxActionBundle.calc,
      undo: getEnvContent(sandboxActionBundle.undo),
      userActions,
      actionHash: null,        // Gets set below by _actionHistory.recordNext...
      parentActionHash: null,  // Gets set below by _actionHistory.recordNext...
    };
    this._logActionBundle(`doApplyUserActions (${Branch[branch]})`, localActionBundle);

    const docActions = getEnvContent(localActionBundle.stored).concat(
      getEnvContent(localActionBundle.calc));

    // TODO Note that the sandbox may produce actions which are not addressed to us (e.g. when we
    // have EDIT permission without VIEW). These are not sent to the browser or the database. But
    // today they are reflected in the sandbox. Should we (or the sandbox) immediately undo the
    // full change, and then redo only the actions addressed to ourselves? Let's cross that bridge
    // when we come to it. For now we only log skipped envelopes as "alien" in _logActionBundle().
    const ownActionBundle: LocalActionBundle = this._filterOwnActions(localActionBundle);

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
        // Check isCalculate because that's not an action we should allow undo/redo for (it's not
        // considered as performed by a particular client).
        if (client && client.clientId && !isCalculate) {
          this._actionHistory.setActionClientId(localActionBundle.actionHash!, client.clientId);
        }
      });
    }
    await this._activeDoc.processActionBundle(ownActionBundle);

    // In the future, we'll save (and share) the result of applying one bundle of UserActions
    // as a single ActionBundle with one actionNum. But the old ActionLog saves on UserAction
    // per actionNum, using linkId to "bundle" them for the purpose of undo-redo. We simulate
    // it here by breaking up ActionBundle into as many old-style ActionGroups as there are
    // UserActions, and associating all DocActions with the first of these ActionGroups.

    // Broadcast the action to connected browsers.
    const actionGroup = asActionGroup(this._actionHistory, localActionBundle, {
      client,
      retValues: sandboxActionBundle.retValues,
      summarize: true,
      // Mark the on-open Calculate action as internal. In future, synchronizing fields to today's
      // date and other changes from external values may count as internal.
      internal: isCalculate,
    });
    await this._activeDoc.beforeBroadcast(docActions, undo);
    try {
      await this._activeDoc.broadcastDocUpdate(client || null, 'docUserAction', {
        actionGroup,
        docActions,
      });
    } finally {
      await this._activeDoc.afterBroadcast();
    }
    return {
      actionNum: localActionBundle.actionNum,
      retValues: sandboxActionBundle.retValues,
      isModification: sandboxActionBundle.stored.length > 0
    };
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
  private createCheckpoint() { /* TODO */ }
  private releaseCheckpoint() { /* TODO */ }
  private rollbackToCheckpoint() { /* TODO */ }
  private createBackupAtCheckpoint() { /* TODO */ }

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
    log.debug("%s: ActionBundle #%s with #%s envelopes: %s",
      prefix, actionBundle.actionNum, actionBundle.envelopes.length,
      infoDesc(actionBundle.info[1]));
    actionBundle.envelopes.forEach((env, i) =>
      log.debug("%s: env #%s: %s", prefix, i, env.recipients.join(' ')));
    actionBundle.stored.forEach((envAction, i) =>
      log.debug("%s: stored #%s [%s%s]: %s", prefix, i, envAction[0],
        (includeEnv[envAction[0]] ? "" : " alien"),
        shortDesc(envAction[1])));
    actionBundle.calc.forEach((envAction, i) =>
      log.debug("%s: calc #%s [%s%s]: %s", prefix, i, envAction[0],
        (includeEnv[envAction[0]] ? "" : " alien"),
        shortDesc(envAction[1])));
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
 * Convert actionInfo to a concise human-readable description, for debugging.
 */
function infoDesc(info: ActionInfo): string {
  const timestamp = timeFormat('A', new Date(info.time));
  const desc = info.desc ? ` desc=[${info.desc}]` : '';
  const otherId = info.otherId ? ` [otherId=${info.otherId}]` : '';
  const linkId = info.linkId ? ` [linkId=${info.linkId}]` : '';
  return `${timestamp} on ${info.inst} by ${info.user}${desc}${otherId}${linkId}`;
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
