import {concatenateSummaries, summarizeAction} from "app/common/ActionSummarizer";
import {createEmptyActionSummary} from "app/common/ActionSummary";
import {QueryFilters} from 'app/common/ActiveDocAPI';
import {ApiError, LimitType} from 'app/common/ApiError';
import {BrowserSettings} from "app/common/BrowserSettings";
import {
  BulkColValues,
  ColValues,
  fromTableDataAction,
  TableColValues,
  TableRecordValue,
  UserAction
} from 'app/common/DocActions';
import {DocData} from 'app/common/DocData';
import {extractTypeFromColType, isBlankValue, isFullReferencingType, isRaisedException} from "app/common/gristTypes";
import {INITIAL_FIELDS_COUNT} from "app/common/Forms";
import {buildUrlId, parseUrlId, SHARE_KEY_PREFIX} from "app/common/gristUrls";
import {isAffirmative, safeJsonParse, timeoutReached} from "app/common/gutil";
import {SchemaTypes} from "app/common/schema";
import {SortFunc} from 'app/common/SortFunc';
import {Sort} from 'app/common/SortSpec';
import {MetaRowRecord} from 'app/common/TableData';
import {TelemetryMetadataByLevel} from "app/common/Telemetry";
import {WebhookFields} from "app/common/Triggers";
import TriggersTI from 'app/common/Triggers-ti';
import {DocReplacementOptions, DocState, DocStateComparison, DocStates, NEW_DOCUMENT_CODE} from 'app/common/UserAPI';
import {HomeDBManager, makeDocAuthResult} from 'app/gen-server/lib/HomeDBManager';
import * as Types from "app/plugin/DocApiTypes";
import DocApiTypesTI from "app/plugin/DocApiTypes-ti";
import {GristObjCode} from "app/plugin/GristData";
import GristDataTI from 'app/plugin/GristData-ti';
import {OpOptions} from "app/plugin/TableOperations";
import {
  handleSandboxErrorOnPlatform,
  TableOperationsImpl,
  TableOperationsPlatform
} from 'app/plugin/TableOperationsImpl';
import {ActiveDoc, colIdToRef as colIdToReference, getRealTableId, tableIdToRef} from "app/server/lib/ActiveDoc";
import {appSettings} from "app/server/lib/AppSettings";
import {sendForCompletion} from 'app/server/lib/Assistance';
import {
  assertAccess,
  getAuthorizedUserId,
  getOrSetDocAuth,
  getTransitiveHeaders,
  getUserId,
  isAnonymousUser,
  RequestWithLogin
} from 'app/server/lib/Authorizer';
import {DocManager} from "app/server/lib/DocManager";
import {docSessionFromRequest, getDocSessionShare, makeExceptionalDocSession,
        OptDocSession} from "app/server/lib/DocSession";
import {DocWorker} from "app/server/lib/DocWorker";
import {IDocWorkerMap} from "app/server/lib/DocWorkerMap";
import {DownloadOptions, parseExportParameters} from "app/server/lib/Export";
import {downloadDSV} from "app/server/lib/ExportDSV";
import {collectTableSchemaInFrictionlessFormat} from "app/server/lib/ExportTableSchema";
import {streamXLSX} from "app/server/lib/ExportXLSX";
import {expressWrap} from 'app/server/lib/expressWrap';
import {filterDocumentInPlace} from "app/server/lib/filterUtils";
import {googleAuthTokenMiddleware} from "app/server/lib/GoogleAuth";
import {exportToDrive} from "app/server/lib/GoogleExport";
import {GristServer} from 'app/server/lib/GristServer';
import {HashUtil} from 'app/server/lib/HashUtil';
import {makeForkIds} from "app/server/lib/idUtils";
import log from 'app/server/lib/log';
import {
  getDocId,
  getDocScope,
  getScope,
  integerParam,
  isParameterOn,
  optBooleanParam,
  optIntegerParam,
  optStringParam,
  sendOkReply,
  sendReply,
  stringParam
} from 'app/server/lib/requestUtils';
import {ServerColumnGetters} from 'app/server/lib/ServerColumnGetters';
import {localeFromRequest} from "app/server/lib/ServerLocale";
import {isUrlAllowed, WebhookAction, WebHookSecret} from "app/server/lib/Triggers";
import {fetchDoc, globalUploadSet, handleOptionalUpload, handleUpload,
        makeAccessId} from "app/server/lib/uploads";
import * as assert from 'assert';
import contentDisposition from 'content-disposition';
import {Application, NextFunction, Request, RequestHandler, Response} from "express";
import * as _ from "lodash";
import LRUCache from 'lru-cache';
import * as moment from 'moment';
import fetch from 'node-fetch';
import * as path from 'path';
import * as t from "ts-interface-checker";
import {Checker} from "ts-interface-checker";
import uuidv4 from "uuid/v4";
import { Document } from "app/gen-server/entity/Document";

// Cap on the number of requests that can be outstanding on a single document via the
// rest doc api.  When this limit is exceeded, incoming requests receive an immediate
// reply with status 429.
const MAX_PARALLEL_REQUESTS_PER_DOC = 10;

// This is NOT the number of docs that can be handled at a time.
// It's a very generous upper bound of what that number might be.
// If there are more docs than this for which API requests are being regularly made at any moment,
// then the _dailyUsage cache may become unreliable and users may be able to exceed their allocated requests.
const MAX_ACTIVE_DOCS_USAGE_CACHE = 1000;

// Maximum amount of time that a webhook endpoint can hold the mutex for in withDocTriggersLock.
const MAX_DOC_TRIGGERS_LOCK_MS = 15_000;

// Maximum duration of a call to /sql. Does not apply to internal calls to SQLite.
const MAX_CUSTOM_SQL_MSEC = appSettings.section('integrations')
  .section('sql').flag('timeout').requireInt({
    envVar: 'GRIST_SQL_TIMEOUT_MSEC',
    defaultValue: 1000,
  });

type WithDocHandler = (activeDoc: ActiveDoc, req: RequestWithLogin, resp: Response) => Promise<void>;

// Schema validators for api endpoints that creates or updates records.
const {
  RecordsPatch, RecordsPost, RecordsPut,
  ColumnsPost, ColumnsPatch, ColumnsPut,
  SqlPost,
  TablesPost, TablesPatch,
} = t.createCheckers(DocApiTypesTI, GristDataTI);

for (const checker of [RecordsPatch, RecordsPost, RecordsPut, ColumnsPost, ColumnsPatch,
                       SqlPost, TablesPost, TablesPatch]) {
  checker.setReportedPath("body");
}

// Schema validators for api endpoints that creates or updates records.
const {
  WebhookPatch,
  WebhookSubscribe,
  WebhookSubscribeCollection,
} = t.createCheckers(TriggersTI);

/**
 * Middleware for validating request's body with a Checker instance.
 */
function validate(checker: Checker): RequestHandler {
  return (req, res, next) => {
    validateCore(checker, req, req.body);
    next();
  };
}

function validateCore(checker: Checker, req: Request, body: any) {
    try {
      checker.check(body);
    } catch(err) {
      log.warn(`Error during api call to ${req.path}: Invalid payload: ${String(err)}`);
      throw new ApiError('Invalid payload', 400, {userError: String(err)});
    }
}

export class DocWorkerApi {
  // Map from docId to number of requests currently being handled for that doc
  private _currentUsage = new Map<string, number>();

  // Map from (docId, time period) combination produced by docPeriodicApiUsageKey
  // to number of requests previously served for that combination.
  // We multiply by 5 because there are 5 relevant keys per doc at any time (current/next day/hour and current minute).
  private _dailyUsage = new LRUCache<string, number>({max: 5 * MAX_ACTIVE_DOCS_USAGE_CACHE});

  constructor(private _app: Application, private _docWorker: DocWorker,
              private _docWorkerMap: IDocWorkerMap, private _docManager: DocManager,
              private _dbManager: HomeDBManager, private _grist: GristServer) {}

