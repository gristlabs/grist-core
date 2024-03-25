import {KoArray} from 'app/client/lib/koArray';
import {localStorageJsonObs} from 'app/client/lib/localStorageObs';
import {CellRec, DocModel, IRowModel, recordSet,
        refRecord, TableRec, ViewFieldRec} from 'app/client/models/DocModel';
import {urlState} from 'app/client/models/gristUrlState';
import {jsonObservable, ObjObservable} from 'app/client/models/modelUtil';
import {AssistanceState} from 'app/common/AssistancePrompts';
import * as gristTypes from 'app/common/gristTypes';
import {getReferencedTableId} from 'app/common/gristTypes';
import {
  BaseFormatter,
  createFullFormatterRaw,
  createVisibleColFormatterRaw,
  FullFormatterArgs
} from 'app/common/ValueFormatter';
import {createParser} from 'app/common/ValueParser';
import {Observable} from 'grainjs';
import * as ko from 'knockout';
import {v4 as uuidv4} from 'uuid';

// Column behavior type, used primarily in the UI.
export type BEHAVIOR = "empty"|"formula"|"data";

// Represents a column in a user-defined table.
export interface ColumnRec extends IRowModel<"_grist_Tables_column"> {
  table: ko.Computed<TableRec>;
  widgetOptionsJson: ObjObservable<any>;
  /** Widget options that are save to copy over (for now, without rules) */
  cleanWidgetOptionsJson: ko.Computed<string>;
  viewFields: ko.Computed<KoArray<ViewFieldRec>>;
  summarySource: ko.Computed<ColumnRec>;

  // Is an empty column (undecided if formula or data); denoted by an empty formula.
  isEmpty: ko.Computed<boolean>;

  // Is a real formula column (not an empty column; i.e. contains a non-empty formula).
  isRealFormula: ko.Computed<boolean>;

  // Is a trigger formula column (not formula, but contains non-empty formula)
  hasTriggerFormula: ko.Computed<boolean>;

  // Used for transforming a column.
  // Reference to the original column for a transform column, or to itself for a non-transforming column.
  origColRef: ko.Observable<number>;
  origCol: ko.Computed<ColumnRec>;
  // Indicates whether a column is transforming. Manually set, but should be true in both the original
  // column being transformed and that column's transform column.
  isTransforming: ko.Observable<boolean>;

  // Convenience observable to obtain and set the type with no suffix
  pureType: ko.Computed<string>;

  // Column behavior as seen by the user.
  behavior: ko.Computed<BEHAVIOR>;

  // The column's display column
  _displayColModel: ko.Computed<ColumnRec>;

  // Display col ref to use for the column, defaulting to the plain column itself.
  displayColRef: ko.Computed<number>;

  // The display column to use for the column, or the column itself when no displayCol is set.
  displayColModel: ko.Computed<ColumnRec>;
  visibleColModel: ko.Computed<ColumnRec>;

  disableModifyBase: ko.Computed<boolean>;    // True if column config can't be modified (name, type, etc.)
  disableModify: ko.Computed<boolean>;        // True if column can't be modified (is summary) or is being transformed.
  disableEditData: ko.Computed<boolean>;      // True to disable editing of the data in this column.

  isHiddenCol: ko.Computed<boolean>;
  isFormCol: ko.Computed<boolean>;

  // Returns the rowModel for the referenced table, or null, if is not a reference column.
  refTable: ko.Computed<TableRec|null>;

  // Helper for Reference/ReferenceList columns, which returns a formatter according
  // to the visibleCol associated with column.
  visibleColFormatter: ko.Computed<BaseFormatter>;

  // A formatter for values of this column.
  // The difference between visibleColFormatter and formatter is especially important for ReferenceLists:
  // `visibleColFormatter` is for individual elements of a list, sometimes hypothetical
  // (i.e. they aren't actually referenced but they exist in the visible column and are relevant to e.g. autocomplete)
  // `formatter` formats actual cell values, e.g. a whole list from the display column.
  formatter: ko.Computed<BaseFormatter>;
  cells: ko.Computed<KoArray<CellRec>>;

  /**
   * Current history of chat. This is a temporary array used only in the ui.
   */
  chatHistory: ko.PureComputed<Observable<ChatHistory>>;

  // Helper which adds/removes/updates column's displayCol to match the formula.
  saveDisplayFormula(formula: string): Promise<void>|undefined;

  createValueParser(): (value: string) => any;
}

