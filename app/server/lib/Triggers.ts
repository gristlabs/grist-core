import { LocalActionBundle } from "app/common/ActionBundle";
import { summarizeAction } from "app/common/ActionSummarizer";
import { ActionSummary, TableDelta } from "app/common/ActionSummary";
import { ApiError } from "app/common/ApiError";
import { fromTableDataAction, RowRecord, TableColValues, TableDataAction } from "app/common/DocActions";
import { StringUnion } from "app/common/StringUnion";
import { MetaRowRecord } from "app/common/TableData";
import { CellDelta } from "app/common/TabularDiff";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import log from "app/server/lib/log";
import { matchesBaseDomain } from "app/server/lib/requestUtils";
import { WebhookQueue } from "app/server/lib/WebhookQueue";

import { promisifyAll } from "bluebird";
import * as _ from "lodash";
import { RedisClient } from "redis";

promisifyAll(RedisClient.prototype);

// Only owners can manage triggers, but any user's activity can trigger them
// and the corresponding actions get the full values
const docSession = makeExceptionalDocSession("system");

// Describes the change in existence to a record, which determines the event type
interface RecordDelta {
  existedBefore: boolean;
  existedAfter: boolean;
}

type RecordDeltas = Map<number, RecordDelta>;

// Union discriminated by type
type TriggerAction = WebhookAction | PythonAction;

export interface WebhookAction {
  type: "webhook";
  id: string;
}

// Just hypothetical
interface PythonAction {
  id: string;
  type: "python";
  code: string;
}

interface WebHookEvent {
  payload: RowRecord;
  id: string;
}

export const allowedEventTypes = StringUnion("add", "update");

type EventType = typeof allowedEventTypes.type;

type Trigger = MetaRowRecord<"_grist_Triggers">;

// Work to do after fetching values from the document
interface Task {
  tableDelta: TableDelta;
  triggers: Trigger[];
  tableDataAction: Promise<TableDataAction>;
  recordDeltas: RecordDeltas;
}

// A time to wait for between retries of a webhook. Exposed for tests.

// Processes triggers for records changed as described in action bundles, initiating webhooks.
// The interesting stuff starts in the handle() method.
// This class identifies which triggers should fire based on document changes,
// then delegates actual webhook queue management and HTTP delivery to WebhookQueue.
// Triggers are configured in the document, while details of webhooks (URLs) are kept
// in the Secrets table of the Home DB.
export class DocTriggers {
  constructor(
    private _activeDoc: ActiveDoc,
    private _jobQueue: WebhookQueue,
  ) {}

  // Called after applying actions to a document and updating its data.
  // Checks for triggers configured in a meta table,
  // and whether any of those triggers monitor tables which were modified by the actions
  // in the given bundle.
  // If so, generates events which are pushed to the local and redis queues.
  //
  // Returns an ActionSummary generated from the given LocalActionBundle.
  //
  // Generating the summary here makes it easy to specify which columns need to
  // have all their changes included in the summary without truncation
  // so that we can accurately identify which records are ready for sending.
  public async handle(localActionBundle: LocalActionBundle): Promise<ActionSummary> {
    const docData = this._activeDoc.docData;
    if (!docData) {
      return summarizeAction(localActionBundle);
    }  // Happens on doc creation while processing InitNewDoc action.

    const triggersTable = docData.getMetaTable("_grist_Triggers");
    const getTableId = docData.getMetaTable("_grist_Tables").getRowPropFunc("tableId");

    const triggersByTableRef = _.groupBy(triggersTable.getRecords().filter(t => t.enabled), "tableRef");
    const triggersByTableId: [string, Trigger[]][] = [];

    // First we need a list of columns which must be included in full in the action summary
    const isReadyColIds: string[] = [];
    let hasWatchedCols = false;
    for (const tableRef of Object.keys(triggersByTableRef).sort()) {
      const triggers = triggersByTableRef[tableRef];
      const tableId = getTableId(Number(tableRef));  // groupBy makes tableRef a string
      triggersByTableId.push([tableId, triggers]);
      for (const trigger of triggers) {
        if (trigger.isReadyColRef) {
          const colId = this._getColId(trigger.isReadyColRef);
          if (colId) {
            isReadyColIds.push(colId);
          }
        }
        if (trigger.watchedColRefList) {
          hasWatchedCols = true;
        }
      }
    }

    const summary = summarizeAction(localActionBundle, {
      // Unset the default limit (10) for row deltas if there are any watched
      // columns; full row deltas are needed to determine which columns were
      // modified.
      // TODO: find a better solution (maybe a field like `updateColumns`
      // in the summary, containing only the IDs of modified columns).
      maximumInlineRows: hasWatchedCols ? null : undefined,
      alwaysPreserveColIds: isReadyColIds,
    });

    // Work to do after fetching values from the document
    const tasks: Task[] = [];

    // For each table in the document which is monitored by one or more triggers...
    for (const [tableId, triggers] of triggersByTableId) {
      const tableDelta = summary.tableDeltas[tableId];
      // ...if the monitored table was modified by the summarized actions,
      // fetch the modified/created records and note the work that needs to be done.
      if (tableDelta) {
        const recordDeltas = this._getRecordDeltas(tableDelta);
        const filters = { id: [...recordDeltas.keys()] };

        // Fetch the modified records in full so they can be sent in webhooks
        // They will also be used to check if the record is ready
        const tableDataAction = this._activeDoc.fetchQuery(docSession, { tableId, filters }, true)
          .then(tableFetchResult => tableFetchResult.tableData);
        tasks.push({ tableDelta, triggers, tableDataAction, recordDeltas });
      }
    }

    // Fetch values from document DB in parallel
    await Promise.all(tasks.map(t => t.tableDataAction));

    const events: WebHookEvent[] = [];
    for (const task of tasks) {
      events.push(...this._handleTask(task, await task.tableDataAction));
    }
    if (!events.length) {
      return summary;
    }
    this._log("Total number of webhook events generated by bundle", { numEvents: events.length });

    await this._jobQueue.enqueue(events);

    return summary;
  }

