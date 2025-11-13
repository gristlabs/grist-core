import { ALL_PERMISSION_PROPS } from 'app/common/ACLPermissions';
import { ACLRuleCollection, SPECIAL_RULES_TABLE_ID } from 'app/common/ACLRuleCollection';
import { ActionGroup } from 'app/common/ActionGroup';
import { createEmptyActionSummary } from 'app/common/ActionSummary';
import { ApplyUAExtendedOptions, ServerQuery } from 'app/common/ActiveDocAPI';
import { ApiError } from 'app/common/ApiError';
import { MapWithTTL } from 'app/common/AsyncCreate';
import { AttachmentColumns, gatherAttachmentIds, getAttachmentColumns } from 'app/common/AttachmentColumns';
import {
  BulkAddRecord,
  BulkColValues,
  BulkRemoveRecord,
  BulkUpdateRecord,
  DataAction,
  getColValues,
  getRowIdsFromDocAction,
  isBulkAction,
  isDataAction,
  isSomeAddRecordAction,
  isSomeRemoveRecordAction,
} from 'app/common/DocActions';
import { CellValue, ColValues, DocAction, getTableId, isSchemaAction } from 'app/common/DocActions';
import { getColIdsFromDocAction, TableDataAction, UserAction } from 'app/common/DocActions';
import { DocComment, getMentions, makeDocComment } from 'app/common/DocComments';
import { DocData } from 'app/common/DocData';
import { UserOverride } from 'app/common/DocListAPI';
import { DocUsageSummary, FilteredDocUsageSummary, UsageRecommendations } from 'app/common/DocUsage';
import { normalizeEmail } from 'app/common/emails';
import { ErrorWithCode } from 'app/common/ErrorWithCode';
import { InfoEditor } from 'app/common/GranularAccessClause';
import * as gristTypes from 'app/common/gristTypes';
import { getSetMapValue, isNonNullish, pruneArray } from 'app/common/gutil';
import { isMetadataTable } from 'app/common/isHiddenTable';
import { compilePredicateFormula, PredicateFormulaInput } from 'app/common/PredicateFormula';
import { SingleCell } from 'app/common/TableData';
import { EmptyRecordView, InfoView, RecordView } from 'app/common/RecordView';
import { canEdit, canView, isValidRole, Role } from 'app/common/roles';
import { User } from 'app/common/User';
import { FullUser, UserAccessData } from 'app/common/UserAPI';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { GristObjCode } from 'app/plugin/GristData';
import { appSettings } from 'app/server/lib/AppSettings';
import { applyAndCheckActionsForCells, CellData, isCellDataAction } from 'app/server/lib/CellDataAccess';
import { describeDocActions, DocActionsDescription } from 'app/server/lib/describeDocActions';
import { DocAuthorizer, DummyAuthorizer } from 'app/server/lib/DocAuthorizer';
import { DocClients } from 'app/server/lib/DocClients';
import { OptDocSession } from 'app/server/lib/DocSession';
import { DocStorage, REMOVE_UNUSED_ATTACHMENTS_DELAY } from 'app/server/lib/DocStorage';
import log from 'app/server/lib/log';
import { IPermissionInfo, MixedPermissionSetWithContext,
         PermissionInfo, PermissionSetWithContext } from 'app/server/lib/PermissionInfo';
import { TablePermissionSetWithContext } from 'app/server/lib/PermissionInfo';
import { integerParam } from 'app/server/lib/requestUtils';
import { getRelatedRows } from 'app/server/lib/RowAccess';
import { getDocSessionAccess, getDocSessionShare } from 'app/server/lib/sessionUtils';
import { quoteIdent } from 'app/server/lib/SQLiteDB';
import cloneDeep = require('lodash/cloneDeep');
import fromPairs = require('lodash/fromPairs');
import get = require('lodash/get');
import memoize = require('lodash/memoize');
import { getConfiguredStandardAttachmentStore } from 'app/server/lib/AttachmentStoreProvider';

/**
 * A threshold beyond which for this installation it would be
 * better to use external attachments (if available).
 */
const GRIST_ATTACHMENTS_THRESHOLD_MB = appSettings.section("attachmentStores").flag("threshold").requireFloat({
  envVar: "GRIST_ATTACHMENTS_THRESHOLD_MB",
  defaultValue: 50,
});

// tslint:disable:no-bitwise

// Check if a tableId is that of an ACL table.  Currently just _grist_ACLRules and
// _grist_ACLResources are accepted.
function isAclTable(tableId: string): boolean {
  return ['_grist_ACLRules', '_grist_ACLResources'].includes(tableId);
}

const ADD_OR_UPDATE_RECORD_ACTIONS = ['AddOrUpdateRecord', 'BulkAddOrUpdateRecord'];

function isAddOrUpdateRecordAction([actionName]: UserAction): boolean {
  return ADD_OR_UPDATE_RECORD_ACTIONS.includes(String(actionName));
}

// A list of key metadata tables that need special handling.  Other metadata tables may
// refer to material in some of these tables but don't need special handling.
// TODO: there are other metadata tables that would need access control, or redesign -
// specifically _grist_Attachments.
const STRUCTURAL_TABLES = new Set(['_grist_Tables', '_grist_Tables_column', '_grist_Views',
                                   '_grist_Views_section', '_grist_Views_section_field',
                                   '_grist_ACLResources', '_grist_ACLRules',
                                   '_grist_Shares', '_grist_Pages']);

// Actions that won't be allowed (yet) for a user with nuanced access to a document.
// A few may be innocuous, but that hasn't been figured out yet.
const SPECIAL_ACTIONS = new Set(['InitNewDoc',
                                 'EvalCode',
                                 'UpdateSummaryViewSection',
                                 'DetachSummaryViewSection',
                                 'GenImporterView',
                                 'MakeImportTransformColumns',
                                 'FillTransformRuleColIds',
                                 'TransformAndFinishImport',
                                 'AddView',
                                 'AddHiddenColumn',
                                 'RespondToRequests',
                                ]);

// Odd-ball actions marked as deprecated or which seem unlikely to be used.
const SURPRISING_ACTIONS = new Set([
                                    'RemoveView',
                                    'AddViewSection',
                                   ]);

// Actions we'll allow unconditionally for now.
const OK_ACTIONS = new Set(['Calculate', 'UpdateCurrentTime']);

// Other actions that are believed to be compatible with granular access.
// Only add an action to OTHER_RECOGNIZED_ACTIONS if you know access control
// has been handled for it, or it is clear that access control can be done
// by looking at the Create/Update/Delete permissions for the DocActions it
// will create.
const OTHER_RECOGNIZED_ACTIONS = new Set([
  // Data actions.
  'AddRecord',
  'BulkAddRecord',
  'UpdateRecord',
  'BulkUpdateRecord',
  'RemoveRecord',
  'BulkRemoveRecord',
  'ReplaceTableData',

  // Data actions handled specially because of read needs.
  'AddOrUpdateRecord',
  'BulkAddOrUpdateRecord',

  // Certain column actions are handled specially because of reads that
  // don't fit the pattern of data actions.
  'ConvertFromColumn',
  'CopyFromColumn',

  // Groups of actions.
  'ApplyDocActions',
  'ApplyUndoActions',

  // Column-level schema changes.
  'AddColumn',
  'AddVisibleColumn',
  'RemoveColumn',
  'RenameColumn',
  'ModifyColumn',
  'AddReverseColumn',

  // Table-level schema changes.
  'AddEmptyTable',
  'AddTable',
  'AddRawTable',
  'RemoveTable',
  'RenameTable',

  // A schema action handled specially because of read needs.
  'DuplicateTable',

  // Display column support.
  'SetDisplayFormula',
  'MaybeCopyDisplayFormula',

  // Sundry misc.
  'RenameChoices',
  'AddEmptyRule',
  'CreateViewSection',
  'RemoveViewSection',
]);

// When an attachment is uploaded, it isn't immediately added to a cell in
// the document. We grant the uploader a special period where they can freely
// add or re-add the attachment to the document without access control fuss.
// We keep that period within the time range where an unused attachment
// would get deleted.
const UPLOADED_ATTACHMENT_OWNERSHIP_PERIOD =
  (REMOVE_UNUSED_ATTACHMENTS_DELAY.delayMs - REMOVE_UNUSED_ATTACHMENTS_DELAY.varianceMs) / 2;

// When a user undoes their own action or actions, checks of attachment ownership
// are handled specially. This special handling will not apply for undoes of actions
// older than this limit.
const HISTORICAL_ATTACHMENT_OWNERSHIP_PERIOD = 24 * 60 * 60 * 1000;

// Transform columns are special. In case we have some rules defined they are only visible
// to those with SCHEMA_EDIT permission.
const TRANSFORM_COLUMN_PREFIXES = ['gristHelper_Converted', 'gristHelper_Transform'];

/**
 * Checks if this is a special helper column used during type conversion.
 */
function isTransformColumn(colId: string): boolean {
  return TRANSFORM_COLUMN_PREFIXES.some(prefix => colId.startsWith(prefix));
}

interface DocUpdateMessage {
  actionGroup: ActionGroup;
  docActions: DocAction[];
  docUsage: DocUsageSummary;
}

/**
 * Granular access for a single bundle, in different phases.
 */
export interface GranularAccessForBundle {
  canApplyBundle(): Promise<void>;
  appliedBundle(): Promise<void>;
  finishedBundle(): Promise<void>;
  sendDocUpdateForBundle(actionGroup: ActionGroup, docUsage: DocUsageSummary): Promise<void>;

  // Null means that there are no changes to tables. Empty list means that there are some changes
  // but no user tables to list. We still deliver notification for empty list, it is just empty
  // informing that something has changed.
  getDirectTablesInBundle(userData: UserAccessData): Promise<DocActionsDescription|null>;
  hasCommentsInBundle(): boolean;
  getCommentsInBundle(userToFilterFor?: UserAccessData): Promise<DocComment[]>;
}

/**
 *
 * Manage granular access to a document.  This allows nuances other than the coarse
 * owners/editors/viewers distinctions.  Nuances are stored in the _grist_ACLResources
 * and _grist_ACLRules tables.
 *
 * When the document is being modified, the object's GranularAccess is called at various
 * steps of the process to check access rights.  The GranularAccess object stores some
 * state for an in-progress modification, to allow some caching of calculations across
 * steps and clients.  We expect modifications to be serialized, and the following
 * pattern of calls for modifications:
 *
 *  - assertCanMaybeApplyUserActions(), called with UserActions for an initial access check.
 *    Since not all checks can be done without analyzing UserActions into DocActions,
 *    it is ok for this call to pass even if a more definitive test later will fail.
 *  - getGranularAccessForBundle(), called once a possible bundle has been prepared
 *    (the UserAction has been compiled to DocActions).
 *  - canApplyBundle(), called when DocActions have been produced from UserActions,
 *    but before those DocActions have been applied to the DB.  If fails, the modification
 *    will be abandoned. This method will also finalize some bundle state,
 *    specifically the `maybeHasShareChanges` flag.
 *  - appliedBundle(), called when DocActions have been applied to the DB, but before
 *    those changes have been sent to clients.
 *  - sendDocUpdateForBundle() is called once a bundle has been applied, to notify
 *    client of changes.
 *  - finishedBundle(), called when completely done with modification and any needed
 *    client notifications, whether successful or failed.
 *
 *
 */
export class GranularAccess implements GranularAccessForBundle {
  // The collection of all rules.
  private _ruler = new Ruler(this);

  // Cache of user attributes associated with the given docSession. It's a WeakMap, to allow
  // garbage-collection once docSession is no longer in use.
  private _userAttributesMap = new WeakMap<OptDocSession, UserAttributes>();
  private _prevUserAttributesMap: WeakMap<OptDocSession, UserAttributes>|undefined;
  private _attachmentUploads = new MapWithTTL<number, string>(UPLOADED_ATTACHMENT_OWNERSHIP_PERIOD);

  // When broadcasting a sequence of DocAction[]s, this contains the state of
  // affected rows for the relevant table before and after each DocAction.  It
  // may contain some unaffected rows as well.
  private _steps: Promise<ActionStep[]>|null = null;
  // Intermediate metadata and rule state, if needed.
  private _metaSteps: Promise<MetaStep[]>|null = null;
  // Access control is done sequentially, bundle by bundle.  This is the current bundle.
  private _activeBundle: {
    docSession: OptDocSession,
    userActions: UserAction[],
    docActions: DocAction[],
    isDirect: boolean[],
    undo: DocAction[],
    // Flag tracking whether a set of actions have been applied to the database or not.
    applied: boolean,
    // Flag for whether user actions mention a rule change (clients are asked to reload
    // in this case).
    hasDeliberateRuleChange: boolean,
    // Flag for whether doc actions mention a rule change, even if passive due to
    // schema changes.
    hasAnyRuleChange: boolean,
    maybeHasShareChanges: boolean,
    options: ApplyUAExtendedOptions|null,
    shareRef?: number;
  }|null;

  public constructor(
    private _docData: DocData,
    private _docStorage: DocStorage,
    private _docClients: DocClients,
    private _fetchQueryFromDB: (query: ServerQuery) => Promise<TableDataAction>,
    private _recoveryMode: boolean,
    private _homeDbManager: HomeDBManager | null,
    private _docId: string) {
  }

  public async close() {
    this._attachmentUploads.clear();
  }

  public getGranularAccessForBundle(docSession: OptDocSession, docActions: DocAction[], undo: DocAction[],
                                    userActions: UserAction[], isDirect: boolean[],
                                    options: ApplyUAExtendedOptions|null): void {
    if (this._activeBundle) { throw new Error('Cannot start a bundle while one is already in progress'); }
    // This should never happen - attempts to write to a pre-fork session should be
    // caught by an Authorizer.  But let's be paranoid, since we may be pretending to
    // be an owner for granular access purposes, and owners can write if we're not
    // careful!
    if (docSession.forkingAsOwner) { throw new Error('Should never modify a prefork'); }
    this._activeBundle = {
      docSession, docActions, undo, userActions, isDirect,
      applied: false, hasDeliberateRuleChange: false, hasAnyRuleChange: false,
      maybeHasShareChanges: false,
      options,
    };
    this._activeBundle.hasDeliberateRuleChange =
      scanActionsRecursively(userActions, (a) => isAclTable(String(a[1])));
    this._activeBundle.hasAnyRuleChange =
      scanActionsRecursively(docActions, a => actionHasRuleChange(a));
  }

  /**
   * Update granular access from DocData.
   */
  public async update() {
    await this._ruler.update(this._docData);

    // Also clear the per-docSession cache of user attributes.
    this._userAttributesMap = new WeakMap();
  }

  /**
   * Construct the UserInfo needed for evaluating rules. This also enriches the user with values
   * created by user-attribute rules.
   */
  public async getUser(docSession: OptDocSession): Promise<User> {
    const linkParameters = docSession.linkParameters || {};
    let access: Role | null;
    let fullUser: FullUser | null;
    const attrs = this._getUserAttributes(docSession);
    access = getDocSessionAccess(docSession);

    const linkId = getDocSessionShare(docSession);
    let shareRef: number = 0;
    if (linkId) {
      const rowIds = this._docData.getMetaTable('_grist_Shares').filterRowIds({
        linkId,
      });
      if (rowIds.length > 1) {
        throw new Error('Share identifier is not unique');
      }
      if (rowIds.length === 1) {
        shareRef = rowIds[0];
      }
    }

    if (docSession.forkingAsOwner) {
      // For granular access purposes, we become an owner.
      // It is a bit of a bluff, done on the understanding that this session will
      // never be used to edit the document, and that any edits will be done on a
      // fork.
      access = 'owners';
    }

    // If aclAsUserId/aclAsUser is set, then override user for acl purposes.
    if (linkParameters.aclAsUserId || linkParameters.aclAsUser) {
      if (access !== 'owners') { throw new ErrorWithCode('ACL_DENY', 'only an owner can override user'); }
      // Use cached overrides, or cache them on first use.
      const override = attrs.override || (attrs.override = await this._getViewAsUser(linkParameters));
      access = override.access;
      fullUser = override.user;
    } else if (linkId) {
      // Anonymize user info for form submissions.
      // Note: This is half-baked and doesn't account for other types of shares besides forms.
      fullUser = this._homeDbManager?.makeFullUser(this._homeDbManager.getAnonymousUser()) ?? null;
    } else {
      fullUser = docSession.fullUser;
    }
    const user = new User();
    user.Access = access;
    user.ShareRef = shareRef || null;
    const isAnonymous = fullUser?.id === this._homeDbManager?.getAnonymousUserId() ||
      fullUser?.id === null;
    user.UserID = (!isAnonymous && fullUser?.id) || null;
    user.Email = fullUser?.email || null;
    user.Name = fullUser?.name || null;
    // If viewed from a websocket, collect any link parameters included.
    // TODO: could also get this from rest api access, just via a different route.
    user.LinkKey = linkParameters;
    // Include origin info if accessed via the rest api.
    // TODO: could also get this for websocket access, just via a different route.
    user.Origin = docSession.req?.get('origin') || null;
    user.SessionID = isAnonymous ? `a${docSession.altSessionId}` : `u${user.UserID}`;
    user.IsLoggedIn = !isAnonymous;
    user.UserRef = fullUser?.ref || null; // Empty string should be treated as null.

    if (this._ruler.ruleCollection.ruleError && !this._recoveryMode) {
      // It is important to signal that the doc is in an unexpected state,
      // and prevent it opening.
      throw this._ruler.ruleCollection.ruleError;
    }

    for (const clause of this._ruler.ruleCollection.getUserAttributeRules().values()) {
      if (clause.name in user) {
        log.warn(`User attribute ${clause.name} ignored; conflicts with an existing one`);
        continue;
      }
      if (attrs.rows[clause.name]) {
        user[clause.name] = attrs.rows[clause.name];
        continue;
      }
      let rec = new EmptyRecordView();
      let rows: TableDataAction|undefined;
      try {
        // TODO: add indexes to db.
        const noCase = clause.charId === 'Email' ? ` COLLATE NOCASE` : '';
        rows = await this._fetchQueryFromDB({
          tableId: clause.tableId,
          filters: {},
          where: {
            clause: `${quoteIdent(clause.lookupColId)}${noCase} = ?`,
            // Use lodash's get() that supports paths, e.g. charId of 'a.b' would look up `user.a.b`.
            params: [get(user, clause.charId)],
          },
        });
      } catch (e) {
        log.warn(`User attribute ${clause.name} failed`, e);
      }
      if (rows && rows[2].length > 0) { rec = new RecordView(rows, 0); }
      user[clause.name] = rec;
      attrs.rows[clause.name] = rec;
    }
    return user;
  }