  /**
   * Adds endpoints for the doc api.
   *
   * Note that it expects bodyParser, userId, and jsonErrorHandler middleware to be set up outside
   * to apply to these routes.
   */
  public addEndpoints() {
    this._app.use((req, res, next) => {
      if (req.url.startsWith('/api/s/')) {
        req.url = req.url.replace('/api/s/', `/api/docs/${SHARE_KEY_PREFIX}`);
      }
      next();
    });

    // check document exists (not soft deleted) and user can view it
    const canView = expressWrap(this._assertAccess.bind(this, 'viewers', false));
    // check document exists (not soft deleted) and user can edit it
    const canEdit = expressWrap(this._assertAccess.bind(this, 'editors', false));
    const checkAnonymousCreation = expressWrap(this._checkAnonymousCreation.bind(this));
    const isOwner = expressWrap(this._assertAccess.bind(this, 'owners', false));
    // check user can edit document, with soft-deleted documents being acceptable
    const canEditMaybeRemoved = expressWrap(this._assertAccess.bind(this, 'editors', true));
    // converts google code to access token and adds it to request object
    const decodeGoogleToken = expressWrap(googleAuthTokenMiddleware.bind(null));
    // check that limit can be increased by 1
    const checkLimit = (type: LimitType) => expressWrap(this._checkLimit.bind(this, type));

    // Middleware to limit number of outstanding requests per document.  Will also
    // handle errors like expressWrap would.
    const throttled = this._apiThrottle.bind(this);

    const withDoc = (callback: WithDocHandler) => throttled(this._requireActiveDoc(callback));

    // Like withDoc, but only one such callback can run at a time per active doc.
    // This is used for webhook endpoints to prevent simultaneous changes to configuration
    // or clearing queues which could lead to weird problems.
    const withDocTriggersLock = (callback: WithDocHandler) => withDoc(
      async (activeDoc: ActiveDoc, req: RequestWithLogin, resp: Response) =>
        await activeDoc.triggersLock.runExclusive(async () => {
          // We don't want to hold the mutex indefinitely so that if one call gets stuck
          // (especially while trying to apply user actions which are stalled by a full queue)
          // another call which would clear a queue, disable a webhook, or fix something related
          // can eventually succeed.
          if (await timeoutReached(MAX_DOC_TRIGGERS_LOCK_MS, callback(activeDoc, req, resp), {rethrow: true})) {
            log.rawError(`Webhook endpoint timed out, releasing mutex`,
              {method: req.method, path: req.path, docId: activeDoc.docName});
          }
        })
    );

    // Apply user actions to a document.
    this._app.post('/api/docs/:docId/apply', canEdit, withDoc(async (activeDoc, req, res) => {
      const parseStrings = !isAffirmative(req.query.noparse);
      res.json(await activeDoc.applyUserActions(docSessionFromRequest(req), req.body, {parseStrings}));
    }));


    async function readTable(
      req: RequestWithLogin,
      activeDoc: ActiveDoc,
      tableId: string,
      filters: QueryFilters,
      params: QueryParameters & {immediate?: boolean}) {
      // Option to skip waiting for document initialization.
      const immediate = isAffirmative(params.immediate);
      if (!Object.keys(filters).every(col => Array.isArray(filters[col]))) {
        throw new ApiError("Invalid query: filter values must be arrays", 400);
      }
      const session = docSessionFromRequest(req);
      const {tableData} = await handleSandboxError(tableId, [], activeDoc.fetchQuery(
        session, {tableId, filters}, !immediate));
      // For metaTables we don't need to specify columns, search will infer it from the sort expression.
      const isMetaTable = tableId.startsWith('_grist');
      const columns = isMetaTable ? null :
        await handleSandboxError('', [], activeDoc.getTableCols(session, tableId, true));
      // Apply sort/limit parameters, if set.  TODO: move sorting/limiting into data engine
      // and sql.
      return applyQueryParameters(fromTableDataAction(tableData), params, columns);
    }

    async function getTableData(activeDoc: ActiveDoc, req: RequestWithLogin, optTableId?: string) {
      const filters = req.query.filter ? JSON.parse(String(req.query.filter)) : {};
      // Option to skip waiting for document initialization.
      const immediate = isAffirmative(req.query.immediate);
      const tableId = await getRealTableId(optTableId || req.params.tableId, {activeDoc, req});
      const params = getQueryParameters(req);
      return await readTable(req, activeDoc, tableId, filters, {...params, immediate});
    }

    function asRecords(
      columnData: TableColValues, opts?: { optTableId?: string; includeHidden?: boolean }): TableRecordValue[] {
      const fieldNames = Object.keys(columnData).filter((k) => {
        if (k === "id") {
          return false;
        }
        if (
          !opts?.includeHidden &&
          (k === "manualSort" || k.startsWith("gristHelper_"))
        ) {
          return false;
        }
        return true;
      });
      return columnData.id.map((id, index) => {
        const result: TableRecordValue = { id, fields: {} };
        for (const key of fieldNames) {
          let value = columnData[key][index];
          if (isRaisedException(value)) {
            _.set(result, ["errors", key], (value as string[])[1]);
            value = null;
          }
          result.fields[key] = value;
        }
        return result;
      });
    }

    async function getTableRecords(
      activeDoc: ActiveDoc, req: RequestWithLogin, opts?: { optTableId?: string; includeHidden?: boolean }
    ): Promise<TableRecordValue[]> {
      const columnData = await getTableData(activeDoc, req, opts?.optTableId);
      return asRecords(columnData, opts);
    }

    // Get the specified table in column-oriented format
    this._app.get('/api/docs/:docId/tables/:tableId/data', canView,
      withDoc(async (activeDoc, req, res) => {
        res.json(await getTableData(activeDoc, req));
      })
    );

    // Get the specified table in record-oriented format
    this._app.get('/api/docs/:docId/tables/:tableId/records', canView,
      withDoc(async (activeDoc, req, res) => {
        const records = await getTableRecords(activeDoc, req,
          { includeHidden: isAffirmative(req.query.hidden) }
        );
        res.json({records});
      })
    );

    const registerWebhook = async (activeDoc: ActiveDoc, req: RequestWithLogin, webhook: WebhookFields) => {
      const {fields, url} = await getWebhookSettings(activeDoc, req, null, webhook);
      if (!fields.eventTypes?.length) {
        throw new ApiError(`eventTypes must be a non-empty array`, 400);
      }
      if (!isUrlAllowed(url)) {
        throw new ApiError('Provided url is forbidden', 403);
      }
      if (!fields.tableRef) {
        throw new ApiError(`tableId is required`, 400);
      }

      const unsubscribeKey = uuidv4();
      const webhookSecret: WebHookSecret = {unsubscribeKey, url};
      const secretValue = JSON.stringify(webhookSecret);
      const webhookId = (await this._dbManager.addSecret(secretValue, activeDoc.docName)).id;

      try {

        const webhookAction: WebhookAction = {type: "webhook", id: webhookId};
        const sandboxRes = await handleSandboxError("_grist_Triggers", [], activeDoc.applyUserActions(
          docSessionFromRequest(req),
          [['AddRecord', "_grist_Triggers", null, {
            enabled: true,
            ...fields,
            actions: JSON.stringify([webhookAction])
          }]]));
        return {
            unsubscribeKey,
            triggerId: sandboxRes.retValues[0],
            webhookId,
        };

      } catch (err) {

        // remove webhook
        await this._dbManager.removeWebhook(webhookId, activeDoc.docName, '', false);
        throw err;
      } finally {
        await activeDoc.sendWebhookNotification();
      }
    };

    const removeWebhook = async (activeDoc: ActiveDoc, req: RequestWithLogin, res: Response) => {
      const {unsubscribeKey} = req.body as WebhookSubscription;
      const webhookId = req.params.webhookId??req.body.webhookId;

      // owner does not need to provide unsubscribeKey
      const checkKey = !(await this._isOwner(req));
      const triggerRowId = activeDoc.triggers.getWebhookTriggerRecord(webhookId).id;
      // Validate unsubscribeKey before deleting trigger from document
      await this._dbManager.removeWebhook(webhookId, activeDoc.docName, unsubscribeKey, checkKey);
      activeDoc.triggers.webhookDeleted(webhookId);

      await handleSandboxError("_grist_Triggers", [], activeDoc.applyUserActions(
        docSessionFromRequest(req),
        [['RemoveRecord', "_grist_Triggers", triggerRowId]]));

      await activeDoc.sendWebhookNotification();

      res.json({success: true});
    };

    async function getWebhookSettings(activeDoc: ActiveDoc, req: RequestWithLogin,
                                      webhookId: string|null, webhook: WebhookFields) {
      const metaTables = await getMetaTables(activeDoc, req);
      const tablesTable = activeDoc.docData!.getMetaTable("_grist_Tables");
      const trigger = webhookId ? activeDoc.triggers.getWebhookTriggerRecord(webhookId) : undefined;
      let currentTableId = trigger ? tablesTable.getValue(trigger.tableRef, 'tableId')! : undefined;
      const {url, eventTypes, isReadyColumn, name} = webhook;
      const tableId = await getRealTableId(req.params.tableId || webhook.tableId, {metaTables});

      const fields: Partial<SchemaTypes['_grist_Triggers']> = {};

      if (url && !isUrlAllowed(url)) {
        throw new ApiError('Provided url is forbidden', 403);
      }

      if (eventTypes) {
        if (!eventTypes.length) {
          throw new ApiError(`eventTypes must be a non-empty array`, 400);
        }
        fields.eventTypes = [GristObjCode.List, ...eventTypes];
      }

      if (tableId !== undefined) {
        fields.tableRef = tableIdToRef(metaTables, tableId);
        currentTableId = tableId;
      }

      if (isReadyColumn !== undefined) {
        // When isReadyColumn is defined let's explicitly change the ready column to the new col
        // id, null or empty string being a special case that unsets it.
        if (isReadyColumn !== null && isReadyColumn !== '') {
          if (!currentTableId) {
            throw new ApiError(`Cannot find column "${isReadyColumn}" because table is not known`, 404);
          }
          fields.isReadyColRef = colIdToReference(metaTables, currentTableId, isReadyColumn);
        } else {
          fields.isReadyColRef = 0;
        }
      } else if (tableId) {
        // When isReadyColumn is undefined but tableId was changed, let's unset the ready column
        fields.isReadyColRef = 0;
      }

      // assign other field properties
      Object.assign(fields, _.pick(webhook, ['enabled', 'memo']));
      if (name) {
        fields.label = name;
      }
      return {
        fields,
        url,
      };
    }

    // Get the columns of the specified table in recordish format
    this._app.get('/api/docs/:docId/tables/:tableId/columns', canView,
      withDoc(async (activeDoc, req, res) => {
        const tableId = await getRealTableId(req.params.tableId, {activeDoc, req});
        const includeHidden = isAffirmative(req.query.hidden);
        const columns = await handleSandboxError('', [],
          activeDoc.getTableCols(docSessionFromRequest(req), tableId, includeHidden));
        res.json({columns});
      })
    );

    // Get the tables of the specified document in recordish format
    this._app.get('/api/docs/:docId/tables', canView,
      withDoc(async (activeDoc, req, res) => {
        const records = await getTableRecords(activeDoc, req, { optTableId: "_grist_Tables" });
        const tables: Types.RecordWithStringId[] = records.map((record) => ({
          id: String(record.fields.tableId),
          fields: {
            ..._.omit(record.fields, "tableId"),
            tableRef: record.id,
          }
        })).filter(({id}) => id);
        res.json({tables});
      })
    );

    // The upload should be a multipart post with an 'upload' field containing one or more files.
    // Returns the list of rowIds for the rows created in the _grist_Attachments table.
    this._app.post('/api/docs/:docId/attachments', canEdit, withDoc(async (activeDoc, req, res) => {
      const uploadResult = await handleUpload(req, res);
      res.json(await activeDoc.addAttachments(docSessionFromRequest(req), uploadResult.uploadId));
    }));

    // Select the fields from an attachment record that we want to return to the user,
    // and convert the timeUploaded from a number to an ISO string.
    function cleanAttachmentRecord(record: MetaRowRecord<"_grist_Attachments">) {
      const {fileName, fileSize, timeUploaded: time} = record;
      const timeUploaded = (typeof time === 'number') ? new Date(time).toISOString() : undefined;
      return {fileName, fileSize, timeUploaded};
    }

    // Returns cleaned metadata for all attachments in /records format.
    this._app.get('/api/docs/:docId/attachments', canView, withDoc(async (activeDoc, req, res) => {
      const rawRecords = await getTableRecords(activeDoc, req, { optTableId: "_grist_Attachments" });
      const records = rawRecords.map(r => ({
        id: r.id,
        fields: cleanAttachmentRecord(r.fields as MetaRowRecord<"_grist_Attachments">),
      }));
      res.json({records});
    }));

    // Returns cleaned metadata for a given attachment ID (i.e. a rowId in _grist_Attachments table).
    this._app.get('/api/docs/:docId/attachments/:attId', canView, withDoc(async (activeDoc, req, res) => {
      const attId = integerParam(req.params.attId, 'attId');
      const attRecord = activeDoc.getAttachmentMetadata(attId);
      res.json(cleanAttachmentRecord(attRecord));
    }));

    // Responds with attachment contents, with suitable Content-Type and Content-Disposition.
    this._app.get('/api/docs/:docId/attachments/:attId/download', canView, withDoc(async (activeDoc, req, res) => {
      const attId = integerParam(req.params.attId, 'attId');
      const tableId = optStringParam(req.params.tableId, 'tableId');
      const colId = optStringParam(req.params.colId, 'colId');
      const rowId = optIntegerParam(req.params.rowId, 'rowId');
      if ((tableId || colId || rowId) && !(tableId && colId && rowId)) {
        throw new ApiError('define all of tableId, colId and rowId, or none.', 400);
      }
      const attRecord = activeDoc.getAttachmentMetadata(attId);
      const cell = (tableId && colId && rowId) ? {tableId, colId, rowId} : undefined;
      const fileIdent = attRecord.fileIdent as string;
      const ext = path.extname(fileIdent);
      const origName = attRecord.fileName as string;
      const fileName = ext ? path.basename(origName, path.extname(origName)) + ext : origName;
      const fileData = await activeDoc.getAttachmentData(docSessionFromRequest(req), attRecord, {cell});
      res.status(200)
        .type(ext)
        // Construct a content-disposition header of the form 'attachment; filename="NAME"'
        .set('Content-Disposition', contentDisposition(fileName, {type: 'attachment'}))
        .set('Cache-Control', 'private, max-age=3600')
        .send(fileData);
    }));

    // Mostly for testing
    this._app.post('/api/docs/:docId/attachments/updateUsed', canEdit, withDoc(async (activeDoc, req, res) => {
      await activeDoc.updateUsedAttachmentsIfNeeded();
      res.json(null);
    }));
    this._app.post('/api/docs/:docId/attachments/removeUnused', isOwner, withDoc(async (activeDoc, req, res) => {
      const expiredOnly = isAffirmative(req.query.expiredonly);
      const verifyFiles = isAffirmative(req.query.verifyfiles);
      await activeDoc.removeUnusedAttachments(expiredOnly);
      if (verifyFiles) {
        await verifyAttachmentFiles(activeDoc);
      }
      res.json(null);
    }));
    this._app.post('/api/docs/:docId/attachments/verifyFiles', isOwner, withDoc(async (activeDoc, req, res) => {
      await verifyAttachmentFiles(activeDoc);
      res.json(null);
    }));

    async function verifyAttachmentFiles(activeDoc: ActiveDoc) {
      assert.deepStrictEqual(
        await activeDoc.docStorage.all(`SELECT DISTINCT fileIdent AS ident FROM _grist_Attachments ORDER BY ident`),
        await activeDoc.docStorage.all(`SELECT                       ident FROM _gristsys_Files    ORDER BY ident`),
      );
    }

    // Adds records given in a column oriented format,
    // returns an array of row IDs
    this._app.post('/api/docs/:docId/tables/:tableId/data', canEdit,
      withDoc(async (activeDoc, req, res) => {
        const colValues = req.body as BulkColValues;
        const count = colValues[Object.keys(colValues)[0]].length;
        const op = await getTableOperations(req, activeDoc);
        const ids = await op.addRecords(count, colValues);
        res.json(ids);
      })
    );

    // Adds records given in a record oriented format,
    // returns in the same format as GET /records but without the fields object for now
    // WARNING: The `req.body` object is modified in place.
    this._app.post('/api/docs/:docId/tables/:tableId/records', canEdit,
      withDoc(async (activeDoc, req, res) => {
        let body = req.body;
        if (isAffirmative(req.query.flat)) {
          if (!body.records && Array.isArray(body)) {
            for (const [i, rec] of body.entries()) {
              if (!rec.fields) {
                // If ids arrive in a loosely formatted flat payload,
                // remove them since we cannot honor them. If not loosely
                // formatted, throw an error later. TODO: would be useful
                // to have a way to exclude or rename fields via query
                // parameters.
                if (rec.id) { delete rec.id; }
                body[i] = {fields: rec};
              }
            }
            body = {records: body};
          }
        }
        validateCore(RecordsPost, req, body);
        const ops = await getTableOperations(req, activeDoc);
        const records = await ops.create(body.records);
        if (req.query.utm_source === 'grist-forms') {
          activeDoc.logTelemetryEvent(docSessionFromRequest(req), 'submittedForm');
        }
        res.json({records});
      })
    );

    // A GET /sql endpoint that takes a query like ?q=select+*+from+Table1
    // Not very useful, apart from testing - see the POST endpoint for
    // serious use.
    // If SQL statements that modify the DB are ever supported, they should
    // not be permitted by this endpoint.
    this._app.get(
      '/api/docs/:docId/sql', canView,
      withDoc(async (activeDoc, req, res) => {
        const sql = stringParam(req.query.q, 'q');
        await this._runSql(activeDoc, req, res, { sql });
      }));

    // A POST /sql endpoint, accepting a body like:
    // { "sql": "select * from Table1 where name = ?", "args": ["Paul"] }
    // Only SELECT statements are currently supported.
    this._app.post(
      '/api/docs/:docId/sql', canView, validate(SqlPost),
      withDoc(async (activeDoc, req, res) => {
        await this._runSql(activeDoc, req, res, req.body);
      }));

    // Create columns in a table, given as records of the _grist_Tables_column metatable.
    this._app.post('/api/docs/:docId/tables/:tableId/columns', canEdit, validate(ColumnsPost),
      withDoc(async (activeDoc, req, res) => {
        const body = req.body as Types.ColumnsPost;
        const tableId = await getRealTableId(req.params.tableId, {activeDoc, req});
        const actions = body.columns.map(({fields, id: colId}) =>
          // AddVisibleColumn adds the column to all widgets of the table.
          // This isn't necessarily what the user wants, but it seems like a good default.
          // Maybe there should be a query param to control this?
          ["AddVisibleColumn", tableId, colId, fields || {}]
        );
        const {retValues} = await handleSandboxError(tableId, [],
          activeDoc.applyUserActions(docSessionFromRequest(req), actions)
        );
        const columns = retValues.map(({colId}) => ({id: colId}));
        res.json({columns});
      })
    );

    // Create new tables in a doc. Unlike POST /records or /columns, each 'record' (table) should have a `columns`
    // property in the same format as POST /columns above, and no `fields` property.
    this._app.post('/api/docs/:docId/tables', canEdit, validate(TablesPost),
      withDoc(async (activeDoc, req, res) => {
        const body = req.body as Types.TablesPost;
        const actions = body.tables.map(({columns, id}) => {
          const colInfos = columns.map(({fields, id: colId}) => ({...fields, id: colId}));
          return ["AddTable", id, colInfos];
        });
        const {retValues} = await activeDoc.applyUserActions(docSessionFromRequest(req), actions);
        const tables = retValues.map(({table_id}) => ({id: table_id}));
        res.json({tables});
      })
    );

    this._app.post('/api/docs/:docId/tables/:tableId/data/delete', canEdit, withDoc(async (activeDoc, req, res) => {
      const rowIds = req.body;
      const op = await getTableOperations(req, activeDoc);
      await op.destroy(rowIds);
      res.json(null);
    }));

    // Download full document
    // TODO: look at download behavior if ActiveDoc is shutdown during call (cannot
    // use withDoc wrapper)
    this._app.get('/api/docs/:docId/download', canView, throttled(async (req, res) => {
      // Support a dryRun flag to check if user has the right to download the
      // full document.
      const dryRun = isAffirmative(req.query.dryrun || req.query.dryRun);
      const dryRunSuccess = () => res.status(200).json({dryRun: 'allowed'});

      const filename = await this._getDownloadFilename(req);

      // We want to be have a way download broken docs that ActiveDoc may not be able
      // to load.  So, if the user owns the document, we unconditionally let them
      // download.
      if (await this._isOwner(req, {acceptTrunkForSnapshot: true})) {
        if (dryRun) { dryRunSuccess(); return; }
        try {
          // We carefully avoid creating an ActiveDoc for the document being downloaded,
          // in case it is broken in some way.  It is convenient to be able to download
          // broken files for diagnosis/recovery.
          return await this._docWorker.downloadDoc(req, res, this._docManager.storageManager, filename);
        } catch (e) {
          if (e.message && e.message.match(/does not exist yet/)) {
            // The document has never been seen on file system / s3.  It may be new, so
            // we try again after having created an ActiveDoc for the document.
            await this._getActiveDoc(req);
            return this._docWorker.downloadDoc(req, res, this._docManager.storageManager, filename);
          } else {
            throw e;
          }
        }
      } else {
        // If the user is not an owner, we load the document as an ActiveDoc, and then
        // check if the user has download permissions.
        const activeDoc = await this._getActiveDoc(req);
        if (!await activeDoc.canDownload(docSessionFromRequest(req))) {
          throw new ApiError('not authorized to download this document', 403);
        }
        if (dryRun) { dryRunSuccess(); return; }
        return this._docWorker.downloadDoc(req, res, this._docManager.storageManager, filename);
      }
    }));

    // Fork the specified document.
    this._app.post('/api/docs/:docId/fork', canView, withDoc(async (activeDoc, req, res) => {
      const result = await activeDoc.fork(docSessionFromRequest(req));
      res.json(result);
    }));

    // Initiate a fork.  Used internally to implement ActiveDoc.fork.  Only usable via a Permit.
    this._app.post('/api/docs/:docId/create-fork', canEdit, throttled(async (req, res) => {
      const docId = stringParam(req.params.docId, 'docId');
      const srcDocId = stringParam(req.body.srcDocId, 'srcDocId');
      if (srcDocId !== req.specialPermit?.otherDocId) { throw new Error('access denied'); }
      const fname = await this._docManager.storageManager.prepareFork(srcDocId, docId);
      await filterDocumentInPlace(docSessionFromRequest(req), fname);
      res.json({srcDocId, docId});
    }));

    // Update records given in column format
    // The records to update are identified by their id column.
    this._app.patch('/api/docs/:docId/tables/:tableId/data', canEdit,
      withDoc(async (activeDoc, req, res) => {
        const columnValues = req.body;
        const rowIds = columnValues.id;
        // sandbox expects no id column
        delete columnValues.id;
        const ops = await getTableOperations(req, activeDoc);
        await ops.updateRecords(columnValues, rowIds);
        res.json(null);
      })
    );

    // Update records given in records format
    this._app.patch('/api/docs/:docId/tables/:tableId/records', canEdit, validate(RecordsPatch),
      withDoc(async (activeDoc, req, res) => {
        const body = req.body as Types.RecordsPatch;
        const ops = await getTableOperations(req, activeDoc);
        await ops.update(body.records);
        res.json(null);
      })
    );

    // Update columns given in records format
    this._app.patch('/api/docs/:docId/tables/:tableId/columns', canEdit, validate(ColumnsPatch),
      withDoc(async (activeDoc, req, res) => {
        const tablesTable = activeDoc.docData!.getMetaTable("_grist_Tables");
        const columnsTable = activeDoc.docData!.getMetaTable("_grist_Tables_column");
        const tableId = await getRealTableId(req.params.tableId, {activeDoc, req});
        const tableRef = tablesTable.findMatchingRowId({tableId});
        if (!tableRef) {
          throw new ApiError(`Table not found "${tableId}"`, 404);
        }
        const body = req.body as Types.ColumnsPatch;
        const columns: Types.Record[] = body.columns.map((col) => {
          const id = columnsTable.findMatchingRowId({parentId: tableRef, colId: col.id});
          if (!id) {
            throw new ApiError(`Column not found "${col.id}"`, 404);
          }
          return {...col, id};
        });
        const ops = await getTableOperations(req, activeDoc, "_grist_Tables_column");
        await ops.update(columns);
        res.json(null);
      })
    );

    // Update tables given in records format
    this._app.patch('/api/docs/:docId/tables', canEdit, validate(TablesPatch),
      withDoc(async (activeDoc, req, res) => {
        const tablesTable = activeDoc.docData!.getMetaTable("_grist_Tables");
        const body = req.body as Types.TablesPatch;
        const tables: Types.Record[] = body.tables.map((table) => {
          const id = tablesTable.findMatchingRowId({tableId: table.id});
          if (!id) {
            throw new ApiError(`Table not found "${table.id}"`, 404);
          }
          return {...table, id};
        });
        const ops = await getTableOperations(req, activeDoc, "_grist_Tables");
        await ops.update(tables);
        res.json(null);
      })
    );

    // Add or update records given in records format
    this._app.put('/api/docs/:docId/tables/:tableId/records', canEdit, validate(RecordsPut),
      withDoc(async (activeDoc, req, res) => {
        const ops = await getTableOperations(req, activeDoc);
        const body = req.body as Types.RecordsPut;
        const options = {
          add: !isAffirmative(req.query.noadd),
          update: !isAffirmative(req.query.noupdate),
          onMany: stringParam(req.query.onmany || "first", "onmany", {
            allowed: ["first", "none", "all"],
          }) as 'first'|'none'|'all'|undefined,
          allowEmptyRequire: isAffirmative(req.query.allow_empty_require),
        };
        await ops.upsert(body.records, options);
        res.json(null);
      })
    );

    // Add or update records given in records format
    this._app.put('/api/docs/:docId/tables/:tableId/columns', canEdit, validate(ColumnsPut),
      withDoc(async (activeDoc, req, res) => {
        const tablesTable = activeDoc.docData!.getMetaTable("_grist_Tables");
        const columnsTable = activeDoc.docData!.getMetaTable("_grist_Tables_column");
        const tableId = await getRealTableId(req.params.tableId, {activeDoc, req});
        const tableRef = tablesTable.findMatchingRowId({tableId});
        if (!tableRef) {
          throw new ApiError(`Table not found "${tableId}"`, 404);
        }
        const body = req.body as Types.ColumnsPut;

        const addActions: UserAction[] = [];
        const updateActions: UserAction[] = [];
        const updatedColumnsIds = new Set();

        for (const col of body.columns) {
          const id = columnsTable.findMatchingRowId({parentId: tableRef, colId: col.id});
          if (id) {
            updateActions.push( ['UpdateRecord', '_grist_Tables_column', id, col.fields] );
            updatedColumnsIds.add( id );
          } else {
            addActions.push( ['AddVisibleColumn', tableId, col.id, col.fields] );
          }
        }

        const getRemoveAction = async () => {
          const columns = await handleSandboxError('', [],
            activeDoc.getTableCols(docSessionFromRequest(req), tableId));
          const columnsToRemove = columns
            .map(col => col.fields.colRef as number)
            .filter(colRef => !updatedColumnsIds.has(colRef));

          return [ 'BulkRemoveRecord', '_grist_Tables_column', columnsToRemove ];
        };

        const actions = [
          ...(!isAffirmative(req.query.noupdate) ? updateActions : []),
          ...(!isAffirmative(req.query.noadd) ? addActions : []),
          ...(isAffirmative(req.query.replaceall) ? [ await getRemoveAction() ] : [] )
        ];
        await handleSandboxError(tableId, [],
          activeDoc.applyUserActions(docSessionFromRequest(req), actions)
        );
        res.json(null);
      })
    );

    this._app.delete('/api/docs/:docId/tables/:tableId/columns/:colId', canEdit,
      withDoc(async (activeDoc, req, res) => {
        const {colId} = req.params;
        const tableId = await getRealTableId(req.params.tableId, {activeDoc, req});
        const actions = [ [ 'RemoveColumn', tableId, colId ] ];
        await handleSandboxError(tableId, [colId],
          activeDoc.applyUserActions(docSessionFromRequest(req), actions)
        );
        res.json(null);
      })
    );

    // Add a new webhook and trigger
    this._app.post('/api/docs/:docId/webhooks', isOwner, validate(WebhookSubscribeCollection),
      withDocTriggersLock(async (activeDoc, req, res) => {
        const registeredWebhooks: Array<WebhookSubscription> = [];
        for(const webhook of req.body.webhooks) {
          const registeredWebhook = await registerWebhook(activeDoc, req, webhook.fields);
          registeredWebhooks.push(registeredWebhook);
        }
        res.json({webhooks:  registeredWebhooks.map(rw=> {
          return {id: rw.webhookId};
        })});
      })
    );

    /**
     @deprecated please call to POST /webhooks instead, this endpoint is only for sake of backward compatibility
     */
    this._app.post('/api/docs/:docId/tables/:tableId/_subscribe', isOwner, validate(WebhookSubscribe),
      withDocTriggersLock(async (activeDoc, req, res) => {
        const registeredWebhook = await registerWebhook(activeDoc, req, req.body);
        res.json(registeredWebhook);
      })
    );

    // Clears all outgoing webhooks in the queue for this document.
    this._app.delete('/api/docs/:docId/webhooks/queue', isOwner,
      withDocTriggersLock(async (activeDoc, req, res) => {
        await activeDoc.clearWebhookQueue();
        await activeDoc.sendWebhookNotification();
        res.json({success: true});
      })
    );

    // Remove webhook and trigger created above
    this._app.delete('/api/docs/:docId/webhooks/:webhookId', isOwner,
      withDocTriggersLock(removeWebhook)
    );

    /**
     @deprecated please call to DEL /webhooks instead, this endpoint is only for sake of backward compatibility
     */
    this._app.post('/api/docs/:docId/tables/:tableId/_unsubscribe', canEdit,
      withDocTriggersLock(removeWebhook)
    );

    // Update a webhook
    this._app.patch(
      '/api/docs/:docId/webhooks/:webhookId', isOwner, validate(WebhookPatch),
      withDocTriggersLock(async (activeDoc, req, res) => {

        const docId = activeDoc.docName;
        const webhookId = req.params.webhookId;
        const {fields, url} = await getWebhookSettings(activeDoc, req, webhookId, req.body);

        if (fields.enabled === false) {
          await activeDoc.triggers.clearSingleWebhookQueue(webhookId);
        }

        const triggerRowId = activeDoc.triggers.getWebhookTriggerRecord(webhookId).id;

        // update url in homedb
        if (url) {
          await this._dbManager.updateWebhookUrl(webhookId, docId, url);
          activeDoc.triggers.webhookDeleted(webhookId); // clear cache
        }

        // then update document
        if (Object.keys(fields).length) {
          await handleSandboxError("_grist_Triggers", [], activeDoc.applyUserActions(
            docSessionFromRequest(req),
            [['UpdateRecord', "_grist_Triggers", triggerRowId, fields]]));
        }

        await activeDoc.sendWebhookNotification();

        res.json({success: true});
      })
    );

    // Clears a single webhook in the queue for this document.
    this._app.delete('/api/docs/:docId/webhooks/queue/:webhookId', isOwner,
      withDocTriggersLock(async (activeDoc, req, res) => {
        const webhookId = req.params.webhookId;
        await activeDoc.clearSingleWebhookQueue(webhookId);
        await activeDoc.sendWebhookNotification();
        res.json({success: true});
      })
    );

    // Lists all webhooks and their current status in the document.
    this._app.get('/api/docs/:docId/webhooks', isOwner,
      withDocTriggersLock(async (activeDoc, req, res) => {
        res.json(await activeDoc.webhooksSummary());
      })
    );

    // Reload a document forcibly (in fact this closes the doc, it will be automatically
    // reopened on use).
    this._app.post('/api/docs/:docId/force-reload', canEdit, throttled(async (req, res) => {
      const activeDoc = await this._getActiveDoc(req);
      await activeDoc.reloadDoc();
      res.json(null);
    }));

    this._app.post('/api/docs/:docId/recover', canEdit, throttled(async (req, res) => {
      const recoveryModeRaw = req.body.recoveryMode;
      const recoveryMode = (typeof recoveryModeRaw === 'boolean') ? recoveryModeRaw : undefined;
      if (!await this._isOwner(req)) { throw new Error('Only owners can control recovery mode'); }
      this._docManager.setRecovery(getDocId(req), recoveryMode ?? true);
      const activeDoc = await this._docManager.fetchDoc(docSessionFromRequest(req), getDocId(req), recoveryMode);
      res.json({
        recoveryMode: activeDoc.recoveryMode
      });
    }));

    // DELETE /api/docs/:docId
    // Delete the specified doc.
    this._app.delete('/api/docs/:docId', canEditMaybeRemoved, throttled(async (req, res) => {
      await this._removeDoc(req, res, true);
    }));

    // POST /api/docs/:docId/remove
    // Soft-delete the specified doc.  If query parameter "permanent" is set,
    // delete permanently.
    this._app.post('/api/docs/:docId/remove', canEditMaybeRemoved, throttled(async (req, res) => {
      await this._removeDoc(req, res, isParameterOn(req.query.permanent));
    }));

    this._app.get('/api/docs/:docId/snapshots', canView, withDoc(async (activeDoc, req, res) => {
      const docSession = docSessionFromRequest(req);
      const {snapshots} = await activeDoc.getSnapshots(docSession, isAffirmative(req.query.raw));
      res.json({snapshots});
    }));

    this._app.get('/api/docs/:docId/usersForViewAs', isOwner, withDoc(async (activeDoc, req, res) => {
      const docSession = docSessionFromRequest(req);
      res.json(await activeDoc.getUsersForViewAs(docSession));
    }));

    this._app.post('/api/docs/:docId/snapshots/remove', isOwner, withDoc(async (activeDoc, req, res) => {
      const docSession = docSessionFromRequest(req);
      const snapshotIds = req.body.snapshotIds as string[];
      if (snapshotIds) {
        await activeDoc.removeSnapshots(docSession, snapshotIds);
        res.json({snapshotIds});
        return;
      }
      if (req.body.select === 'unlisted') {
        // Remove any snapshots not listed in inventory.  Ideally, there should be no
        // snapshots, and this undocumented feature is just for fixing up problems.
        const full = (await activeDoc.getSnapshots(docSession, true)).snapshots.map(s => s.snapshotId);
        const listed = new Set((await activeDoc.getSnapshots(docSession)).snapshots.map(s => s.snapshotId));
        const unlisted = full.filter(snapshotId => !listed.has(snapshotId));
        await activeDoc.removeSnapshots(docSession, unlisted);
        res.json({snapshotIds: unlisted});
        return;
      }
      if (req.body.select === 'past') {
        // Remove all but the latest snapshot.  Useful for sanitizing history if something
        // bad snuck into previous snapshots and they are not valuable to preserve.
        const past = (await activeDoc.getSnapshots(docSession, true)).snapshots.map(s => s.snapshotId);
        past.shift();  // remove current version.
        await activeDoc.removeSnapshots(docSession, past);
        res.json({snapshotIds: past});
        return;
      }
      throw new Error('please specify snapshotIds to remove');
    }));

    this._app.post('/api/docs/:docId/flush', canEdit, throttled(async (req, res) => {
      const activeDocPromise = this._getActiveDocIfAvailable(req);
      if (!activeDocPromise) {
        // Only need to flush if doc is actually open.
        res.json(false);
        return;
      }
      const activeDoc = await activeDocPromise;
      await activeDoc.flushDoc();
      res.json(true);
    }));

    // Administrative endpoint, that checks if a document is in the expected group,
    // and frees it for reassignment if not.  Has no effect if document is in the
    // expected group.  Does not require specific rights.  Returns true if the document
    // is freed up for reassignment, otherwise false.
    //
    // Optionally accepts a `group` query param for updating the document's group prior
    // to (possible) reassignment. A blank string unsets the current group, if any.
    // (Requires a special permit.)
    this._app.post('/api/docs/:docId/assign', canEdit, throttled(async (req, res) => {
      const docId = getDocId(req);
      const group = optStringParam(req.query.group, 'group');
      if (group !== undefined && req.specialPermit?.action === 'assign-doc') {
        if (group.trim() === '') {
          await this._docWorkerMap.removeDocGroup(docId);
        } else {
          await this._docWorkerMap.updateDocGroup(docId, group);
        }
      }
      const status = await this._docWorkerMap.getDocWorker(docId);
      if (!status) { res.json(false); return; }
      const workerGroup = await this._docWorkerMap.getWorkerGroup(status.docWorker.id);
      const docGroup = await this._docWorkerMap.getDocGroup(docId);
      if (docGroup === workerGroup) { res.json(false); return; }
      const activeDoc = await this._getActiveDoc(req);
      await activeDoc.flushDoc();
      // flushDoc terminates once there's no pending operation on the document.
      // There could still be async operations in progress.  We mute their effect,
      // as if they never happened.
      activeDoc.docClients.interruptAllClients();
      activeDoc.setMuted();
      await activeDoc.shutdown();
      await this._docWorkerMap.releaseAssignment(status.docWorker.id, docId);
      res.json(true);
    }));

    // This endpoint cannot use withDoc since it is expected behavior for the ActiveDoc it
    // starts with to become muted.
    this._app.post('/api/docs/:docId/replace', canEdit, throttled(async (req, res) => {
      const docSession = docSessionFromRequest(req);
      const activeDoc = await this._getActiveDoc(req);
      const options: DocReplacementOptions = {};
      if (req.body.sourceDocId) {
        options.sourceDocId = await this._confirmDocIdForRead(req, String(req.body.sourceDocId));
        // Make sure that if we wanted to download the full source, we would be allowed.
        const result = await fetch(this._grist.getHomeUrl(req, `/api/docs/${options.sourceDocId}/download?dryrun=1`), {
          method: 'GET',
          headers: {
            ...getTransitiveHeaders(req),
            'Content-Type': 'application/json',
          }
        });
        if (result.status !== 200) {
          const jsonResult = await result.json();
          throw new ApiError(jsonResult.error, result.status);
        }
        // We should make sure the source document has flushed recently.
        // It may not be served by the same worker, so work through the api.
        await fetch(this._grist.getHomeUrl(req, `/api/docs/${options.sourceDocId}/flush`), {
          method: 'POST',
          headers: {
            ...getTransitiveHeaders(req),
            'Content-Type': 'application/json',
          }
        });
        if (req.body.resetTutorialMetadata) {
          const scope = getDocScope(req);
          const tutorialTrunkId = options.sourceDocId;
          await this._dbManager.connection.transaction(async (manager) => {
            // Fetch the tutorial trunk doc so we can replace the tutorial doc's name.
            const tutorialTrunk = await this._dbManager.getDoc({...scope, urlId: tutorialTrunkId}, manager);
            await this._dbManager.updateDocument(
              scope,
              {
                name: tutorialTrunk.name,
                options: {
                  tutorial: {
                    ...tutorialTrunk.options?.tutorial,
                    // For now, the only state we need to reset is the slide position.
                    lastSlideIndex: 0,
                  },
                },
              },
              manager
            );
          });
          const {forkId} = parseUrlId(scope.urlId);
          activeDoc.logTelemetryEvent(docSession, 'tutorialRestarted', {
            full: {
              tutorialForkIdDigest: forkId,
              tutorialTrunkIdDigest: tutorialTrunkId,
            },
          });
        }
      }
      if (req.body.snapshotId) {
        options.snapshotId = String(req.body.snapshotId);
      }
      await activeDoc.replace(docSession, options);
      res.json(null);
    }));

    this._app.get('/api/docs/:docId/states', canView, withDoc(async (activeDoc, req, res) => {
      const docSession = docSessionFromRequest(req);
      res.json(await this._getStates(docSession, activeDoc));
    }));

    this._app.post('/api/docs/:docId/states/remove', isOwner, withDoc(async (activeDoc, req, res) => {
      const docSession = docSessionFromRequest(req);
      const keep = integerParam(req.body.keep, 'keep');
      res.json(await activeDoc.deleteActions(docSession, keep));
    }));

    this._app.get('/api/docs/:docId/compare/:docId2', canView, withDoc(async (activeDoc, req, res) => {
      const showDetails = isAffirmative(req.query.detail);
      const docSession = docSessionFromRequest(req);
      const {states} = await this._getStates(docSession, activeDoc);
      const ref = await fetch(this._grist.getHomeUrl(req, `/api/docs/${req.params.docId2}/states`), {
        headers: {
          ...getTransitiveHeaders(req),
          'Content-Type': 'application/json',
        }
      });
      const states2: DocState[] = (await ref.json()).states;
      const left = states[0];
      const right = states2[0];
      if (!left || !right) {
        // This should not arise unless there's a bug.
        throw new Error('document with no history');
      }
      const rightHashes = new Set(states2.map(state => state.h));
      const parent = states.find(state => rightHashes.has(state.h )) || null;
      const leftChanged = parent && parent.h !== left.h;
      const rightChanged = parent && parent.h !== right.h;
      const summary = leftChanged ? (rightChanged ? 'both' : 'left') :
        (rightChanged ? 'right' : (parent ? 'same' : 'unrelated'));
      const comparison: DocStateComparison = {
        left, right, parent, summary
      };
      if (showDetails && parent) {
        // Calculate changes from the parent to the current version of this document.
        const leftChanges = (await this._getChanges(docSession, activeDoc, states, parent.h,
                                                    'HEAD')).details!.rightChanges;

        // Calculate changes from the (common) parent to the current version of the other document.
        const url = `/api/docs/${req.params.docId2}/compare?left=${parent.h}`;
        const rightChangesReq = await fetch(this._grist.getHomeUrl(req, url), {
          headers: {
            ...getTransitiveHeaders(req),
            'Content-Type': 'application/json',
          }
        });
        const rightChanges = (await rightChangesReq.json()).details!.rightChanges;

        // Add the left and right changes as details to the result.
        comparison.details = { leftChanges, rightChanges };
      }
      res.json(comparison);
    }));

    // Give details about what changed between two versions of a document.
    this._app.get('/api/docs/:docId/compare', canView, withDoc(async (activeDoc, req, res) => {
      // This could be a relatively slow operation if actions are large.
      const left = stringParam(req.query.left || 'HEAD', 'left');
      const right = stringParam(req.query.right || 'HEAD', 'right');
      const docSession = docSessionFromRequest(req);
      const {states} = await this._getStates(docSession, activeDoc);
      res.json(await this._getChanges(docSession, activeDoc, states, left, right));
    }));

    // Do an import targeted at a specific workspace. Although the URL fits ApiServer, this
    // endpoint is handled only by DocWorker, so is handled here. (Note: this does not handle
    // actual file uploads, so no worries here about large request bodies.)
    this._app.post('/api/workspaces/:wid/import', expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      const userId = getUserId(req);
      const wsId = integerParam(req.params.wid, 'wid');
      const uploadId = integerParam(req.body.uploadId, 'uploadId');
      const result = await this._docManager.importDocToWorkspace(mreq, {
        userId,
        uploadId,
        workspaceId: wsId,
        browserSettings: req.body.browserSettings,
        telemetryMetadata: {
          limited: {
            isImport: true,
            sourceDocIdDigest: undefined,
          },
          full: {
            userId: mreq.userId,
            altSessionId: mreq.altSessionId,
          },
        },
      });
      this._logCreatedFileImportDocTelemetryEvent(req, {
        full: {
          docIdDigest: result.id,
        },
      });
      res.json(result);
    }));

    this._app.get('/api/docs/:docId/download/table-schema', canView, withDoc(async (activeDoc, req, res) => {
      const doc = await this._dbManager.getDoc(req);
      const options = await this._getDownloadOptions(req, doc);
      const tableSchema = await collectTableSchemaInFrictionlessFormat(activeDoc, req, options);
      const apiPath = await this._grist.getResourceUrl(doc, 'api');
      const query = new URLSearchParams(req.query as {[key: string]: string});
      const tableSchemaPath = `${apiPath}/download/csv?${query.toString()}`;
      res.send({
        format: "csv",
        mediatype: "text/csv",
        encoding: "utf-8",
        path: tableSchemaPath,
        dialect: {
          delimiter: ",",
          doubleQuote: true,
        },
        ...tableSchema,
      });
    }));

    this._app.get('/api/docs/:docId/download/csv', canView, withDoc(async (activeDoc, req, res) => {
      const options = await this._getDownloadOptions(req);

      await downloadDSV(activeDoc, req, res, {...options, delimiter: ','});
    }));

    this._app.get('/api/docs/:docId/download/tsv', canView, withDoc(async (activeDoc, req, res) => {
      const options = await this._getDownloadOptions(req);

      await downloadDSV(activeDoc, req, res, {...options, delimiter: '\t'});
    }));

    this._app.get('/api/docs/:docId/download/dsv', canView, withDoc(async (activeDoc, req, res) => {
      const options = await this._getDownloadOptions(req);

      await downloadDSV(activeDoc, req, res, {...options, delimiter: '💩'});
    }));

    this._app.get('/api/docs/:docId/download/xlsx', canView, withDoc(async (activeDoc, req, res) => {
      const options: DownloadOptions = (!_.isEmpty(req.query) && !_.isEqual(Object.keys(req.query), ["title"]))
        ? await this._getDownloadOptions(req)
        : {
        filename: await this._getDownloadFilename(req),
        tableId: '',
        viewSectionId: undefined,
        filters: [],
        sortOrder: [],
        header: 'label'
      };
      await downloadXLSX(activeDoc, req, res, options);
    }));

    this._app.get('/api/docs/:docId/send-to-drive', canView, decodeGoogleToken, withDoc(exportToDrive));

    /**
     * Send a request to the formula assistant to get completions for a formula. Increases the
     * usage of the formula assistant for the billing account in case of success.
     */
    this._app.post('/api/docs/:docId/assistant', canView, checkLimit('assistant'),
      withDoc(async (activeDoc, req, res) => {
        const docSession = docSessionFromRequest(req);
        const request = req.body;
        const result = await sendForCompletion(docSession, activeDoc, request);
        const limit = await this._increaseLimit('assistant', req);
        res.json({
          ...result,
          limit: !limit ? undefined : {
            usage: limit.usage,
            limit: limit.limit,
          },
        });
      })
    );

    /**
     * Create a document.
     *
     * When an upload is included, it is imported as the initial state of the document.
     *
     * When a source document id is included, its structure and (optionally) data is
     * included in the new document.
     *
     * In all other cases, the document is left empty.
     *
     * If a workspace id is included, the document will be saved there instead of
     * being left "unsaved".
     *
     * Returns the id of the created document.
     *
     * TODO: unify this with the other document creation and import endpoints.
     */
    this._app.post('/api/docs', checkAnonymousCreation, expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      const userId = getUserId(req);

      let uploadId: number|undefined;
      let parameters: {[key: string]: any};
      if (req.is('multipart/form-data')) {
        const formResult = await handleOptionalUpload(req, res);
        if (formResult.upload) {
          uploadId = formResult.upload.uploadId;
        }
        parameters = formResult.parameters || {};
      } else {
        parameters = req.body;
      }

      const sourceDocumentId = optStringParam(parameters.sourceDocumentId, 'sourceDocumentId');
      const workspaceId = optIntegerParam(parameters.workspaceId, 'workspaceId');
      const browserSettings: BrowserSettings = {};
      if (parameters.timezone) { browserSettings.timezone = parameters.timezone; }
      browserSettings.locale = localeFromRequest(req);

      let docId: string;
      if (sourceDocumentId !== undefined) {
        docId = await this._copyDocToWorkspace(req, {
          userId,
          sourceDocumentId,
          workspaceId: integerParam(parameters.workspaceId, 'workspaceId'),
          documentName: stringParam(parameters.documentName, 'documentName'),
          asTemplate: optBooleanParam(parameters.asTemplate, 'asTemplate'),
        });
      } else if (uploadId !== undefined) {
        const result = await this._docManager.importDocToWorkspace(mreq, {
          userId,
          uploadId,
          documentName: optStringParam(parameters.documentName, 'documentName'),
          workspaceId,
          browserSettings,
          telemetryMetadata: {
            limited: {
              isImport: true,
              sourceDocIdDigest: undefined,
            },
            full: {
              userId: mreq.userId,
              altSessionId: mreq.altSessionId,
            },
          },
        });
        docId = result.id;
        this._logCreatedFileImportDocTelemetryEvent(req, {
          full: {
            docIdDigest: docId,
          },
        });
      } else if (workspaceId !== undefined) {
        docId = await this._createNewSavedDoc(req, {
          workspaceId: workspaceId,
          documentName: optStringParam(parameters.documentName, 'documentName'),
        });
      } else {
        docId = await this._createNewUnsavedDoc(req, {
          userId,
          browserSettings,
        });
      }

      return res.status(200).json(docId);
    }));

    /**
     * Get the specified view section's form data.
     */
    this._app.get('/api/docs/:docId/forms/:vsId', canView,
      withDoc(async (activeDoc, req, res) => {
        if (!activeDoc.docData) {
          throw new ApiError('DocData not available', 500);
        }

        const sectionId = integerParam(req.params.vsId, 'vsId');
        const docSession = docSessionFromRequest(req);
        const linkId = getDocSessionShare(docSession);
        if (linkId) {
          /* If accessed via a share, the share's `linkId` will be present and
           * we'll need to check that the form is in fact published, and that the
           * share key is associated with the form, before granting access to the
           * form. */
          this._assertIsPublishedForm({
            docData: activeDoc.docData,
            linkId,
            sectionId,
          });
        }

        const Views_section = activeDoc.docData.getMetaTable('_grist_Views_section');
        const section = Views_section.getRecord(sectionId);
        if (!section) {
          throw new ApiError('Form not found', 404, {code: 'FormNotFound'});
        }

        const Views_section_field = activeDoc.docData.getMetaTable('_grist_Views_section_field');
        const Tables_column = activeDoc.docData.getMetaTable('_grist_Tables_column');
        const fields = Views_section_field
          .filterRecords({parentId: sectionId})
          .filter(f => {
            const col = Tables_column.getRecord(f.colRef);
            // Formulas and attachments are currently unsupported.
            return col && !(col.isFormula && col.formula) && col.type !== 'Attachments';
          });

        let {layoutSpec: formLayoutSpec} = section;
        if (!formLayoutSpec) {
          formLayoutSpec = JSON.stringify({
            type: 'Layout',
            children: [
              {type: 'Label'},
              {type: 'Label'},
              {
                type: 'Section',
                children: [
                  {type: 'Label'},
                  {type: 'Label'},
                  ...fields.slice(0, INITIAL_FIELDS_COUNT).map(f => ({
                    type: 'Field',
                    leaf: f.id,
                  })),
                ],
              },
            ],
          });
        }

        // Cache the table reads based on tableId. We are caching only the promise, not the result.
        const table = _.memoize(
          (tableId: string) => readTable(req, activeDoc, tableId, {}, {}).then(r => asRecords(r))
        );

        const getTableValues = async (tableId: string, colId: string) => {
          const records = await table(tableId);
          return records.map(r => [r.id as number, r.fields[colId]] as const);
        };

        const Tables = activeDoc.docData.getMetaTable('_grist_Tables');

        const getRefTableValues = async (col: MetaRowRecord<'_grist_Tables_column'>) => {
          const refId = col.visibleCol;
          if (!refId) { return [] as any; }

          const refCol = Tables_column.getRecord(refId);
          if (!refCol) { return []; }

          const refTable = Tables.getRecord(refCol.parentId);
          if (!refTable) { return []; }

          const refTableId = refTable.tableId as string;
          const refColId = refCol.colId as string;
          if (!refTableId || !refColId) { return () => []; }
          if (typeof refTableId !== 'string' || typeof refColId !== 'string') { return []; }

          const values = await getTableValues(refTableId, refColId);
          return values.filter(([_id, value]) => !isBlankValue(value));
        };

        const formFields = await Promise.all(fields.map(async (field) => {
          const col = Tables_column.getRecord(field.colRef);
          if (!col) { throw new Error(`Column ${field.colRef} not found`); }

          const fieldOptions = safeJsonParse(field.widgetOptions as string, {});
          const colOptions = safeJsonParse(col.widgetOptions as string, {});
          const options = {...colOptions, ...fieldOptions};
          const type = extractTypeFromColType(col.type as string);
          const colId = col.colId as string;

          return [field.id, {
            colId,
            description: fieldOptions.description || col.description,
            question: options.question || col.label || colId,
            options,
            type,
            refValues: isFullReferencingType(col.type) ? await getRefTableValues(col) : null,
          }] as const;
        }));
        const formFieldsById = Object.fromEntries(formFields);

        const getTableName = () => {
          const rawSectionRef = Tables.getRecord(section.tableRef)?.rawViewSectionRef;
          if (!rawSectionRef) { return null; }

          const rawSection = activeDoc.docData!
            .getMetaTable('_grist_Views_section')
            .getRecord(rawSectionRef);
          return rawSection?.title ?? null;
        };

        const formTableId = await getRealTableId(String(section.tableRef), {activeDoc, req});
        const formTitle = section.title || getTableName() || formTableId;

        this._grist.getTelemetry().logEvent(req, 'visitedForm', {
          full: {
            docIdDigest: activeDoc.docName,
            userId: req.userId,
            altSessionId: req.altSessionId,
          },
        });

        res.status(200).json({
          formFieldsById,
          formLayoutSpec,
          formTableId,
          formTitle,
        });
      })
    );
  }

  /**
   * Throws if the specified section is not a published form.
   */
  private _assertIsPublishedForm(params: {
    docData: DocData,
    linkId: string,
    sectionId: number,
  }) {
    const {docData, linkId, sectionId} = params;

    // Check that the request is for a valid section in the document.
    const sections = docData.getMetaTable('_grist_Views_section');
    const section = sections.getRecord(sectionId);
    if (!section) { throw new ApiError('Form not found', 404, {code: 'FormNotFound'}); }

    // Check that the section is for a form.
    const sectionShareOptions = safeJsonParse(section.shareOptions, {});
    if (!sectionShareOptions.form) { throw new ApiError('Form not found', 404, {code: 'FormNotFound'}); }

    // Check that the form is associated with a share.
    const viewId = section.parentId;
    const pages = docData.getMetaTable('_grist_Pages');
    const page = pages.getRecords().find(p => p.viewRef === viewId);
    if (!page) { throw new ApiError('Form not found', 404, {code: 'FormNotFound'}); }

    const shares = docData.getMetaTable('_grist_Shares');
    const share = shares.getRecord(page.shareRef);
    if (!share) { throw new ApiError('Form not found', 404, {code: 'FormNotFound'}); }

    // Check that the share's link id matches the expected link id.
    if (share.linkId !== linkId) { throw new ApiError('Form not found', 404, {code: 'FormNotFound'}); }

    // Finally, check that both the section and share are published.
    if (!sectionShareOptions.publish || !safeJsonParse(share.options, {})?.publish) {
      throw new ApiError('Form not published', 404, {code: 'FormNotPublished'});
    }
  }

  private async _copyDocToWorkspace(req: Request, options: {
    userId: number,
    sourceDocumentId: string,
    workspaceId: number,
    documentName: string,
    asTemplate?: boolean,
  }): Promise<string> {
    const mreq = req as RequestWithLogin;
    const {userId, sourceDocumentId, workspaceId, documentName, asTemplate = false} = options;

    // First, upload a copy of the document.
    let uploadResult;
    try {
      const accessId = makeAccessId(req, getAuthorizedUserId(req));
      uploadResult = await fetchDoc(this._grist, sourceDocumentId, req, accessId, asTemplate);
      globalUploadSet.changeUploadName(uploadResult.uploadId, accessId, `${documentName}.grist`);
    } catch (err) {
      if ((err as ApiError).status === 403) {
        throw new ApiError('Insufficient access to document to copy it entirely', 403);
      }

      throw err;
    }

    // Then, import the copy to the workspace.
    const result = await this._docManager.importDocToWorkspace(mreq, {
      userId,
      uploadId: uploadResult.uploadId,
      documentName,
      workspaceId,
      telemetryMetadata: {
        limited: {
          isImport: false,
          sourceDocIdDigest: sourceDocumentId,
        },
        full: {
          userId: mreq.userId,
          altSessionId: mreq.altSessionId,
        },
      },
    });

    const sourceDocument = await this._dbManager.getRawDocById(sourceDocumentId);
    const isTemplateCopy = sourceDocument.type === 'template';
    if (isTemplateCopy) {
      this._grist.getTelemetry().logEvent(mreq, 'copiedTemplate', {
        full: {
          templateId: parseUrlId(sourceDocument.urlId || sourceDocument.id).trunkId,
          userId: mreq.userId,
          altSessionId: mreq.altSessionId,
        },
      });
    }
    this._grist.getTelemetry().logEvent(
      mreq,
      `createdDoc-${isTemplateCopy ? 'CopyTemplate' : 'CopyDoc'}`,
      {
        full: {
          docIdDigest: result.id,
          userId: mreq.userId,
          altSessionId: mreq.altSessionId,
        },
      }
    );

    return result.id;
  }

  private async _createNewSavedDoc(req: Request, options: {
    workspaceId: number,
    documentName?: string,
  }): Promise<string> {
    const {documentName, workspaceId} = options;
    const {status, data, errMessage} = await this._dbManager.addDocument(getScope(req), workspaceId, {
      name: documentName ?? 'Untitled document',
    });
    const docId = data!;
    if (status !== 200) {
      throw new ApiError(errMessage || 'unable to create document', status);
    }
    this._logDocumentCreatedTelemetryEvent(req, {
      limited: {
        docIdDigest: docId,
        sourceDocIdDigest: undefined,
        isImport: false,
        fileType: undefined,
        isSaved: true,
      },
    });
    this._logCreatedEmptyDocTelemetryEvent(req, {
      full: {
        docIdDigest: docId,
      },
    });
    return docId;
  }

  private async _createNewUnsavedDoc(req: Request, options: {
    userId: number,
    browserSettings?: BrowserSettings,
  }): Promise<string> {
    const {userId, browserSettings} = options;
    const isAnonymous = isAnonymousUser(req);
    const result = makeForkIds({
      userId,
      isAnonymous,
      trunkDocId: NEW_DOCUMENT_CODE,
      trunkUrlId: NEW_DOCUMENT_CODE,
    });
    const docId = result.docId;
    await this._docManager.createNamedDoc(
      makeExceptionalDocSession('nascent', {
        req: req as RequestWithLogin,
        browserSettings,
      }),
      docId
    );
    this._logDocumentCreatedTelemetryEvent(req, {
      limited: {
        docIdDigest: docId,
        sourceDocIdDigest: undefined,
        isImport: false,
        fileType: undefined,
        isSaved: false,
      },
    });
    this._logCreatedEmptyDocTelemetryEvent(req, {
      full: {
        docIdDigest: docId,
      },
    });
    return docId;
  }

  private _logDocumentCreatedTelemetryEvent(req: Request, metadata: TelemetryMetadataByLevel) {
    const mreq = req as RequestWithLogin;
    this._grist.getTelemetry().logEvent(mreq, 'documentCreated', _.merge({
      full: {
        userId: mreq.userId,
        altSessionId: mreq.altSessionId,
      },
    }, metadata));
  }

  private _logCreatedEmptyDocTelemetryEvent(req: Request, metadata: TelemetryMetadataByLevel) {
    this._logCreatedDocTelemetryEvent(req, 'createdDoc-Empty', metadata);
  }

  private _logCreatedFileImportDocTelemetryEvent(req: Request, metadata: TelemetryMetadataByLevel) {
    this._logCreatedDocTelemetryEvent(req, 'createdDoc-FileImport', metadata);
  }

  private _logCreatedDocTelemetryEvent(
    req: Request,
    event: 'createdDoc-Empty' | 'createdDoc-FileImport',
    metadata: TelemetryMetadataByLevel,
  ) {
    const mreq = req as RequestWithLogin;
    this._grist.getTelemetry().logEvent(mreq, event, _.merge({
      full: {
        userId: mreq.userId,
        altSessionId: mreq.altSessionId,
      },
    }, metadata));
  }

  /**
   * Check for read access to the given document, and return its
   * canonical docId.  Throws error if read access not available.
   * This method is used for documents that are not the main document
   * associated with the request, but are rather an extra source to be
   * read from, so the access information is not cached in the
   * request.
   */
  private async _confirmDocIdForRead(req: Request, urlId: string): Promise<string> {
    const docAuth = await makeDocAuthResult(this._dbManager.getDoc({...getScope(req), urlId}));
    if (docAuth.error) { throw docAuth.error; }
    assertAccess('viewers', docAuth);
    return docAuth.docId!;
  }

  private async _getDownloadFilename(req: Request, tableId?: string, optDoc?: Document): Promise<string> {
    let filename = optStringParam(req.query.title, 'title');
    if (!filename) {
      // Query DB for doc metadata to get the doc data.
      const doc = optDoc || await this._dbManager.getDoc(req);
      const docTitle = doc.name;
      const suffix = tableId ? (tableId === docTitle ? '' : `-${tableId}`) : '';
      filename = docTitle + suffix || 'document';
    }
    return filename;
  }

  private async _getDownloadOptions(req: Request, doc?: Document): Promise<DownloadOptions> {
    const params = parseExportParameters(req);
    return {
      ...params,
      filename: await this._getDownloadFilename(req, params.tableId, doc),
    };
  }

  private _getActiveDoc(req: RequestWithLogin): Promise<ActiveDoc> {
    return this._docManager.fetchDoc(docSessionFromRequest(req), getDocId(req));
  }

  private _getActiveDocIfAvailable(req: RequestWithLogin): Promise<ActiveDoc>|undefined {
    return this._docManager.getActiveDoc(getDocId(req));
  }

  /**
   * Middleware to track the number of requests outstanding on each document, and to
   * throw an exception when the maximum number of requests are already outstanding.
   * Also throws an exception if too many requests (based on the user's product plan)
   * have been made today for this document.
   * Access to a document must already have been authorized.
   */
  private _apiThrottle(callback: (req: RequestWithLogin,
                                  resp: Response,
                                  next: NextFunction) => void | Promise<void>): RequestHandler {
    return async (req, res, next) => {
      const docId = getDocId(req);
      try {
        const count = this._currentUsage.get(docId) || 0;
        this._currentUsage.set(docId, count + 1);
        if (count + 1 > MAX_PARALLEL_REQUESTS_PER_DOC) {
          throw new ApiError(`Too many backlogged requests for document ${docId} - ` +
            `try again later?`, 429);
        }

        if (await this._checkDailyDocApiUsage(req, docId)) {
          throw new ApiError(`Exceeded daily limit for document ${docId}`, 429);
        }

        await callback(req as RequestWithLogin, res, next);
      } catch (err) {
        next(err);
      } finally {
        const count = this._currentUsage.get(docId);
        if (count) {
          if (count === 1) {
            this._currentUsage.delete(docId);
          } else {
            this._currentUsage.set(docId, count - 1);
          }
        }
      }
    };
  }

  /**
   * Usually returns true if too many requests (based on the user's product plan)
   * have been made today for this document and the request should be rejected.
   * Access to a document must already have been authorized.
   * This is called frequently so it uses caches to check quickly in the common case,
   * which allows a few ways for users to exceed the limit slightly if the timing works out,
   * but these should be acceptable.
   */
  private async _checkDailyDocApiUsage(req: Request, docId: string): Promise<boolean> {
    // Use the cached doc to avoid a database call.
    // This leaves a small window (currently 5 seconds) for the user to bypass this limit after downgrading,
    // or to be wrongly rejected after upgrading.
    const doc = (req as RequestWithLogin).docAuth!.cachedDoc!;

    const max = doc.workspace.org.billingAccount?.product.features.baseMaxApiUnitsPerDocumentPerDay;
    if (!max) {
      // This doc has no associated product (happens to new unsaved docs)
      // or the product has no API limit. Allow the request through.
      return false;
    }

    // Check the counts in the dailyUsage cache rather than waiting for redis.
    // The cache will not have counts if this is the first request for this document served by this worker process
    // or if so many other documents have been served since then that the keys were evicted from the LRU cache.
    // Both scenarios are temporary and unlikely when usage has been exceeded.
    // Note that if the limits are exceeded then `keys` below will be undefined,
    // otherwise it will be an array of three keys corresponding to a day, hour, and minute.
    const m = moment.utc();
    const keys = getDocApiUsageKeysToIncr(docId, this._dailyUsage, max, m);
    if (!keys) {
      // The limit has been exceeded, reject the request.
      return true;
    }

    // If Redis isn't configured, this is as far as we can go with checks.
    if (!process.env.REDIS_URL) { return false; }

    // Note the increased API usage on redis and in our local cache.
    // Update redis in the background so that the rest of the request can continue without waiting for redis.
    const cli = this._docWorkerMap.getRedisClient();
    if (!cli) { throw new Error('redis unexpectedly not available'); }
    const multi = cli.multi();
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      // Incrementing the local count immediately prevents many requests from being squeezed through every minute
      // before counts are received from redis.
      // But this cache is not 100% reliable and the count from redis may be higher.
      this._dailyUsage.set(key, (this._dailyUsage.get(key) ?? 0) + 1);
      const period = docApiUsagePeriods[i];
      // Expire the key just so that it cleans itself up and saves memory on redis.
      // Expire after two periods to handle 'next' buckets.
      const expiry = 2 * 24 * 60 * 60 / period.periodsPerDay;
      multi.incr(key).expire(key, expiry);
    }
    multi.execAsync().then(result => {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const newCount = Number(result![i * 2]);  // incrs are at even positions, expires at odd positions
        // Theoretically this could be overwritten by a lower count that was requested earlier
        // but somehow arrived after.
        // This doesn't really matter, and the count on redis will still increase reliably.
        this._dailyUsage.set(key, newCount);
      }
    }).catch(e => console.error(`Error tracking API usage for doc ${docId}`, e));

    // Allow the request through.
    return false;
  }

  /**
   * Creates a middleware that checks the current usage of a limit and rejects the request if it is exceeded.
   */
  private async _checkLimit(limit: LimitType, req: Request, res: Response, next: NextFunction) {
    await this._dbManager.increaseUsage(getDocScope(req), limit, {dryRun: true, delta: 1});
    next();
  }

  /**
   * Increases the current usage of a limit by 1.
   */
  private async _increaseLimit(limit: LimitType, req: Request) {
    return await this._dbManager.increaseUsage(getDocScope(req), limit, {delta: 1});
  }

  /**
   * Disallow document creation for anonymous users if GRIST_ANONYMOUS_CREATION is set to false.
   */
  private async _checkAnonymousCreation(req: Request, res: Response, next: NextFunction) {
    const isAnonPlayground = isAffirmative(process.env.GRIST_ANON_PLAYGROUND ?? true);
    if (isAnonymousUser(req) && !isAnonPlayground) {
      throw new ApiError('Anonymous document creation is disabled', 403);
    }
    next();
  }

  private async _assertAccess(role: 'viewers'|'editors'|'owners'|null, allowRemoved: boolean,
                              req: Request, res: Response, next: NextFunction) {
    const scope = getDocScope(req);
    allowRemoved = scope.showAll || scope.showRemoved || allowRemoved;
    const docAuth = await getOrSetDocAuth(req as RequestWithLogin, this._dbManager, this._grist, scope.urlId);
    if (role) { assertAccess(role, docAuth, {allowRemoved}); }
    next();
  }

  /**
   * Check if user is an owner of the document.
   * If acceptTrunkForSnapshot is set, being an owner of the trunk of the document (if it is a snapshot)
   * is sufficient. Uses cachedDoc, which could be stale if access has changed recently.
   */
  private async _isOwner(req: Request, options?: { acceptTrunkForSnapshot?: boolean }) {
    const scope = getDocScope(req);
    const docAuth = await getOrSetDocAuth(req as RequestWithLogin, this._dbManager, this._grist, scope.urlId);
    if (docAuth.access === 'owners') {
      return true;
    }
    if (options?.acceptTrunkForSnapshot && docAuth.cachedDoc?.trunkAccess === 'owners') {
      const parts = parseUrlId(scope.urlId);
      if (parts.snapshotId) { return true; }
    }
    return false;
  }

  // Helper to generate a 503 if the ActiveDoc has been muted.
  private _checkForMute(activeDoc: ActiveDoc|undefined) {
    if (activeDoc && activeDoc.muted) {
      throw new ApiError('Document in flux - try again later', 503);
    }
  }

  /**
   * Throws an error if, during processing, the ActiveDoc becomes "muted".  Also replaces any
   * other error that may have occurred if the ActiveDoc becomes "muted", since the document
   * shutting down during processing may have caused a variety of errors.
   *
   * Expects to be called within a handler that catches exceptions.
   */
  private _requireActiveDoc(callback: WithDocHandler): RequestHandler {
    return async (req, res) => {
      let activeDoc: ActiveDoc|undefined;
      try {
        activeDoc = await this._getActiveDoc(req as RequestWithLogin);
        await callback(activeDoc, req as RequestWithLogin, res);
        if (!res.headersSent) { this._checkForMute(activeDoc); }
      } catch (err) {
        this._checkForMute(activeDoc);
        throw err;
      }
    };
  }

  private async _getStates(docSession: OptDocSession, activeDoc: ActiveDoc): Promise<DocStates> {
    const states = await activeDoc.getRecentStates(docSession);
    return {
      states,
    };
  }

  /**
   *
   * Calculate changes between two document versions identified by leftHash and rightHash.
   * If rightHash is the latest version of the document, the ActionSummary for it will
   * contain a copy of updated and added rows.
   *
   * Currently will fail if leftHash is not an ancestor of rightHash (this restriction could
   * be lifted, but is adequate for now).
   *
   */
  private async _getChanges(docSession: OptDocSession, activeDoc: ActiveDoc, states: DocState[],
                            leftHash: string, rightHash: string): Promise<DocStateComparison> {
    const finder = new HashUtil(states);
    const leftOffset = finder.hashToOffset(leftHash);
    const rightOffset = finder.hashToOffset(rightHash);
    if (rightOffset > leftOffset) {
      throw new Error('Comparisons currently require left to be an ancestor of right');
    }
    const actionNums: number[] = states.slice(rightOffset, leftOffset).map(state => state.n);
    const actions = (await activeDoc.getActions(actionNums)).reverse();
    let totalAction = createEmptyActionSummary();
    for (const action of actions) {
      if (!action) { continue; }
      const summary = summarizeAction(action);
      totalAction = concatenateSummaries([totalAction, summary]);
    }
    const result: DocStateComparison = {
      left: states[leftOffset],
      right: states[rightOffset],
      parent: states[leftOffset],
      summary: (leftOffset === rightOffset) ? 'same' : 'right',
      details: {
        leftChanges: {tableRenames: [], tableDeltas: {}},
        rightChanges: totalAction
      }
    };
    return result;
  }

  private async _removeDoc(req: Request, res: Response, permanent: boolean) {
    const mreq = req as RequestWithLogin;
    const scope = getDocScope(req);
    const docId = getDocId(req);
    if (permanent) {
      const {forkId} = parseUrlId(docId);
      if (!forkId) {
        // Soft delete the doc first, to de-list the document.
        await this._dbManager.softDeleteDocument(scope);
      }
      // Delete document content from storage. Include forks if doc is a trunk.
      const forks = forkId ? [] : await this._dbManager.getDocForks(docId);
      const docsToDelete = [
        docId,
        ...forks.map((fork) =>
          buildUrlId({forkId: fork.id, forkUserId: fork.createdBy!, trunkId: docId})),
      ];
      await Promise.all(docsToDelete.map(docName => this._docManager.deleteDoc(null, docName, true)));
      // Permanently delete from database.
      const query = await this._dbManager.deleteDocument(scope);
      this._dbManager.checkQueryResult(query);
      this._grist.getTelemetry().logEvent(mreq, 'deletedDoc', {
        full: {
          docIdDigest: docId,
          userId: mreq.userId,
          altSessionId: mreq.altSessionId,
        },
      });
      await sendReply(req, res, query);
    } else {
      await this._dbManager.softDeleteDocument(scope);
      await sendOkReply(req, res);
    }
    await this._dbManager.flushSingleDocAuthCache(scope, docId);
    await this._docManager.interruptDocClients(docId);
  }

  private async _runSql(activeDoc: ActiveDoc, req: RequestWithLogin, res: Response,
      options: Types.SqlPost) {
    if (!await activeDoc.canCopyEverything(docSessionFromRequest(req))) {
      throw new ApiError('insufficient document access', 403);
    }
    const statement = options.sql;
    // A very loose test, just for early error message
    if (!(statement.toLowerCase().includes('select'))) {
      throw new ApiError('only select statements are supported', 400);
    }
    const sqlOptions = activeDoc.docStorage.getOptions();
    if (!sqlOptions?.canInterrupt || !sqlOptions?.bindableMethodsProcessOneStatement) {
      throw new ApiError('The available SQLite wrapper is not adequate', 500);
    }
    const timeout =
        Math.max(0, Math.min(MAX_CUSTOM_SQL_MSEC,
                             optIntegerParam(options.timeout, 'timeout') || MAX_CUSTOM_SQL_MSEC));
    // Wrap in a select to commit to the SELECT branch of SQLite
    // grammar. Note ; isn't a problem.
    //
    // The underlying SQLite functions used will only process the
    // first statement in the supplied text. For node-sqlite3, the
    // remainder is placed in a "tail string" ignored by that library.
    // So a Robert'); DROP TABLE Students;-- style attack isn't applicable.
    //
    // Since Grist is used with multiple SQLite wrappers, not just
    // node-sqlite3, we have added a bindableMethodsProcessOneStatement
    // flag that will need adding for each wrapper, and this endpoint
    // will not operate unless that flag is set to true.
    //
    // The text is wrapped in select * from (USER SUPPLIED TEXT) which
    // puts SQLite unconditionally onto the SELECT branch of its
    // grammar. It is straightforward to break out of such a wrapper
    // with multiple statements, but again, only the first statement
    // is processed.
    const wrappedStatement = `select * from (${statement})`;
    const interrupt = setTimeout(async () => {
      await activeDoc.docStorage.interrupt();
    }, timeout);
    try {
      const records = await activeDoc.docStorage.all(wrappedStatement,
                                                     ...(options.args || []));
      res.status(200).json({
        statement,
        records: records.map(
          rec => ({
            fields: rec,
          })
        ),
      });
    } catch (e) {
      if (e?.code === 'SQLITE_INTERRUPT') {
        res.status(400).json({
          error: "a slow statement resulted in a database interrupt",
        });
      } else if (e?.code === 'SQLITE_ERROR') {
        res.status(400).json({
          error: e?.message,
        });
      } else {
        throw e;
      }
    } finally {
      clearTimeout(interrupt);
    }
  }
}

