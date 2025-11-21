import {
  ActionBundle,
  ActionInfo,
  Envelope,
  getEnvContent,
  LocalActionBundle,
  SandboxActionBundle,
  UserActionBundle
} from 'app/common/ActionBundle';
import {ApplyUAExtendedOptions, ApplyUAResult} from 'app/common/ActiveDocAPI';
import {DocAction, getNumRows, SYSTEM_ACTIONS, UserAction} from 'app/common/DocActions';
import {GranularAccessForBundle} from 'app/server/lib/GranularAccess';
import {insightLogEntry} from 'app/server/lib/InsightLog';
import log from 'app/server/lib/log';
import {LogMethods} from "app/server/lib/LogMethods";
import {shortDesc} from 'app/server/lib/shortDesc';
import assert from 'assert';
import {Mutex} from 'async-mutex';
import isEqual = require('lodash/isEqual');
import {ActionHistory, asActionGroup, getActionUndoInfo} from 'app/server/lib/ActionHistory';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {makeExceptionalDocSession, OptDocSession} from 'app/server/lib/DocSession';
import {summarizeAction} from 'app/common/ActionSummarizer';

// Don't log details of action bundles in production.
const LOG_ACTION_BUNDLE = (process.env.NODE_ENV !== 'production');

interface ApplyResult {
  /**
   * Access denied exception if the user does not have permission to apply the action.
   */
  failure?: Error,
  /**
   * Result of applying user actions. If there is a failure, it contains result of reverting
   * those actions that should be persisted (probably extra actions caused by nondeterministic
   * functions).
   */
  result?: {
    accessControl: GranularAccessForBundle,
    bundle: SandboxActionBundle,
  }
}

export class Sharing {
  private _userActionLock = new Mutex();
  private _log = new LogMethods('Sharing ', (s: OptDocSession) => this._activeDoc.getLogMeta(s));

  constructor(private _activeDoc: ActiveDoc, private _actionHistory: ActionHistory, private _modificationLock: Mutex) {
    assert(_actionHistory.isInitialized());
  }

  /** Returns the instanceId if the doc is shared or null otherwise. */
  public get instanceId(): string|null { return null; }

  /**
   * The only public interface. This may be called at any time, but the work happens for at most
   * one action at a time.
   */
  public addUserAction(docSession: OptDocSession, action: UserActionBundle): Promise<ApplyUAResult> {
    return this._userActionLock.runExclusive(async () => {
      try {
        return await this._doApplyUserActions(action.info, action.userActions, docSession, action.options || null);
      } catch (e) {
        this._log.warn(docSession, "Unable to apply action...", e);
        throw e;
      }
    });
  }

