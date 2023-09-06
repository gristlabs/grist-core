/**
 * Importer manages an import files to Grist tables
 * TODO: hidden tables should be also deleted on page refresh, error...
 */
// tslint:disable:no-console

import {GristDoc} from 'app/client/components/GristDoc';
import {buildParseOptionsForm, ParseOptionValues} from 'app/client/components/ParseOptions';
import {PluginScreen} from 'app/client/components/PluginScreen';
import {makeTestId} from 'app/client/lib/domUtils';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {makeT} from 'app/client/lib/localization';
import {fetchURL, isDriveUrl, selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {reportError} from 'app/client/models/AppModel';
import {ColumnRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {SortedRowSet} from 'app/client/models/rowset';
import {buildHighlightedCode} from 'app/client/ui/CodeHighlight';
import {openFilePicker} from 'app/client/ui/FileDialog';
import {ACCESS_DENIED, AUTH_INTERRUPTED, canReadPrivateFiles, getGoogleCodeForReading} from 'app/client/ui/googleAuth';
import {cssPageIcon} from 'app/client/ui/LeftPanelCommon';
import {hoverTooltip, overflowTooltip} from 'app/client/ui/tooltips';
import {bigBasicButton, bigPrimaryButton, textButton} from 'app/client/ui2018/buttons';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {testId as baseTestId, theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {IOptionFull, menuDivider, menuItem, multiSelect, selectMenu, selectOption} from 'app/client/ui2018/menus';
import {cssModalTitle} from 'app/client/ui2018/modals';
import {openFormulaEditor} from 'app/client/widgets/FormulaEditor';
import {
  DataSourceTransformed,
  DestId,
  ImportResult,
  ImportTableResult,
  MergeOptions,
  MergeOptionsMap,
  MergeStrategy,
  NEW_TABLE,
  SKIP_TABLE,
  TransformColumn,
  TransformRule,
  TransformRuleMap
} from 'app/common/ActiveDocAPI';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {byteString, not} from 'app/common/gutil';
import {FetchUrlOptions, UploadResult} from 'app/common/uploads';
import {ParseOptions, ParseOptionSchema} from 'app/plugin/FileParserAPI';
import {
  Computed,
  Disposable,
  dom,
  DomContents,
  fromKo,
  Holder,
  IDisposable,
  MultiHolder,
  MutableObsArray,
  obsArray,
  Observable,
  styled,
  UseCBOwner
} from 'grainjs';
import debounce = require('lodash/debounce');

const t = makeT('Importer');
// Custom testId that can be appended conditionally.
const testId = makeTestId('test-importer-');


// We expect a function for creating the preview GridView, to avoid the need to require the
// GridView module here. That brings many dependencies, making a simple test fixture difficult.
type CreatePreviewFunc = (vs: ViewSectionRec) => GridView;
type GridView = IDisposable & {viewPane: HTMLElement, sortedRows: SortedRowSet, listenTo: (...args: any[]) => void};
const TABLE_MAPPING = 1;
const COLUMN_MAPPING = 2;
type ViewType = typeof TABLE_MAPPING | typeof COLUMN_MAPPING;

/**
 * Information returned by the backend of the current import state, and how the table and sections look there.
 * Also contains some UI state, so it is updated with the data that comes from the backend.
 */
export interface SourceInfo {
  /** Table id that holds the imported data. */
  hiddenTableId: string;
  /** Uploaded file index */
  uploadFileIndex: number;
  /** Table name that was figured out by the backend. File name or tab in excel name */
  origTableName: string;
  /**
   * Section that contains only imported columns. It is not shown to the user.
   * Table besides the imported data have formula columns that are used to finalize import. Those formula
   * columns are not part of this section.
   */
  sourceSection: ViewSectionRec;
  /**
   * A viewSection containing transform (formula) columns pointing to the original source columns.
   * When user selects New table, they are basically formulas pointing to the source columns.
   * When user selects Existing table, new formula columns are created that look like the selected table, and this
   * section contains those formula columns.
   */
  transformSection: Observable<ViewSectionRec|null>;
  /** The destination table id, selected by the user. Can be null for skip and empty string for `New table`  */
  destTableId: Observable<DestId>;
  /** True if there is at least one request in progress to create a new transform section. */
  isLoadingSection: Observable<boolean>;
  /** Reference to last promise for the GenImporterView action (which creates `transformSection`). */
  lastGenImporterViewPromise: Promise<any>|null;
  /** Selected view, can be table mapping or column mapping, used only in UI. */
  selectedView: Observable<ViewType>;
  /** List of columns that were customized (have custom formulas) */
  customizedColumns: Observable<Set<string>>;
}

/** Changes the customization flag for the column */
function toggleCustomized(info: SourceInfo, colId: string, on: boolean): void {
  const customizedColumns = info.customizedColumns.get();
  if (!on) {
    customizedColumns.delete(colId);
  } else {
    customizedColumns.add(colId);
  }
  info.customizedColumns.set(new Set(customizedColumns));
}


/**
 * UI state for each imported table (file). Maps table id to the info object.
 */
interface MergeOptionsStateMap {
  [hiddenTableId: string]: MergeOptionsState|undefined;
}

/**
 * UI state of merge options for a SourceInfo.
 */
interface MergeOptionsState {
  /**
   * Whether to update existing records or only add new ones. If false, mergeCols is empty.
   */
  updateExistingRecords: Observable<boolean>;
  /**
   * List of column ids to merge on if user set `updateExistingRecords` to true. Those are columns from the
   * target table.
   */
  mergeCols: MutableObsArray<string>;
  /**
   * Merge strategy to use, not used currently.
   */
  mergeStrategy: Observable<MergeStrategy>;
  /**
   * Whether mergeCols contains invalid columns (set in the code to show error message).
   */
  hasInvalidMergeCols: Observable<boolean>;
}

/**
 * Imports using the given plugin importer.
 */
export async function selectAndImport(
  gristDoc: GristDoc,
  imports: ImportSourceElement[],
  importSourceElem: ImportSourceElement,
  createPreview: CreatePreviewFunc
) {
  // HACK: The url plugin does not support importing from google drive, and we don't want to
  // ask a user for permission to access all his files (needed to download a single file from an URL).
  // So to have a nice user experience, we will switch to the built-in google drive plugin and allow
  // user to chose a file manually.
  // Suggestion for the future is:
  // (1) ask the user for the greater permission,
  // (2) detect when the permission is not granted, and open the picker-based plugin in that case.
  try {
    // Importer disposes itself when its dialog is closed, so we do not take ownership of it.
    await Importer.create(null, gristDoc, importSourceElem, createPreview).pickAndUploadSource(null);
  } catch(err1) {
    // If the url was a Google Drive Url, run the google drive plugin.
    if (!(err1 instanceof GDriveUrlNotSupported)) {
      reportError(err1);
    } else {
      const gdrivePlugin = imports.find((p) => p.plugin.definition.id === 'builtIn/gdrive' && p !== importSourceElem);
      if (!gdrivePlugin) {
        reportError(err1);
      } else {
        try {
          await Importer.create(null, gristDoc, gdrivePlugin, createPreview).pickAndUploadSource(null);
        } catch(err2) {
          reportError(err2);
        }
      }
    }
  }
}

/**
 * Imports from file.
 */
export async function importFromFile(gristDoc: GristDoc, createPreview: CreatePreviewFunc) {
  // In case of using built-in file picker we want to get upload result before instantiating Importer
  // because if the user dismisses the dialog without picking a file,
  // there is no good way to detect this and dispose Importer.
  let uploadResult: UploadResult|null = null;
  // Use the built-in file picker. On electron, it uses the native file selector (without
  // actually uploading anything), which is why this requires a slightly different flow.
  const files: File[] = await openFilePicker({multiple: true});
  // Important to fork first before trying to import, so we end up uploading to a
  // consistent doc worker.
  await gristDoc.forkIfNeeded();
  const label = files.map(f => f.name).join(', ');
  const size = files.reduce((acc, f) => acc + f.size, 0);
  const app = gristDoc.app.topAppModel.appObs.get();
  const progress = app ? app.notifier.createProgressIndicator(label, byteString(size)) : null;
  const onProgress = (percent: number) => progress && progress.setProgress(percent);
  try {
    onProgress(0);
    uploadResult = await uploadFiles(files, {docWorkerUrl: gristDoc.docComm.docWorkerUrl,
                                              sizeLimit: 'import'}, onProgress);
    onProgress(100);
  } finally {
    if (progress) {
      progress.dispose();
    }
  }
  // Importer disposes itself when its dialog is closed, so we do not take ownership of it.
  await Importer.create(null, gristDoc, null, createPreview).pickAndUploadSource(uploadResult);
}


/**
 * Importer manages an import files to Grist tables and shows Preview
 */
export class Importer extends DisposableWithEvents {

  private _docComm = this._gristDoc.docComm;
  private _uploadResult?: UploadResult;

  private _screen: PluginScreen;
  private _optionsScreenHolder = Holder.create(this);
  /**
   * Merge information (for updating existing rows).
   */
  private _mergeOptions: MergeOptionsStateMap = {};
  /**
   * Parsing options (for parsing the file), passed to the backend directly.
   */
  private _parseOptions = Observable.create<ParseOptions>(this, {});
  /**
   * Info about the data that was parsed from the imported files (or tabs in excel).
   */
  private _sourceInfoArray = Observable.create<SourceInfo[]>(this, []);
  /**
   * Currently selected table to import (a file or a tab in excel).
   */
  private _sourceInfoSelected = Observable.create<SourceInfo|null>(this, null);

  // Owner of the observables in the _sourceInfoArray
  private readonly _sourceInfoHolder = Holder.create(this);

  // Holder for the column mapping formula editor.
  private readonly _formulaEditorHolder = Holder.create(this);

  /**
   * Helper for the preview section (the transformSection from the backend). The naming is misleading a bit, sorry
   * about that, but this transform section is shown to the user as a Grid.
   *
   * We need a helper to make sure section is in good state before showing it to the user.
   */
  private _previewViewSection: Observable<ViewSectionRec|null> =
    Computed.create(this, this._sourceInfoSelected, (use, info) => {
      if (!info) { return null; }

      const isLoading = use(info.isLoadingSection);
      if (isLoading) { return null; }

      const viewSection = use(info.transformSection);
      return viewSection && !viewSection.isDisposed() && !use(viewSection._isDeleted) ? viewSection : null;
    });

  /**
   * True if there is at least one request in progress to generate an import diff.
   */
  private _isLoadingDiff = Observable.create(this, false);
  // Promise for the most recent generateImportDiff action.
  private _lastGenImportDiffPromise: Promise<any>|null = null;

  private _debouncedUpdateDiff = debounce(this._updateDiff, 1000, {leading: true, trailing: true});

  /**
   * Flag that is set when _updateImportDiff is called, and unset when _debouncedUpdateDiff begins executing.
   *
   * This is a workaround until Lodash's next release, which supports checking if a debounced function is
   * pending. We need to know if more debounced calls are pending so that we can decide to take down the
   * loading spinner over the preview table, or leave it up until all scheduled calls settle.
   */
  private _hasScheduledDiffUpdate = false;

  /**
   * destTables is a list of tables user can choose to import data into, in the format suitable for the UI to consume.
   */
  private _destTables = Computed.create<Array<IOptionFull<DestId>>>(this, (use) => [
    ...use(this._gristDoc.docModel.visibleTableIds.getObservable()).map((id) => ({value: id, label: id})),
  ]);

  /**
   * List of transform fields, i.e. those formula fields of the transform section whose values will be used to
   * populate the destination columns.
   * For `New table` those fields are 1-1 with columns imported from the file.
   * For `Existing table` those are fields that simulate the target table columns.
   * In UI we will call it `GRIST COLUMNS`, whereas source columns will be called `SOURCE COLUMNS`.
   *
   * This is helper that makes sure that those fields from the transformSection are in a good state to show.
   */
  private _transformFields: Computed<ViewFieldRec[]|null> = Computed.create(
      this, this._sourceInfoSelected, (use, info) => {
    const section = info && use(info.transformSection);
    if (!section || use(section._isDeleted)) { return null; }
    return use(use(section.viewFields).getObservable());
  });

  /**
   * Prepare a Map, mapping of colRef of each transform column to the set of options to offer in
   * the dropdown. The options are represented as a Map too, mapping formula to label.
   *
   * It only matters for importing into existing table. Transform column are perceived as GRIST COLUMNS, so those
   * columns that will be updated or imported into.
   *
   * For each of such column, this will create a map of possible options to choose in from (except SKIP).
   * The result is a map (treated as just list of Records), with a formula and label to show in the UI.
   * This formula will be used to update the target helper column, when user selects it.
   *
   * For example:
   * File has those columns: `Name`, `Age`, `City`, `Country`
   * Existing table has those: `First name`, `Last name`.
   *
   * So for `First name` (and `Last name`) we will have a map of options:
   * - `$Name` -> `Name`
   * - `$City` -> `City`
   * - `$Country` -> `Country`
   * - `$Age` -> `Age`
   * (and skip added in the UI).
   *
   * There are some special cases for References and column ids.
   */
  private _transformColImportOptions: Computed<Map<number, Map<string, string>>> = Computed.create(
      this, this._transformFields, this._sourceInfoSelected, (use, fields, info) => {
    if (!fields || !info) { return new Map(); }
    return new Map(fields.map(f =>
      [use(f.colRef), this._makeImportOptionsForCol(use(f.column), info)]));
  });

  /**
   * List of labels of destination columns that aren't mapped to a source column, i.e. transform
   * columns with empty formulas.
   *
   * In other words, this is a list of GRIST COLUMNS that are not mapped to any SOURCE COLUMNS, so
   * columns that won't be imported.
   */
  private _unmatchedFieldsMap: Computed<Map<SourceInfo, string[]|null>> = Computed.create(this, use => {
    const sources = use(this._sourceInfoArray);
    const result = new Map<SourceInfo, string[]|null>();
    const unmatched = (info: SourceInfo) => {
      // If Skip import selected, ignore.
      if (use(info.destTableId) === SKIP_TABLE) { return null; }
      // If New table selected, ignore.
      if (use(info.destTableId) === NEW_TABLE) { return null; }
      // Otherwise, return list of labels of unmatched fields.
      const section = info && use(info.transformSection);
      if (!section || section.isDisposed() || use(section._isDeleted)) { return null; }
      const fields = use(use(section.viewFields).getObservable());
      const labels = fields?.filter(f => (use(use(f.column).formula).trim() === ''))
                            .map(f => use(f.label)) ?? null;
      return labels?.length ? labels : null;
    };
    for (const info of sources) {
      result.set(info, unmatched(info));
    }
    return result;
  });

  constructor(private _gristDoc: GristDoc,
              // null tells to use the built-in file picker.
              private _importSourceElem: ImportSourceElement|null,
              private _createPreview: CreatePreviewFunc) {
    super();
    const label = _importSourceElem?.importSource.label || "Import from file";
    this._screen = PluginScreen.create(this, label);

    this.onDispose(() => {
      this._resetImportDiffState();
    });
  }

  /*
   * Uploads file to the server using the built-in file picker or a plugin instance.
   */
  public async pickAndUploadSource(uploadResult: UploadResult|null = null) {
    try {
      if (!this._importSourceElem) {
        // Use upload result if it was passed in or the built-in file picker.
        // On electron, it uses the native file selector (without actually uploading anything),
        // which is why this requires a slightly different flow.
        uploadResult = uploadResult || await selectFiles({docWorkerUrl: this._docComm.docWorkerUrl,
                                                          multiple: true, sizeLimit: 'import'});
      } else {
        // Need to use plugin to get the data, and manually upload it.
        const plugin = this._importSourceElem.plugin;
        const handle = this._screen.renderPlugin(plugin);
        const importSource = await this._importSourceElem.importSourceStub.getImportSource(handle);
        plugin.removeRenderTarget(handle);
        this._screen.renderSpinner();

        if (importSource) {
          // If data has been picked, upload it.
          const item = importSource.item;
          if (item.kind === "fileList") {
            const files = item.files.map(({content, name}) => new File([content], name));
            uploadResult = await uploadFiles(files, {docWorkerUrl: this._docComm.docWorkerUrl,
                                                     sizeLimit: 'import'});
          } else if (item.kind ===  "url") {
            if (isDriveUrl(item.url)) {
              uploadResult = await this._fetchFromDrive(item.url);
            } else {
              uploadResult = await fetchURL(this._docComm, item.url);
            }
          } else {
            throw new Error(`Import source of kind ${(item as any).kind} are not yet supported!`);
          }
        }
      }
    } catch (err) {
      if (err instanceof CancelledError) {
        await this._cancelImport();
        return;
      }
      if (err instanceof GDriveUrlNotSupported) {
        await this._cancelImport();
        throw err;
      }
      this._screen.renderError(err.message);
      return;
    }

    if (uploadResult) {
      this._uploadResult = uploadResult;
      await this._reImport(uploadResult);
    } else {
      await this._cancelImport();
    }
  }

  private _getPrimaryViewSection(tableId: string): ViewSectionRec {
    const tableModel = this._gristDoc.getTableModel(tableId);
    const viewRow = tableModel.tableMetaRow.primaryView.peek();
    return viewRow.viewSections.peek().peek()[0];
  }

  private _getSectionByRef(sectionRef: number): ViewSectionRec {
    return this._gristDoc.docModel.viewSections.getRowModel(sectionRef);
  }

  private async _updateTransformSection(sourceInfo: SourceInfo) {
    this._resetImportDiffState();

    sourceInfo.isLoadingSection.set(true);
    sourceInfo.transformSection.set(null);

    const genImporterViewPromise = this._gristDoc.docData.sendAction(
      ['GenImporterView', sourceInfo.hiddenTableId, sourceInfo.destTableId.get(), null, null]);
    sourceInfo.lastGenImporterViewPromise = genImporterViewPromise;
    const transformSectionRef = (await genImporterViewPromise).viewSectionRef;

    // If the request is superseded by a newer request, or the Importer is disposed, do nothing.
    if (this.isDisposed() || sourceInfo.lastGenImporterViewPromise !== genImporterViewPromise) {
      return;
    }

    // Otherwise, update the transform section for `sourceInfo`.
    sourceInfo.transformSection.set(this._gristDoc.docModel.viewSections.getRowModel(transformSectionRef));
    sourceInfo.isLoadingSection.set(false);

    // Change the active section to the transform section, so that formula autocomplete works.
    this._gristDoc.viewModel.activeSectionId(transformSectionRef);
  }

  /**
   * Reads the configuration from the temporary table and creates a configuration map for each table.
   */
  private _getTransformedDataSource(upload: UploadResult): DataSourceTransformed {
    const transforms: TransformRuleMap[] = upload.files.map((file, i) => this._createTransformRuleMap(i));
    return {uploadId: upload.uploadId, transforms};
  }

  private _getMergeOptionMaps(upload: UploadResult): MergeOptionsMap[] {
    return upload.files.map((_file, i) => this._createMergeOptionsMap(i));
  }

  private _createTransformRuleMap(uploadFileIndex: number): TransformRuleMap {
    const result: TransformRuleMap = {};
    for (const sourceInfo of this._sourceInfoArray.get()) {
      if (sourceInfo.uploadFileIndex === uploadFileIndex) {
        result[sourceInfo.origTableName] = this._createTransformRule(sourceInfo);
      }
    }
    return result;
  }

  private _createMergeOptionsMap(uploadFileIndex: number): MergeOptionsMap {
    const result: MergeOptionsMap = {};
    for (const sourceInfo of this._sourceInfoArray.get()) {
      if (sourceInfo.uploadFileIndex === uploadFileIndex) {
        result[sourceInfo.origTableName] = this._getMergeOptionsForSource(sourceInfo);
      }
    }
    return result;
  }

  private _createTransformRule(sourceInfo: SourceInfo): TransformRule {
    const transformSection = sourceInfo.transformSection.get();
    if (!transformSection) {
      throw new Error(`Table ${sourceInfo.hiddenTableId} is missing transform section`);
    }

    const transformFields = transformSection.viewFields().peek();
    const sourceFields = sourceInfo.sourceSection.viewFields().peek();

    const destTableId: DestId = sourceInfo.destTableId.get();
    return {
      destTableId,
      destCols: transformFields.map<TransformColumn>((field) => ({
        label: field.label(),
        colId: destTableId ? field.colId() : null, // if inserting into new table, colId isn't defined
        type: field.column().type(),
        widgetOptions: field.column().widgetOptions(),
        formula: field.column().formula()
      })),
      sourceCols: sourceFields.map((field) => field.colId())
    };
  }

  private _getMergeOptionsForSource(sourceInfo: SourceInfo): MergeOptions|undefined {
    const mergeOptions = this._mergeOptions[sourceInfo.hiddenTableId];
    if (!mergeOptions) { return undefined; }

    const {updateExistingRecords, mergeCols, mergeStrategy} = mergeOptions;
    return {
      mergeCols: updateExistingRecords.get() ? mergeCols.get() : [],
      mergeStrategy: mergeStrategy.get()
    };
  }

  private _getHiddenTableIds(): string[] {
    return this._sourceInfoArray.get().map((si: SourceInfo) => si.hiddenTableId);
  }

  private async _reImport(upload: UploadResult) {
    this._screen.renderSpinner();
    this._resetImportDiffState();
    try {
      // Initialize parsing options with NUM_ROWS=0 (a whole file).
      const parseOptions = {...this._parseOptions.get(), NUM_ROWS: 0};

      // Create the temporary tables and import the files into it.
      const importResult: ImportResult = await this._docComm.importFiles(
        this._getTransformedDataSource(upload), parseOptions, this._getHiddenTableIds());

      // Update the parsing options with the actual one used by the importer (it might have changed)
      this._parseOptions.set(importResult.options);

      this._sourceInfoHolder.clear();
      const owner = MultiHolder.create(this._sourceInfoHolder);

      // Read the information from what was imported in a better representation and some metadata, we
      // will allow to change by the user.
      this._sourceInfoArray.set(importResult.tables.map((info: ImportTableResult) => ({
        hiddenTableId: info.hiddenTableId,
        uploadFileIndex: info.uploadFileIndex,
        origTableName: info.origTableName,
        // This is the section with the data imported.
        sourceSection: this._getPrimaryViewSection(info.hiddenTableId)!,
        // This is the section created every time user changes the configuration, used for the preview.
        transformSection: Observable.create(owner, this._getSectionByRef(info.transformSectionRef)),
        // This is the table where the data will be imported, either a new table or an existing one.
        // If a new one, it will be hidden for a while, until the user confirms the import.
        destTableId: Observable.create<DestId>(owner, info.destTableId ?? NEW_TABLE),
        // Helper to show the spinner.
        isLoadingSection: Observable.create(owner, false),
        // and another one.
        lastGenImporterViewPromise: null,
        // Which view to show or was shown previously.
        selectedView: Observable.create(owner, TABLE_MAPPING),
        // List of customized
        customizedColumns: Observable.create(owner, new Set<string>()),
      })));

      if (this._sourceInfoArray.get().length === 0) {
        throw new Error("No data was imported");
      }

      this._prepareMergeOptions();

      // Select the first sourceInfo to show in preview.
      this._sourceInfoSelected.set(this._sourceInfoArray.get()[0] || null);

      // And finally render the main screen.
      this._renderMain(upload);
    } catch (e) {
      console.warn("Import failed", e);
      this._screen.renderError(e.message);
    }
  }

  /**
   * Create a merging options. This is an extension to the configuration above (_sourceInfoArray).
   * By default, we are pointing to new tables, so it is empty. This method is used to communicate
   * with the user about what they want and how they want to merge the data.
   * For an existing table, it will be filled by the user with columns to merge on (how to identify
   * existing rows).
   */
  private _prepareMergeOptions() {
    this._mergeOptions = {};
    this._getHiddenTableIds().forEach(tableId => {
      this._mergeOptions[tableId] = {
        // By default no, as we are importing into new tables.
        updateExistingRecords: Observable.create(null, false),
        // Empty, user will select it for existing table.
        mergeCols: obsArray(),
        // Strategy for the backend (from UI we don't care about it).
        mergeStrategy: Observable.create(null, {type: 'replace-with-nonblank-source'}),
        // Helper to show the validation that something is wrong with the columns selected to merge.
        hasInvalidMergeCols: Observable.create(null, false),
      };
    });
  }

  private async _maybeFinishImport(upload: UploadResult) {
    const isConfigValid = this._validateImportConfiguration();
    if (!isConfigValid) { return; }

    this._screen.renderSpinner();
    this._resetImportDiffState();

    const parseOptions = {...this._parseOptions.get(), NUM_ROWS: 0};
    const mergeOptionMaps = this._getMergeOptionMaps(upload);

    const importResult: ImportResult = await this._docComm.finishImportFiles(
      this._getTransformedDataSource(upload), this._getHiddenTableIds(), {mergeOptionMaps, parseOptions});

    // This is not hidden table anymore, it was renamed to the name of the final table.
    if (importResult.tables[0]?.hiddenTableId) {
      const tableRowModel = this._gristDoc.docModel.dataTables[importResult.tables[0].hiddenTableId].tableMetaRow;
      const primaryViewId = tableRowModel.primaryViewId();
      if (primaryViewId) {
        // Switch page if there is a sensible one to switch to.
        await this._gristDoc.openDocPage(primaryViewId);
      }
    }
    this._screen.close();
    this.dispose();
  }

  private async _cancelImport() {
    this._resetImportDiffState();
    // Formula editor cleanup needs to happen before the hidden tables are removed.
    this._formulaEditorHolder.dispose();
    if (this._uploadResult) {
      await this._docComm.cancelImportFiles(this._uploadResult.uploadId, this._getHiddenTableIds());
    }
    this._screen.close();
    this.dispose();
  }

  private _resetTableMergeOptions(tableId: string) {
    this._mergeOptions[tableId]?.mergeCols.set([]);
  }

  private _validateImportConfiguration(): boolean {
    let isValid = true;

    const selectedSourceInfo = this._sourceInfoSelected.get();
    if (!selectedSourceInfo) { return isValid; } // No configuration to validate.

    const mergeOptions = this._mergeOptions[selectedSourceInfo.hiddenTableId];
    if (!mergeOptions) { return isValid; } // No configuration to validate.

    const destTableId = selectedSourceInfo.destTableId.get();
    const {updateExistingRecords, mergeCols, hasInvalidMergeCols} = mergeOptions;

    // Check that at least one merge column was selected (if merging into an existing table).
    if (destTableId !== null && updateExistingRecords.get() && mergeCols.get().length === 0) {
      hasInvalidMergeCols.set(true);
      isValid = false;
    }

    return isValid;
  }

  private _buildModalTitle(rightElement?: DomContents) {
    const title =  this._importSourceElem ? this._importSourceElem.importSource.label : 'Import from file';
    return cssModalHeader(cssModalTitle(title), rightElement);
  }

  private _buildStaticTitle() {
    return cssStaticHeader(cssModalTitle(t('Import from file')));
  }

  /**
   * Triggers an update of the import diff in the preview table. When called in quick succession,
   * only the most recent call will result in an update being made to the preview table.
   *
   * @param {SourceInfo} info The source to update the diff for.
   */
  private async _updateImportDiff(info: SourceInfo) {
    const {updateExistingRecords, mergeCols} = this._mergeOptions[info.hiddenTableId]!;
    const isMerging = info.destTableId && updateExistingRecords.get() && mergeCols.get().length > 0;
    if (!isMerging && this._gristDoc.comparison) {
      // If we're not merging but diffing is enabled, disable it; since `comparison` isn't
      // currently observable, we'll wrap the modification around the `_isLoadingDiff`
      // flag, which will force the preview table to re-render with diffing disabled.
      this._isLoadingDiff.set(true);
      this._gristDoc.comparison = null;
      this._isLoadingDiff.set(false);
    }

    // If we're not merging, no diff is shown, so don't schedule an update for one.
    if (!isMerging) { return; }

    this._hasScheduledDiffUpdate = true;
    this._isLoadingDiff.set(true);
    await this._debouncedUpdateDiff(info);
  }

  /**
   * NOTE: This method should not be called directly. Instead, use _updateImportDiff above, which
   * wraps this method and calls a debounced version of it.
   *
   * Triggers an update of the import diff in the preview table. When called in quick succession,
   * only the most recent call will result in an update being made to the preview table.
   *
   * @param {SourceInfo} info The source to update the diff for.
   */
  private async _updateDiff(info: SourceInfo) {
    // Reset the flag tracking scheduled updates since the debounced update has started.
    this._hasScheduledDiffUpdate = false;

    // Request a diff of the current source and wait for a response.
    const genImportDiffPromise = this._docComm.generateImportDiff(info.hiddenTableId,
      this._createTransformRule(info), this._getMergeOptionsForSource(info)!);
    this._lastGenImportDiffPromise = genImportDiffPromise;
    const diff = await genImportDiffPromise;

    // If the request is superseded by a newer request, or the Importer is disposed, do nothing.
    if (this.isDisposed() || genImportDiffPromise !== this._lastGenImportDiffPromise) { return; }

    // Put the document in comparison mode with the diff data.
    this._gristDoc.comparison = diff;

    // If more updates where scheduled since we started the update, leave the loading spinner up.
    if (!this._hasScheduledDiffUpdate) {
      this._isLoadingDiff.set(false);
    }
  }

  /**
   * Resets all state variables related to diffs to their default values.
   */
  private _resetImportDiffState() {
    this._cancelPendingDiffRequests();
    this._gristDoc.comparison = null;
  }

  /**
   * Effectively cancels all pending diff requests by causing their fulfilled promises to
   * be ignored by their attached handlers. Since we can't natively cancel the promises, this
   * is functionally equivalent to canceling the outstanding requests.
   */
  private _cancelPendingDiffRequests() {
    this._debouncedUpdateDiff.cancel();
    this._lastGenImportDiffPromise = null;
    this._hasScheduledDiffUpdate = false;
    this._isLoadingDiff.set(false);
  }

  // The importer state showing import in progress, with a list of tables, and a preview.
  private _renderMain(upload: UploadResult) {
    const schema = this._parseOptions.get().SCHEMA;
    const header = this._buildModalTitle();
    const options = schema ? cssActionLink(cssLinkIcon('Settings'), 'Import options',
      testId('options-link'),
      dom.on('click', () => this._renderParseOptions(schema, upload))
    ) : null;

    const selectTab = async (info: SourceInfo) => {
      // Ignore click if source is already selected.
      if (info === this._sourceInfoSelected.get()) { return; }
      // Prevent changing selected source if current configuration is invalid.
      if (!this._validateImportConfiguration()) { return; }
      this._cancelPendingDiffRequests();
      this._sourceInfoSelected.set(info);
      await this._updateImportDiff(info);
    };

    const tabs = cssTableList(
      dom.forEach(this._sourceInfoArray, (info) => {
        const owner = MultiHolder.create(null);
        const destTableId = Computed.create(owner, (use) => use(info.destTableId));
        destTableId.onWrite(async (destId) => {
          // Prevent changing destination of un-selected sources if current configuration is invalid.
          if (info !== this._sourceInfoSelected.get() && !this._validateImportConfiguration()) {
            return;
          }
          info.destTableId.set(destId);
          this._resetTableMergeOptions(info.hiddenTableId);
          if (destId !== SKIP_TABLE) {
            await this._updateTransformSection(info);
          }
        });

        // If this is selected source.
        const isSelected = Computed.create(owner, (use) => use(this._sourceInfoSelected) === info);

        const unmatchedCount = Computed.create(owner, use => {
          const map = use(this._unmatchedFieldsMap);
          return map.get(info)?.length ?? 0;
        });

        return cssTabItem(
          dom.autoDispose(owner),
          cssBorderBottom(),
          cssTabItem.cls('-not-selected', not(isSelected)),
          testId('source'),
          testId('source-selected', isSelected),
          testId('source-not-selected', not(isSelected)),
          cssTabItemContent(
            cssFileTypeIcon(getSourceFileExtension(info, upload),
              cssFileTypeIcon.cls('-active', isSelected),
            ),
            cssTabItemContent.cls('-selected', isSelected),
            cssTableLine(cssTableSource(
              getSourceDescription(info, upload),
              testId('from'),
              overflowTooltip(),
            )),
            dom.on('click', () => selectTab(info)),
          ),
          dom.maybe(unmatchedCount, (count) => cssError(
            'Exclamation',
            testId('error'),
            hoverTooltip(t('{{count}} unmatched field', {count}))
          )),
        );
      }),
    );
    const previewAndConfig = dom.maybeOwned(this._sourceInfoSelected, (owner, info) => {
      const {mergeCols, updateExistingRecords, hasInvalidMergeCols} = this._mergeOptions[info.hiddenTableId]!;

      // Computed for transform section if we have destination table selected.
      const configSection = Computed.create(owner,
        use => use(info.destTableId) && use(info.transformSection) ? use(info.transformSection) : null);

      // Computed to show the loader while we are waiting for the preview.
      const showLoader = Computed.create(owner, use => {
        return use(this._isLoadingDiff) || !use(this._previewViewSection);
      });

      // The same computed as configSection, but will evaluate to null while we are waiting for the preview
      const previewSection = Computed.create(owner, use => {
        return use(showLoader) ? null : use(this._previewViewSection);
      });

      // Use helper for checking if destination is selected.
      const isSelected = (destId: DestId) => (use: UseCBOwner) => use(info.destTableId) === destId;

      // True if user selected `Skip import`
      const isSkipTable = Computed.create(owner, isSelected(SKIP_TABLE));

      // True if user selected a valid destination table.
      const isMergeTable = Computed.create(owner, use => ![NEW_TABLE, SKIP_TABLE].includes(use(info.destTableId)));

      // Changes the class if the item is selected. Creates a dom method that can be attached to element.
      const selectIfDestIs = (destId: DestId) => cssDestination.cls('-selected', isSelected(destId));

      // Helper to toggle visibility if target is selected.
      const visibleIfDestIs = (destId: DestId) => dom.show(isSelected(destId));

      // Creates a click handler that changes the destination table to the given value.
      const onClickChangeDestTo = (destId: DestId) => dom.on('click', async () => {
        if (info !== this._sourceInfoSelected.get() && !this._validateImportConfiguration()) {
          return;
        }
        info.selectedView.set(TABLE_MAPPING);
        info.destTableId.set(destId);
        this._resetTableMergeOptions(info.hiddenTableId);
        if (destId !== SKIP_TABLE) {
          await this._updateTransformSection(info);
        }
      });

      // Should we show the right panel with the column mapping.
      const showRightPanel = Computed.create(owner, use => {
        return use(isMergeTable) && use(info.selectedView) === COLUMN_MAPPING;
      });

      // Handler to switch the view, between destination and column mapping panes.
      const onClickShowView = (view: ViewType) => dom.on('click', () => {
        info.selectedView.set(view);
      });

      // Pattern to create a computed value that can create and dispose objects in its callback.
      Computed.create(owner, use => {
        // This value must be returned for this pattern to work.
        const holder = MultiHolder.create(use.owner);
        // Now we can safely take ownership of things we create here - the subscriber.
        if (use(configSection)) {
          holder.autoDispose(updateExistingRecords.addListener(async () => {
            if (holder.isDisposed()) { return; }
            await this._updateImportDiff(info);
          }));
        }
        return holder;
      });

      return cssConfigAndPreview(
        cssConfigPanel(
          cssConfigPanel.cls('-right', showRightPanel),
          cssConfigLeft(
            cssTitle('Destination table', testId('target-top')),
            cssDestinationWrapper(cssDestination(
              cssPageIcon('Plus'),
              dom('span', 'New Table'),
              selectIfDestIs(NEW_TABLE),
              onClickChangeDestTo(NEW_TABLE),
              testId('target'),
              testId('target-new-table'),
              testId('target-selected', isSelected(NEW_TABLE)),
            )),
            dom.maybe(use => use(this._sourceInfoArray).length > 1, () => [
              cssDestinationWrapper(cssDestination(
                cssPageIcon('CrossBig'),
                dom('span', t('Skip Import')),
                selectIfDestIs(SKIP_TABLE),
                onClickChangeDestTo(SKIP_TABLE),
                testId('target'),
                testId('target-skip'),
                testId('target-selected', isSelected(SKIP_TABLE)),
              )),
            ]),
            dom.forEach(this._destTables, (destTable) => {
              return cssDestinationWrapper(
                testId('target'),
                testId('target-existing-table'),
                testId('target-selected', isSelected(destTable.value)),
                cssDestination(
                  cssPageIcon('TypeTable'),
                  dom('span', destTable.label),
                  selectIfDestIs(destTable.value),
                  onClickChangeDestTo(destTable.value),
                  onClickShowView(COLUMN_MAPPING),
                ),
                cssDetailsIcon('ArrowRight',
                  onClickShowView(COLUMN_MAPPING),
                  visibleIfDestIs(destTable.value),
                  hoverTooltip(t('Column mapping')),
                  testId('target-column-mapping'),
                )
              );
            }),
          ),
          cssConfigRight(
            cssNavigation(
              cssFlexBaseline(
                cssDestinationTableSecondary(
                  cssNavigationIcon('ArrowLeft'),
                  t('Destination table'),
                  onClickShowView(TABLE_MAPPING),
                  testId('table-mapping')
                ),
                cssSlash(' / '),
                cssColumnMappingNav(t('Column Mapping')),
              )
            ),
            cssMergeOptions(
              dom.maybe(isMergeTable, () => cssMergeOptionsToggle(labeledSquareCheckbox(
                updateExistingRecords,
                t("Update existing records"),
                testId('update-existing-records')
              ))),
              dom.maybe(configSection, (section) => {
                return dom.maybeOwned(updateExistingRecords, (owner2) => {
                  owner2.autoDispose(mergeCols.addListener(async val => {
                    // Reset the error state of the multiSelect on change.
                    if (val.length !== 0 && hasInvalidMergeCols.get()) {
                      hasInvalidMergeCols.set(false);
                    }
                    await this._updateImportDiff(info);
                  }));
                  return [
                    cssMergeOptionsMessage(
                      t("Merge rows that match these fields:"),
                      testId('merge-fields-message')
                    ),
                    multiSelect(
                      mergeCols,
                      section.viewFields().peek().map(f => ({label: f.label(), value: f.colId()})) ?? [],
                      {
                        placeholder: t("Select fields to match on"),
                        error: hasInvalidMergeCols
                      },
                      testId('merge-fields-select')
                    )
                  ];
                });
              }),
            ),
            dom.maybeOwned(configSection, (owner1, section) => {
              owner1.autoDispose(updateExistingRecords.addListener(async () => {
                await this._updateImportDiff(info);
              }));
              return dom('div',
                cssColumnMatchHeader(
                  dom('span', t('Grist column')),
                  dom('div', null),
                  dom('span', t('Source column')),
                ),
                dom.forEach(fromKo(section.viewFields().getObservable()), field => {
                  const owner2 = MultiHolder.create(null);
                  const isCustomFormula = Computed.create(owner2, use => {
                    return use(info.customizedColumns).has(field.colId());
                  });
                  return cssColumnMatchRow(
                    testId('column-match-source-destination'),
                    dom.autoDispose(owner2),
                    dom.domComputed(field.label, () => cssDestinationFieldLabel(
                      dom.text(field.label),
                      overflowTooltip(),
                      testId('column-match-destination'),
                    )),
                    cssIcon180('ArrowRightOutlined'),
                    dom.domComputedOwned(isCustomFormula, (owner3, isCustom) => {
                      if (isCustom) {
                        return this._buildCustomFormula(owner3, field, info);
                      } else {
                        return this._buildSourceSelector(owner3, field, info);
                      }
                    }),
                    dom('div',
                      dom.maybe(isCustomFormula, () => icon('Revert',
                        dom.style('cursor', 'pointer'),
                        hoverTooltip(t('Revert')),
                        dom.on('click', async () => {
                          toggleCustomized(info, field.colId(), false);
                          // Try to set the default label.
                          const transformCol = field.column.peek();
                          const possibilities = this._transformColImportOptions.get().get(transformCol.getRowId())
                                                ?? new Map<string, string>();
                          const matched = [...possibilities.entries()].find(([, v]) => v === transformCol.label.peek());
                          if (matched) {
                            await this._setColumnFormula(transformCol, matched[0], info);
                          } else {
                            await this._gristDoc.clearColumns([field.colRef()]);
                          }
                        }),
                      )),
                    ),
                  );
                }),
                testId('column-match-options'),
              );
            }),
          )
        ),
        cssPreviewColumn(
          dom.maybe(showLoader, () => cssPreviewSpinner(loadingSpinner(), testId('preview-spinner'))),
          dom.maybe(previewSection, () => [
            cssOptions(
              dom.domComputed(info.destTableId, destId => cssTableName(
                destId === NEW_TABLE ? t("New Table") :
                destId === SKIP_TABLE ? t("Skip Import") :
                dom.domComputed(this._destTables, list =>
                  list.find(dt => dt.value === destId)?.label ?? t("New Table")
                )
              )),
              options,
            )
          ]),
          cssWarningText(dom.text(use => use(this._parseOptions)?.WARNING || ""), testId('warning')),
          dom.domComputed(use => {
            if (use(isSkipTable)) {
              return cssOverlay(t('Skip Table on Import'), testId('preview-overlay'));
            }
            const section = use(previewSection);
            if (!section || section.isDisposed()) { return null; }
            const gridView = this._createPreview(section);
            return cssPreviewGrid(
              dom.autoDispose(gridView),
              gridView.viewPane,
              testId('preview'),
            );
          })
        )
      );
    });

    const buttons = cssImportButtons(cssImportButtonsLine(
      bigPrimaryButton('Import',
        dom.on('click', () => this._maybeFinishImport(upload)),
        dom.boolAttr('disabled', use => {
          return use(this._previewViewSection) === null ||
                 use(this._sourceInfoArray).every(i => use(i.destTableId) === SKIP_TABLE);
        }),
        baseTestId('modal-confirm'),
      ),
      bigBasicButton('Cancel',
        dom.on('click', () => this._cancelImport()),
        baseTestId('modal-cancel'),
      ),
      dom.domComputed(this._unmatchedFieldsMap, fields => {
        const piles: HTMLElement[] = [];
        let count = 0;
        for(const [info, list] of fields) {
          if (!list?.length) { continue; }
          count += list.length;
          piles.push(cssUnmatchedFieldsList(
            list.join(', '),
            dom.on('click', () => selectTab(info)),
            hoverTooltip(getSourceDescription(info, upload)),
          ));
        }
        if (!count) { return null; }
        return cssUnmatchedFields(
          cssUnmatchedFieldsIntro(
            cssUnmatchedIcon('Exclamation'),
            t('{{count}} unmatched field in import', {count}), ': ',
          ),
          ...piles,
          testId('unmatched-fields'),
        );
      }),
    ));
    const body = cssContainer(
      {tabIndex: '-1'},
      header,
      cssPreviewWrapper(
        cssTabsWrapper(
          tabs,
        ),
        previewAndConfig,
      ),
      buttons,
    );
    this._addFocusLayer(body);
    this._screen.render(body, {
      fullscreen: true,
      fullbody: true
    });
  }

  private _makeImportOptionsForCol(gristCol: ColumnRec, info: SourceInfo) {
    const options = new Map<string, string>();  // Maps formula to label.
    const sourceFields = info.sourceSection.viewFields.peek().peek();

    // Reference columns are populated using lookup formulas, so figure out now if this is a
    // reference column, and if so, its destination table and the lookup column ID.
    const refTable = gristCol.refTable.peek();
    const refTableId = refTable ? refTable.tableId.peek() : undefined;

    const visibleColId = gristCol.visibleColModel.peek().colId.peek();
    const isRefDest = Boolean(info.destTableId.get() && gristCol.pureType.peek() === 'Ref');

    for (const sourceField of sourceFields) {
      const sourceCol = sourceField.column.peek();
      const sourceId = sourceCol.colId.peek();
      const sourceLabel = sourceCol.label.peek();
      if (isRefDest && visibleColId) {
        const formula = `${refTableId}.lookupOne(${visibleColId}=$${sourceId}) or ($${sourceId} and str($${sourceId}))`;
        options.set(formula, sourceLabel);
      } else {
        options.set(`$${sourceId}`, sourceLabel);
      }
      if (isRefDest && ['Numeric', 'Int'].includes(sourceCol.type.peek())) {
        options.set(`${refTableId}.lookupOne(id=NUM($${sourceId})) or ($${sourceId} and str(NUM($${sourceId})))`,
          `${sourceLabel} (as row ID)`);
      }
    }
    return options;
  }

  private _makeImportOptionsMenu(transformCol: ColumnRec, others: [string, string][], info: SourceInfo) {
    return [
      menuItem(() => this._setColumnFormula(transformCol, null, info),
        'Skip',
        testId('column-match-menu-item')),
      others.length ? menuDivider() : null,
      ...others.map(([formula, label]) =>
        menuItem(() => this._setColumnFormula(transformCol, formula, info),
          label,
          testId('column-match-menu-item'))
      )
    ];
  }

  private _addFocusLayer(container: HTMLElement) {
    dom.autoDisposeElem(container, new FocusLayer({
      defaultFocusElem: container,
      allowFocus: (elem) => (elem !== document.body),
      onDefaultFocus: () => this.trigger('importer_focus'),
    }));
  }

  /**
   * Updates the formula on column `colRef` to `formula`, when user wants to match it to a source column.
   */
  private async _setColumnFormula(transformCol: ColumnRec, formula: string|null, info: SourceInfo) {
    const transformColRef = transformCol.id();
    const customized = info.customizedColumns.get();
    customized.delete(transformCol.colId());
    info.customizedColumns.set(customized);
    if (formula === null) {
      await this._gristDoc.clearColumns([transformColRef], {keepType: true});
    } else {
      await this._gristDoc.docModel.columns.sendTableAction(
        ['UpdateRecord', transformColRef, { formula, isFormula: true }]);
    }
    await this._updateImportDiff(info);
  }

  /**
   * Opens a formula editor for `field` over `refElem`.
   */
  private _activateFormulaEditor(refElem: Element, field: ViewFieldRec, onSave: (formula: string) => Promise<void>) {
    const vsi = this._gristDoc.viewModel.activeSection().viewInstance();
    const editRow = vsi?.moveEditRowToCursor();
    const editorHolder = openFormulaEditor({
      gristDoc: this._gristDoc,
      column: field.column(),
      editingFormula: field.editingFormula,
      refElem,
      editRow,
      canDetach: false,
      setupCleanup: this._setupFormulaEditorCleanup.bind(this),
      onSave: async (column, formula) => {
        if (formula === column.formula.peek()) { return; }
        // Sorry for this hack. We need to store somewhere an info that the formula was edited
        // unfortunately, we don't have a better place to store it. So we will save this by setting
        // display column to the same column. This won't break anything as this is a default value.
        await column.updateColValues({formula});
        await onSave(formula);
      }
    });
    this._formulaEditorHolder.autoDispose(editorHolder);
  }

  /**
   * Called by _activateFormulaEditor to initialize cleanup
   * code for when the formula editor is closed. Registers and
   * unregisters callbacks for saving edits when the editor loses
   * focus.
   */
  private _setupFormulaEditorCleanup(
    owner: Disposable, _doc: GristDoc, editingFormula: ko.Computed<boolean>, _saveEdit: () => Promise<unknown>
  ) {
    const saveEdit = () => _saveEdit().catch(reportError);

    // Whenever focus returns to the dialog, close the editor by saving the value.
    this.on('importer_focus', saveEdit);

    owner.onDispose(() => {
      this.off('importer_focus', saveEdit);
      editingFormula(false);
    });
  }

  /**
   * Builds an editable formula component that is displayed
   * in the column mapping section of Importer. On click, opens
   * an editor for the formula for `column`.
   */
  private _buildSourceSelector(owner: MultiHolder, field: ViewFieldRec, info: SourceInfo) {
    const anyOtherColumns = Computed.create(owner, use => {
      const transformCol = field.column.peek();
      const options = use(this._transformColImportOptions)!.get(transformCol.getRowId()) ?? new Map<string, string>();
      const otherFilter = ([formula]: [string, string] ) => {
        // Notice how this is only reactive to the formula value, every other observable is
        // just picked without being tracked. This is because we only want to recompute this
        // when the formula is changed (so the target column is changed). If anything other is
        // changed, we don't care here as this whole computed will be recreated by the caller.
        const myFormula = use(transformCol.formula);
        const anyOther = info.transformSection.get()?.viewFields.peek().all()
            .filter(f => f.column.peek() !== transformCol)
            .map(f => use(f.column.peek().formula));
        // If we picked this formula thats ok.
        if (formula === myFormula) { return true; }
        // If any other column picked this formula, then we should not show it.
        if (anyOther?.includes(formula)) { return false; }
        // Otherwise, show it.
        return true;
      };
      const possibleSources = Array.from(options).filter(otherFilter);

      return this._makeImportOptionsMenu(transformCol, possibleSources, info);
    });

    const selectedSource = Computed.create(owner, use => {
      const column = use(field.column);
      const importOptions = use(this._transformColImportOptions).get(column.getRowId());
      // Now translate the formula generated (which is unique) to the source label.
      const label = importOptions?.get(use(column.formula)) || null;
      return label;
    });
    const selectedSourceText = Computed.create(owner, use => use(selectedSource) || t('Skip'));

    const selectedOption = cssSelected(
      dom.text(selectedSourceText),
      testId('column-match-formula'),
      cssSelected.cls('-skip', not(selectedSource)),
      overflowTooltip(),
    );
    const otherColsOptions = dom.domComputed(anyOtherColumns, x => x);
    const formulaOption = selectOption(
      () => {
        this._activateFormulaEditor(selectMenuElement, field, async (newFormula) => {
          toggleCustomized(info, field.colId.peek(), !!newFormula);
          await this._updateImportDiff(info);
        });
      },
      "Apply Formula",
      "Lighting",
      testId('apply-formula'),
      cssGreenIcon.cls(''),
    );
    const selectMenuElement = selectMenu(selectedOption, () => [
      otherColsOptions,
      menuDivider(),
      formulaOption,
    ], testId('column-match-source'));
    return selectMenuElement;
  }

  /**
   * Builds an editable formula component that is displayed
   * in the column mapping section of Importer. On click, opens
   * an editor for the formula for `column`.
   */
  private _buildCustomFormula(owner: MultiHolder, field: ViewFieldRec, info: SourceInfo) {
    const formula = Computed.create(owner, use => {
      const column = use(field.column);
      return use(column.formula);
    });
    const codeOptions = {gristTheme: this._gristDoc.currentTheme, placeholder: 'Skip', maxLines: 1};
    return cssFieldFormula(formula, codeOptions,
      dom.cls('disabled'),
      dom.cls('formula_field_sidepane'),
      {tabIndex: '-1'},
      dom.on('focus', (_ev, elem) => this._activateFormulaEditor(elem, field, async (newFormula) => {
        toggleCustomized(info, field.colId.peek(), !!newFormula);
        await this._updateImportDiff(info);
      })),
      testId('column-match-formula'),
    );
  }

  // The importer state showing parse options that may be changed.
  private _renderParseOptions(schema: ParseOptionSchema[], upload: UploadResult) {
    const anotherScreen = PluginScreen.create(this._optionsScreenHolder, 'Import from file');
    anotherScreen.showImportDialog({
      noClickAway: false,
      noEscapeKey: false,
    });
    anotherScreen.render([
      this._buildStaticTitle(),
      dom.create(buildParseOptionsForm, schema, this._parseOptions.get() as ParseOptionValues,
        (p: ParseOptions) => {
          anotherScreen.dispose();
          this._parseOptions.set(p);
          // Drop what we previously matched because we may have different columns.
          // If user manually matched, then changed import options, they'll have to re-match; when
          // columns change at all, the alternative has incorrect columns in UI and is more confusing.
          this._sourceInfoArray.set([]);
          this._reImport(upload).catch((err) => reportError(err));
        },
        () => {
          anotherScreen.dispose();
          this._renderMain(upload);
        },
      )
    ]);
  }

  private async _fetchFromDrive(itemUrl: string) {
    // First we will assume that this is public file, so no need to ask for permissions.
    try {
      return await fetchURL(this._docComm, itemUrl);
    } catch(err) {
      // It is not a public file or the file id in the url is wrong,
      // but we have no way to check it, so we assume that it is private file
      // and ask the user for the permission (if we are configured to do so)
      if (canReadPrivateFiles()) {
        const options: FetchUrlOptions = {};
        try {
          // Request for authorization code from Google.
          const code = await getGoogleCodeForReading(this);
          options.googleAuthorizationCode = code;
        } catch(permError) {
          if (permError?.message === ACCESS_DENIED) {
            // User declined to give us full readonly permission, fallback to GoogleDrive plugin
            // or cancel import if GoogleDrive plugin is not configured.
            throw new GDriveUrlNotSupported(itemUrl);
          } else if(permError?.message === AUTH_INTERRUPTED) {
            // User closed the window - we assume he doesn't want to continue.
            throw new CancelledError();
          } else {
            // Some other error happened during authentication, report to user.
            throw err;
          }
        }
        // Download file from private drive, if it fails, report the error to user.
        return await fetchURL(this._docComm, itemUrl, options);
      } else {
        // We are not allowed to ask for full readonly permission, fallback to GoogleDrive plugin.
        throw new GDriveUrlNotSupported(itemUrl);
      }
    }
  }
}

// Used for switching from URL plugin to Google drive plugin.
class GDriveUrlNotSupported extends Error {
  constructor(public url: string) {
    super(`This url ${url} is not supported`);
  }
}

// Used to cancel import (close the dialog without any error).
class CancelledError extends Error {
}

function getSourceDescription(sourceInfo: SourceInfo, upload: UploadResult) {
  const origName = upload.files[sourceInfo.uploadFileIndex].origName;
  return sourceInfo.origTableName ? `${sourceInfo.origTableName} - ${origName}` : origName;
}

function getSourceFileExtension(sourceInfo: SourceInfo, upload: UploadResult) {
  const origName = upload.files[sourceInfo.uploadFileIndex].origName;
  return origName.includes(".") ? origName.split('.').pop() : "file";
}

const cssContainer = styled('div', `
  height: 100%;
  display: flex;
  flex-direction: column;
  outline: unset;
`);

const cssActionLink = styled('div', `
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  &:hover {
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
  }
`);

const cssLinkIcon = styled(icon, `
  flex: none;
  margin-right: 4px;
`);

const cssStaticHeader = styled('div', `
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  & > .${cssModalTitle.className} {
    margin-bottom: 0px;
  }
`);

const cssModalHeader = styled(cssStaticHeader, `
  padding-left: var(--css-modal-dialog-padding-horizontal, 0px);
  padding-right: var(--css-modal-dialog-padding-horizontal, 0px);
  padding-top: var(--css-modal-dialog-padding-vertical, 0px);
`);

const cssPreviewWrapper = styled('div', `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`);

const cssBorderBottom = styled('div', `
  border-bottom: 1px solid ${theme.importerTableInfoBorder};
  display: none;
  height: 0px;
  bottom: 0px;
  position: absolute;
  width: 100%;
`);


const cssFileTypeIcon = styled('div', `
  background: ${theme.importerInactiveFileBg};
  color: ${theme.importerInactiveFileFg};
  border-radius: 4px;
  height: 2em;
  text-align: center;
  display: flex;
  align-items: center;
  padding: 1em;
  font-size: 15px;
  font-weight: 600;
  text-transform: uppercase;
  &-active{
    background: ${theme.importerActiveFileBg};
    color: ${theme.importerActiveFileFg};
  }
`);

const cssTabsWrapper = styled('div', `
  border-bottom: 1px solid ${theme.importerTableInfoBorder};
  display: flex;
  flex-direction: column;
`);

const cssWarningText = styled('div', `
  margin-bottom: 8px;
  color: ${theme.errorText};
  white-space: pre-line;
`);

const cssTableList = styled('div', `
  align-self: flex-start;
  max-width: 100%;
  display: flex;
  padding: 0px var(--css-modal-dialog-padding-horizontal, 0px);
`);

const cssTabItemContent = styled('div', `
  border: 1px solid transparent;
  padding-left: 20px;
  padding-right: 20px;
  display: flex;
  align-items: center;
  align-content: flex-end;
  overflow: hidden;
  border-radius: 4px 4px 0px 0px;
  height: 56px;
  column-gap: 8px;
  &-selected {
    border: 1px solid ${theme.importerTableInfoBorder};
    border-bottom-color: ${theme.importerMainContentBg};
    background-color: ${theme.importerMainContentBg};
  }
`);

const cssTabItem = styled('div', `
  background: ${theme.importerOutsideBg};
  position: relative;
  cursor: pointer;
  margin-bottom: -2px;
  border-bottom: 1px solid ${theme.importerMainContentBg};
  flex: 1;
  &-not-selected + &-not-selected::after{
    content: '';
    position: absolute;
    left: 0px;
    top: 20%;
    height: 60%;
    border-left: 1px solid ${theme.importerTableInfoBorder};
  }
  &-not-selected .${cssBorderBottom.className} {
    display: block;
  }
  &-not-selected .${cssFileTypeIcon.className} {
    display: none;
  }
  &-not-selected {
    min-width: 0px;
  }
  &-not-selected:first-child .${cssTabItemContent.className} {
    padding-left: 0px;
  }
`);

const cssTableLine = styled('div', `
  display: flex;
  align-items: center;
  overflow: hidden;
  flex-shrink: 1;
  height: 100%;
`);

const cssTableSource = styled('div', `
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  flex-shrink: 1;
`);

const cssConfigAndPreview = styled('div', `
  display: flex;
  gap: 8px;
  flex-grow: 1;
  height: 0px;
  background-color: ${theme.importerMainContentBg};
  padding-right: var(--css-modal-dialog-padding-horizontal, 0px);
`);

const cssConfigLeft = styled('div', `
  padding-right: 8px;
  padding-top: 16px;
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  width: 100%;
  transition: transform 0.2s ease-in-out;
`);

const cssConfigRight = styled(cssConfigLeft, `
  left: 100%;
  padding-left: var(--css-modal-dialog-padding-horizontal, 0px);
`);

const cssConfigPanel = styled('div', `
  width: 360px;
  height: 100%;
  position: relative;
  overflow-x: hidden;
  &-right .${cssConfigLeft.className} {
    transform: translateX(-100%);
  }
  &-right .${cssConfigRight.className} {
    transform: translateX(-100%);
  }
`);


const cssPreviewColumn = styled('div', `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`);

const cssPreview = styled('div', `
  display: flex;
  flex-grow: 1;
`);

const cssPreviewSpinner = styled(cssPreview, `
  align-items: center;
  justify-content: center;
`);

const cssOverlay = styled('div', `
  background: ${theme.importerSkippedTableOverlay};
  flex: 1;
  display: grid;
  place-items: center;
`);

const cssPreviewGrid = styled(cssPreview, `
  border: 1px solid ${theme.importerPreviewBorder};
  position: relative;
`);

const cssMergeOptions = styled('div', `
  margin-bottom: 16px;
`);

const cssMergeOptionsToggle = styled('div', `
  margin-bottom: 8px;
  margin-top: 8px;
`);

const cssMergeOptionsMessage = styled('div', `
  color: ${theme.lightText};
  margin-bottom: 8px;
`);

const cssColumnMatchHeader = styled('div', `
  display: grid;
  grid-template-columns: 1fr 20px 1fr;
  text-transform: uppercase;
  color: ${theme.lightText};
  letter-spacing: 1px;
  font-size: ${vars.xsmallFontSize};
  margin-bottom: 12px;
`);

const cssColumnMatchRow = styled('div', `
  display: grid;
  grid-template-columns: 1fr 20px 1fr 20px;
  gap: 4px;
  align-items: center;
  --icon-color: ${theme.iconDisabled};
  & + & {
    margin-top: 16px;
  }
`);

const cssFieldFormula = styled(buildHighlightedCode, `
  flex: auto;
  cursor: pointer;
  margin-top: 1px;
  padding-left: 24px;
  --icon-color: ${theme.accentIcon};
`);

const cssDestinationFieldLabel = styled('div', `
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding-left: 4px;
  cursor: unset;
  background-color: ${theme.pageBg};
  color: ${theme.text};
  width: 100%;
  height: 30px;
  line-height: 16px;
  font-size: ${vars.mediumFontSize};
  padding: 5px;
  border: 1px solid ${theme.selectButtonBorder};
  border-radius: 3px;
  user-select: none;
  outline: none;
`);

const cssUnmatchedIcon = styled(icon, `
  height: 12px;
  --icon-color: ${theme.lightText};
  vertical-align: bottom;
  margin-bottom: 2px;
`);

const cssUnmatchedFields = styled('div', `
  display: flex;
  flex-wrap: wrap;
  row-gap: 2px;
  column-gap: 4px;
  align-items: flex-start;
`);

const cssUnmatchedFieldsIntro = styled('div', `
  padding: 4px 8px;
`);

const cssUnmatchedFieldsList = styled('div', `
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  padding-right: 16px;
  color: ${theme.text};
  border-radius: 8px;
  padding: 4px 8px;
  background-color: ${theme.pagePanelsBorder};
  max-width: 160px;
  cursor: pointer;
`);

const cssImportButtons = styled('div', `
  padding-top: 40px;
  padding-left: var(--css-modal-dialog-padding-horizontal, 0px);
  padding-right: var(--css-modal-dialog-padding-horizontal, 0px);
  padding-bottom: calc(var(--css-modal-dialog-padding-vertical, 0px) - 12px);
  background-color: ${theme.importerMainContentBg};
`);

const cssImportButtonsLine = styled('div', `
  height: 52px;
  overflow: hidden;
  display: flex;
  gap: 8px;
  align-items: flex-start;
`);


const cssTitle = styled('span._cssToFrom', `
  color: ${theme.darkText};
  text-transform: uppercase;
  font-weight: 600;
  font-size: ${vars.smallFontSize};
  letter-spacing: 0.5px;
  padding-left: var(--css-modal-dialog-padding-horizontal, 0px);
  text-align: left;
  margin-bottom: 16px;
`);

const cssDestinationWrapper = styled('div', `
  margin-bottom: 1px;
  /* Reuse the modal padding but move 16px to left if possible */
  margin-left: max(0px, calc(var(--css-modal-dialog-padding-horizontal, 0px) - 16px));
  display: flex;
  align-items: center;
`);

const cssDestination = styled('div', `
  --icon-color: ${theme.lightText};
  align-items: center;
  border-radius: 0 3px 3px 0;
  padding-left: 16px;
  color: ${theme.text};
  cursor: pointer;
  display: flex;
  height: 32px;
  line-height: 32px;
  flex: 1;
  &:hover {
    background-color: ${theme.pageHoverBg};
  }
  &-selected, &-selected:hover {
    background-color: ${theme.activePageBg};
    color: ${theme.activePageFg};
    --icon-color: ${theme.activePageFg};
  }
`);

const cssOptions = styled('div', `
  display: flex;
  align-items: flex-end;
  padding-bottom: 8px;
  justify-content: space-between;
  height: 36px;
`);

const cssTableName = styled('span', `
  font-weight: 600;
`);

const cssNavigation = styled('div', `
  display: flex;
  align-items: center;
  margin-bottom: 8px;
`);

const cssDetailsIcon = styled(icon, `
  flex: none;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  margin-left: 4px;
  margin-top: -4px;
  cursor: pointer;
  &:hover {
    --icon-color: ${theme.controlHoverFg};
  }
`);

const cssError = styled(icon, `
  --icon-color: ${theme.iconError};
  right: 2px;
  position: absolute;
  z-index: 1;
  top: calc(50% - 8px);
`);

const cssNavigationIcon = styled(icon, `
  flex: none;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};
  margin-right: 4px;
  margin-top: -3px;
  width: 12px;
`);

const cssFlexBaseline = styled('div', `
  display: flex;
  align-items: baseline;
`);

const cssSelected = styled(cssTableSource, `
  &-skip {
    color: ${theme.lightText};
  }
`);

const cssIcon180 = styled(icon, `
  transform: rotate(180deg);
`);

const cssGreenIcon = styled(`div`, `
--icon-color: ${theme.accentIcon};
`);


const cssColumnMappingNav = styled('span', `
  text-transform: uppercase;
  color: ${theme.darkText};
  text-transform: uppercase;
  font-weight: 600;
  font-size: ${vars.smallFontSize};
  letter-spacing: 0.5px;
`);

const cssSlash = styled('div', `
  padding: 0px 4px;
  font-size: ${vars.xsmallFontSize};
  color: ${theme.lightText};
`);

const cssDestinationTableSecondary = styled(textButton, `
  text-transform: uppercase;
  font-size: ${vars.smallFontSize};
  letter-spacing: 0.5px;
  text-align: left;
  margin-bottom: 16px;
  color: ${theme.lightText};
`);