export function addDocApiRoutes(
  app: Application, docWorker: DocWorker, docWorkerMap: IDocWorkerMap, docManager: DocManager, dbManager: HomeDBManager,
  grist: GristServer
) {
  const api = new DocWorkerApi(app, docWorker, docWorkerMap, docManager, dbManager, grist);
  api.addEndpoints();
}

/**
 * Options for returning results from a query about document data.
 * Currently these option don't affect the query itself, only the
 * results returned to the user.
 */
export interface QueryParameters {
  sort?: string[];  // Columns names to sort by (ascending order by default,
                    // prepend "-" for descending order, can contain flags,
                    // see more in Sort.SortSpec).
  limit?: number;   // Limit on number of rows to return.
}


/**
 * Extract a sort parameter from a request, if present.  Follows
 * https://jsonapi.org/format/#fetching-sorting for want of a better
 * standard - comma separated, defaulting to ascending order, keys
 * prefixed by "-" for descending order.
 *
 * The sort parameter can either be given as a query parameter, or
 * as a header.
 */
function getSortParameter(req: Request): string[]|undefined {
  const sortString: string|undefined = optStringParam(req.query.sort, 'sort') || req.get('X-Sort');
  if (!sortString) { return undefined; }
  return sortString.split(',');
}

/**
 * Extract a limit parameter from a request, if present.  Should be a
 * simple integer.  The limit parameter can either be given as a query
 * parameter, or as a header.
 */