export function createColumnRec(this: ColumnRec, docModel: DocModel): void {
  this.table = refRecord(docModel.tables, this.parentId);
  this.widgetOptionsJson = jsonObservable(this.widgetOptions);
  this.viewFields = recordSet(this, docModel.viewFields, 'colRef');
  this.summarySource = refRecord(docModel.columns, this.summarySourceCol);
  this.cells = recordSet(this, docModel.cells, 'colRef');

  // Is this an empty column (undecided if formula or data); denoted by an empty formula.
  this.isEmpty = ko.pureComputed(() => this.isFormula() && this.formula() === '');

  // Is this a real formula column (not an empty column; i.e. contains a non-empty formula).
  this.isRealFormula = ko.pureComputed(() => this.isFormula() && this.formula() !== '');
  // If this column has a trigger formula defined
  this.hasTriggerFormula = ko.pureComputed(() => !this.isFormula() && this.formula() !== '');

  // Used for transforming a column.
  // Reference to the original column for a transform column, or to itself for a non-transforming column.
  this.origColRef = ko.observable(this.getRowId());
  this.origCol = refRecord(docModel.columns, this.origColRef);
  // Indicates whether a column is transforming. Manually set, but should be true in both the original
  // column being transformed and that column's transform column.
  this.isTransforming = ko.observable(false);

  // Convenience observable to obtain and set the type with no suffix
  this.pureType = ko.pureComputed(() => gristTypes.extractTypeFromColType(this.type()));

  // The column's display column
  this._displayColModel = refRecord(docModel.columns, this.displayCol);

  // Helper which adds/removes/updates this column's displayCol to match the formula.
  this.saveDisplayFormula = function(formula) {
    if (formula !== (this._displayColModel().formula() || '')) {
      return docModel.docData.sendAction(["SetDisplayFormula", this.table().tableId(),
        null, this.getRowId(), formula]);
    }
  };

  // Display col ref to use for the column, defaulting to the plain column itself.
  this.displayColRef = ko.pureComputed(() => this.displayCol() || this.origColRef());

  // The display column to use for the column, or the column itself when no displayCol is set.
  this.displayColModel = refRecord(docModel.columns, this.displayColRef);
  this.visibleColModel = refRecord(docModel.columns, this.visibleCol);

  this.disableModifyBase = ko.pureComputed(() => Boolean(this.summarySourceCol()));
  this.disableModify = ko.pureComputed(() => this.disableModifyBase() || this.isTransforming());
  this.disableEditData = ko.pureComputed(() => Boolean(this.summarySourceCol()));

  this.isHiddenCol = ko.pureComputed(() => gristTypes.isHiddenCol(this.colId()));
  this.isFormCol = ko.pureComputed(() => (
    !this.isHiddenCol() &&
    this.pureType() !== 'Attachments' &&
    !this.isRealFormula()
  ));

  // Returns the rowModel for the referenced table, or null, if this is not a reference column.
  this.refTable = ko.pureComputed(() => {
    const refTableId = getReferencedTableId(this.type() || "");
    return refTableId ? docModel.visibleTables.all().find(t => t.tableId() === refTableId) || null : null;
  });

  // Helper for Reference/ReferenceList columns, which returns a formatter according to the visibleCol
  // associated with this column. If no visible column available, return formatting for the column itself.
  this.visibleColFormatter = ko.pureComputed(() => formatterForRec(this, this, docModel, 'vcol'));

  this.formatter = ko.pureComputed(() => formatterForRec(this, this, docModel, 'full'));

  this.createValueParser = function() {
    const parser = createParser(docModel.docData, this.id.peek());
    return parser.cleanParse.bind(parser);
  };

  this.behavior = ko.pureComputed(() => this.isEmpty() ? 'empty' : this.isFormula() ? 'formula' : 'data');

  this.chatHistory = this.autoDispose(ko.computed(() => {
    const docId = urlState().state.get().doc ?? '';
    // Changed key name from history to history-v2 when ChatHistory changed in incompatible way.
    const key = `formula-assistant-history-v2-${docId}-${this.table().tableId()}-${this.colId()}`;
    return localStorageJsonObs(key, {messages: [], conversationId: uuidv4()} as ChatHistory);
  }));

  this.cleanWidgetOptionsJson = ko.pureComputed(() => {
    const options = this.widgetOptionsJson();
    if (options && options.rules) {
      delete options.rules;
    }
    return JSON.stringify(options);
  });
}

export function formatterForRec(
  rec: ColumnRec | ViewFieldRec, colRec: ColumnRec, docModel: DocModel, kind: 'full' | 'vcol'
): BaseFormatter {
  const vcol = rec.visibleColModel();
  const func = kind === 'full' ? createFullFormatterRaw : createVisibleColFormatterRaw;
  const args: FullFormatterArgs = {
    docData: docModel.docData,
    type: colRec.type(),
    widgetOpts: rec.widgetOptionsJson(),
    visibleColType: vcol?.type(),
    visibleColWidgetOpts: vcol?.widgetOptionsJson(),
    docSettings: docModel.docInfoRow.documentSettingsJson(),
  };
  return func(args);
}

/**
 * A chat message. Either send by the user or by the AI.
 */
export interface ChatMessage {
  /**
   * The message to display. It is a prompt typed by the user or a formula returned from the AI.
   */
  message: string;
  /**
   * The sender of the message. Either the user or the AI.
   */
  sender: 'user' | 'ai';
  /**
   * The formula returned from the AI. It is only set when the sender is the AI.
   */
  formula?: string|null;
  /**
   * Suggested actions returned from the AI.
   */
  action?: any;
}

/**
 * The state of assistance for a particular column.
 * ChatMessages are what are shown in the UI, whereas state is
 * how the back-end represents the conversation. The two are
 * similar but not the same because of post-processing.
 * It may be possible to reconcile them when things settle down
 * a bit?
 */
export interface ChatHistory {
  messages: ChatMessage[];
  conversationId?: string;
  state?: AssistanceState;
}