  public async getCachedUser(docSession: OptDocSession): Promise<User> {
    const access = await this._getAccess(docSession);
    return access.getUser();
  }

  /**
   * Represent fields from the session in an input object for ACL rules.
   * Just one field currently, "user".
   */
  public async inputs(docSession: OptDocSession): Promise<PredicateFormulaInput> {
    return {
      user: await this.getUser(docSession),
      docId: this._docId
    };
  }

  /**
   * Check whether user has any access to table.
   */
  public async hasTableAccess(docSession: OptDocSession, tableId: string) {
    const pset = await this.getTableAccess(docSession, tableId);
    return this.getReadPermission(pset) !== 'deny';
  }

  /**
   * Checks if user has read access to a cell. Optionally takes docData that will be used
   * to retrieve the cell value instead of the current docData.
   */
  public async hasCellAccess(docSession: OptDocSession, cell: SingleCell, docData?: DocData): Promise<boolean> {
    try {
      await this.getCellValue(docSession, cell, docData);
      return true;
    } catch(err) {
      if (err instanceof ErrorWithCode) { return false; }
      throw err;
    }
  }

  /**
   * Get content of a given cell, if user has read access. Optionally takes docData that will be used
   * to retrieve the cell value instead of the current docData.
   * Throws if not.
   */
  public async getCellValue(docSession: OptDocSession, cell: SingleCell, docData?: DocData): Promise<CellValue> {
    function fail(): never {
      throw new ErrorWithCode('ACL_DENY', 'Cannot access cell');
    }
    const hasExceptionalAccess = this._hasExceptionalFullAccess(docSession);
    if (!hasExceptionalAccess && !await this.hasTableAccess(docSession, cell.tableId)) { fail(); }
    let rows: TableDataAction|null = null;
    if (docData) {
      const record = docData.getTable(cell.tableId)?.getRecord(cell.rowId);
      if (record) {
        rows = ['TableData', cell.tableId, [cell.rowId], getColValues([record])];
      }
    } else {
      rows = await this._fetchQueryFromDB({
        tableId: cell.tableId,
        filters: { id: [cell.rowId] }
      });
    }
    if (!rows || rows[2].length === 0) {
      return fail();
    }
    const rec = new RecordView(rows, 0);
    if (!hasExceptionalAccess) {
      const input: PredicateFormulaInput = {...await this.inputs(docSession), rec, newRec: rec};
      const rowPermInfo = new PermissionInfo(this._ruler.ruleCollection, input);
      const rowAccess = rowPermInfo.getTableAccess(cell.tableId).perms.read;
      if (rowAccess === 'deny') { fail(); }
      if (rowAccess !== 'allow') {
        const colAccess = rowPermInfo.getColumnAccess(cell.tableId, cell.colId).perms.read;
        if (colAccess === 'deny') { fail(); }
      }
      const colValues = rows[3];
      if (!(cell.colId in colValues)) { fail(); }
    }
    return rec.get(cell.colId);
  }

  /**
   * Checks whether the specified cell is accessible by the user, and contains
   * the specified attachment. Throws with ACL_DENY code if not.
   */
  public async assertAttachmentAccess(docSession: OptDocSession, cell: SingleCell, attId: number): Promise<void> {
    const value = await this.getCellValue(docSession, cell);

    // Need to check column is actually an attachment column.
    if (this._docStorage.getColumnType(cell.tableId, cell.colId) !== 'Attachments') {
      throw new ErrorWithCode('ACL_DENY', 'not an attachment column');
    }

    // Check that material in cell includes the attachment.
    if (!gristTypes.isList(value)) {
      throw new ErrorWithCode('ACL_DENY', 'not a list');
    }
    if (value.indexOf(attId) <= 0) {
      throw new ErrorWithCode('ACL_DENY', 'attachment not present in cell');
    }
  }

  /**
   * Check whether the specified attachment is known to have been uploaded
   * by the user (identified by SessionID) recently.
   */
  public async isAttachmentUploadedByUser(docSession: OptDocSession, attId: number): Promise<boolean> {
    const user = await this.getUser(docSession);
    const id = user.SessionID || '';
    return (this._attachmentUploads.get(attId) === id);
  }

  /**
   * Find a cell in an attachment column that contains the specified attachment,
   * and which is accessible by the user associated with the session.
   */
  public async findAttachmentCellForUser(docSession: OptDocSession, attId: number): Promise<SingleCell|undefined> {
    // Find cells that refer to the given attachment.
    const cells = await this._docStorage.findAttachmentReferences(attId);
    // Run through them to see if the user has access to any of them.
    // We'd expect in a typical document that this will be a small
    // list of cells, typically 1 or less, but of course extreme cases
    // are possible.
    for (const possibleCell of cells) {
      try {
        await this.assertAttachmentAccess(docSession, possibleCell, attId);
        return possibleCell;
      } catch (e) {
        if (e instanceof ErrorWithCode && e.code === 'ACL_DENY') {
          continue;
        }
        throw e;
      }
    }
    // Nothing found.
    return undefined;
  }

  /**
   * Called after UserAction[]s have been applied in the sandbox, and DocAction[]s have been
   * computed, but before we have committed those DocAction[]s to the database.  If this
   * throws an exception, the sandbox changes will be reverted.
   */
  public async canApplyBundle() {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const {docActions, docSession, isDirect} = this._activeBundle;
    const currentUser = await this.getUser(docSession);
    const userIsOwner = await this.isOwner(docSession);
    if (this._activeBundle.hasDeliberateRuleChange && !userIsOwner) {
      throw new ErrorWithCode('ACL_DENY', 'Only owners can modify access rules');
    }
    // Normally, viewer requests would never reach this point, but they can happen
    // using the "view as" functionality where user is an owner wanting to preview the
    // access level of another.  And again, the default access rules would normally
    // forbid edit access to a viewer - but that can be overridden.
    // An alternative to this check would be to sandwich user-defined access rules
    // between some defaults.  Currently the defaults have lower priority than
    // user-defined access rules.
    if (!canEdit(await this.getNominalAccess(docSession))) {
      throw new ErrorWithCode('ACL_DENY', 'Only owners or editors can modify documents');
    }
    if (this._ruler.haveRules()) {
      await Promise.all(
        docActions.map((action, actionIdx) => {
          if (isDirect[actionIdx]) {
            return this._checkIncomingDocAction({docSession, action, actionIdx});
          }
        }));
      const shares = this._docData.getMetaTable('_grist_Shares');
      /**
       * This is a good point at which to determine whether we may be
       * making a change to special shares. If we may be, then currently
       * we will reload any connected web clients accessing the document
       * via a share.
       *
       * The role of the `maybeHasShareChanges` flag is to trigger
       * reloads of web clients that are accessing the document via a
       * share, if share configuration may have changed. It doesn't
       * actually impact access control itself. The sketch of order of
       * operations given in the docstring for the GranularAccess
       * class is helpful for understanding this flow.
       *
       * At the time of writing, web client support for special shares
       * is not an official feature - but it is super convenient for testing
       * and will be important later.
       */
      if (shares.getRowIds().length > 0 &&
          docActions.some(action => isMetadataTable(getTableId(action)))) {
        // TODO: could actually compare new rules with old rules and
        // see if they've changed. Or could exclude some tables that
        // could easily change without an impact on share rules,
        // such as _grist_Attachments. Either improvement could
        // greatly reduce unnecessary web client reloads for shares
        // if that becomes an issue.
        this._activeBundle.maybeHasShareChanges = true;
      }
    }

    await this._canApplyCellActions(currentUser, userIsOwner);

    if (this._recoveryMode) {
      // Don't do any further checking in recovery mode.
      return;
    }

    // If the actions change any rules, verify that we'll be able to handle the changed rules. If
    // they are to cause an error, reject the action to avoid forcing user into recovery mode.
    // WATCH OUT - this will trigger for "passive" changes caused by tableId/colId renames.
    if (docActions.some(docAction => isAclTable(getTableId(docAction)))) {
      // Create a tmpDocData with just the tables we care about, then update docActions to it.
      const tmpDocData: DocData = new DocData(
        (tableId) => { throw new Error("Unexpected DocData fetch"); }, {
          _grist_Tables: this._docData.getMetaTable('_grist_Tables').getTableDataAction(),
          _grist_Tables_column: this._docData.getMetaTable('_grist_Tables_column').getTableDataAction(),
          _grist_ACLResources: this._docData.getMetaTable('_grist_ACLResources').getTableDataAction(),
          _grist_ACLRules: this._docData.getMetaTable('_grist_ACLRules').getTableDataAction(),
          _grist_Shares: this._docData.getMetaTable('_grist_Shares').getTableDataAction(),
          // WATCH OUT - Shares may need more tables, check.
        });
      for (const da of docActions) {
        tmpDocData.receiveAction(da);
      }

      // Use the post-actions data to process the rules collection, and throw error if that fails.
      const ruleCollection = new ACLRuleCollection();
      await ruleCollection.update(tmpDocData, {log, compile: compilePredicateFormula});
      if (ruleCollection.ruleError) {
        throw new ApiError(ruleCollection.ruleError.message, 400);
      }
      try {
        ruleCollection.checkDocEntities(tmpDocData);
      } catch (err) {
        throw new ApiError(err.message, 400);
      }
    }

    // TODO: any changes needed to this logic for shares?
  }

  /**
   * This should be called after each action bundle has been applied to the database,
   * but before the actions are broadcast to clients.  It will set us up to be able
   * to efficiently filter those broadcasts.
   *
   * We expect actions bundles for a document to be applied+broadcast serially (the
   * broadcasts can be parallelized, but should complete before moving on to further
   * document mutation).
   */
  public async appliedBundle() {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const {docActions} = this._activeBundle;
    this._activeBundle.applied = true;
    if (!this._ruler.haveRules()) { return; }
    // Check if a table that affects user attributes has changed.  If so, put current
    // attributes aside for later comparison, and clear cache.
    const attrs = new Set([...this._ruler.ruleCollection.getUserAttributeRules().values()].map(r => r.tableId));
    const attrChange = docActions.some(docAction => attrs.has(getTableId(docAction)));
    if (attrChange) {
      this._prevUserAttributesMap = this._userAttributesMap;
      this._userAttributesMap = new WeakMap();
    }
    // If there's a schema change, zap permission cache.
    const schemaChange = docActions.some(docAction => isSchemaAction(docAction));
    if (attrChange || schemaChange) {
      this._ruler.clearCache();
    }
  }

  /**
   * This should be called once an action bundle has been broadcast to
   * all clients (or the bundle has been denied).  It will clean up
   * any temporary state cached for filtering those broadcasts.
   */
  public async finishedBundle() {
    if (!this._activeBundle) { return; }
    if (this._activeBundle.applied) {
      const {docActions} = this._activeBundle;
      await this._updateRules(docActions);
    }
    this._steps = null;
    this._metaSteps = null;
    this._prevUserAttributesMap = undefined;
    this._activeBundle = null;
  }

  /**
   * Filter DocActions to be sent to a client.
   */
  public async filterOutgoingDocActions(docSession: OptDocSession, docActions: DocAction[]): Promise<DocAction[]> {
    // If the user requested a rule change, trigger a reload.
    if (this._activeBundle?.hasDeliberateRuleChange) {
      // TODO: could avoid reloading in many cases, especially for an owner who has full
      // document access.
      throw new ErrorWithCode('NEED_RELOAD', 'document needs reload, access rules changed');
    }

    const linkId = getDocSessionShare(docSession);
    if (linkId && this._activeBundle?.maybeHasShareChanges) {
      throw new ErrorWithCode('NEED_RELOAD', 'document needs reload, share may have changed');
    }

    // Optimize case where there are no rules to enforce.
    if (!this._ruler.haveRules()) { return docActions; }

    // If user attributes have changed, trigger a reload.
    await this._checkUserAttributes(docSession);

    const actions = await Promise.all(
      docActions.map((action, actionIdx) => this._filterOutgoingDocAction({docSession, action, actionIdx})));
    let result = ([] as ActionCursor[]).concat(...actions);
    result = await this._filterOutgoingAttachments(result);

    return await this._filterOutgoingCellInfo(docSession, docActions,
                                              result.map(a => a.action));
  }

  /**
   * Returns the list of tables which are updated by the active action bundle. Considers only
   * actions visible to the given user, and only direct actions (e.g. not tables updated by
   * formulas). This is used for notifications.
   */
  public async getDirectTablesInBundle(userData: UserAccessData): Promise<DocActionsDescription|null> {
    try {
      const filtered = await this._getOutgoingDocActionsForNotifications(userData);
      return describeDocActions(filtered, this._docData);
    } catch (err) {
      if (err.code === 'NEED_RELOAD') {
        // If something changes that affects access and tells each client to reload, then consider
        // it a change visible to all users, even though we can't tell which tables are affected.
        const result: DocActionsDescription = {userTableNames: [], categories: []};
        // The error message normally mentions the reason for the reload, so get category from that.
        if (err.message.includes('user attributes')) {
          result.categories.push('user attributes');
        } else if (err.message.includes('access rules')) {
          result.categories.push('access rules');
        } else if (err.message.includes('share')) {
          result.categories.push('forms');
        } else {
          result.categories.push('metadata');   // catch-all
        }
        return result;
      }
      throw err;
    }
  }

  public hasCommentsInBundle() {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const { docActions, isDirect } = this._activeBundle;
    // We are only interested in direct actions that add comments.
    return docActions.filter((_, index) => isDirect[index]).some(a => {
      return isDataAction(a) && isSomeAddRecordAction(a) && getTableId(a) === '_grist_Cells';
    });
  }

  /**
   * Get comments in the active bundle, filtering them for a specific user if requested.
   */
  public async getCommentsInBundle(userToFilterFor?: UserAccessData): Promise<DocComment[]> {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    try {
      const filtered: DocAction[] = await this._getOutgoingDocActionsForNotifications(userToFilterFor);
      const cellData = new CellData(this._docData);
      const newComments = cellData.getNewComments(filtered);
      const audienceMap = cellData.getAudience(newComments.map(r => r.id));

      const docComments: DocComment[] = [];
      for(const commentRow of newComments) {
        const audience = audienceMap.get(commentRow.id) || [];
        const mentions = getMentions(commentRow.content);
        const docComment = makeDocComment(commentRow, audience, mentions);
        if (!docComment) {
          log.warn(`Comment row ${commentRow.id} does not have a valid comment`);
          continue;
        }
        docComments.push(docComment);
      }

      return docComments;
    } catch (err) {
      if (err.code === 'NEED_RELOAD') {
        // If something changes that affects access and tells each client to reload, then we
        // can't tell what comment actions are visible. This should never happen in normal use
        // of comments (since we don't expect comment actions to be in the same bundle with
        // access-changing actions), so just assume there are no comments to worry about.
        return [];
      }
      throw err;
    }
  }

  /**
   * Filter an ActionGroup to be sent to a client.
   */
  public async filterActionGroup(
    docSession: OptDocSession,
    actionGroup: ActionGroup,
    options: {role?: Role | null} = {}
  ): Promise<ActionGroup> {
    if (await this.allowActionGroup(docSession, actionGroup, options)) { return actionGroup; }
    // For now, if there's any nuance at all, suppress the summary and description.
    const result: ActionGroup = { ...actionGroup };
    result.actionSummary = createEmptyActionSummary();
    result.desc = '';
    return result;
  }