function getLimitParameter(req: Request): number|undefined {
  const limitString: string|undefined = optStringParam(req.query.limit, 'limit') || req.get('X-Limit');
  if (!limitString) { return undefined; }
  const limit = parseInt(limitString, 10);
  if (isNaN(limit)) { throw new Error('limit is not a number'); }
  return limit;
}

/**
 * Extract sort and limit parameters from request, if they are present.
 */
function getQueryParameters(req: Request): QueryParameters {
  return {
    sort: getSortParameter(req),
    limit: getLimitParameter(req),
  };
}

/**
 * Sort table contents being returned.  Sort keys with a '-' prefix
 * are sorted in descending order, otherwise ascending.  Contents are
 * modified in place. Sort keys can contain sort options.
 * Columns can be either expressed as a colId (name string) or as colRef (rowId number).
 */
function applySort(
  values: TableColValues,
  sort: string[],
  _columns: TableRecordValue[]|null = null) {
  if (!sort) { return values; }

  // First we need to prepare column description in ColValue format (plain objects).
  // This format is used by ServerColumnGetters.
  let properColumns: ColValues[] = [];

  // We will receive columns information only for user tables, not for metatables. So
  // if this is the case, we will infer them from the result.
  if (!_columns) {
    _columns = Object.keys(values).map((col, index) => ({ id: col, fields: { colRef: index }}));
  }
  // For user tables, we will not get id column (as this column is not in the schema), so we need to
  // make sure the column is there.
  else {
    // This is enough information for ServerGetters
    _columns = [..._columns, { id : 'id', fields: {colRef: 0 }}];
  }

  // Once we have proper columns, we can convert them to format that ServerColumnGetters
  // understand.
  properColumns = _columns.map(c => ({
    ...c.fields,
    id : c.fields.colRef,
    colId: c.id
  }));

  // We will sort row indices in the values object, not rows ids.
  const rowIndices = values.id.map((__, i) => i);
  const getters = new ServerColumnGetters(rowIndices, values, properColumns);
  const sortFunc = new SortFunc(getters);
  const colIdToRef = new Map(properColumns.map(({id, colId}) => [colId as string, id as number]));
  sortFunc.updateSpec(Sort.parseNames(sort, colIdToRef));
  rowIndices.sort(sortFunc.compare.bind(sortFunc));

  // Sort resulting values according to the sorted index.
  for (const key of Object.keys(values)) {
    const col = values[key];
    values[key] = rowIndices.map(i => col[i]);
  }
  return values;
}

