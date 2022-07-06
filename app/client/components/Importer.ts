/**
 * Importer manages an import files to Grist tables
 * TODO: hidden tables should be also deleted on page refresh, error...
 */
// tslint:disable:no-console

import {GristDoc} from 'app/client/components/GristDoc';
import {buildParseOptionsForm, ParseOptionValues} from 'app/client/components/ParseOptions';
import {PluginScreen} from 'app/client/components/PluginScreen';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {fetchURL, isDriveUrl, selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {reportError} from 'app/client/models/AppModel';
import {ColumnRec, ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {SortedRowSet} from 'app/client/models/rowset';
import {buildHighlightedCode} from 'app/client/ui/CodeHighlight';
import {openFilePicker} from 'app/client/ui/FileDialog';
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IOptionFull, linkSelect, menu, menuDivider, menuItem, multiSelect} from 'app/client/ui2018/menus';
import {cssModalButtons, cssModalTitle} from 'app/client/ui2018/modals';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {openFormulaEditor} from 'app/client/widgets/FormulaEditor';
import {DataSourceTransformed, DestId, ImportResult, ImportTableResult, MergeOptions,
        MergeOptionsMap, MergeStrategy, NEW_TABLE, SKIP_TABLE,
        TransformColumn, TransformRule, TransformRuleMap} from 'app/common/ActiveDocAPI';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {byteString} from 'app/common/gutil';
import {FetchUrlOptions, UploadResult} from 'app/common/uploads';
import {ParseOptions, ParseOptionSchema} from 'app/plugin/FileParserAPI';
import {Computed, dom, DomContents, fromKo, Holder, IDisposable, MultiHolder, MutableObsArray, obsArray, Observable,
        styled} from 'grainjs';
import {labeledSquareCheckbox} from 'app/client/ui2018/checkbox';
import {ACCESS_DENIED, AUTH_INTERRUPTED, canReadPrivateFiles, getGoogleCodeForReading} from 'app/client/ui/googleAuth';
import debounce = require('lodash/debounce');


// We expect a function for creating the preview GridView, to avoid the need to require the
// GridView module here. That brings many dependencies, making a simple test fixture difficult.
type CreatePreviewFunc = (vs: ViewSectionRec) => GridView;
type GridView = IDisposable & {viewPane: HTMLElement, sortedRows: SortedRowSet, listenTo: (...args: any[]) => void};

export interface SourceInfo {
  // The source table id.
  hiddenTableId: string;
  uploadFileIndex: number;
  origTableName: string;
  sourceSection: ViewSectionRec;
  // A viewsection containing transform (formula) columns pointing to the original source columns.
  transformSection: Observable<ViewSectionRec|null>;
  // The destination table id.
  destTableId: Observable<DestId>;
  // True if there is at least one request in progress to create a new transform section.
  isLoadingSection: Observable<boolean>;
  // Reference to last promise for the GenImporterView action (which creates `transformSection`).
  lastGenImporterViewPromise: Promise<any>|null;
}

interface MergeOptionsStateMap {
  [hiddenTableId: string]: MergeOptionsState|undefined;
}

// UI state of merge options for a SourceInfo.
interface MergeOptionsState {
  updateExistingRecords: Observable<boolean>;
  mergeCols: MutableObsArray<string>;
  mergeStrategy: Observable<MergeStrategy>;
  hasInvalidMergeCols: Observable<boolean>;
}

/**
 * Importer manages an import files to Grist tables and shows Preview
 */
export class Importer extends DisposableWithEvents {
  /**
   * Imports using the given plugin importer, or the built-in file-picker when null is passed in.
   */
  public static async selectAndImport(
    gristDoc: GristDoc,
    imports: ImportSourceElement[],
    importSourceElem: ImportSourceElement|null,
    createPreview: CreatePreviewFunc
  ) {
    // In case of using built-in file picker we want to get upload result before instantiating Importer
    // because if the user dismisses the dialog without picking a file,
    // there is no good way to detect this and dispose Importer.
    let uploadResult: UploadResult|null = null;
    if (!importSourceElem) {
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
    }
    // HACK: The url plugin does not support importing from google drive, and we don't want to
    // ask a user for permission to access all his files (needed to download a single file from an URL).
    // So to have a nice user experience, we will switch to the built-in google drive plugin and allow
    // user to chose a file manually.
    // Suggestion for the future is:
    // (1) ask the user for the greater permission,
    // (2) detect when the permission is not granted, and open the picker-based plugin in that case.
    try {
      // Importer disposes itself when its dialog is closed, so we do not take ownership of it.
      await Importer.create(null, gristDoc, importSourceElem, createPreview).pickAndUploadSource(uploadResult);
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
            await Importer.create(null, gristDoc, gdrivePlugin, createPreview).pickAndUploadSource(uploadResult);
          } catch(err2) {
            reportError(err2);
          }
        }
      }
    }
  }

  private _docComm = this._gristDoc.docComm;
  private _uploadResult?: UploadResult;

  private _screen: PluginScreen;
  private _mergeOptions: MergeOptionsStateMap = {};
  private _parseOptions = Observable.create<ParseOptions>(this, {});
  private _sourceInfoArray = Observable.create<SourceInfo[]>(this, []);
  private _sourceInfoSelected = Observable.create<SourceInfo|null>(this, null);

  // Holder for the column mapping formula editor.
  private readonly _formulaEditorHolder = Holder.create(this);

  private _previewViewSection: Observable<ViewSectionRec|null> =
    Computed.create(this, this._sourceInfoSelected, (use, info) => {
      if (!info) { return null; }

      const isLoading = use(info.isLoadingSection);
      if (isLoading) { return null; }

      const viewSection = use(info.transformSection);
      return viewSection && !use(viewSection._isDeleted) ? viewSection : null;
    });

  // True if there is at least one request in progress to generate an import diff.
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

  // destTables is a list of options for import destinations, and includes all tables in the
  // document, plus two values: to import as a new table, and to skip a table.
  private _destTables = Computed.create<Array<IOptionFull<DestId>>>(this, (use) => [
    {value: NEW_TABLE, label: 'New Table'},
    ...(use(this._sourceInfoArray).length > 1 ? [{value: SKIP_TABLE, label: 'Skip'}] : []),
    ...use(this._gristDoc.docModel.visibleTableIds.getObservable()).map((id) => ({value: id, label: id})),
  ]);

  // Source column labels for the selected import source, keyed by column id.
  private _sourceColLabelsById = Computed.create(this, this._sourceInfoSelected, (use, info) => {
    if (!info || use(info.sourceSection._isDeleted)) { return null; }

    const fields = use(use(info.sourceSection.viewFields).getObservable());
    return new Map(fields.map(f => [use(use(f.column).colId), use(use(f.column).label)]));
  });

  // Transform section columns of the selected source.
  private _transformSectionCols = Computed.create(this, this._sourceInfoSelected, (use, info) => {
    if (!info) { return null; }

    const transformSection = use(info.transformSection);
    if (!transformSection || use(transformSection._isDeleted)) { return null; }

    const fields = use(use(transformSection.viewFields).getObservable());
    return fields.map(f => use(f.column));
  });

  // List of destination fields that aren't mapped to a source column.
  private _unmatchedFields = Computed.create(this, this._transformSectionCols, (use, cols) => {
    if (!cols) { return null; }

    return cols.filter(c => use(c.formula).trim() === '').map(c => c.label());
  });

  // null tells to use the built-in file picker.
  constructor(private _gristDoc: GristDoc, private _importSourceElem: ImportSourceElement|null,
              private _createPreview: CreatePreviewFunc) {
    super();
    this._screen = PluginScreen.create(this, _importSourceElem?.importSource.label || "Import from file");

    this.onDispose(() => {
      this._resetImportDiffState();
    });
  }

  /*
   * Get new import sources and update the current one.
   */
  public async pickAndUploadSource(uploadResult: UploadResult|null) {
    try {
      if (!this._importSourceElem) {
        // Use upload result if it was passed in or the built-in file picker.
        // On electron, it uses the native file selector (without actually uploading anything),
        // which is why this requires a slightly different flow.
        uploadResult = uploadResult || await selectFiles({docWorkerUrl: this._docComm.docWorkerUrl,
                                                          multiple: true, sizeLimit: 'import'});
      } else {
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
      ['GenImporterView', sourceInfo.hiddenTableId, sourceInfo.destTableId.get(), null]);
    sourceInfo.lastGenImporterViewPromise = genImporterViewPromise;
    const transformSectionRef = await genImporterViewPromise;

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
    return this._sourceInfoArray.get().map((t: SourceInfo) => t.hiddenTableId);
  }

  private async _reImport(upload: UploadResult) {
    this._screen.renderSpinner();
    this._resetImportDiffState();
    try {
      const parseOptions = {...this._parseOptions.get(), NUM_ROWS: 0};
      const importResult: ImportResult = await this._docComm.importFiles(
        this._getTransformedDataSource(upload), parseOptions, this._getHiddenTableIds());

      this._parseOptions.set(importResult.options);

      this._sourceInfoArray.set(importResult.tables.map((info: ImportTableResult) => ({
        hiddenTableId: info.hiddenTableId,
        uploadFileIndex: info.uploadFileIndex,
        origTableName: info.origTableName,
        sourceSection: this._getPrimaryViewSection(info.hiddenTableId)!,
        transformSection: Observable.create(null, this._getSectionByRef(info.transformSectionRef)),
        destTableId: Observable.create<DestId>(null, info.destTableId ?? NEW_TABLE),
        isLoadingSection: Observable.create(null, false),
        lastGenImporterViewPromise: null
      })));

      if (this._sourceInfoArray.get().length === 0) {
        throw new Error("No data was imported");
      }

      this._mergeOptions = {};
      this._getHiddenTableIds().forEach(tableId => {
        this._mergeOptions[tableId] = {
          updateExistingRecords: Observable.create(null, false),
          mergeCols: obsArray(),
          mergeStrategy: Observable.create(null, {type: 'replace-with-nonblank-source'}),
          hasInvalidMergeCols: Observable.create(null, false),
        };
      });

      // Select the first sourceInfo to show in preview.
      this._sourceInfoSelected.set(this._sourceInfoArray.get()[0] || null);

      this._renderMain(upload);

    } catch (e) {
      console.warn("Import failed", e);
      this._screen.renderError(e.message);
    }
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

    if (importResult.tables[0]?.hiddenTableId) {
      const tableRowModel = this._gristDoc.docModel.dataTables[importResult.tables[0].hiddenTableId].tableMetaRow;
      await this._gristDoc.openDocPage(tableRowModel.primaryViewId());
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
    const content = cssContainer(
      dom.autoDispose(this._formulaEditorHolder),
      {tabIndex: '-1'},
      this._buildModalTitle(
        schema ? cssActionLink(cssLinkIcon('Settings'), 'Import options',
          testId('importer-options-link'),
          dom.on('click', () => this._renderParseOptions(schema, upload))
        ) : null,
      ),
      cssPreviewWrapper(
        cssTableList(
          dom.forEach(this._sourceInfoArray, (info) => {
            const destTableId = Computed.create(null, (use) => use(info.destTableId))
              .onWrite(async (destId) => {
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
            return cssTableInfo(
              dom.autoDispose(destTableId),
              cssTableLine(cssToFrom('From'),
                cssTableSource(getSourceDescription(info, upload), testId('importer-from'))),
              cssTableLine(cssToFrom('To'), linkSelect<DestId>(destTableId, this._destTables)),
              cssTableInfo.cls('-selected', (use) => use(this._sourceInfoSelected) === info),
              dom.on('click', async () => {
                // Ignore click if source is already selected.
                if (info === this._sourceInfoSelected.get()) { return; }

                // Prevent changing selected source if current configuration is invalid.
                if (!this._validateImportConfiguration()) { return; }

                this._cancelPendingDiffRequests();
                this._sourceInfoSelected.set(info);
                await this._updateImportDiff(info);
              }),
              testId('importer-source'),
            );
          }),
        ),
        dom.maybe(this._sourceInfoSelected, (info) => {
          const {mergeCols, updateExistingRecords, hasInvalidMergeCols} = this._mergeOptions[info.hiddenTableId]!;

          return cssConfigAndPreview(
            dom.maybe(info.destTableId, () => cssConfigColumn(
              dom.maybe(info.transformSection, section => {
                const updateRecordsListener = updateExistingRecords.addListener(async () => {
                  await this._updateImportDiff(info);
                });

                return [
                  cssMergeOptions(
                    cssMergeOptionsToggle(labeledSquareCheckbox(
                      updateExistingRecords,
                      'Update existing records',
                      dom.autoDispose(updateRecordsListener),
                      testId('importer-update-existing-records')
                    )),
                    dom.maybe(updateExistingRecords, () => {
                      const mergeColsListener = mergeCols.addListener(async val => {
                        // Reset the error state of the multiSelect on change.
                        if (val.length !== 0 && hasInvalidMergeCols.get()) {
                          hasInvalidMergeCols.set(false);
                        }
                        await this._updateImportDiff(info);
                      });

                      return [
                        cssMergeOptionsMessage(
                          'Merge rows that match these fields:',
                          testId('importer-merge-fields-message')
                        ),
                        multiSelect(
                          mergeCols,
                          section.viewFields().peek().map(f => ({label: f.label(), value: f.colId()})) ?? [],
                          {
                            placeholder: 'Select fields to match on',
                            error: hasInvalidMergeCols
                          },
                          dom.autoDispose(mergeColsListener),
                          testId('importer-merge-fields-select')
                        )
                      ];
                    })
                  ),
                  dom.domComputed(this._unmatchedFields, fields =>
                    fields && fields.length > 0 ?
                      cssUnmatchedFields(
                        dom('div',
                          cssGreenText(
                            `${fields.length} unmatched ${fields.length > 1 ? 'fields' : 'field'}`
                          ),
                          ' in import:'
                        ),
                        cssUnmatchedFieldsList(fields.join(', ')),
                        testId('importer-unmatched-fields')
                      ) : null
                  ),
                  cssColumnMatchOptions(
                    dom.forEach(fromKo(section.viewFields().getObservable()), field => cssColumnMatchRow(
                      cssColumnMatchIcon('ImportArrow'),
                      cssSourceAndDestination(
                        cssDestinationFieldRow(
                          cssDestinationFieldLabel(
                            dom.text(field.label),
                          ),
                          cssDestinationFieldSettings(
                            icon('Dots'),
                            menu(
                              () => {
                                const sourceColId = field.origCol().id();
                                const sourceColIdsAndLabels = [...this._sourceColLabelsById.get()!.entries()];
                                return [
                                  menuItem(
                                    async () => {
                                      await this._gristDoc.clearColumns([sourceColId]);
                                      await this._updateImportDiff(info);
                                    },
                                    'Skip',
                                    testId('importer-column-match-menu-item')
                                  ),
                                  menuDivider(),
                                  ...sourceColIdsAndLabels.map(([id, label]) =>
                                    menuItem(
                                      async () => {
                                        await this._setColumnFormula(sourceColId, '$' + id);
                                        await this._updateImportDiff(info);
                                      },
                                      label,
                                      testId('importer-column-match-menu-item')
                                    ),
                                  ),
                                  testId('importer-column-match-menu'),
                                ];
                              },
                              { placement: 'right-start' },
                            ),
                            testId('importer-column-match-destination-settings')
                          ),
                          testId('importer-column-match-destination')
                        ),
                        dom.domComputed(use => dom.create(
                          this._buildColMappingFormula.bind(this),
                          use(field.column),
                          (elem: Element) => this._activateFormulaEditor(
                            elem,
                            field,
                            () => this._updateImportDiff(info),
                          ),
                          'Skip'
                        )),
                        testId('importer-column-match-source-destination'),
                      )
                    )),
                    testId('importer-column-match-options'),
                  )
                ];
              }),
            )),
            cssPreviewColumn(
              cssSectionHeader('Preview'),
              dom.domComputed(use => {
                const previewSection = use(this._previewViewSection);
                if (use(this._isLoadingDiff) || !previewSection) {
                  return cssPreviewSpinner(loadingSpinner(), testId('importer-preview-spinner'));
                }

                const gridView = this._createPreview(previewSection);
                return cssPreviewGrid(
                  dom.maybe(use1 => SKIP_TABLE === use1(info.destTableId),
                    () => cssOverlay(testId("importer-preview-overlay"))),
                  dom.autoDispose(gridView),
                  gridView.viewPane,
                  testId('importer-preview'),
                );
              })
            )
          );
        }),
      ),
      cssModalButtons(
        bigPrimaryButton('Import',
          dom.on('click', () => this._maybeFinishImport(upload)),
          dom.boolAttr('disabled', use => {
            return use(this._previewViewSection) === null ||
                   use(this._sourceInfoArray).every(i => use(i.destTableId) === SKIP_TABLE);
          }),
          testId('modal-confirm'),
        ),
        bigBasicButton('Cancel',
          dom.on('click', () => this._cancelImport()),
          testId('modal-cancel'),
        ),
      ),
    );
    this._addFocusLayer(content);
    this._screen.render(content, {fullscreen: true});
  }

  private _addFocusLayer(container: HTMLElement) {
    dom.autoDisposeElem(container, new FocusLayer({
      defaultFocusElem: container,
      allowFocus: (elem) => (elem !== document.body),
      onDefaultFocus: () => this.trigger('importer_focus'),
    }));
  }

  /**
   * Updates the formula on column `colRef` to `formula`.
   */
  private async _setColumnFormula(colRef: number, formula: string): Promise<void> {
    return this._gristDoc.docModel.columns.sendTableAction(
      ['UpdateRecord', colRef, { formula, isFormula: true }]
    );
  }

  /**
   * Opens a formula editor for `field` over `refElem`.
   */
  private _activateFormulaEditor(refElem: Element, field: ViewFieldRec, onSave: () => Promise<void>) {
    const vsi = this._gristDoc.viewModel.activeSection().viewInstance();
    const editRow = vsi?.moveEditRowToCursor();
    const editorHolder = openFormulaEditor({
      gristDoc: this._gristDoc,
      field,
      refElem,
      editRow,
      setupCleanup: this._setupFormulaEditorCleanup.bind(this),
      onSave: async (column, formula) => {
        if (formula === column.formula.peek()) { return; }

        await column.updateColValues({formula});
        await onSave();
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
    owner: MultiHolder, _doc: GristDoc, field: ViewFieldRec, _saveEdit: () => Promise<unknown>
  ) {
    const saveEdit = () => _saveEdit().catch(reportError);

    // Whenever focus returns to the dialog, close the editor by saving the value.
    this.on('importer_focus', saveEdit);

    owner.onDispose(() => {
      this.off('importer_focus', saveEdit);
      field.editingFormula(false);
    });
  }

  /**
   * Builds an editable formula component that is displayed
   * in the column mapping section of Importer. On click, opens
   * an editor for the formula for `column`.
   */
  private _buildColMappingFormula(_owner: MultiHolder, column: ColumnRec, buildEditor: (e: Element) => void,
                                  placeholder: string) {
    const formatFormula = (formula: string) => {
      const sourceColLabels = this._sourceColLabelsById.get();
      if (!sourceColLabels) { return formula; }

      formula = formula.trim();
      if (formula.startsWith('$') && sourceColLabels.has(formula.slice(1))) {
        // For simple formulas that only reference a source column id, show the source column label.
        return sourceColLabels.get(formula.slice(1))!;
      }

      return formula;
    };

    return cssFieldFormula(use => formatFormula(use(column.formula)), {placeholder, maxLines: 1},
      dom.cls('disabled'),
      {tabIndex: '-1'},
      dom.on('focus', (_ev, elem) => buildEditor(elem)),
      testId('importer-column-match-formula'),
    );
  }

  // The importer state showing parse options that may be changed.
  private _renderParseOptions(schema: ParseOptionSchema[], upload: UploadResult) {
    this._screen.render([
      this._buildModalTitle(),
      dom.create(buildParseOptionsForm, schema, this._parseOptions.get() as ParseOptionValues,
        (p: ParseOptions) => {
          this._parseOptions.set(p);
          this._reImport(upload).catch((err) => reportError(err));
        },
        () => { this._renderMain(upload); },
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
  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};
  &:hover {
    color: ${colors.darkGreen};
    --icon-color: ${colors.darkGreen};
  }
`);

const cssLinkIcon = styled(icon, `
  flex: none;
  margin-right: 4px;
`);

const cssModalHeader = styled('div', `
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  & > .${cssModalTitle.className} {
    margin-bottom: 0px;
  }
`);

const cssPreviewWrapper = styled('div', `
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  overflow-y: auto;
`);

// This partly duplicates cssSectionHeader from HomeLeftPane.ts
const cssSectionHeader = styled('div', `
  margin-bottom: 8px;
  color: ${colors.slate};
  text-transform: uppercase;
  font-weight: 500;
  font-size: ${vars.xsmallFontSize};
  letter-spacing: 1px;
`);

const cssTableList = styled('div', `
  max-height: 50%;
  column-gap: 32px;
  display: flex;
  flex-flow: row wrap;
  margin-bottom: 16px;
  align-items: flex-start;
  overflow-y: auto;
`);

const cssTableInfo = styled('div', `
  padding: 4px 8px;
  margin: 4px 0px;
  width: 300px;
  border-radius: 3px;
  border: 1px solid ${colors.darkGrey};
  &:hover, &-selected {
    background-color: ${colors.mediumGrey};
  }
`);

const cssTableLine = styled('div', `
  display: flex;
  align-items: center;
  margin: 4px 0;
`);

const cssToFrom = styled('span', `
  flex: none;
  margin-right: 8px;
  color: ${colors.slate};
  text-transform: uppercase;
  font-weight: 500;
  font-size: ${vars.xsmallFontSize};
  letter-spacing: 1px;
  width: 40px;
  text-align: right;
`);

const cssTableSource = styled('div', `
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`);

const cssConfigAndPreview = styled('div', `
  display: flex;
  gap: 32px;
  flex-grow: 1;
  height: 0px;
`);

const cssConfigColumn = styled('div', `
  width: 300px;
  padding-right: 8px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
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
  position: absolute;
  top: 0px;
  left: 0px;
  height: 100%;
  width: 100%;
  z-index: 10;
  background: ${colors.mediumGrey};
`);

const cssPreviewGrid = styled(cssPreview, `
  border: 1px solid ${colors.darkGrey};
  position: relative;
`);

const cssMergeOptions = styled('div', `
  margin-bottom: 16px;
`);

const cssMergeOptionsToggle = styled('div', `
  margin-bottom: 8px;
`);

const cssMergeOptionsMessage = styled('div', `
  color: ${colors.slate};
  margin-bottom: 8px;
`);

const cssColumnMatchOptions = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 20px;
`);

const cssColumnMatchRow = styled('div', `
  display: flex;
  align-items: center;
`);

const cssFieldFormula = styled(buildHighlightedCode, `
  flex: auto;
  cursor: pointer;
  margin-top: 1px;
  padding-left: 4px;
  --icon-color: ${colors.lightGreen};
`);

const cssColumnMatchIcon = styled(icon, `
  flex-shrink: 0;
  width: 20px;
  height: 32px;
  background-color: ${colors.darkGrey};
  margin-right: 4px;
`);

const cssDestinationFieldRow = styled('div', `
  align-items: center;
  display: flex;
`);

const cssSourceAndDestination = styled('div', `
  min-width: 0;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`);

const cssDestinationFieldLabel = styled('div', `
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding-left: 4px;
`);

const cssDestinationFieldSettings = styled('div', `
  flex: none;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: pointer;
  --icon-color: ${colors.slate};

  &:hover, &.weasel-popup-open {
    background-color: ${colors.mediumGrey};
  }
`);

const cssUnmatchedFields = styled('div', `
  margin-bottom: 16px;
`);

const cssUnmatchedFieldsList = styled('div', `
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  padding-right: 16px;
  color: ${colors.slate};
`);

const cssGreenText = styled('span', `
  color: ${colors.lightGreen};
`);