  private async _doApplyUserActions(info: ActionInfo, userActions: UserAction[],
                                    docSession: OptDocSession,
                                    options: ApplyUAExtendedOptions|null): Promise<ApplyUAResult> {
    const client = docSession && docSession.client;

    if (docSession?.linkId) {
      info.linkId = docSession.linkId;
    }

    const insightLog = insightLogEntry();
    const {result, failure} =
      await this._modificationLock.runExclusive(() => this._applyActionsToDataEngine(docSession, userActions, options));

    // ACL check failed, and we don't have anything to save. Just rethrow the error.
    if (failure && !result) {
      throw failure;
    }

    assert(result, "result should be defined if failure is not");

    const sandboxActionBundle = result.bundle;
    const accessControl = result.accessControl;
    const undo = getEnvContent(result.bundle.undo);

    try {

      const isSystemAction = (userActions.length === 1 && SYSTEM_ACTIONS.has(userActions[0][0] as string));
      // `internal` is true if users shouldn't be able to undo the actions. Applies to:
      // - Calculate/UpdateCurrentTime because it's not considered as performed by a particular client.
      // - Adding attachment metadata when uploading attachments,
      //   because then the attachment file may get hard-deleted and redo won't work properly.
      // - Action was rejected but it had some side effects (e.g. NOW() or UUID() formulas).
      const internal =
        isSystemAction ||
        userActions.every(a => a[0] === "AddRecord" && a[1] === "_grist_Attachments") ||
        !!failure;

      // A trivial action does not merit allocating an actionNum,
      // logging, and sharing. It's best not to log the
      // action that calculates formula values when the document is opened cold
      // (without cached ActiveDoc) if it doesn't change anything - otherwise we'll end up with spam
      // log entries for each time the document is opened cold.
      const trivial = internal && sandboxActionBundle.stored.length === 0;

      const actionNum = trivial ? 0 : this._actionHistory.getNextLocalActionNum();

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

      const logMeta = {
        actionNum,
        linkId: info.linkId,
        otherId: info.otherId,
        numDocActions: localActionBundle.stored.length,
        numRows: localActionBundle.stored.reduce((n, env) => n + getNumRows(env[1]), 0),
        ...(sandboxActionBundle.numBytes ? {numBytes: sandboxActionBundle.numBytes} : {}),
      };
      insightLog?.addMeta(logMeta);
      if (LOG_ACTION_BUNDLE) {
        this._logActionBundle(`_doApplyUserActions`, localActionBundle);
      }

      // If the document has shut down in the meantime, and this was just a "Calculate" action,
      // return a trivial result.  This is just to reduce noisy warnings in migration tests.
      if (this._activeDoc.isShuttingDown && isSystemAction) {
        return {
          actionNum: localActionBundle.actionNum,
          actionHash: localActionBundle.actionHash,
          retValues: [],
          isModification: false
        };
      }

      // Apply the action to the database, and record in the action log.
      if (!trivial) {
        await this._activeDoc.docStorage.execTransaction(async () => {
          insightLog?.mark("docStorageTxn");
          await this._activeDoc.applyStoredActionsToDocStorage(getEnvContent(localActionBundle.stored));

          // Before sharing is enabled, actions are immediately marked as "shared" (as if accepted
          // by the hub). The alternative of keeping actions on the "local" branch until sharing is
          // enabled is less suitable, because such actions could have empty envelopes, and cannot
          // be shared. Once sharing is enabled, we would share a snapshot at that time.
          await this._actionHistory.recordNextShared(localActionBundle);

          if (client && client.clientId && !internal) {
            this._actionHistory.setActionUndoInfo(
              localActionBundle.actionHash!,
              getActionUndoInfo(localActionBundle, client.clientId, sandboxActionBundle.retValues));
          }
        });
        insightLog?.mark("docStorage");
      }
      await this._activeDoc.processActionBundle(localActionBundle);
      insightLog?.mark("processBundle");

      // Don't trigger webhooks for single Calculate actions, this causes a deadlock on document load.
      // See gh issue #799
      const isSingleCalculateAction = userActions.length === 1 && userActions[0][0] === 'Calculate';
      const actionSummary = !isSingleCalculateAction ?
        await this._activeDoc.handleTriggers(localActionBundle) :
        summarizeAction(localActionBundle);

      // Opportunistically use actionSummary to see if _grist_Shares was
      // changed.
      if (actionSummary.tableDeltas._grist_Shares) {
        // This is a little risky, since it entangles us with home db
        // availability. But we aren't doing a lot...?
        await this._activeDoc.syncShares(makeExceptionalDocSession('system'));
        insightLog?.mark("syncShares");
      }

      insightLog?.addMeta({docRowCount: sandboxActionBundle.rowCount.total});
      await this._activeDoc.updateRowCount(sandboxActionBundle.rowCount, docSession);
      insightLog?.mark("updateRowCount");

      // Broadcast the action to connected browsers.
      const actionGroup = asActionGroup(this._actionHistory, localActionBundle, {
        clientId: client?.clientId,
        retValues: sandboxActionBundle.retValues,
        internal,
      });
      actionGroup.actionSummary = actionSummary;
      await accessControl.appliedBundle();
      insightLog?.mark("accessRulesApplied");
      await accessControl.sendDocUpdateForBundle(actionGroup, this._activeDoc.getDocUsageSummary());
      insightLog?.mark("sendDocUpdate");
      await this._activeDoc.notifySubscribers(docSession, accessControl);
      insightLog?.mark("notifySubscribers");
      // If the action was rejected, throw an exception, by this point data-engine should be in
      // sync with the database, and everyone should have the same view of the document.
      if (failure) {
        throw failure;
      }
      if (docSession) {
        docSession.linkId = docSession.shouldBundleActions ? localActionBundle.actionNum : 0;
      }
      return {
        actionNum: localActionBundle.actionNum,
        actionHash: localActionBundle.actionHash,
        retValues: sandboxActionBundle.retValues,
        isModification: sandboxActionBundle.stored.length > 0
      };
    } finally {
      // Make sure the bundle is marked as complete, even if some miscellaneous error occurred.
      await accessControl.finishedBundle();
      insightLog?.mark("accessRulesFinish");
    }
  }

  /** Log an action bundle to the debug log. */
  private _logActionBundle(prefix: string, actionBundle: ActionBundle) {
    actionBundle.stored.forEach((envAction, i) =>
      log.debug("%s: stored #%s [%s]: %s", prefix, i, envAction[0],
        shortDesc(envAction[1])));
    actionBundle.calc.forEach((envAction, i) =>
      log.debug("%s: calc #%s [%s]: %s", prefix, i, envAction[0],
        shortDesc(envAction[1])));
  }