/**
 * Truncate columns to the first N values.  Columns are modified in place.
 */
function applyLimit(values: TableColValues, limit: number) {
  // for no limit, or 0 limit, do not apply any restriction
  if (!limit) { return values; }
  for (const key of Object.keys(values)) {
    values[key].splice(limit);
  }
  return values;
}

/**
 * Apply query parameters to table contents.  Contents are modified in place.
 */
export function applyQueryParameters(
  values: TableColValues,
  params: QueryParameters,
  columns: TableRecordValue[]|null = null): TableColValues {
  if (params.sort) { applySort(values, params.sort, columns); }
  if (params.limit) { applyLimit(values, params.limit); }
  return values;
}

function getErrorPlatform(tableId: string): TableOperationsPlatform {
  return {
    async getTableId() { return tableId; },
    throwError(verb, text, status) {
      throw new ApiError(verb + (verb ? ' ' : '') + text, status);
    },
    applyUserActions() {
      throw new Error('no document');
    }
  };
}

export async function getMetaTables(activeDoc: ActiveDoc, req: RequestWithLogin) {
  return await handleSandboxError("", [],
    activeDoc.fetchMetaTables(docSessionFromRequest(req)));
}

async function getTableOperations(
  req: RequestWithLogin,
  activeDoc: ActiveDoc,
  tableId?: string): Promise<TableOperationsImpl> {
  const options: OpOptions = {
    parseStrings: !isAffirmative(req.query.noparse)
  };
  const realTableId = await getRealTableId(tableId ?? req.params.tableId, {activeDoc, req});
  const platform: TableOperationsPlatform = {
    ...getErrorPlatform(realTableId),
    applyUserActions(actions, opts) {
      if (!activeDoc) { throw new Error('no document'); }
      return activeDoc.applyUserActions(
        docSessionFromRequest(req),
        actions,
        opts
      );
    }
  };
  return new TableOperationsImpl(platform, options);
}