  /**
   * Check whether an ActionGroup can be sent to the client.  TODO: in future, we'll want
   * to filter acceptable parts of ActionGroup, rather than denying entirely.
   */
  public async allowActionGroup(
    docSession: OptDocSession,
    _actionGroup: ActionGroup,
    options: {role?: Role | null} = {}
  ): Promise<boolean> {
    return this.canReadEverything(docSession, options);
  }

  /**
   * Figure out any recommendations based on usage to pass along.
   */
  public async getUsageRecommendations(
    docSession: OptDocSession,
    docUsage: DocUsageSummary,
  ): Promise<UsageRecommendations> {
    const rec: UsageRecommendations = {};
    if (!this._docData.docSettings().attachmentStoreId &&
        docUsage.attachmentsSizeBytes !== 'pending' &&
        docUsage.attachmentsSizeBytes >= GRIST_ATTACHMENTS_THRESHOLD_MB * 1024 * 1024 &&
        getConfiguredStandardAttachmentStore() &&
        await this.isOwner(docSession)) {
      rec.recommendExternal = true;
    }
    return rec;
  }

  /**
   * Filter DocUsageSummary to be sent to a client.
   * Include usage recommendations.
   */
  public async filterDocUsageSummary(
    docSession: OptDocSession,
    docUsage: DocUsageSummary,
    options: {role?: Role | null} = {}
  ): Promise<FilteredDocUsageSummary> {
    const usageRecommendations = await this.getUsageRecommendations(docSession, docUsage);
    const result: FilteredDocUsageSummary = { ...docUsage, usageRecommendations };
    // Owners can see everything all the time.
    if (await this.isOwner(docSession)) {
      return result;
    }
    const role = options.role ?? await this.getNominalAccess(docSession);
    const hasEditRole = canEdit(role);
    if (!hasEditRole) { result.dataLimitInfo.status = null; }
    const hasFullReadAccess = await this.canReadEverything(docSession);
    if (!hasEditRole || !hasFullReadAccess) {
      result.rowCount = 'hidden';
      result.dataSizeBytes = 'hidden';
      result.attachmentsSizeBytes = 'hidden';
    }
    return result;
  }

  /**
   * Check the list of UserActions, throwing if something not permitted is found.
   * The data engine is the definitive interpreter of UserActions, but we do what
   * we can, and then rely on analysis of DocActions produced by the data engine
   * later to finish the job. Any actions that read data and expose it in some way
   * need to be caught at this point, since that won't be evident in the DocActions.
   * So far, we've been restricting the permitted combinations of UserActions when
   * data is read to make access control tractable. Likewise, any actions that might
   * result in running user code that would not eventually be permitted needs to be
   * caught now, since by the time it hits the data engine it is too late.
   */
  public async checkUserActions(docSession: OptDocSession, actions: UserAction[]): Promise<void> {
    if (this._hasExceptionalFullAccess(docSession)) { return; }

    // Checks are in no particular order.
    await this._checkSimpleDataActions(docSession, actions);
    await this._checkForSpecialOrSurprisingActions(docSession, actions);
    await this._checkIfNeedsEarlySchemaPermission(docSession, actions);
    await this._checkDuplicateTableAccess(docSession, actions);
    await this._checkAddOrUpdateAccess(docSession, actions);
  }

  /**
   * Called when it is permissible to partially fulfill the requested actions.
   * Will remove forbidden actions in a very limited set of recognized circumstances.
   * In fact, currently in only one circumstance:
   *
   *   - If there is a single requested action, and it is an ApplyUndoActions.
   *     The goal being to let a user undo their action to the extent that it
   *     is possible to do so.
   *
   * In this case, the list of actions nested in ApplyUndoActions will be extracted,
   * treated as DocActions, and filtered to remove any component parts (at action,
   * column, row, or individual cell level) that would be forbidden.
   *
   * Beyond pure data changes, there are no heroics - any schema change will
   * result in prefiltering being skipped.
   *
   * Any filtering done here is NOT a security measure, and the output should
   * not be granted any level of automatic trust.
   */
  public async prefilterUserActions(docSession: OptDocSession, actions: UserAction[],
                                    options: ApplyUAExtendedOptions|null): Promise<UserAction[]> {
    // Currently we only attempt prefiltering for an ApplyUndoActions.
    if (actions.length !== 1) { return actions; }
    const userAction = actions[0];
    if (userAction[0] !== 'ApplyUndoActions') { return actions; }

    // Ok, this is an undo.  Unpack the requested undo actions.  For a bona
    // fide ApplyUndoActions, these would be doc actions generated by the
    // data engine and stored in action history.  But there is no actual
    // restriction in how ApplyUndoActions could be generated.  Security
    // is enforced separately, so we don't need to be paranoid here.
    const docActions = userAction[1] as DocAction[];

    // Bail out if there is any hint of a schema change.
    // TODO: may want to also bail if an action we'd need to filter would
    // affect a row id used later in the bundle.  Perhaps prefiltering
    // should be restricted to bundles of updates only for that reason.
    for (const action of docActions) {
      if (!isDataAction(action) || isMetadataTable(getTableId(action))) {
        return actions;
      }
    }

    // Run through a simulation of access control on these actions,
    // retaining only permitted material.
    const proposedActions: UserAction[] = [];
    try {
      // Establish our doc actions as the current context for access control.
      // We don't have undo information for them, but don't need to because
      // they have not been applied to the db.  Treat all actions as "direct"
      // since we could not trust claims of indirectness currently in
      // any case (though we could rearrange to limit how undo actions are
      // requested).
      this.getGranularAccessForBundle(docSession, docActions, [], docActions,
                                      docActions.map(() => true), options);
      for (const [actionIdx, action] of docActions.entries()) {
        // A single action might contain forbidden material at cell, row, column,
        // or table level.  Retaining permitted material may require refactoring the
        // single action into a series of actions.
        try {
          await this._checkIncomingDocAction({docSession, action, actionIdx});
          // Nothing forbidden!  Keep this action unchanged.
          proposedActions.push(action);
        } catch (e) {
          if (String(e.code) !== 'ACL_DENY') { throw e; }
          const acts = await this._prefilterDocAction({docSession, action, actionIdx});
          proposedActions.push(...acts);
          // Presumably we've changed the action.  Zap our cache of intermediate
          // states, since it is stale now.  TODO: reorganize cache to so can avoid wasting
          // time repeating work unnecessarily.  The cache was designed with all-or-nothing
          // operations in mind, and is poorly suited to prefiltering.
          // Note: the meaning of newRec is slippery in prefiltering, since it depends on
          // state at the end of the bundle, but that state is unstable now.
          // TODO look into prefiltering in cases using newRec in a many-action bundle.
          this._steps = null;
          this._metaSteps = null;
        }
      }
    } finally {
      await this.finishedBundle();
    }
    return [['ApplyUndoActions', proposedActions]];
  }

  /**
   * For changes that could include Python formulas, check for schema access early.
   */
  public needEarlySchemaPermission(a: UserAction|DocAction): boolean {
    const name = a[0] as string;
    // ConvertFromColumn and CopyFromColumn are hard to reason
    // about, especially since they appear in bundles with other
    // actions. We throw up our hands a bit here, and just make
    // sure the user has schema permissions. Today, in Grist, that
    // gives a lot of power. If this gets narrowed down in future,
    // we'll have to rethink this.
    const actionNames = [
      'ModifyColumn',
      'SetDisplayFormula',
      'ConvertFromColumn',
      'CopyFromColumn',
      'AddReverseColumn',
    ];
    if (actionNames.includes(name)) {
      return true;
    } else if (isDataAction(a)) {
      const tableId = getTableId(a);
      if (tableId === '_grist_Tables_column' || tableId === '_grist_Validations') {
        return true;
      }
    }
    return false;
  }

  /**
   * Check whether access is simple, or there are granular nuances that need to be
   * worked through.  Currently if there are no owner-only tables, then everyone's
   * access is simple and without nuance.
   */
  public async hasNuancedAccess(docSession: OptDocSession): Promise<boolean> {
    if (!this._ruler.haveRules()) { return false; }
    return !await this.hasFullAccess(docSession);
  }

  /**
   * Check if user is explicitly permitted to download/copy document.
   * They may be allowed to download in any case, see canCopyEverything.
   */
  public async hasFullCopiesPermission(docSession: OptDocSession): Promise<boolean> {
    const permInfo = await this._getAccess(docSession);
    return permInfo.getColumnAccess(SPECIAL_RULES_TABLE_ID, 'FullCopies').perms.read === 'allow';
  }

  /**
   * Check if user may view Access Rules.
   */
  public async hasAccessRulesPermission(docSession: OptDocSession): Promise<boolean> {
    const permInfo = await this._getAccess(docSession);
    return permInfo.getColumnAccess(SPECIAL_RULES_TABLE_ID, 'AccessRules').perms.read === 'allow';
  }

  /**
   * Check whether user can read everything in document.  Checks both home-level and doc-level
   * permissions.
   */
  public async canReadEverything(
    docSession: OptDocSession,
    options: {role?: Role | null} = {}
  ): Promise<boolean> {
    const access = options.role ?? await this.getNominalAccess(docSession);
    if (!canView(access)) { return false; }
    const permInfo = await this._getAccess(docSession);
    return this.getReadPermission(permInfo.getFullAccess()) === 'allow';
  }

  /**
   * Allow if user can read all data, or is an owner.
   * Might be worth making a special permission.
   * At the time of writing, used for:
   *   - findColFromValues
   *   - autocomplete
   *   - unfiltered access to attachment metadata
   */
  public async canScanData(docSession: OptDocSession): Promise<boolean> {
    return await this.isOwner(docSession) || await this.canReadEverything(docSession);
  }

  /**
   * Check whether user can copy everything in document.  Owners can always copy
   * everything, even if there are rules that specify they cannot.
   *
   * There's a small wrinkle about access rules.  The content
   * of _grist_ACLRules and Resources are only send to clients that are owners,
   * but could be copied by others by other means (e.g. download) as long as all
   * tables or columns are readable. This seems ok (no private info involved),
   * just a bit inconsistent.
   */
  public async canCopyEverything(docSession: OptDocSession): Promise<boolean> {
    return await this.hasFullCopiesPermission(docSession) ||
      await this.canReadEverything(docSession);
  }

  /**
   * Check whether user has full access to the document.  Currently that is interpreted
   * as equivalent owner-level access to the document.
   * TODO: uses of this method should be checked to see if they can be fleshed out
   * now we have more of the ACL implementation done.
   */
  public hasFullAccess(docSession: OptDocSession): Promise<boolean> {
    return this.isOwner(docSession);
  }

  /**
   * Check whether user has owner-level access to the document.
   */
  public async isOwner(docSession: OptDocSession): Promise<boolean> {
    const access = await this.getNominalAccess(docSession);
    return access === 'owners';
  }

  /**
   *
   * If the user does not have access to the full document, we need to filter out
   * parts of the document metadata.  For simplicity, we overwrite rather than
   * filter for now, so that the overall structure remains consistent.  We overwrite:
   *
   *   - names, textual ids, formulas, and other textual options
   *   - foreign keys linking columns/views/sections back to a forbidden table
   *
   * On the client, a page with a blank name will be marked gracefully as unavailable.
   *
   * Some information leaks, for example the existence of private tables and how
   * many columns they had, and something of the relationships between them. Long term,
   * it could be better to zap rows entirely, and do the work of cleaning up any cross
   * references to them.
   *
   */
  public async filterMetaTables(docSession: OptDocSession,
                                tables: {[key: string]: TableDataAction}): Promise<{[key: string]: TableDataAction}> {
    // If user has right to read everything, return immediately.
    if (await this.canReadEverything(docSession)) { return tables; }
    // If we are going to modify metadata, make a copy.
    tables = cloneDeep(tables);

    // Prepare cell censorship information.
    const cells = new CellData(this._docData).convertToCells(tables['_grist_Cells']);
    let cellCensor: CellAccessHelper|undefined;
    if (cells.length > 0) {
      cellCensor = this._createCellAccess(docSession);
      await cellCensor.calculate(cells);
    }

    const permInfo = await this._getAccess(docSession);
    const censor = new CensorshipInfo(permInfo, this._ruler.ruleCollection, tables,
                                      await this.hasAccessRulesPermission(docSession),
                                      cellCensor);
    if (cellCensor) {
      censor.filter(tables["_grist_Cells"]);
    }

    for (const tableId of STRUCTURAL_TABLES) {
      censor.filter(tables[tableId]);
    }
    if (await this.needAttachmentControl(docSession)) {
      // Attachments? No attachments here (whistles innocently).
      // Computing which attachments user has access to would require
      // looking at entire document, which we don't want to do. So instead
      // we'll be sending this info on a need-to-know basis later.
      const attachments = tables['_grist_Attachments'];
      attachments[2] = [];
      Object.values(attachments[3]).forEach(values => {
        values.length = 0;
      });
    }
    return tables;
  }

  /**
   * Distill the clauses for the given session and table, to figure out the
   * access level and any row-level access functions needed.
   */
  public async getTableAccess(docSession: OptDocSession, tableId: string): Promise<TablePermissionSetWithContext> {
    if (this._hasExceptionalFullAccess(docSession)) {
      return {
        perms: {read: 'allow', create: 'allow', delete: 'allow', update: 'allow', schemaEdit: 'allow'},
        ruleType: 'table',
        getMemos() { throw new Error('never needed'); }
      };
    }
    return (await this._getAccess(docSession)).getTableAccess(tableId);
  }

  /**
   * Modify table data in place, removing any rows or columns to which access
   * is not granted.
   */
  public async filterData(docSession: OptDocSession, data: TableDataAction) {
    const permInfo = await this._getAccess(docSession);
    const cursor: ActionCursor = {docSession, action: data, actionIdx: null};
    const tableId = getTableId(data);
    if (this.getReadPermission(permInfo.getTableAccess(tableId)) === 'mixed') {
      const readAccessCheck = this._readAccessCheck(docSession);
      await this._filterRowsAndCells(cursor, data, data, readAccessCheck, {allowRowRemoval: true});
    }

    // Filter columns, omitting any to which the user has no access, regardless of rows.
    this._filterColumns(
      data[3],
      (colId) => this.getReadPermission(permInfo.getColumnAccess(tableId, colId)) !== 'deny');
  }

  public async getUserOverride(docSession: OptDocSession): Promise<UserOverride|undefined> {
    await this.getUser(docSession);
    return this._getUserAttributes(docSession).override;
  }

  public getReadPermission(ps: PermissionSetWithContext) {
    return ps.perms.read;
  }

  public assertCanRead(ps: PermissionSetWithContext) {
    accessChecks.fatal.read.get(ps);
  }

  /**
   * Broadcast document changes to all clients, with appropriate filtering.
   */
  public async sendDocUpdateForBundle(actionGroup: ActionGroup, docUsage: DocUsageSummary) {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const { docActions, docSession } = this._activeBundle;
    const client = docSession && docSession.client || null;
    const message: DocUpdateMessage = { actionGroup, docActions, docUsage };
    await this._docClients.broadcastDocMessage(client, 'docUserAction',
                                               message,
                                               (_docSession) => this._filterDocUpdate(_docSession, message));
  }

  /**
   * Called when uploads occur. We record the fact that the specified attachment
   * ids originated in uploads by the current user, for a certain length of time.
   * During that time, attempts by the user to use these attachment ids in an
   * attachment column will be accepted. The user is identified by SessionID,
   * which is a user id for logged in users, and a session-unique id for
   * anonymous users accessing Grist from a browser.
   *
   * A remaining weakness of this protection could be if attachment ids were
   * reused, and reused quickly. Attachments can be deleted after
   * REMOVE_UNUSED_ATTACHMENTS_DELAY and on document shutdown. We keep
   * UPLOADED_ATTACHMENT_OWNERSHIP_PERIOD less than REMOVE_UNUSED_ATTACHMENTS_DELAY,
   * and wipe our records on document shutdown.
   */
  public async noteUploads(docSession: OptDocSession, attIds: number[]) {
    const user = await this.getUser(docSession);
    const id = user.SessionID;
    if (!id) {
      log.rawError('noteUploads needs a SessionID', {
        docId: this._docId,
        attIds,
        userId: user.UserID,
      });
      return;
    }
    for (const attId of attIds) {
      this._attachmentUploads.set(attId, id);
    }
  }

  // Remove cached access information for a given session.
  public flushAccess(docSession: OptDocSession) {
    this._ruler.flushAccess(docSession);
    this._userAttributesMap.delete(docSession);
    this._prevUserAttributesMap?.delete(docSession);
  }

  // Get a set of example users for playing with access control.
  // We use the example.com domain, which is reserved for uses like this.
  public getExampleViewAsUsers(): UserAccessData[] {
    return [
      {id: 0, email: 'owner@example.com', name: 'Owner', access: 'owners'},
      {id: 0, email: 'editor1@example.com', name: 'Editor 1', access: 'editors'},
      {id: 0, email: 'editor2@example.com', name: 'Editor 2', access: 'editors'},
      {id: 0, email: 'viewer@example.com', name: 'Viewer', access: 'viewers'},
      {id: 0, email: 'unknown@example.com', name: 'Unknown User', access: null},
    ];
  }