  private async _applyActionsToDataEngine(
    docSession: OptDocSession,
    userActions: UserAction[],
    options: ApplyUAExtendedOptions|null): Promise<ApplyResult> {
    const applyResult = await this._activeDoc.applyActionsToDataEngine(docSession, userActions);
    const insightLog = insightLogEntry();
    insightLog?.mark("dataEngine");
    let accessControl = this._startGranularAccessForBundle(docSession, applyResult, userActions, options);
    try {
      // TODO: see if any of the code paths that have no docSession are relevant outside
      // of tests.
      await accessControl.canApplyBundle();
      insightLog?.mark("accessRulesCheck");
      return { result : {bundle: applyResult, accessControl}};
    } catch (applyExc) {
      insightLog?.mark("dataEngineReverting");
      try {
        // We can't apply those actions, so we need to revert them.
        const undoResult = await this._activeDoc.applyActionsToDataEngine(docSession, [
          ['ApplyUndoActions', getEnvContent(applyResult.undo)]
        ]);

        // We managed to reject and undo actions in the data-engine. Now we need to calculate if we have any extra
        // actions generated by the undo (it can happen for nondeterministic formulas). If we have them, we will need to
        // test if they pass ACL check and persist them in the database in order to keep the data engine in sync with
        // the database. If we have any extra actions, we will simulate that only those actions were applied and return
        // fake bundle together with the access failure. If we don't have any extra actions, we will just return the
        // failure.
        const extraBundle = this._createExtraBundle(undoResult, getEnvContent(applyResult.undo));

        // If we have the same number of actions and they are equal, we can assume that the data-engine is in sync.
        if (!extraBundle) {
          // We stored what we send, we don't have any extra actions to save, we can just return the failure.
          await accessControl.finishedBundle();
          return { failure: applyExc };
        }

        // We have some extra actions, so we need to prepare a fake bundle (only with the extra actions) and
        // return the failure, so the caller can persist the extra actions and report the failure.
        // Finish the access control for the origBundle.
        await accessControl.finishedBundle();
        // Start a new one. We assume that all actions are indirect, so this is basically a no-op, but we are doing it
        // nevertheless to make sure they pass access control.
        // NOTE: we assume that docActions can be used as userActions here. This is not always the case (as we might
        // have a special logic that targets UserActions directly), but in this scenario, the extra bundle should
        // contain only indirect data actions (mostly UpdateRecord) that are produced by comparing UserTables in the
        // data-engine.
        accessControl = this._startGranularAccessForBundle(docSession, extraBundle, extraBundle.stored, options);
        // Check if the extra bundle is allowed.
        await accessControl.canApplyBundle();
        // We are ok, we can store extra actions and report back the exception.
        return {result: {bundle: extraBundle, accessControl}, failure: applyExc};
      } catch(rollbackExc) {
        this._log.error(docSession, "Failed to apply undo of rejected action", rollbackExc.message);
        await accessControl.finishedBundle();
        this._log.debug(docSession, "Sharing._applyActionsToDataEngine starting ActiveDoc.shutdown");
        await this._activeDoc.shutdown();
        throw rollbackExc;
      }
    }
  }

  private _startGranularAccessForBundle(
    docSession: OptDocSession|null,
    bundle: SandboxActionBundle,
    userActions: UserAction[],
    options: ApplyUAExtendedOptions|null
  ) {
    const undo = getEnvContent(bundle.undo);
    const docActions = getEnvContent(bundle.stored).concat(getEnvContent(bundle.calc));
    const isDirect = getEnvContent(bundle.direct);
    return this._activeDoc.getGranularAccessForBundle(
      docSession || makeExceptionalDocSession('share'),
      docActions,
      undo,
      userActions,
      isDirect,
      options
    );
  }

  /**
   * Calculates the extra bundle that effectively was applied to the data engine.
   * @param undoResult Result of applying undo actions to the data engine.
   * @param undoSource Actions that were sent to perform the undo.
   * @returns A bundle with extra actions that were applied to the data engine or null if there are no extra actions.
   */
  private _createExtraBundle(undoResult: SandboxActionBundle, undoSource: DocAction[]): SandboxActionBundle|null {
    // First check that what we sent is what we stored, since those are undo actions, they should be identical. We
    // need to reverse the order of undo actions (they are reversed in data-engine by ApplyUndoActions)
    const sent = undoSource.slice().reverse();
    const storedHead = getEnvContent(undoResult.stored).slice(0, sent.length);
    // If we have less actions or they are not equal, we need need to fail immediately, this was not expected.
    if (undoResult.stored.length < undoSource.length) {
      throw new Error("There are less actions stored then expected");
    }
    if (!storedHead.every((action, i) => isEqual(action, sent[i]))) {
      throw new Error("Stored actions differ from sent actions");
    }
    // If we have the same number of actions and they are equal there is nothing to return.
    if (undoResult.stored.length === undoSource.length) {
      return null;
    }
    // Create a fake bundle simulating only those extra actions that were applied.
    return {
      envelopes: undoResult.envelopes, // Envelops are not supported, so we can use the first one (which is always #ALL)
      stored: undoResult.stored.slice(undoSource.length),
      // All actions are treated as direct, we want to perform ACL check on them.
      direct: undoResult.direct.slice(undoSource.length),
      calc: [], // Calc actions are also not used anymore.
      undo: [], // We won't allow to undo this one.
      retValues: undoResult.retValues.slice(undoSource.length),
      rowCount: undoResult.rowCount
    };
  }
}

const allToken: string = '#ALL';

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