async function handleSandboxError<T>(tableId: string, colNames: string[], p: Promise<T>): Promise<T> {
  return handleSandboxErrorOnPlatform(tableId, colNames, p, getErrorPlatform(tableId));
}

export interface DocApiUsagePeriod {
  unit: 'day' | 'hour' | 'minute',
  format: string;
  periodsPerDay: number;
}

export const docApiUsagePeriods: DocApiUsagePeriod[] = [
  {
    unit: 'day',
    format: 'YYYY-MM-DD',
    periodsPerDay: 1,
  },
  {
    unit: 'hour',
    format: 'YYYY-MM-DDTHH',
    periodsPerDay: 24,
  },
  {
    unit: 'minute',
    format: 'YYYY-MM-DDTHH:mm',
    periodsPerDay: 24 * 60,
  },
];

/**
 * Returns a key used for redis and a local cache
 * which store the number of API requests made for the given document in the given period.
 * The key contains the current UTC date (and maybe hour and minute)
 * so that counts from previous periods are simply ignored and eventually evicted.
 * This means that the daily measured usage conceptually 'resets' at UTC midnight.
 * If `current` is false, returns a key for the next day/hour.
 */
export function docPeriodicApiUsageKey(docId: string, current: boolean, period: DocApiUsagePeriod, m: moment.Moment) {
  if (!current) {
    m = m.clone().add(1, period.unit);
  }
  return `doc-${docId}-periodicApiUsage-${m.format(period.format)}`;
}