  // Compile a list of users mentioned in user attribute tables keyed by email.
  // If there is a Name column or an Access column, in the table, we use them.
  public async collectViewAsUsersFromUserAttributeTables(): Promise<Array<Partial<UserAccessData>>> {
    const result: Array<Partial<UserAccessData>> = [];
    const seenEmails = new Set();
    for (const clause of this._ruler.ruleCollection.getUserAttributeRules().values()) {
      if (clause.charId !== 'Email') { continue; }
      try {
        const users = await this._fetchQueryFromDB({
          tableId: clause.tableId,
          filters: {},
        });
        const user = new RecordView(users, undefined);
        const count = users[2].length;
        for (let i = 0; i < count; i++) {
          user.index = i;
          const emailRaw = user.get(clause.lookupColId);
          if (!emailRaw) { continue; }
          const email = String(emailRaw);
          const emailLower = email.toLowerCase();
          // Avoid adding multiple users that differ only in case of email, since later we match
          // case-insensitively anyway.
          if (seenEmails.has(emailLower)) { continue; }
          seenEmails.add(emailLower);
          const name = user.get('Name') || email.split('@')[0];
          const access = user.has('Access') ? String(user.get('Access')) : 'editors';
          result.push({
            email,
            name: name ? String(name) : undefined,
            access: isValidRole(access) ? access : null,  // 'null' -> null a bit circuitously
          });
        }
      } catch (e) {
        log.warn(`User attribute ${clause.name} failed`, e);
      }
    }
    return result;
  }

  /**
   * Get the role the session user has for this document.  User may be overridden,
   * in which case the role of the override is returned.
   * The forkingAsOwner flag of docSession should not be respected for non-owners,
   * so that the pseudo-ownership it offers is restricted to granular access within a
   * document (as opposed to document-level operations).
   */
  public async getNominalAccess(docSession: OptDocSession): Promise<Role|null> {
    const linkParameters = docSession.linkParameters || {};
    const baseAccess = getDocSessionAccess(docSession);
    if ((linkParameters.aclAsUserId || linkParameters.aclAsUser) && baseAccess === 'owners') {
      const info = await this.getUser(docSession);
      return info.Access;
    }
    return baseAccess;
  }

  public async createSnapshotWithCells(docActions: DocAction[]) {
    const rows = new Map(getRelatedRows(docActions));
    const cellData = new CellData(this._docData);
    for(const action of docActions) {
      for(const cell of cellData.convertToCells(action)) {
        if (!rows.has(cell.tableId)) { rows.set(cell.tableId, new Set()); }
        rows.get(cell.tableId)?.add(cell.rowId);
      }
    }
    // Don't need to sync _grist_Cells table, since we already have it.
    rows.delete('_grist_Cells');
    // Populate a minimal in-memory version of the database with these rows.
    const docData = new DocData(
      async (tableId) => {
        return {
          tableData: await this._fetchQueryFromDB(
            {tableId, filters: {id: [...rows.get(tableId)!]}})
        };
      }, {
        _grist_Cells: this._docData.getMetaTable('_grist_Cells')!.getTableDataAction(),
        // We need some basic table information to translate numeric ids to string ids (refs to ids).
        _grist_Tables: this._docData.getMetaTable('_grist_Tables')!.getTableDataAction(),
        _grist_Tables_column: this._docData.getMetaTable('_grist_Tables_column')!.getTableDataAction()
      },
    );
    // Load pre-existing rows touched by the bundle.
    await Promise.all([...rows.keys()].map(tableId => docData.syncTable(tableId)));
    return docData;
  }

  // Return true if attachment info must be sent on a need-to-know basis.
  public async needAttachmentControl(docSession: OptDocSession) {
    return !await this.canScanData(docSession);
  }