  // Converts a table to tableId by looking it up in _grist_Tables.
  private _getTableId(rowId: number) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      throw new Error("ActiveDoc not ready");
    }
    return docData.getMetaTable("_grist_Tables").getValue(rowId, "tableId");
  }

  // Return false if colRef does not belong to tableRef
  private _validateColId(colRef: number, tableRef: number) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      throw new Error("ActiveDoc not ready");
    }
    return docData.getMetaTable("_grist_Tables_column").getValue(colRef, "parentId") === tableRef;
  }

  // Converts a column ref to colId by looking it up in _grist_Tables_column. If tableRef is
  // provided, check whether col belongs to table and throws if not.
  private _getColId(rowId: number, tableRef?: number) {
    const docData = this._activeDoc.docData;
    if (!docData) {
      throw new Error("ActiveDoc not ready");
    }
    if (!rowId) { return ""; }
    const colId = docData.getMetaTable("_grist_Tables_column").getValue(rowId, "colId");
    if (tableRef !== undefined &&
      docData.getMetaTable("_grist_Tables_column").getValue(rowId, "parentId") !== tableRef) {
      throw new ApiError(`Column ${colId} does not belong to table ${this._getTableId(tableRef)}`, 400);
    }
    return colId;
  }

  private _log(msg: string, { level = "info", ...meta }: any = {}) {
    log.origLog(level, "WebhookQueue: " + msg, {
      ...meta,
      docId: this._activeDoc.docName,
    });
  }

  private _getRecordDeltas(tableDelta: TableDelta): RecordDeltas {
    const recordDeltas = new Map<number, RecordDelta>();
    tableDelta.updateRows.forEach(id =>
      recordDeltas.set(id, { existedBefore: true, existedAfter: true }));
    // A row ID can appear in both updateRows and addRows, although it probably shouldn't
    // Added row IDs override updated rows because they didn't exist before
    tableDelta.addRows.forEach(id =>
      recordDeltas.set(id, { existedBefore: false, existedAfter: true }));

    // If we allow subscribing to deletion in the future
    // delta.removeRows.forEach(id =>
    //   recordDeltas.set(id, {existedBefore: true, existedAfter: false}));

    return recordDeltas;
  }

  private _handleTask(
    { tableDelta, triggers, recordDeltas }: Task,
    tableDataAction: TableDataAction,
  ) {
    const bulkColValues = fromTableDataAction(tableDataAction);

    const meta = { numTriggers: triggers.length, numRecords: bulkColValues.id.length };
    this._log(`Processing triggers`, meta);

    const makePayload = _.memoize((rowIndex: number) =>
      _.mapValues(bulkColValues, col => col[rowIndex]) as RowRecord,
    );

    const result: WebHookEvent[] = [];
    for (const trigger of triggers) {
      const actions = JSON.parse(trigger.actions) as TriggerAction[];
      const webhookActions = actions.filter(act => act.type === "webhook") as WebhookAction[];
      if (!webhookActions.length) {
        continue;
      }

      if (trigger.isReadyColRef) {
        if (!this._validateColId(trigger.isReadyColRef, trigger.tableRef)) {
          // ready column does not belong to table, let's ignore trigger and log stats
          for (const action of webhookActions) {
            const colId = this._getColId(trigger.isReadyColRef); // no validation
            const tableId = this._getTableId(trigger.tableRef);
            const error = `isReadyColumn is not valid: colId ${colId} does not belong to ${tableId}`;
            this._log(error, { level: "warn", actionId: action.id, triggerId: trigger.id });
          }
          continue;
        }
      }

      if (trigger.watchedColRefList) {
        for (const colRef of trigger.watchedColRefList.slice(1)) {
          if (!this._validateColId(colRef as number, trigger.tableRef)) {
            // column does not belong to table, let's ignore trigger and log stats
            for (const action of webhookActions) {
              const colId = this._getColId(colRef as number); // no validation
              const tableId = this._getTableId(trigger.tableRef);
              const error = `column is not valid: colId ${colId} does not belong to ${tableId}`;
              this._log(error, { level: "warn", actionId: action.id, triggerId: trigger.id });
            }
            continue;
          }
        }
      }

      // TODO: would be worth checking that the trigger's fields are valid (ie: eventTypes, url,
      // ...) as there's no guarantee that they are.

      const rowIndexesToSend: number[] = _.range(bulkColValues.id.length).filter((rowIndex) => {
        const rowId = bulkColValues.id[rowIndex];
        return this._shouldTriggerActions(
          trigger, bulkColValues, rowIndex, rowId, recordDeltas.get(rowId)!, tableDelta,
        );
      },
      );

      for (const action of webhookActions) {
        for (const rowIndex of rowIndexesToSend) {
          const event = { id: action.id, payload: makePayload(rowIndex) };
          result.push(event);
        }
      }
    }

    this._log("Generated events from triggers", { numEvents: result.length, ...meta });

    return result;
  }

  /**
   * Determines if actions should be triggered for a single record and trigger.
   */
  private _shouldTriggerActions(
    trigger: Trigger,
    bulkColValues: TableColValues,
    rowIndex: number,
    rowId: number,
    recordDelta: RecordDelta,
    tableDelta: TableDelta,
  ): boolean {
    let readyBefore: boolean;
    if (!trigger.isReadyColRef) {
      // User hasn't configured a column, so all records are considered ready immediately
      readyBefore = recordDelta.existedBefore;
    } else {
      const isReadyColId = this._getColId(trigger.isReadyColRef)!;

      // Must be the actual boolean `true`, not just anything truthy
      const isReady = bulkColValues[isReadyColId][rowIndex] === true;
      if (!isReady) {
        return false;
      }

      const cellDelta: CellDelta | undefined = tableDelta.columnDeltas[isReadyColId]?.[rowId];
      if (!recordDelta.existedBefore) {
        readyBefore = false;
      } else if (!cellDelta) {
        // Cell wasn't changed, and the record is ready now, so it was ready before.
        // This requires that the ActionSummary contains all changes to the isReady column.
        readyBefore = true;
      } else {
        const deltaBefore = cellDelta[0];
        if (deltaBefore === null) {
          // The record didn't exist before, so it definitely wasn't ready
          // (although we probably shouldn't reach this since we already checked recordDelta.existedBefore)
          readyBefore = false;
        } else if (deltaBefore === "?") {
          // The ActionSummary shouldn't contain this kind of delta at all
          // since it comes from a single action bundle, not a combination of summaries.
          this._log('Unexpected deltaBefore === "?"', { level: "warn", trigger });
          readyBefore = true;
        } else {
          // Only remaining case is that deltaBefore is a single-element array containing the previous value.
          const [valueBefore] = deltaBefore;

          // Must be the actual boolean `true`, not just anything truthy
          readyBefore = valueBefore === true;
        }
      }
    }

    const colIdsToCheck: string[] = [];
    if (trigger.watchedColRefList) {
      for (const colRef of trigger.watchedColRefList.slice(1)) {
        colIdsToCheck.push(this._getColId(colRef as number)!);
      }
    }

    let eventType: EventType;
    if (readyBefore) {
      // check if any of the columns to check were changed to consider this an update
      if (colIdsToCheck.length === 0 || colIdsToCheck.some(colId => tableDelta.columnDeltas[colId]?.[rowId])) {
        eventType = "update";
      } else {
        return false;
      }
      // If we allow subscribing to deletion in the future
      // if (recordDelta.existedAfter) {
      //   eventType = "update";
      // } else {
      //   eventType = "remove";
      // }
    } else {
      eventType = "add";
    }

    return trigger.eventTypes!.includes(eventType);
  }
}

export function isUrlAllowed(urlString: string) {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (e) {
    return false;
  }

  // Support at most https and http.
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }

  // Support a wildcard that allows all domains.
  // Allow either https or http if it is set.
  if (process.env.ALLOWED_WEBHOOK_DOMAINS === "*") {
    return true;
  }

  // http (no s) is only allowed for localhost for testing.
  // localhost still needs to be explicitly permitted, and it shouldn't be outside dev
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    return false;
  }

  return (process.env.ALLOWED_WEBHOOK_DOMAINS || "").split(",").some(domain =>
    domain && matchesBaseDomain(url.host, domain),
  );
}