/**
 * Checks whether the doc API usage fits within the daily maximum.
 * If so, returns an array of keys for each unit of time whose usage should be incremented.
 * If not, returns undefined.
 *
 * Description of the algorithm this is implementing:
 *
 * Maintain up to 5 buckets: current day, next day, current hour, next hour, current minute.
 * For each API request, check in order:
 * - if current_day < DAILY_LIMIT, allow; increment all 3 current buckets
 * - else if current_hour < DAILY_LIMIT/24, allow; increment next_day, current_hour, and current_minute buckets.
 * - else if current_minute < DAILY_LIMIT/24/60, allow; increment next_day, next_hour, and current_minute buckets.
 * - else reject.
 * I think it has pretty good properties:
 * - steady low usage may be maintained even if a burst exhausted the daily limit
 * - user could get close to twice the daily limit on the first day with steady usage after a burst,
 *   but would then be limited to steady usage the next day.
 */
export function getDocApiUsageKeysToIncr(
  docId: string, usage: LRUCache<string, number>, dailyMax: number, m: moment.Moment
): string[] | undefined {
  // Start with keys for the current day, minute, and hour
  const keys = docApiUsagePeriods.map(p => docPeriodicApiUsageKey(docId, true, p, m));
  for (let i = 0; i < docApiUsagePeriods.length; i++) {
    const period = docApiUsagePeriods[i];
    const key = keys[i];
    const periodMax = Math.ceil(dailyMax / period.periodsPerDay);
    const count = usage.get(key) || 0;
    if (count < periodMax) {
      return keys;
    }
    // Allocation for the current day/hour/minute has been exceeded, increment the next day/hour/minute instead.
    keys[i] = docPeriodicApiUsageKey(docId, false, period, m);
  }
  // Usage exceeded all the time buckets, so return undefined to reject the request.
}

export interface WebhookSubscription {
  unsubscribeKey: string;
  webhookId: string;
}

/**
 * Converts `activeDoc` to XLSX and sends the converted data through `res`.
 */
export async function downloadXLSX(activeDoc: ActiveDoc, req: Request,
                                   res: Response, options: DownloadOptions) {
  const {filename} = options;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', contentDisposition(filename + '.xlsx'));
  return streamXLSX(activeDoc, req, res, options);
}