  /**
   * An optimization to catch obvious access problems for simple data
   * actions (such as UpdateRecord, BulkAddRecord, etc) early. Checks
   * actions one by one (nesting into ApplyUndoActions and
   * ApplyDocActions as needed) until meeting one that isn't a simple
   * data action. Checks are crude, and limited to the table access
   * level. Returns true if all actions were checked, false if
   * not. Returning true does not imply the actions in the bundle are
   * permissible; returning false does not imply they should be
   * denied. Throwing an error DOES imply that an action was
   * encountered that should be denied.
   */
  private async _checkSimpleDataActions(docSession: OptDocSession, actions: UserAction[]): Promise<boolean> {
    for (const action of actions) {
      if (!await this._checkSimpleDataAction(docSession, action)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Throws an error for simple data actions that the user cannot perform.
   * Checking is only at the table level. Returns true if the action clearly
   * does not change the document schema or metadata, otherwise false if it might.
   */
  private async _checkSimpleDataAction(docSession: OptDocSession, a: UserAction|DocAction): Promise<boolean> {
    const name = a[0] as string;
    if (name === 'ApplyUndoActions') {
      return this._checkSimpleDataActions(docSession, a[1] as UserAction[]);
    } else if (name === 'ApplyDocActions') {
      return this._checkSimpleDataActions(docSession, a[1] as UserAction[]);
    } else if (isDataAction(a)) {
      const tableId = getTableId(a);
      if (isMetadataTable(tableId)) {
        return false;
      }
      const tableAccess = await this.getTableAccess(docSession, tableId);
      const accessCheck = await this._getAccessForActionType(docSession, a, 'fatal');
      accessCheck.get(tableAccess);  // will throw if access denied.
      return true;
    } else {
      // Any other action might change schema, so continuing could lead
      // to false detections of failures. For example, renaming a column
      // and then updating cells within it should be allowed.
      return false;
    }
  }

  private async _checkForSpecialOrSurprisingActions(docSession: OptDocSession,
                                                    actions: UserAction[]) {
    await applyToActionsRecursively(actions, async (a) => {
      const name = String(a[0]);
      if (SPECIAL_ACTIONS.has(name)) {
        if (await this.hasNuancedAccess(docSession)) {
          throw new ErrorWithCode('ACL_DENY', `Blocked by access rules: '${name}' actions need uncomplicated access`);
        }
      } else if (SURPRISING_ACTIONS.has(name)) {
        if (!await this.hasFullAccess(docSession)) {
          throw new ErrorWithCode('ACL_DENY', `Blocked by access rules: '${name}' actions need full access`);
        }
      } else if (OK_ACTIONS.has(name)) {
        // fine, anyone can do these at any time, continue.
      } else if (OTHER_RECOGNIZED_ACTIONS.has(name)) {
        // these are known actions that have not been specifically classified.
      } else {
        // we've hit something unexpected - perhaps a UserAction has been added
        // without considering access control.
        throw new ErrorWithCode('ACL_DENY', `Blocked by access rules: '${name}' actions are not controlled`);
      }
    });
  }

  // AddOrUpdateRecord requires broad read access to a table.
  // But tables can be renamed, and access can be granted and removed
  // within a bundle.
  //
  // For now, we forbid the combination of AddOrUpdateRecord and
  // with actions other than other AddOrUpdateRecords, or simple data
  // changes.
  //
  // Access rules and user attributes might change during the bundle.
  // We deny based on access rights at the beginning of the bundle,
  // as for _checkPossiblePythonFormulaModification. This is on the
  // theory that someone who can change access rights can do anything.
  //
  // There might be uses for applying AddOrUpdateRecord in a nuanced
  // way within the scope of what a user can read, but there's no easy
  // way to do that within the data engine as currently
  // formulated. Could perhaps be done for on-demand tables though.
  private async _checkAddOrUpdateAccess(docSession: OptDocSession, actions: UserAction[]) {
    if (!scanActionsRecursively(actions, isAddOrUpdateRecordAction)) {
      // Don't need to apply this particular check.
      return;
    }

    await this._assertOnlyBundledWithSimpleDataActions(ADD_OR_UPDATE_RECORD_ACTIONS, actions);
    // Check for read access, and that we're not touching metadata.
    await applyToActionsRecursively(actions, async (a) => {
      if (!isAddOrUpdateRecordAction(a)) { return; }
      const actionName = String(a[0]);
      const tableId = validTableIdString(a[1]);
      if (isMetadataTable(tableId)) {
        throw new Error(`${actionName} cannot yet be used on metadata tables`);
      }
      const tableAccess = await this.getTableAccess(docSession, tableId);
      accessChecks.fatal.read.throwIfNotFullyAllowed(tableAccess);
      accessChecks.fatal.update.throwIfDenied(tableAccess);
      accessChecks.fatal.create.throwIfDenied(tableAccess);
    });
  }

  /**
   * Asserts that `actionNames` (if present in `actions`) are only bundled with simple data actions.
   */
  private async _assertOnlyBundledWithSimpleDataActions(actionNames: string | string[], actions: UserAction[]) {
    const names = Array.isArray(actionNames) ? actionNames : [actionNames];
    // Fail if being combined with anything that isn't a simple data action.
    await applyToActionsRecursively(actions, async (a) => {
      const name = String(a[0]);
      if (!names.includes(name) && !(isDataAction(a) && !isMetadataTable(getTableId(a)))) {
        throw new Error(`Can only combine ${names.join(' and ')} with simple data changes`);
      }
    });
  }

  private async _checkIfNeedsEarlySchemaPermission(docSession: OptDocSession, actions: UserAction[]) {
    // If changes could include Python formulas, then user must have
    // +S before we even consider passing these to the data engine.
    // Since we don't track rule or schema changes at this stage, we
    // approximate with the user's access rights at beginning of
    // bundle.
    // We also check for +S in scenarios that are hard to break down
    // in a more granular way, for example ConvertFromColumn and
    // CopyFromColumn.
    if (scanActionsRecursively(actions, (a) => this.needEarlySchemaPermission(a))) {
      await this._assertSchemaAccess(docSession);
    }
  }

  /**
   * Like `_checkAddOrUpdateAccess`, but for DuplicateTable actions.
   *
   * Permitted only when a user has full access, or full table read and schema edit
   * access for the table being duplicated.
   *
   * Currently, DuplicateTable cannot be combined with other action types, including
   * simple data actions. This may be relaxed in the future, but should only be done
   * after careful consideration of its implications.
   */
  private async _checkDuplicateTableAccess(docSession: OptDocSession, actions: UserAction[]) {
    if (!scanActionsRecursively(actions, ([actionName]) => String(actionName) === 'DuplicateTable')) {
      // Don't need to apply this particular check.
      return;
    }

    // Fail if being combined with another action.
    await applyToActionsRecursively(actions, async ([actionName]) => {
      if (String(actionName) !== 'DuplicateTable') {
        throw new Error('DuplicateTable currently cannot be combined with other actions');
      }
    });

    // Check for read and schema edit access, and that we're not duplicating metadata tables.
    await applyToActionsRecursively(actions, async (a) => {
      const tableId = validTableIdString(a[1]);
      if (isMetadataTable(tableId)) {
        throw new Error('DuplicateTable cannot be used on metadata tables');
      }
      if (await this.hasFullAccess(docSession)) { return; }

      const tableAccess = await this.getTableAccess(docSession, tableId);
      accessChecks.fatal.read.throwIfNotFullyAllowed(tableAccess);
      accessChecks.fatal.schemaEdit.throwIfDenied(tableAccess);

      const includeData = a[3];
      if (includeData) {
        accessChecks.fatal.create.throwIfDenied(tableAccess);
      }
    });
  }

  /**
   * Asserts that user has schema access.
   */
  private async _assertSchemaAccess(docSession: OptDocSession) {
    if (this._hasExceptionalFullAccess(docSession)) { return; }
    const permInfo = await this._getAccess(docSession);
    accessChecks.fatal.schemaEdit.throwIfDenied(permInfo.getFullAccess());
  }

  // The AccessCheck for the "read" permission is used enough to merit a shortcut.
  // We just need to be careful to retain unfettered access for exceptional sessions.
  private _readAccessCheck(docSession: OptDocSession): IAccessCheck {
    return this._hasExceptionalFullAccess(docSession) ? dummyAccessCheck : accessChecks.check.read;
  }

  // Return true for special system sessions or document-creation sessions, where
  // unfettered access is appropriate.
  private _hasExceptionalFullAccess(docSession: OptDocSession): Boolean {
    return docSession.mode === 'system' || docSession.mode === 'nascent';
  }

  /**
   * This filters a message being broadcast to all clients to be appropriate for one
   * particular client, if that client may need some material filtered out.
   */
  private async _filterDocUpdate(docSession: OptDocSession, message: DocUpdateMessage) {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const role = await this.getNominalAccess(docSession);
    const result = {
      ...message,
      docUsage: await this.filterDocUsageSummary(docSession, message.docUsage, {role}),
    };
    if (!this._ruler.haveRules() && !this._activeBundle.hasDeliberateRuleChange) {
      return result;
    }
    result.actionGroup = await this.filterActionGroup(docSession, message.actionGroup, {role});
    result.docActions = await this.filterOutgoingDocActions(docSession, message.docActions);
    if (result.docActions.length === 0) { return null; }
    return result;
  }

  private async _updateRules(docActions: DocAction[]) {
    // If there is a rule change, redo from scratch for now.
    // TODO: this is placeholder code. Should deal with connected clients.
    if (docActions.some(docAction => isAclTable(getTableId(docAction)))) {
      await this.update();
      return;
    }
    const shares = this._docData.getMetaTable('_grist_Shares');
    if (shares.getRowIds().length > 0 &&
        docActions.some(action => isMetadataTable(getTableId(action)))) {
      await this.update();
      return;
    }
    if (!shares && !this._ruler.haveRules()) {
      return;
    }
    // If there is a schema change, redo from scratch for now.
    if (docActions.some(docAction => isSchemaAction(docAction))) {
      await this.update();
    }
  }

  /**
   * Strip out any denied columns from an action.  Returns null if nothing is left.
   * accessCheck may throw if denials are fatal.
   */
  private _pruneColumns(a: DocAction, permInfo: IPermissionInfo, tableId: string,
                        accessCheck: IAccessCheck): DocAction|null {
    permInfo = new TransformColumnPermissionInfo(permInfo);
    if (a[0] === 'RemoveRecord' || a[0] === 'BulkRemoveRecord') {
      return a;
    } else if (a[0] === 'AddRecord' || a[0] === 'BulkAddRecord' || a[0] === 'UpdateRecord' ||
               a[0] === 'BulkUpdateRecord' || a[0] === 'ReplaceTableData' || a[0] === 'TableData') {
      const na = cloneDeep(a);
      this._filterColumns(na[3], (colId) => accessCheck.get(permInfo.getColumnAccess(tableId, colId)) !== 'deny');
      if (Object.keys(na[3]).length === 0) { return null; }
      return na;
    } else if (a[0] === 'AddColumn' || a[0] === 'RemoveColumn' || a[0] === 'RenameColumn' ||
               a[0] === 'ModifyColumn') {
      const colId: string = a[2];
      if (accessCheck.get(permInfo.getColumnAccess(tableId, colId)) === 'deny') { return null; }
    } else {
      // Remaining cases of AddTable, RemoveTable, RenameTable should have
      // been handled at the table level.
    }
    return a;
  }

  /**
   * Strip out any denied rows from an action.  The action may be rewritten if rows
   * become allowed or denied during the action.  An action to add newly-allowed
   * rows may be included, or an action to remove newly-forbidden rows.  The result
   * is a list rather than a single action.  It may be the empty list.
   */
  private async _pruneRows(cursor: ActionCursor): Promise<DocAction[]> {
    const {action} = cursor;
    // This only deals with Record-related actions.
    if (!isDataAction(action)) { return [action]; }

    // Get before/after state for this action.  Broadcasts to other users can make use of the
    // same state, so we share it (and only compute it if needed).
    const {rowsBefore, rowsAfter} = await this._getRowsBeforeAndAfter(cursor);

    // Figure out which rows were forbidden to this session before this action vs
    // after this action.  We need to know both so that we can infer the state of the
    // client and send the correct change.
    const orderedIds = getRowIdsFromDocAction(action);
    const ids = new Set(orderedIds);
    const forbiddenBefores = new Set(await this._getForbiddenRows(cursor, rowsBefore, ids));
    const forbiddenAfters = new Set(await this._getForbiddenRows(cursor, rowsAfter, ids));

    /**
     * For rows forbidden before and after: just remove them.
     * For rows allowed before and after: just leave them unchanged.
     * For rows that were allowed before and are now forbidden:
     *   - strip them from the current action.
     *   - add a BulkRemoveRecord for them.
     * For rows that were forbidden before and are now allowed:
     *   - remove them from the current action.
     *   - add a BulkAddRecord for them.
     */

    const removals = new Set<number>();      // rows to remove from current action.
    const forceAdds = new Set<number>();     // rows to add, that were previously stripped.
    const forceRemoves = new Set<number>();  // rows to remove, that have become forbidden.
    for (const id of ids) {
      const forbiddenBefore = forbiddenBefores.has(id);
      const forbiddenAfter = forbiddenAfters.has(id);
      if (!forbiddenBefore && !forbiddenAfter) { continue; }
      if (forbiddenBefore && forbiddenAfter) {
        removals.add(id);
        continue;
      }
      // If we reach here, then access right to the row changed and we have fancy footwork to do.
      if (forbiddenBefore) {
        // The row was forbidden and now is allowed.  That's trivial if the row was just added.
        if (action[0] === 'AddRecord' || action[0] === 'BulkAddRecord' ||
            action[0] === 'ReplaceTableData' || action[0] === 'TableData') {
          continue;
        }
        // Otherwise, strip the row from the current action.
        removals.add(id);
        if (action[0] === 'UpdateRecord' || action[0] === 'BulkUpdateRecord') {
          // For updates, we need to send the entire row as an add, since the client
          // doesn't know anything about it yet.
          forceAdds.add(id);
        } else {
          // Remaining cases are [Bulk]RemoveRecord.
        }
      } else {
        // The row was allowed and now is forbidden.
        // If the action is a removal, that is just right.
        if (action[0] === 'RemoveRecord' || action[0] === 'BulkRemoveRecord') { continue; }
        // Otherwise, strip the row from the current action.
        removals.add(id);
        if (action[0] === 'UpdateRecord' || action[0] === 'BulkUpdateRecord') {
          // For updates, we need to remove the entire row.
          forceRemoves.add(id);
        } else {
          // Remaining cases are add-like actions.
        }
      }
    }
    // Execute our cunning plans for DocAction revisions.
    const revisedDocActions = [
      this._makeAdditions(rowsAfter, forceAdds),
      this._removeRows(action, removals),
      this._makeRemovals(rowsAfter, forceRemoves),
    ].filter(isNonNullish);

    // Check whether there are column rules for this table, and if so whether they are row
    // dependent.  If so, we may need to update visibility of cells not mentioned in the
    // original DocAction.
    // No censorship is done here, all we do at this point is pull in any extra cells that need
    // to be updated for the current client.  Censorship for these cells, and any cells already
    // present in the DocAction, is done by _filterRowsAndCells.
    const ruler = await this._getRuler(cursor);
    const tableId = getTableId(action);
    const ruleSets = ruler.ruleCollection.getAllColumnRuleSets(tableId);
    const colIds = new Set(([] as string[]).concat(
      ...ruleSets.map(ruleSet => ruleSet.colIds === '*' ? [] : ruleSet.colIds)
    ));
    const access = await ruler.getAccess(cursor.docSession);
    // Check columns in a consistent order, for determinism (easier testing).
    // TODO: could pool some work between columns by doing them together rather than one by one.
    for (const colId of [...colIds].sort()) {
      // If the column is already in the DocAction, we can skip checking if we need to add it.
      if (!action[3] || (colId in action[3])) { continue; }
      // If the column is not row dependent, we have nothing to do.
      if (access.getColumnAccess(tableId, colId).perms.read !== 'mixed') { continue; }
      // Check column accessibility before and after.
      const _forbiddenBefores = new Set(await this._getForbiddenRows(cursor, rowsBefore, ids, colId));
      const _forbiddenAfters = new Set(await this._getForbiddenRows(cursor, rowsAfter, ids, colId));
      // For any column that is in a visible row and for which accessibility has changed,
      // pull it into the doc actions.  We don't censor cells yet, that happens later
      // (if that's what needs doing).
      const changedIds = orderedIds.filter(id => !forceRemoves.has(id) && !removals.has(id) &&
                                        (_forbiddenBefores.has(id) !== _forbiddenAfters.has(id)));
      if (changedIds.length > 0) {
        revisedDocActions.push(this._makeColumnUpdate(rowsAfter, colId, new Set(changedIds)));
      }
    }

    // Return the results, also applying any cell-level access control.
    const readAccessCheck = this._readAccessCheck(cursor.docSession);
    const filteredDocActions: DocAction[] = [];
    for (const a of revisedDocActions) {
      const {filteredAction} =
        await this._filterRowsAndCells({...cursor, action: a}, rowsAfter, rowsAfter, readAccessCheck,
                                       {allowRowRemoval: false, copyOnModify: true});
      if (filteredAction) { filteredDocActions.push(filteredAction); }
    }
    return filteredDocActions;
  }

  /**
   * Like _pruneRows, but fails immediately if access to any row is forbidden.
   * The accessCheck supplied should throw an error on denial.
   */
  private async _checkRows(cursor: ActionCursor, accessCheck: IAccessCheck): Promise<void> {
    const {action} = cursor;
    // This check applies to data changes only.
    if (!isDataAction(action)) { return; }
    const {rowsBefore, rowsAfter} = await this._getRowsForRecAndNewRec(cursor);
    // If any change is needed, this call will fail immediately because we are using
    // access checks that throw.
    await this._filterRowsAndCells(cursor, rowsBefore, rowsAfter, accessCheck,
                                   {allowRowRemoval: false});
  }

  private async _getRowsBeforeAndAfter(cursor: ActionCursor) {
    const {rowsBefore, rowsAfter} = await this._getStep(cursor);
    if (!rowsBefore || !rowsAfter) { throw new Error('Logic error: no rows available'); }
    return {rowsBefore, rowsAfter};
  }

  private async _getRowsForRecAndNewRec(cursor: ActionCursor) {
    const steps = await this._getSteps();
    if (cursor.actionIdx === null) { throw new Error('No step available'); }
    const {rowsBefore, rowsLast} = steps[cursor.actionIdx];
    if (!rowsBefore) { throw new Error('Logic error: no previous rows available'); }
    if (rowsLast) {
      return {rowsBefore, rowsAfter: rowsLast};
    }
    // When determining whether to apply an action, we choose to make newRec refer to the
    // state at the end of the entire bundle.  So we look for the last pair of row snapshots
    // for the same table.
    // TODO: there's a problem that this could alias rows if row ids were reused within the
    // same bundle. It is kind of a slippery idea. Likewise, column renames are slippery.
    // We could solve a lot of slipperiness by having newRec not transition across schema
    // changes, but we don't really have the option because formula updates happen late.
    let tableId = getTableId(rowsBefore);
    let last = cursor.actionIdx;
    for (let i = last + 1; i < steps.length; i++) {
      const act = steps[i].action;
      if (getTableId(act) !== tableId) { continue; }
      if (act[0] === 'RenameTable') {
        tableId = act[2];
        continue;
      }
      last = i;
    }
    const rowsAfter = steps[cursor.actionIdx].rowsLast = steps[last].rowsAfter;
    if (!rowsAfter) { throw new Error('Logic error: no next rows available'); }
    return {rowsBefore, rowsAfter};
  }

  /**
   * Scrub any rows and cells to which access is not granted from an
   * action. Returns filteredAction, which is the provided action, a
   * modified copy of the provided action, or null. It is null if the
   * action was entirely eliminated (and was not a bulk action). It is
   * a modified copy if any scrubbing was needed and copyOnModify is
   * set, otherwise the original is modified in place.
   *
   * Also returns censoredRows, a set of indexes of rows that have a
   * censored value in them.
   *
   * If allowRowRemoval is false, then rows will not be removed, and if the user
   * does not have access to a row and the action itself is not a remove action, then
   * an error will be thrown.  This flag setting is used when filtering outgoing
   * actions, where actions need rewriting elsewhere to reflect access changes to
   * rows for each individual client.
   */
  private async _filterRowsAndCells(cursor: ActionCursor, rowsBefore: TableDataAction, rowsAfter: TableDataAction,
                                    accessCheck: IAccessCheck,
                                    options: {
                                      allowRowRemoval?: boolean,
                                      copyOnModify?: boolean,
                                    }): Promise<{
                                      filteredAction: DocAction | null,
                                      censoredRows: Set<number>
                                    }> {
    const censoredRows = new Set<number>();
    const ruler = await this._getRuler(cursor);
    const {docSession, action} = cursor;
    if (action && isSchemaAction(action)) {
      return {filteredAction: action, censoredRows};
    }
    let filteredAction: DocAction | null = action;

    // For user convenience, for creations and deletions we equate rec and newRec.
    // This makes writing rules that control multiple permissions easier to write in
    // practice.
    let rowsRec = rowsBefore;
    let rowsNewRec = rowsAfter;
    if (isSomeAddRecordAction(action)) {
      rowsRec = rowsAfter;
    } else if (isSomeRemoveRecordAction(action)) {
      rowsNewRec = rowsBefore;
    }

    const rec = new RecordView(rowsRec, undefined);
    const newRec = new RecordView(rowsNewRec, undefined);
    const input: PredicateFormulaInput = {...await this.inputs(docSession), rec, newRec};

    const [, tableId, , colValues] = action;
    let filteredColValues: ColValues | BulkColValues | undefined | null = null;
    const rowIds = getRowIdsFromDocAction(action);
    const toRemove: number[] = [];

    // Call this to make sure we are modifying a copy, not the original, if copyOnModify is set.
    const copyOnNeed = () => {
      if (filteredColValues === null) {
        filteredAction = options?.copyOnModify ? cloneDeep(action) : action;
        filteredColValues = filteredAction[3];
      }
      return filteredColValues;
    };
    let censorAt: (colId: string, idx: number) => void;
    if (colValues === undefined) {
      censorAt = () => 1;
    } else if (Array.isArray(action[2])) {
      censorAt = (colId, idx) => (copyOnNeed() as BulkColValues)[colId][idx] = [GristObjCode.Censored];
    } else {
      censorAt = (colId) => (copyOnNeed() as ColValues)[colId] = [GristObjCode.Censored];
    }

    // These map an index of a row in the action to its index in rowsBefore and in rowsAfter.
    let getRecIndex: (idx: number) => number|undefined = (idx) => idx;
    let getNewRecIndex: (idx: number) => number|undefined = (idx) => idx;
    if (action !== rowsRec) {
      const recIndexes = new Map(rowsRec[2].map((rowId, idx) => [rowId, idx]));
      getRecIndex = (idx) => recIndexes.get(rowIds[idx]);
    }
    if (action !== rowsNewRec) {
      const newRecIndexes = new Map(rowsNewRec[2].map((rowId, idx) => [rowId, idx]));
      getNewRecIndex = (idx) => newRecIndexes.get(rowIds[idx]);
    }

    for (let idx = 0; idx < rowIds.length; idx++) {
      rec.index = getRecIndex(idx);
      newRec.index = getNewRecIndex(idx);

      const rowPermInfo = new PermissionInfo(ruler.ruleCollection, input);
      // getTableAccess() evaluates all column rules for THIS record. So it's really rowAccess.
      const rowAccess = rowPermInfo.getTableAccess(tableId);
      const access = accessCheck.get(rowAccess);
      if (access === 'deny') {
        toRemove.push(idx);
      } else if (access !== 'allow' && colValues) {
        // Go over column rules.
        for (const colId of Object.keys(colValues)) {
          const colAccess = rowPermInfo.getColumnAccess(tableId, colId);
          if (accessCheck.get(colAccess) === 'deny') {
            censorAt(colId, idx);
            censoredRows.add(idx);
          }
        }
      }
    }

    if (toRemove.length > 0) {
      if (options.allowRowRemoval) {
        copyOnNeed();
        if (Array.isArray(filteredAction[2])) {
          this._removeRowsAt(toRemove, filteredAction[2], filteredAction[3]);
        } else {
          filteredAction = null;
        }
      } else {
        // Artificially introduced removals are ok, otherwise this is suspect.
        if (filteredAction[0] !== 'RemoveRecord' && filteredAction[0] !== 'BulkRemoveRecord') {
          throw new Error('Unexpected row removal');
        }
      }
    }
    return {filteredAction, censoredRows};
  }

  // Compute which of the row ids supplied are for rows forbidden for this session.
  // If colId is supplied, check instead whether that specific column is forbidden.
  private async _getForbiddenRows(cursor: ActionCursor, data: TableDataAction, ids: Set<number>,
                                  colId?: string): Promise<number[]> {
    const ruler = await this._getRuler(cursor);
    const rec = new RecordView(data, undefined);
    const input: PredicateFormulaInput = {...await this.inputs(cursor.docSession), rec};

    const [, tableId, rowIds] = data;
    const toRemove: number[] = [];
    for (let idx = 0; idx < rowIds.length; idx++) {
      rec.index = idx;
      if (!ids.has(rowIds[idx])) { continue; }

      const rowPermInfo = new PermissionInfo(ruler.ruleCollection, input);
      // getTableAccess() evaluates all column rules for THIS record. So it's really rowAccess.
      const rowAccess = rowPermInfo.getTableAccess(tableId);
      if (!colId) {
        if (this.getReadPermission(rowAccess) === 'deny') {
          toRemove.push(rowIds[idx]);
        }
      } else {
        const colAccess = rowPermInfo.getColumnAccess(tableId, colId);
        if (this.getReadPermission(colAccess) === 'deny') {
          toRemove.push(rowIds[idx]);
        }
      }
    }
    return toRemove;
  }

  /**
   * Removes the toRemove rows (indexes, not row ids) from the rowIds list and from
   * the colValues structure.
   *
   * toRemove must be sorted, lowest to highest.
   */
  private _removeRowsAt(toRemove: number[], rowIds: number[], colValues: BulkColValues|ColValues|undefined) {
    if (toRemove.length > 0) {
      pruneArray(rowIds, toRemove);
      if (colValues) {
        for (const values of Object.values(colValues)) {
          pruneArray(values, toRemove);
        }
      }
    }
  }

  /**
   * Remove columns from a ColumnValues parameter of certain DocActions, using a predicate for
   * which columns to keep.
   * Will retain manualSort columns regardless of wildcards.
   */
  private _filterColumns(data: BulkColValues|ColValues, shouldInclude: (colId: string) => boolean) {
    for (const colId of Object.keys(data)) {
      if (colId !== 'manualSort' && !shouldInclude(colId)) {
        delete data[colId];
      }
    }
  }

  /**
   * Get PermissionInfo for the user represented by the given docSession. The returned object
   * allows evaluating access level as far as possible without considering specific records.
   *
   * The result is cached in a WeakMap, and PermissionInfo does its own caching, so multiple calls
   * to this._getAccess(docSession).someMethod() will reuse already-evaluated results.
   */
  private async _getAccess(docSession: OptDocSession): Promise<PermissionInfo> {
    // TODO The intent of caching is to avoid duplicating rule evaluations while processing a
    // single request. Caching based on docSession is riskier since those persist across requests.
    return this._ruler.getAccess(docSession);
  }

  private _getUserAttributes(docSession: OptDocSession): UserAttributes {
    // TODO Same caching intent and caveat as for _getAccess
    return getSetMapValue(this._userAttributesMap as Map<OptDocSession, UserAttributes>, docSession,
                          () => new UserAttributes());
  }

  /**
   * Check whether user attributes have changed.  If so, prompt client
   * to reload the document, since we aren't sophisticated enough to
   * figure out the changes to send.
   */
  private async _checkUserAttributes(docSession: OptDocSession) {
    if (!this._prevUserAttributesMap) { return; }
    const userAttrBefore = this._prevUserAttributesMap.get(docSession);
    if (!userAttrBefore) { return; }
    await this._getAccess(docSession);  // Makes sure user attrs have actually been computed.
    const userAttrAfter = this._getUserAttributes(docSession);
    for (const [tableId, rec] of Object.entries(userAttrAfter.rows)) {
      const prev = userAttrBefore.rows[tableId];
      if (!prev || JSON.stringify(prev.toJSON()) !== JSON.stringify(rec.toJSON())) {
        throw new ErrorWithCode('NEED_RELOAD', 'document needs reload, user attributes changed');
      }
    }
  }

  /**
   * Get the "View As" user specified in link parameters.
   * If aclAsUserId is set, we get the user with the specified id.
   * If aclAsUser is set, we get the user with the specified email,
   * from the database if possible, otherwise from user attribute
   * tables or examples.
   */
  private async _getViewAsUser(linkParameters: Record<string, string>): Promise<UserOverride> {
    // Look up user information in database, if available
    const dbUser = linkParameters.aclAsUserId ?
      (await this._homeDbManager?.getUser(integerParam(linkParameters.aclAsUserId, 'aclAsUserId'))) :
      (await this._homeDbManager?.getExistingUserByLogin(linkParameters.aclAsUser));

    const dbAccess = dbUser ? await this._homeDbManager?.getDocAuthCached({
      urlId: this._docId,
      userId: dbUser.id
    }) : null;

    // If we want to preview as an existing user who has access to the document, we will use users' real
    // access level.
    if (dbUser && dbAccess?.access) {
      return {
        access: dbAccess.access,
        user: this._homeDbManager?.makeFullUser(dbUser) || null
      };
    } else if (linkParameters.aclAsUser) {
      // Look further for the user, in user attribute tables or examples.
      const otherUsers = (await this.collectViewAsUsersFromUserAttributeTables())
                          .concat(this.getExampleViewAsUsers());
      const email = normalizeEmail(linkParameters.aclAsUser);
      const dummyUser = otherUsers.find(user => normalizeEmail(user?.email || '') === email);
      if (!dummyUser) {
        // Make sure the user is in the table or examples, otherwise we return no access.
        return {access: null, user: null};
      } else {
        let access = dummyUser.access || null;
        if (!access) {
          // In case the dummy user has no access to the document, check if the document
          // is shared publicly, and there is a default access for anonymous users.
          const docAuth =  await this._homeDbManager?.getDocAuthCached({
            urlId: this._docId,
            userId: this._homeDbManager.getAnonymousUserId(),
          });
          access = docAuth?.access || null;
        }
        return {
          access,
          user: {
            id: -1,
            email: dummyUser.email!,
            name: dummyUser.name || dummyUser.email!,
          }
        };
      }
    } else {
      return {access: null, user: null};
    }
  }

  /**
   * Remove a set of rows from a DocAction.  If the DocAction ends up empty, null is returned.
   * If the DocAction needs modification, it is copied first - the original is never
   * changed.
   */
  private _removeRows(a: DocAction, rowIds: Set<number>): DocAction|null {
    // If there are no rows, there's nothing to do.
    if (isSchemaAction(a)) { return a; }
    if (a[0] === 'AddRecord' || a[0] === 'UpdateRecord' || a[0] === 'RemoveRecord') {
      return rowIds.has(a[2]) ? null : a;
    }
    const na = cloneDeep(a);
    const [, , oldIds, bulkColValues] = na;
    const mask = oldIds.map((id, idx) => rowIds.has(id) ? idx : false).filter(v => v !== false) as number[];
    this._removeRowsAt(mask, oldIds, bulkColValues);
    if (oldIds.length === 0) { return null; }
    return na;
  }

  /**
   * Make a BulkAddRecord for a set of rows.
   */
  private _makeAdditions(data: TableDataAction, rowIds: Set<number>): BulkAddRecord|null {
    if (rowIds.size === 0) { return null; }
    // TODO: optimize implementation, this does an unnecessary clone.
    const notAdded = data[2].filter(id => !rowIds.has(id));
    const partialData = this._removeRows(data, new Set(notAdded)) as TableDataAction|null;
    if (partialData === null) { return partialData; }
    return ['BulkAddRecord', partialData[1], partialData[2], partialData[3]];
  }

  /**
   * Make a BulkRemoveRecord for a set of rows.
   */
  private _makeRemovals(data: TableDataAction, rowIds: Set<number>): BulkRemoveRecord|null {
    if (rowIds.size === 0) { return null; }
    return ['BulkRemoveRecord', getTableId(data), [...rowIds]];
  }

  /**
   * Make a BulkUpdateRecord for a particular column across a set of rows.
   */
  private _makeColumnUpdate(data: TableDataAction, colId: string, rowIds: Set<number>): BulkUpdateRecord {
    const dataRowIds = data[2];
    const selectedRowIds = dataRowIds.filter(r => rowIds.has(r));
    const colData = data[3][colId].filter((value, idx) => rowIds.has(dataRowIds[idx]));
    return ['BulkUpdateRecord', getTableId(data), selectedRowIds, {[colId]: colData}];
  }

  private async _getSteps(): Promise<Array<ActionStep>> {
    if (!this._steps) {
      this._steps = this._getUncachedSteps().catch(e => {
        log.error('step computation failed:', e);
        throw e;
      });
    }
    return this._steps;
  }

  private async _getMetaSteps(): Promise<Array<MetaStep>> {
    if (!this._metaSteps) {
      this._metaSteps = this._getUncachedMetaSteps().catch(e => {
        log.error('meta step computation failed:', e);
        throw e;
      });
    }
    return this._metaSteps;
  }

  /**
   * Prepare to compute intermediate states of rows, as
   * this._steps.  The computation should happen only if
   * needed, which depends on the rules and actions.  The computation
   * uses the state of the database, and so depends on whether the
   * docActions have already been applied to the database or not, as
   * determined by the this._applied flag, which should never be
   * changed during any possible use of this._steps.
   */
  private async _getUncachedSteps(): Promise<Array<ActionStep>> {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const {docActions, undo, applied} = this._activeBundle;
    // For row access work, we'll need to know the state of affected rows before and
    // after the actions.
    // First figure out what rows in which tables are touched during the actions.
    const rows = new Map(getRelatedRows(applied ? [...undo].reverse() : docActions));
    // Populate a minimal in-memory version of the database with these rows.
    // We need sufficient metadata to know column types, if there are any row additions.
    // Otherwise we may assume a cell contains "null" when it should contain "false" for
    // example (for a Bool column).
    const metaData = {
      _grist_Tables: this._docData.getMetaTable('_grist_Tables').getTableDataAction(),
      _grist_Tables_column: this._docData.getMetaTable('_grist_Tables_column').getTableDataAction(),
    };
    const docData = new DocData(
      async (tableId) => {
        return {
          tableData: await this._fetchQueryFromDB({tableId, filters: {id: [...rows.get(tableId)!]}})
        };
      },
      metaData,
    );
    // Load pre-existing rows touched by the bundle.
    await Promise.all([...rows.keys()].map(tableId => docData.syncTable(tableId)));
    if (applied) {
      // Apply the undo actions, since the docActions have already been applied to the db.
      for (const docAction of [...undo].reverse()) { docData.receiveAction(docAction); }
    }

    // Now step forward, storing the before and after state for the table
    // involved in each action.  We'll use this to compute row access changes.
    // For simple changes, the rows will be just the minimal set needed.
    // This could definitely be optimized.  E.g. for pure table updates, these
    // states could be extracted while applying undo actions, with no need for
    // a forward pass.  And for a series of updates to the same table, there'll
    // be duplicated before/after states that could be optimized.
    const steps = new Array<ActionStep>();
    for (const docAction of docActions) {
      const tableId = getTableId(docAction);
      const tableData = docData.getTable(tableId);
      const rowsBefore = cloneDeep(tableData?.getTableDataAction() || ['TableData', '', [], {}] as TableDataAction);
      docData.receiveAction(docAction);
      // If table is deleted, state afterwards doesn't matter.
      const rowsAfter = docData.getTable(tableId) ?
        cloneDeep(tableData?.getTableDataAction() || ['TableData', '', [], {}] as TableDataAction) :
        rowsBefore;
      const step: ActionStep = {action: docAction, rowsBefore, rowsAfter};
      steps.push(step);
    }
    return steps;
  }

  /**
   * Prepare to compute intermediate metadata and rules, as this._metaSteps.
   */
  private async _getUncachedMetaSteps(): Promise<Array<MetaStep>> {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const {docActions, undo, applied} = this._activeBundle;

    const needMeta = docActions.some(a => isSchemaAction(a) || isMetadataTable(getTableId(a)));
    if (!needMeta) {
      // Sometimes, the intermediate states are trivial.
      // TODO: look into whether it would be worth caching attachment columns.
      const attachmentColumns = getAttachmentColumns(this._docData);
      return docActions.map(action => ({action, attachmentColumns}));
    }
    const metaDocData = new DocData(
      async (tableId) => {
        const result = this._docData.getTable(tableId)?.getTableDataAction();
        if (!result) { throw new Error('surprising load'); }
        return {tableData: result};
      },
      null,
    );
    // Read the structural tables.
    await Promise.all([...STRUCTURAL_TABLES].map(tableId => metaDocData.syncTable(tableId)));
    if (applied) {
      for (const docAction of [...undo].reverse()) { metaDocData.receiveAction(docAction); }
    }
    let meta = {} as {[key: string]: TableDataAction};
    // Metadata is stored as a hash of TableDataActions.
    for (const tableId of STRUCTURAL_TABLES) {
      meta[tableId] = cloneDeep(metaDocData.getTable(tableId)!.getTableDataAction());
    }

    // Now step forward, tracking metadata and rules through any changes that occur.
    const steps = new Array<MetaStep>();
    let ruler = this._ruler;
    if (applied) {
      // Rules may have changed - back them off to a copy of their original state.
      ruler = new Ruler(this);
      await ruler.update(metaDocData);
    }
    let replaceRuler = false;
    for (const docAction of docActions) {
      const tableId = getTableId(docAction);
      const step: MetaStep = {action: docAction};
      step.metaBefore = meta;
      if (STRUCTURAL_TABLES.has(tableId)) {
        metaDocData.receiveAction(docAction);
        // make shallow copy of all tables
        meta = {...meta};
        // replace table just modified with a deep copy
        meta[tableId] = cloneDeep(metaDocData.getTable(tableId)!.getTableDataAction());
      }
      step.metaAfter = meta;
      // replaceRuler logic avoids updating rules between paired changes of resources and rules.
      if (actionHasRuleChange(docAction)) {
        replaceRuler = true;
      } else if (replaceRuler) {
        ruler = new Ruler(this);
        await ruler.update(metaDocData);
        replaceRuler = false;
      }
      step.ruler = ruler;
      step.attachmentColumns = getAttachmentColumns(metaDocData);
      steps.push(step);
    }
    return steps;
  }

  /**
   * Return any permitted parts of an action.  A completely forbidden
   * action results in an empty list.  Forbidden columns and rows will
   * be stripped from a returned action.  Rows with forbidden cells are
   * extracted and returned in distinct actions (since they will have
   * a distinct set of columns).
   *
   * This method should only be called with data actions, and will throw
   * for anything else.
   */
  private async _prefilterDocAction(cursor: ActionCursor): Promise<DocAction[]> {
    const {action, docSession} = cursor;
    const tableId = getTableId(action);
    const permInfo = await this._getStepAccess(cursor);
    const tableAccess = permInfo.getTableAccess(tableId);
    const accessCheck = await this._getAccessForActionType(docSession, action, 'check');
    const access = accessCheck.get(tableAccess);
    if (access === 'deny') {
      // Filter out this action entirely.
      return [];
    } else if (access === 'allow') {
      // Retain this action entirely.
      return [action];
    } else if (access === 'mixedColumns') {
      // Retain some or all columns entirely.
      const act = this._pruneColumns(action, permInfo, tableId, accessCheck);
      return act ? [act] : [];
    }
    // The remainder is the mixed condition.

    const {rowsBefore, rowsAfter} = await this._getRowsForRecAndNewRec(cursor);
    const {censoredRows, filteredAction} = await this._filterRowsAndCells({...cursor, action: cloneDeep(action)},
                                                                          rowsBefore, rowsAfter, accessCheck,
                                                                          {allowRowRemoval: true});
    if (filteredAction === null) {
      return [];
    }
    if (!isDataAction(filteredAction)) {
      throw new Error('_prefilterDocAction called with unexpected action');
    }
    if (isSomeRemoveRecordAction(filteredAction)) {
      // removals do not mention columns or cells, so no further complications.
      return [filteredAction];
    }

    // Strip any forbidden columns.
    this._filterColumns(
      filteredAction[3],
      (colId) => accessCheck.get(permInfo.getColumnAccess(tableId, colId)) !== 'deny');
    if (censoredRows.size === 0) {
      // no cell censorship, so no further complications.
      return [filteredAction];
    }

    return filterColValues(filteredAction, (idx) => censoredRows.has(idx), gristTypes.isCensored);
  }

  /**
   * Tailor the information about a change reported to a given client. The action passed in
   * is never modified. The actions output may differ in the following ways:
   *   - Tables, columns or rows may be omitted if the client does not have access to them.
   *   - Columns in structural metadata tables may be cleared if the client does not have
   *     access to the resources they relate to.
   *   - Columns in the _grist_Views table may be cleared or uncleared depending on changes
   *     in other metadata tables.
   *   - Rows may be inserted if the client newly acquires access to them via an update.
   * TODO: I think that column rules controlling READ access using rec are not fully supported
   * yet.  They work on first load, but if READ access is lost/gained updates won't be made.
   */
  private async _filterOutgoingDocAction(cursor: ActionCursor): Promise<ActionCursor[]> {
    const {action} = cursor;
    const tableId = getTableId(action);

    let results: DocAction[] = [];
    if (isMetadataTable(tableId)) {
      // Granular access rules don't apply to metadata directly, instead there
      // is a process of censorship (see later in this method).
      results = [action];
    } else {
      const permInfo = await this._getStepAccess(cursor);
      const tableAccess = permInfo.getTableAccess(tableId);
      const access = this.getReadPermission(tableAccess);
      const readAccessCheck = this._readAccessCheck(cursor.docSession);
      if (access === 'deny') {
        // filter out this data.
      } else if (access === 'allow') {
        results.push(action);
      } else if (access === 'mixedColumns') {
        const act = this._pruneColumns(action, permInfo, tableId, readAccessCheck);
        if (act) { results.push(act); }
      } else {
        // The remainder is the mixed condition.
        for (const act of await this._pruneRows(cursor)) {
          const prunedAct = this._pruneColumns(act, permInfo, tableId, readAccessCheck);
          if (prunedAct) { results.push(prunedAct); }
        }
      }
    }
    const secondPass: DocAction[] = [];
    for (const act of results) {
      if (STRUCTURAL_TABLES.has(getTableId(act)) && isDataAction(act)) {
        await this._filterOutgoingStructuralTables(cursor, act, secondPass);
      } else {
        secondPass.push(act);
      }
    }
    return secondPass.map(act => ({ ...cursor, action: act }));
  }

  private async _filterOutgoingStructuralTables(cursor: ActionCursor, act: DataAction, results: DocAction[]) {
    // Filter out sensitive columns from tables.
    const permissionInfo = await this._getStepAccess(cursor);
    const step = await this._getMetaStep(cursor);
    if (!step.metaAfter) { throw new Error('missing metadata'); }
    act = cloneDeep(act); // Don't change original action.
    const ruler = await this._getRuler(cursor);
    const censor = new CensorshipInfo(permissionInfo,
                                      ruler.ruleCollection,
                                      step.metaAfter,
                                      await this.hasAccessRulesPermission(cursor.docSession));
    if (censor.filter(act)) {
      results.push(act);
    }

    // There's a wrinkle to deal with. If we just added or removed a section, we need to
    // reconsider whether the view containing it is visible.
    if (getTableId(act) === '_grist_Views_section') {
      if (!step.metaBefore) { throw new Error('missing prior metadata'); }
      const censorBefore = new CensorshipInfo(permissionInfo,
                                              ruler.ruleCollection,
                                              step.metaBefore,
                                              await this.hasAccessRulesPermission(cursor.docSession));
      // For all views previously censored, if they are now uncensored,
      // add an UpdateRecord to expose them.
      for (const v of censorBefore.censoredViews) {
        if (!censor.censoredViews.has(v)) {
          const table = step.metaAfter._grist_Views;
          const idx = table[2].indexOf(v);
          const name = table[3].name[idx];
          results.push(['UpdateRecord', '_grist_Views', v, {name}]);
        }
      }
      // For all views currently censored, if they were previously uncensored,
      // add an UpdateRecord to censor them.
      for (const v of censor.censoredViews) {
        if (!censorBefore.censoredViews.has(v)) {
          results.push(['UpdateRecord', '_grist_Views', v, {name: ''}]);
        }
      }
    }
  }

  private async _checkIncomingDocAction(cursor: ActionCursor): Promise<void> {
    await this._checkIncomingAttachmentChanges(cursor);
    const {action, docSession} = cursor;
    const accessCheck = await this._getAccessForActionType(docSession, action, 'fatal');
    const tableId = getTableId(action);
    const permInfo = await this._getStepAccess(cursor);
    const tableAccess = permInfo.getTableAccess(tableId);
    const access = accessCheck.get(tableAccess);
    if (access === 'allow') { return; }
    if (access === 'mixed') {
      // Deal with row-level access for the mixed condition.
      await this._checkRows(cursor, accessCheck);
    }
    // Somewhat abusing prune method by calling it with an access function that
    // throws on denial.
    this._pruneColumns(action, permInfo, tableId, accessCheck);
  }

  /**
   * Take a look at the DocAction and see if it might allow the user to
   * introduce attachment ids into a cell. If so, make sure the user
   * has the right to access any attachments mentioned.
   */
  private async _checkIncomingAttachmentChanges(cursor: ActionCursor): Promise<void> {
    const {docSession} = cursor;
    const attIds = await this._gatherAttachmentChanges(cursor);
    for (const attId of attIds) {
      if (!await this.isAttachmentUploadedByUser(docSession, attId) &&
        !await this.findAttachmentCellForUser(docSession, attId)) {
        throw new ErrorWithCode('ACL_DENY', 'Cannot access attachment', {
          status: 403,
        });
      }
    }
  }

  /**
   * If user doesn't have sufficient rights, rewrite any attachment information
   * as follows:
   *   - Remove data actions (other than [Bulk]RemoveRecord) on the _grist_Attachments table
   *   - Gather any attachment ids mentioned in data actions
   *   - Prepend a BulkAddRecord for _grist_Attachments giving metadata for the attachments
   * This will result in metadata being sent to clients more than necessary,
   * but saves us keeping track of which clients already know about which
   * attachments.
   * We don't make any particular effort to retract attachment metadata from
   * clients if they lose access to it later. They won't have access to the
   * content of the attachment, and will lose metadata on a document reload.
   */
  private async _filterOutgoingAttachments(cursors: ActionCursor[]) {
    if (cursors.length === 0) { return []; }
    const docSession = cursors[0].docSession;
    if (!await this.needAttachmentControl(docSession)) {
      return cursors;
    }
    const result = [] as ActionCursor[];
    const attIds = new Set<number>();
    for (const cursor of cursors) {
      const changes = await this._gatherAttachmentChanges(cursor);
      // We assume here that ACL rules were already applied and columns were
      // either removed or censored.
      // Gather all attachment ids stored in user tables.
      for (const attId of changes) {
        attIds.add(attId);
      }
      const {action} = cursor;
      // Remove any additions or updates to the _grist_Attachments table.
      if (!isDataAction(action) || isSomeRemoveRecordAction(action) || getTableId(action) !== '_grist_Attachments') {
        result.push(cursor);
      }
    }
    // We removed all actions that created attachments, now send all attachments metadata
    // we currently have that are related to actions being broadcast.
    if (attIds.size > 0) {
      const act = this._docData.getMetaTable('_grist_Attachments')
        .getBulkAddRecord([...attIds]);
      result.unshift({
        action: act,
        docSession,
        // For access control purposes, this new action will be under the
        // same access rules as the first DocAction.
        actionIdx: cursors[0].actionIdx,
      });
    }
    return result;
  }

  private async _gatherAttachmentChanges(cursor: ActionCursor): Promise<Set<number>> {
    const empty = new Set<number>();
    const options = this._activeBundle?.options;
    if (options?.fromOwnHistory && options.oldestSource &&
      Date.now() - options.oldestSource < HISTORICAL_ATTACHMENT_OWNERSHIP_PERIOD) {
      return empty;
    }
    const {action, docSession} = cursor;
    if (!isDataAction(action)) { return empty; }
    if (isSomeRemoveRecordAction(action)) { return empty; }
    const tableId = getTableId(action);
    const step = await this._getMetaStep(cursor);
    const attachmentColumns = step.attachmentColumns;
    if (!attachmentColumns) { return empty; }
    const ac = attachmentColumns.get(tableId);
    if (!ac) { return empty; }
    const colIds = getColIdsFromDocAction(action) || [];
    if (!colIds.some(colId => ac.has(colId))) { return empty; }
    if (!await this.needAttachmentControl(docSession)) { return empty; }
    return gatherAttachmentIds(attachmentColumns, action);
  }

  /**
   * Suppress notifications of schema/metadata changes to users who have no permission to change
   * schema. This is the current compromise to reduce unwanted notifications; it assumes that
   * non-creators use the document as a data app and care about data changes.
   */
  private async _filterSchemaActionsForNotifications(
    docSession: OptDocSession,
    docActions: DocAction[]
  ): Promise<DocAction[]> {
    try {
      await this._assertSchemaAccess(docSession);
      return docActions;
    } catch (e: unknown) {
      if (e instanceof ErrorWithCode && e.code === 'ACL_DENY') {
        return docActions.filter((a) => {
          const tableId = getTableId(a);
          return (
            !isSchemaAction(a) &&
            (!isMetadataTable(tableId) || tableId === '_grist_Cells')
          );
        });
      }

      throw e;
    }
  }

  private async _getRuler(cursor: ActionCursor) {
    if (cursor.actionIdx === null) { return this._ruler; }
    const step = await this._getMetaStep(cursor);
    return step.ruler || this._ruler;
  }

  private async _getStepAccess(cursor: ActionCursor) {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    if (this._activeBundle.hasAnyRuleChange) {
      const step = await this._getMetaStep(cursor);
      if (step.ruler) { return step.ruler.getAccess(cursor.docSession); }
    }
    // No rule changes!
    return this._getAccess(cursor.docSession);
  }

  private async _getStep(cursor: ActionCursor) {
    if (cursor.actionIdx === null) { throw new Error('No step available'); }
    const steps = await this._getSteps();
    return steps[cursor.actionIdx];
  }

  private async _getMetaStep(cursor: ActionCursor) {
    if (cursor.actionIdx === null) { throw new Error('No step available'); }
    const steps = await this._getMetaSteps();
    return steps[cursor.actionIdx];
  }

  // Get an AccessCheck appropriate for the specific action.
  // TODO: deal with ReplaceTableData, which both deletes and creates rows.
  private async _getAccessForActionType(docSession: OptDocSession, a: DocAction,
                                        severity: 'check'|'fatal'): Promise<IAccessCheck> {
    if (this._hasExceptionalFullAccess(docSession)) {
      return dummyAccessCheck;
    }
    const tableId = getTableId(a);
    if (isMetadataTable(tableId) && tableId !== '_grist_Cells') {
      if (tableId === '_grist_Attachments') {
        // If the back end is adding/removing an attachment, all
        // necessary authentication has happened, and we can go ahead
        // and do it. Perhaps the back end should just use an
        // exceptional session for this, rather than a special
        // flag. That would change attribution of the action in the
        // log, so I stuck with a flag, but I'm not sure if
        // attribution is particularly useful in this case.
        if (this._activeBundle?.options?.attachment) {
          return dummyAccessCheck;
        }
        // Users cannot take actions on _grist_Attachments through the regular
        // action interface.
        throw new Error('_grist_Attachments modification is not allowed');
      }
      // Actions on any metadata table currently require the schemaEdit flag.
      // Exception: the cell info table, which needs to be reworked to be compatible
      // with granular access.

      // Another exception: ensure owners always have full access to ACL tables, so they
      // can change rules and don't get stuck.
      if (isAclTable(tableId) && await this.isOwner(docSession)) {
        return dummyAccessCheck;
      }
      return accessChecks[severity].schemaEdit;
    } else if (a[0] === 'UpdateRecord' || a[0] === 'BulkUpdateRecord') {
      return accessChecks[severity].update;
    } else if (a[0] === 'RemoveRecord' || a[0] === 'BulkRemoveRecord') {
      return accessChecks[severity].delete;
    } else if (a[0] === 'AddRecord' || a[0] === 'BulkAddRecord') {
      return accessChecks[severity].create;
    } else {
      return accessChecks[severity].schemaEdit;
    }
  }

  /**
   * Filter outgoing actions and include or remove cell information from _grist_Cells.
   */
  private async _filterOutgoingCellInfo(docSession: OptDocSession, before: DocAction[], after: DocAction[]) {
    // Rewrite bundle, simplifying all actions that are touching cell metadata.
    const cellView = new CellData(this._docData);
    const patch = cellView.generatePatch(before);

    // If there is nothing to do, just return after state.
    if (!patch) { return after; }

    // Now remove all action that modify cell metadata from after.
    // We will use the patch to reconstruct the cell metadata.
    const result = after.filter(action => !isCellDataAction(action));

    // Prepare checker, we need to use checker from the last step.
    const cursor = {
      docSession,
      action: before[before.length - 1],
      actionIdx: before.length - 1
    };
    const ruler = await this._getRuler(cursor);
    const permInfo = await ruler.getAccess(docSession);
    const inputs = await this.inputs(docSession);
    // Cache some data, as they are checked.
    const readRows = memoize(this._fetchQueryFromDB.bind(this));
    const hasAccess = async (cell: SingleCell) => {
      // First check table access, maybe table is hidden.
      const tableAccess = permInfo.getTableAccess(cell.tableId);
      const access = this.getReadPermission(tableAccess);
      if (access === 'deny') { return false; }

      // Check, if table is fully allowed (no ACL column/rows rules).
      if (access === 'allow') { return true; }

      // Maybe there are only rules that hides this column completely.
      if (access === 'mixedColumns') {
        const collAccess = this.getReadPermission(permInfo.getColumnAccess(cell.tableId, cell.colId));
        if (collAccess === 'deny') { return false; }
        if (collAccess === 'allow') { return true; }
      }

      // Probably there are rules at the cell level, check them.
      const rows = await readRows({
        tableId: cell.tableId,
        filters: { id: [cell.rowId] }
      });
      // Make sure we have row.
      if (!rows || rows[2].length === 0) {
        if (cell.rowId) {
          return false;
        }
      }
      const rec = rows ? new RecordView(rows, 0) : undefined;
      const input: PredicateFormulaInput = {...inputs, rec, newRec: rec};
      const rowPermInfo = new PermissionInfo(ruler.ruleCollection, input);
      const rowAccess = rowPermInfo.getTableAccess(cell.tableId).perms.read;
      if (rowAccess === 'deny') { return false; }
      if (rowAccess !== 'allow') {
        const colAccess = rowPermInfo.getColumnAccess(cell.tableId, cell.colId).perms.read;
        if (colAccess === 'deny') { return false; }
      }
      return true;
    };

    // Now censor the patch, so it only contains cells content that user has access to.
    await cellView.censorCells(patch, (cell) => hasAccess(cell));

    // And append it to the result.
    result.push(...patch);

    return result;
  }

  /**
   * Tests if the user can modify cell's data.
   */
  private async _canApplyCellActions(currentUser: User, userIsOwner: boolean) {
    // Owner can modify all comments, without exceptions.
    if (userIsOwner) {
      return;
    }
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const {docActions, docSession} = this._activeBundle;
    const snapShot = await this.createSnapshotWithCells(docActions);
    await applyAndCheckActionsForCells(
      snapShot,
      docActions,
      userIsOwner,
      this._ruler.haveRules(),
      currentUser.UserRef || '',
      (cell, state) => this.hasCellAccess(docSession, cell, state),
    );
  }

  private _createCellAccess(docSession: OptDocSession, docData?: DocData) {
    return new CellAccessHelper(this, this._ruler, docSession, this._fetchQueryFromDB, docData);
  }

  private async _getOutgoingDocActionsForNotifications(
    userData?: UserAccessData
  ): Promise<DocAction[]> {
    if (!this._activeBundle) { throw new Error('no active bundle'); }
    const { docActions, isDirect, docSession } = this._activeBundle;
    const relevant = docActions.filter((_, index) => isDirect[index]);
    if (!userData) {
      return relevant;
    }
    const userDocSession = new PseudoDocSession(userData, this._docId, docSession.org);
    let filtered = await this.filterOutgoingDocActions(userDocSession, relevant);
    filtered = await this._filterSchemaActionsForNotifications(userDocSession, filtered);
    return filtered;
  }
}

/**
 * A snapshots of rules and permissions at during one of more steps within a bundle.
 */
export class Ruler {
  // The collection of all rules, with helpful accessors.
  public ruleCollection = new ACLRuleCollection();

  // Cache of PermissionInfo associated with the given docSession. It's a WeakMap, so should allow
  // both to be garbage-collected once docSession is no longer in use.
  private _permissionInfoMap = new WeakMap<OptDocSession, Promise<PermissionInfo>>();

  public constructor(private _owner: RulerOwner) {}

  public async getAccess(docSession: OptDocSession): Promise<PermissionInfo> {
    // TODO The intent of caching is to avoid duplicating rule evaluations while processing a
    // single request. Caching based on docSession is riskier since those persist across requests.
    return getSetMapValue(this._permissionInfoMap as Map<OptDocSession, Promise<PermissionInfo>>, docSession,
      async () => new PermissionInfo(this.ruleCollection, await this._owner.inputs(docSession)));
  }

  public flushAccess(docSession: OptDocSession) {
    this._permissionInfoMap.delete(docSession);
  }

  /**
   * Update granular access from DocData.
   */
  public async update(docData: DocData) {
    await this.ruleCollection.update(docData, {
      log,
      compile: compilePredicateFormula,
      enrichRulesForImplementation: true,
    });

    // Also clear the per-docSession cache of rule evaluations.
    this.clearCache();
  }

  public clearCache() {
    this._permissionInfoMap = new WeakMap();
  }

  public haveRules() {
    return this.ruleCollection.haveRules();
  }
}

export interface RulerOwner {
  getUser(docSession: OptDocSession): Promise<User>;
  inputs(docSession: OptDocSession): Promise<PredicateFormulaInput>;
}

/**
 * Information about a single step within a bundle.  We cache this information to share
 * when filtering output to several clients.
 */
export interface ActionStep {
  action: DocAction;
  rowsBefore: TableDataAction|undefined;  // only defined for actions modifying rows
  rowsAfter: TableDataAction|undefined;   // only defined for actions modifying rows
  rowsLast?: TableDataAction;             // cached calculation of where to point "newRec"
}
export interface MetaStep {
  action: DocAction;
  metaBefore?: {[key: string]: TableDataAction};  // cached structural metadata before action
  metaAfter?: {[key: string]: TableDataAction};   // cached structural metadata after action
  ruler?: Ruler;                          // rules at this step
  attachmentColumns?: AttachmentColumns;        // attachment columns after this step
}

/**
 * A pointer to a particular step within a bundle for a particular session.
 */
interface ActionCursor {
  action: DocAction;
  docSession: OptDocSession;
  actionIdx: number|null;     // an index into where we are within the original
                              // DocActions, for access control purposes.
                              // Used for referencing a cache of intermediate
                              // access control state.
}

/**
 * A read-write view of a DataAction, for use in censorship.
 */
class RecordEditor implements InfoEditor {
  private _rows: number[];
  private _bulk: boolean;
  private _data: ColValues | BulkColValues;
  public constructor(public data: DataAction, public index: number|undefined,
                     public optional: boolean) {
    const rows = data[2];
    this._bulk = Array.isArray(rows);
    this._rows = Array.isArray(rows) ? rows : [rows];
    this._data = data[3] || {};
  }

  public get(colId: string): CellValue {
    if (this.index === undefined) { return null; }
    if (colId === 'id') {
      return this._rows[this.index];
    }
    return this._bulk ?
      (this._data as BulkColValues)[colId][this.index] :
      (this._data as ColValues)[colId];
  }

  public set(colId: string, val: CellValue): this {
    if (this.index === undefined) { throw new Error('cannot set value of non-existent cell'); }
    if (colId === 'id') { throw new Error('cannot change id'); }
    if (this.optional && !(colId in this._data)) { return this; }
    if (this._bulk) {
      (this._data as BulkColValues)[colId][this.index] = val;
    } else {
      (this._data as ColValues)[colId] = val;
    }
    return this;
  }

  public toJSON() {
    if (this.index === undefined) { return {}; }
    const results: {[key: string]: any} = {};
    for (const key of Object.keys(this._data)) {
      results[key] = this.get(key);
    }
    return results;
  }
}

/**
 * Cache information about user attributes.
 */
class UserAttributes {
  public rows: {[clauseName: string]: InfoView} = {};
  public override?: UserOverride;
}

interface IAccessCheck {
  get(ps: PermissionSetWithContext): string;
  throwIfDenied(ps: PermissionSetWithContext): void;
  throwIfNotFullyAllowed(ps: PermissionSetWithContext): void;
}

class AccessCheck implements IAccessCheck {
  constructor(public access: 'update'|'delete'|'create'|'schemaEdit'|'read',
              public severity: 'check'|'fatal') {
  }

  public get(ps: PermissionSetWithContext): string {
    const result = ps.perms[this.access];
    if (result !== 'deny' || this.severity !== 'fatal') { return result; }
    this.throwIfDenied(ps);
    return result;
  }

  public throwIfDenied(ps: PermissionSetWithContext): void {
    const result = ps.perms[this.access];
    if (result !== 'deny') { return; }
    this._throwError(ps);
  }

  public throwIfNotFullyAllowed(ps: PermissionSetWithContext): void {
    const result = ps.perms[this.access];
    if (result === 'allow') { return; }
    this._throwError(ps);
  }

  private _throwError(ps: PermissionSetWithContext): void {
    const memos = ps.getMemos()[this.access];
    const label =
      this.access === 'schemaEdit' ? 'structure' :
      this.access;
    throw new ErrorWithCode('ACL_DENY', `Blocked by ${ps.ruleType} ${label} access rules`, {
      memos,
      status: 403
    });
  }
}

export const accessChecks = {
  check: fromPairs(ALL_PERMISSION_PROPS.map(prop => [prop, new AccessCheck(prop, 'check')])),
  fatal: fromPairs(ALL_PERMISSION_PROPS.map(prop => [prop, new AccessCheck(prop, 'fatal')])),
};


// This AccessCheck allows everything.
const dummyAccessCheck: IAccessCheck = {
  get() { return 'allow'; },
  throwIfDenied() {},
  throwIfNotFullyAllowed() {}
};

/**
 * Helper class to calculate access for a set of cells in bulk. Used for initial
 * access check for a whole _grist_Cell table. Each cell can belong to a different
 * table and row, so here we will avoid loading rows multiple times and checking
 * the table access multiple time.
 */
class CellAccessHelper {
  private _tableAccess: Map<string, boolean> = new Map();
  private _rowPermInfo: Map<string, Map<number, PermissionInfo>> = new Map();
  private _rows: Map<string, TableDataAction> = new Map();
  private _inputs!: PredicateFormulaInput;

  constructor(
    private _granular: GranularAccess,
    private _ruler: Ruler,
    private _docSession: OptDocSession,
    private _fetchQueryFromDB?: (query: ServerQuery) => Promise<TableDataAction>,
    private _state?: DocData,
  ) { }

  /**
   * Resolves access for all cells, and save the results in the cache.
   */
  public async calculate(cells: SingleCell[]) {
    this._inputs = await this._granular.inputs(this._docSession);
    const tableIds = new Set(cells.map(cell => cell.tableId));
    for (const tableId of tableIds) {
      this._tableAccess.set(tableId, await this._granular.hasTableAccess(this._docSession, tableId));
      if (this._tableAccess.get(tableId)) {
        const rowIds = new Set(cells.filter(cell => cell.tableId === tableId).map(cell => cell.rowId));
        const rows = await this._getRows(tableId, rowIds);
        for(const [idx, rowId] of rows[2].entries()) {
          if (rowIds.has(rowId) === false) { continue; }
          const rec = new RecordView(rows, idx);
          const input: PredicateFormulaInput = {...this._inputs, rec, newRec: rec};
          const rowPermInfo = new PermissionInfo(this._ruler.ruleCollection, input);
          if (!this._rowPermInfo.has(tableId)) {
            this._rowPermInfo.set(tableId, new Map());
          }
          this._rowPermInfo.get(tableId)!.set(rows[2][idx], rowPermInfo);
          this._rows.set(tableId, rows);
        }
      }
    }
  }

  /**
   * Checks if user has a read access to a particular cell. Needs to be called after calculate().
   */
  public hasAccess(cell: SingleCell) {
    const rowPermInfo = this._rowPermInfo.get(cell.tableId)?.get(cell.rowId);
    if (!rowPermInfo) { return true; }
    const rowAccess = rowPermInfo.getTableAccess(cell.tableId).perms.read;
    if (rowAccess === 'deny') { return true; }
    if (rowAccess !== 'allow') {
      const colAccess = rowPermInfo.getColumnAccess(cell.tableId, cell.colId).perms.read;
      if (colAccess === 'deny') { return true; }
    }
    const colValues = this._rows.get(cell.tableId);
    if (!colValues || !(cell.colId in colValues[3])) { return true; }
    return false;
  }

  private async _getRows(tableId: string, rowIds: Set<number>) {
    if (this._state) {
      const rows = this._state.getTable(tableId)!.getTableDataAction();
      return rows;
    }
    if (this._fetchQueryFromDB) {
      return await this._fetchQueryFromDB({
        tableId,
        filters: { id: [...rowIds] }
      });
    }
    return ['TableData', tableId, [], {}] as TableDataAction;
  }
}


/**
 * Manage censoring metadata.
 *
 * For most metadata, censoring means blanking out certain fields, rather than removing rows,
 * (because the latter was too big of a change). In particular, these changes are relied on by
 * other code:
 *
 *  - Censored tables (from _grist_Tables) have cleared tableId field. To check for it, use the
 *    isTableCensored() helper in app/common/isHiddenTable.ts. This is used by exports to Excel.
 */
export class CensorshipInfo {
  public censoredTables = new Set<number>();
  public censoredSections = new Set<number>();
  public censoredViews = new Set<number>();
  public censoredColumns = new Set<number>();
  public censoredFields = new Set<number>();
  public censoredComments = new Set<number>();
  public censored = {
    _grist_Tables: this.censoredTables,
    _grist_Tables_column: this.censoredColumns,
    _grist_Views: this.censoredViews,
    _grist_Views_section: this.censoredSections,
    _grist_Views_section_field: this.censoredFields,
    _grist_Cells: this.censoredComments,
  };

  public constructor(permInfo: PermissionInfo,
                     ruleCollection: ACLRuleCollection,
                     tables: {[key: string]: TableDataAction},
                     private _canViewACLs: boolean,
                     cellAccessInfo?: CellAccessHelper) {
    // Collect a list of censored columns (by "<tableRef> <colId>").
    const columnCode = (tableRef: number, colId: string) => `${tableRef} ${colId}`;
    const censoredColumnCodes: Set<string> = new Set();
    const tableRefToTableId: Map<number, string> = new Map();
    const tableRefToIndex: Map<number, number> = new Map();
    const columnRefToColId: Map<number, string> = new Map();
    const uncensoredTables: Set<number> = new Set();
    // Scan for forbidden tables.
    let rec = new RecordView(tables._grist_Tables, undefined);
    let ids = getRowIdsFromDocAction(tables._grist_Tables);
    for (let idx = 0; idx < ids.length; idx++) {
      rec.index = idx;
      const tableId = rec.get('tableId') as string;
      const tableRef = ids[idx];
      tableRefToTableId.set(tableRef, tableId);
      tableRefToIndex.set(tableRef, idx);
      const tableAccess = permInfo.getTableAccess(tableId);
      if (tableAccess.perms.read === 'deny') {
        this.censoredTables.add(tableRef);
      } else if (tableAccess.perms.read === 'allow') {
        uncensoredTables.add(tableRef);
      }
    }
    // Scan for forbidden columns.
    ids = getRowIdsFromDocAction(tables._grist_Tables_column);
    rec = new RecordView(tables._grist_Tables_column, undefined);
    for (let idx = 0; idx < ids.length; idx++) {
      rec.index = idx;
      const tableRef = rec.get('parentId') as number;
      const colId = rec.get('colId') as string;
      const colRef = ids[idx];
      columnRefToColId.set(colRef, colId);
      if (uncensoredTables.has(tableRef)) { continue; }
      const tableId = tableRefToTableId.get(tableRef);
      if (!tableId) { throw new Error('table not found: ' + tableRef); }
      if (this.censoredTables.has(tableRef) ||
          (colId !== 'manualSort' && permInfo.getColumnAccess(tableId, colId).perms.read === 'deny')) {
        censoredColumnCodes.add(columnCode(tableRef, colId));
      }
      if (isTransformColumn(colId) && permInfo.getColumnAccess(tableId, colId).perms.schemaEdit === 'deny') {
        censoredColumnCodes.add(columnCode(tableRef, colId));
      }
    }
    // Collect a list of all sections and views containing a table to which the user has no access.
    rec = new RecordView(tables._grist_Views_section, undefined);
    ids = getRowIdsFromDocAction(tables._grist_Views_section);
    for (let idx = 0; idx < ids.length; idx++) {
      rec.index = idx;
      if (!this.censoredTables.has(rec.get('tableRef') as number)) { continue; }
      const parentId = rec.get('parentId') as number;
      if (parentId) { this.censoredViews.add(parentId); }
      this.censoredSections.add(ids[idx]);
    }
    // Collect a list of all columns from tables to which the user has no access.
    rec = new RecordView(tables._grist_Tables_column, undefined);
    ids = getRowIdsFromDocAction(tables._grist_Tables_column);
    for (let idx = 0; idx < ids.length; idx++) {
      rec.index = idx;
      const parentId = rec.get('parentId') as number;
      if (this.censoredTables.has(parentId) ||
          censoredColumnCodes.has(columnCode(parentId, rec.get('colId') as string))) {
        this.censoredColumns.add(ids[idx]);
      }
    }
    // Collect a list of all fields from sections to which the user has no access.
    rec = new RecordView(tables._grist_Views_section_field, undefined);
    ids = getRowIdsFromDocAction(tables._grist_Views_section_field);
    for (let idx = 0; idx < ids.length; idx++) {
      rec.index = idx;
      if (!this.censoredSections.has(rec.get('parentId') as number) &&
          !this.censoredColumns.has(rec.get('colRef') as number)) { continue; }
      this.censoredFields.add(ids[idx]);
    }

    // Now undo some of the above...
    // Specifically, when a summary table is not censored, uncensor the source table's raw view section,
    // so that the user can see the source table's title,
    // which is used to construct the summary table's title. The section's fields remain censored.
    // This would also be a sensible place to uncensor the source tableId, but that causes other problems.
    rec = new RecordView(tables._grist_Tables, undefined);
    ids = getRowIdsFromDocAction(tables._grist_Tables);
    for (let idx = 0; idx < ids.length; idx++) {
      rec.index = idx;
      const tableRef = ids[idx];
      const sourceTableRef = rec.get('summarySourceTable') as number;
      const sourceTableIndex = tableRefToIndex.get(sourceTableRef);
      if (
        this.censoredTables.has(tableRef) ||
        !sourceTableRef ||
        sourceTableIndex === undefined ||
        !this.censoredTables.has(sourceTableRef)
      ) { continue; }
      rec.index = sourceTableIndex;
      const rawViewSectionRef = rec.get('rawViewSectionRef') as number;
      this.censoredSections.delete(rawViewSectionRef);
    }

    // Collect a list of all cells metadata to which the user has no access.
    rec = new RecordView(tables._grist_Cells, undefined);
    ids = tables._grist_Cells ? getRowIdsFromDocAction(tables._grist_Cells) : [];
    for (let idx = 0; idx < ids.length; idx++) {
      rec.index = idx;
      const isTableCensored = () => this.censoredTables.has(rec.get('tableRef') as number);
      const isColumnCensored = () => this.censoredColumns.has(rec.get('colRef') as number);
      const isCellCensored = () => {
        if (!cellAccessInfo) { return false; }
        const cell = {
          tableId: tableRefToTableId.get(rec.get('tableRef') as number)!,
          colId: columnRefToColId.get(rec.get('colRef') as number)!,
          rowId: rec.get('rowId') as number
        };
        return !cell.tableId || !cell.colId || cellAccessInfo.hasAccess(cell);
      };
      if (isTableCensored() || isColumnCensored() || isCellCensored()) {
        this.censoredComments.add(ids[idx]);
      }
    }
  }

  public filter(a: DataAction) {
    const tableId = getTableId(a);
    if (['_grist_ACLResources', '_grist_ACLRules', '_grist_Shares'].includes(tableId)) {
      if (!this._canViewACLs && a[0] === 'TableData') {
        a[2] = [];
        a[3] = {};
      }
      return this._canViewACLs;
    }
    if (!(tableId in this.censored)) { return true; }

    const rec = new RecordEditor(a, undefined, true);
    const method = getCensorMethod(getTableId(a));
    const censoredRows = (this.censored as any)[tableId] as Set<number>;
    const ids = getRowIdsFromDocAction(a);
    for (const [index, id] of ids.entries()) {
      if (censoredRows.has(id)) {
        rec.index = index;
        method(rec);
      }
    }
    return true;
  }
}

function getCensorMethod(tableId: string): (rec: RecordEditor) => void {
  switch (tableId) {
    case '_grist_Tables':
      return rec => rec.set('tableId', '');
    case '_grist_Views':
      return rec => rec.set('name', '');
    case '_grist_Views_section':
      return rec => rec.set('title', '').set('tableRef', 0);
    case '_grist_Tables_column':
      return rec => rec.set('label', '').set('colId', '').set('widgetOptions', '')
        .set('formula', '').set('type', 'Any').set('parentId', 0);
    case '_grist_Views_section_field':
      return rec => rec.set('widgetOptions', '').set('filter', '').set('parentId', 0);
    case '_grist_Cells':
        return rec => rec.set('content', [GristObjCode.Censored]).set('userRef', '');
    default:
      throw new Error(`cannot censor ${tableId}`);
  }
}

function scanActionsRecursively<T extends DocAction|UserAction>(actions: T[],
                                check: (action: T) => boolean): boolean {
  for (const a of actions) {
    if (a[0] === 'ApplyUndoActions' || a[0] === 'ApplyDocActions') {
      return scanActionsRecursively(a[1] as T[], check);
    }
    if (check(a)) { return true; }
  }
  return false;
}

async function applyToActionsRecursively(actions: (DocAction|UserAction)[],
                                         op: (action: DocAction|UserAction) => Promise<void>): Promise<void> {
  for (const a of actions) {
    if (a[0] === 'ApplyUndoActions' || a[0] === 'ApplyDocActions') {
      await applyToActionsRecursively(a[1] as UserAction[], op);
    }
    await op(a);
  }
}

/**
 * Takes an action, and removes certain cells from it.  The action
 * passed in is modified in place, and also returned as part of a list
 * of derived actions.
 *
 * For a non-bulk action, any cell values that return true for
 * shouldFilterCell are removed.  For a bulk action, there's no way to
 * express that in general in a single action.  For a bulk action, for
 * any row (identified by row index, not rowId) that returns true for
 * shouldFilterRow, we remove cell values based on shouldFilterCell
 * and add the row to an action with just the remaining cell values.
 *
 * This is by no means a general-purpose function.  It is used only in
 * the implementation of partial undos.  If is factored out for
 * testing purposes.
 *
 * This method could be made unnecessary if a way were created to have
 * unambiguous "holes" in column value arrays, where values for some
 * rows are omitted.
 */
export function filterColValues(action: DataAction,
                                shouldFilterRow: (idx: number) => boolean,
                                shouldFilterCell: (value: CellValue) => boolean): DataAction[] {
  if (isSomeRemoveRecordAction(action)) {
    // removals do not have cells, so nothing to do.
    return [action];
  }

  const colIds = Object.keys(action[3]).sort();
  const colValues = action[3];

  if (!isBulkAction(action)) {
    for (const colId of colIds) {
      if (shouldFilterCell((colValues as ColValues)[colId])) {
        delete colValues[colId];
      }
    }
    return [action];
  }

  const rowIds = action[2];

  // For bulk operations, censored cells require us to reorganize into a set of actions
  // with different columns.
  const parts: Map<string, typeof action> = new Map();
  let at = 0;
  for (let idx = 0; idx < rowIds.length; idx++) {
    if (!shouldFilterRow(idx)) {
      if (idx !== at) {
        // Shuffle columnar data up as we remove rows.
        rowIds[at] = rowIds[idx];
        for (const colId of colIds) {
          (colValues as BulkColValues)[colId][at] = (colValues as BulkColValues)[colId][idx];
        }
      }
      at++;
      continue;
    }
    // Some censored data in this row, so move the row to an action specialized
    // for the set of columns this row has.
    const keys: string[] = [];
    const values: BulkColValues = {};
    for (const colId of colIds) {
      const value = (colValues as BulkColValues)[colId][idx];
      if (!shouldFilterCell(value)) {
        values[colId] = [value];
        keys.push(colId);
      }
    }
    const mergedKey = keys.join(' ');
    const peers = parts.get(mergedKey);
    if (!peers) {
      parts.set(mergedKey, [action[0], action[1], [rowIds[idx]], values]);
    } else {
      peers[2].push(rowIds[idx]);
      for (const key of keys) {
        peers[3][key].push(values[key][0]);
      }
    }
  }
  // Truncate columnar data.
  rowIds.length = at;
  for (const colId of colIds) {
    (colValues as BulkColValues)[colId].length = at;
  }
  // Return all actions, in a consistent order for test purposes.
  return [action, ...[...parts.keys()].sort().map(key => parts.get(key)!)];
}

export function validTableIdString(tableId: any): string {
  if (typeof tableId !== 'string') { throw new Error(`Expected tableId to be a string`); }
  return tableId;
}

function actionHasRuleChange(a: DocAction): boolean {
  return isAclTable(getTableId(a)) || (
    // Check if any helper columns have been specified while adding/updating a metadata record,
    // as this will affect the result of `getHelperCols` in `ACLRuleCollection.ts` and thus the set of ACL resources.
    // Note that removing a helper column doesn't directly trigger this code, but:
    //  - It will typically be accompanied closely by unsetting the helper column on the metadata record.
    //  - `getHelperCols` can handle non-existent helper columns and other similarly invalid metadata.
    //  - Since the column is removed, ACL restrictions on it don't really matter.
    isDataAction(a)
    && ["_grist_Tables_column", "_grist_Views_section_field"].includes(getTableId(a))
    && Boolean(
      a[3]?.hasOwnProperty('rules') ||
      a[3]?.hasOwnProperty('displayCol')
    )
  );
}

/**
 * Wrapper around a permission info object that overrides permissions for transform columns.
 */
class TransformColumnPermissionInfo implements IPermissionInfo {
  constructor(private _inner: IPermissionInfo) {

  }
  public getColumnAccess(tableId: string, colId: string): MixedPermissionSetWithContext {
    const access = this._inner.getColumnAccess(tableId, colId);
    const isSchemaDenied = access.perms.schemaEdit === 'deny';
    // If this is a transform column, it's only accessible if the user has a schemaEdit access.
    if (isSchemaDenied && isTransformColumn(colId)) {
      return {
        ...access,
        perms: {
          create: 'deny',
          read: 'deny',
          update: 'deny',
          delete: 'deny',
          schemaEdit: 'deny',
        }
      };
    }
    return access;
  }
  public getTableAccess(tableId: string): TablePermissionSetWithContext {
    return this._inner.getTableAccess(tableId);
  }
  public getFullAccess(): MixedPermissionSetWithContext {
    return this._inner.getFullAccess();
  }
  public getRuleCollection(): ACLRuleCollection {
    return this._inner.getRuleCollection();
  }
}


/**
 * A version of DocSession that pretends to represent a particular user for the sake of applying
 * access rules to notifications for that user.
 */
export class PseudoDocSession extends OptDocSession {
  public readonly client = null;
  public authorizer: DocAuthorizer = new DummyAuthorizer(this._userData.access, this._docId);

  constructor(private _userData: UserAccessData, private _docId: string, private _org: string|undefined) {
    super({});
  }
  public get org() { return this._org; }
  public get altSessionId() { return null; }
  public get userId() { return this._userData.id; }
  public get userIsAuthorized() { return !this._userData.anonymous; }
  public get fullUser() { return this._userData; }
}
