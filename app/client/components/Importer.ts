/**
 * Importer manages an import files to Grist tables
 * TODO: hidden tables should be also deleted on page refresh, error...
 */
// tslint:disable:no-console

import {GristDoc} from "app/client/components/GristDoc";
import {buildParseOptionsForm, ParseOptionValues} from 'app/client/components/ParseOptions';
import {PluginScreen} from "app/client/components/PluginScreen";
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {fetchURL, isDriveUrl, selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {reportError} from 'app/client/models/AppModel';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {openFilePicker} from "app/client/ui/FileDialog";
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {IOptionFull, linkSelect, multiSelect} from 'app/client/ui2018/menus';
import {cssModalButtons, cssModalTitle} from 'app/client/ui2018/modals';
import {DataSourceTransformed, ImportResult, ImportTableResult, MergeOptions,
        MergeOptionsMap,
        MergeStrategy, TransformColumn, TransformRule, TransformRuleMap} from "app/common/ActiveDocAPI";
import {byteString} from "app/common/gutil";
import {FetchUrlOptions, UploadResult} from 'app/common/uploads';
import {ParseOptions, ParseOptionSchema} from 'app/plugin/FileParserAPI';
import {Computed, Disposable, dom, DomContents, IDisposable, MutableObsArray, obsArray, Observable,
        styled} from 'grainjs';
import {labeledSquareCheckbox} from "app/client/ui2018/checkbox";
import {ACCESS_DENIED, AUTH_INTERRUPTED, canReadPrivateFiles, getGoogleCodeForReading} from "app/client/ui/googleAuth";

// Special values for import destinations; null means "new table".
// TODO We should also support "skip table" (needs server support), so that one can open, say,
// an Excel file with many tabs, and import only some of them.
type DestId = string | null;

// We expect a function for creating the preview GridView, to avoid the need to require the
// GridView module here. That brings many dependencies, making a simple test fixture difficult.
type CreatePreviewFunc = (vs: ViewSectionRec) => GridView;
type GridView = IDisposable & {viewPane: HTMLElement};

// SourceInfo conteains information about source table and corresponding destination table id,
// transform sectionRef (can be used to show previous transform section with users changes)
// and also originalFilename and path.
export interface SourceInfo {
  hiddenTableId: string;
  uploadFileIndex: number;
  origTableName: string;
  sourceSection: ViewSectionRec;
  transformSection: Observable<ViewSectionRec>;
  destTableId: Observable<DestId>;
}
// UI state of selected merge options for each source table (from SourceInfo).
interface MergeOptionsState {
  [srcTableId: string]: {
    updateExistingRecords: Observable<boolean>;
    mergeCols: MutableObsArray<string>;
    mergeStrategy: Observable<MergeStrategy>;
    hasInvalidMergeCols: Observable<boolean>;
  } | undefined;
}

/**
 * Importer manages an import files to Grist tables and shows Preview
 */
export class Importer extends Disposable {
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
  private _mergeOptions: MergeOptionsState = {};
  private _parseOptions = Observable.create<ParseOptions>(this, {});
  private _sourceInfoArray = Observable.create<SourceInfo[]>(this, []);
  private _sourceInfoSelected = Observable.create<SourceInfo|null>(this, null);

  private _previewViewSection: Observable<ViewSectionRec|null> =
    Computed.create(this, this._sourceInfoSelected, (use, info) => {
      if (!info) { return null; }
      const viewSection = use(info.transformSection);
      return viewSection && !use(viewSection._isDeleted) ? viewSection : null;
    });

  // destTables is a list of options for import destinations, and includes all tables in the
  // document, plus two values: to import as a new table, and to skip an import table entirely.
  private _destTables = Computed.create<Array<IOptionFull<DestId>>>(this, (use) => [
    {value: null, label: 'New Table'},
    ...use(this._gristDoc.docModel.allTableIds.getObservable()).map((t) => ({value: t, label: t})),
  ]);

  // null tells to use the built-in file picker.
  constructor(private _gristDoc: GristDoc, private _importSourceElem: ImportSourceElement|null,
              private _createPreview: CreatePreviewFunc) {
    super();
    this._screen = PluginScreen.create(this, _importSourceElem?.importSource.label || "Import from file");
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

  private async _updateTransformSection(sourceInfo: SourceInfo, destTableId: string|null) {
    const transformSectionRef = await this._gristDoc.docData.sendAction(
      ['GenImporterView', sourceInfo.hiddenTableId, destTableId, null]);
    sourceInfo.transformSection.set(this._gristDoc.docModel.viewSections.getRowModel(transformSectionRef));
    sourceInfo.destTableId.set(destTableId);
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
    const transformFields = sourceInfo.transformSection.get().viewFields().peek();
    const sourceFields = sourceInfo.sourceSection.viewFields().peek();

    const destTableId: DestId = sourceInfo.destTableId.get();
    return {
      destTableId,
      destCols: transformFields.map<TransformColumn>((field) => ({
        label: field.label(),
        colId: destTableId ? field.colId() : null, // if inserting into new table, colId isnt defined
        type: field.column().type(),
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
    try {
      const parseOptions = {...this._parseOptions.get(), NUM_ROWS: 100};
      const importResult: ImportResult = await this._docComm.importFiles(
        this._getTransformedDataSource(upload), parseOptions, this._getHiddenTableIds());

      this._parseOptions.set(importResult.options);

      this._sourceInfoArray.set(importResult.tables.map((info: ImportTableResult) => ({
        hiddenTableId: info.hiddenTableId,
        uploadFileIndex: info.uploadFileIndex,
        origTableName: info.origTableName,
        sourceSection: this._getPrimaryViewSection(info.hiddenTableId)!,
        transformSection: Observable.create(null, this._getSectionByRef(info.transformSectionRef)),
        destTableId: Observable.create<DestId>(null, info.destTableId)
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
          hasInvalidMergeCols: Observable.create(null, false)
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
    const parseOptions = {...this._parseOptions.get(), NUM_ROWS: 0};
    const mergeOptionMaps = this._getMergeOptionMaps(upload);

    const importResult: ImportResult = await this._docComm.finishImportFiles(
      this._getTransformedDataSource(upload), this._getHiddenTableIds(), {mergeOptionMaps, parseOptions});

    if (importResult.tables[0].hiddenTableId) {
      const tableRowModel = this._gristDoc.docModel.dataTables[importResult.tables[0].hiddenTableId].tableMetaRow;
      await this._gristDoc.openDocPage(tableRowModel.primaryViewId());
    }
    this._screen.close();
    this.dispose();
  }

  private async _cancelImport() {
    if (this._uploadResult) {
      await this._docComm.cancelImportFiles(
        this._getTransformedDataSource(this._uploadResult), this._getHiddenTableIds());
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

    const {updateExistingRecords, mergeCols, hasInvalidMergeCols} = mergeOptions;
    if (updateExistingRecords.get() && mergeCols.get().length === 0) {
      hasInvalidMergeCols.set(true);
      isValid = false;
    }

    return isValid;
  }

  private _buildModalTitle(rightElement?: DomContents) {
    const title =  this._importSourceElem ? this._importSourceElem.importSource.label : 'Import from file';
    return cssModalHeader(cssModalTitle(title), rightElement);
  }

  // The importer state showing import in progress, with a list of tables, and a preview.
  private _renderMain(upload: UploadResult) {
    const schema = this._parseOptions.get().SCHEMA;
    this._screen.render([
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
              .onWrite((destId) => {
                this._resetTableMergeOptions(info.hiddenTableId);
                void this._updateTransformSection(info, destId);
              });
            return cssTableInfo(
              dom.autoDispose(destTableId),
              cssTableLine(cssToFrom('From'),
                cssTableSource(getSourceDescription(info, upload), testId('importer-from'))),
              cssTableLine(cssToFrom('To'), linkSelect<DestId>(destTableId, this._destTables)),
              cssTableInfo.cls('-selected', (use) => use(this._sourceInfoSelected) === info),
              dom.on('click', () => {
                if (info === this._sourceInfoSelected.get() || !this._validateImportConfiguration()) {
                  return;
                }
                this._sourceInfoSelected.set(info);
              }),
              testId('importer-source'),
            );
          }),
        ),
        dom.maybe(this._sourceInfoSelected, (info) =>
          dom.maybe(info.destTableId, () => {
            const {mergeCols, updateExistingRecords, hasInvalidMergeCols} = this._mergeOptions[info.hiddenTableId]!;
            return cssMergeOptions(
              cssMergeOptionsToggle(labeledSquareCheckbox(
                updateExistingRecords,
                'Update existing records',
                testId('importer-update-existing-records')
              )),
              dom.maybe(updateExistingRecords, () => [
                cssMergeOptionsMessage(
                  'Imported rows will be merged with records that have the same values for all of these fields:',
                  testId('importer-merge-fields-message')
                ),
                dom.domComputed(info.transformSection, section => {
                  // When changes are made to selected fields, reset the multiSelect error observable.
                  const invalidColsListener = mergeCols.addListener((val, _prev) => {
                    if (val.length !== 0 && hasInvalidMergeCols.get()) {
                      hasInvalidMergeCols.set(false);
                    }
                  });
                  return [
                    dom.autoDispose(invalidColsListener),
                    multiSelect(
                      mergeCols,
                      section.viewFields().peek().map(field => field.label()),
                      {
                        placeholder: 'Select fields to match on',
                        error: hasInvalidMergeCols
                      },
                      testId('importer-merge-fields-select')
                    ),
                  ];
                })
              ])
            );
          })
        ),
        dom.maybe(this._previewViewSection, () => cssSectionHeader('Preview')),
        dom.maybe(this._previewViewSection, (viewSection) => {
          const gridView = this._createPreview(viewSection);
          return cssPreviewGrid(
            dom.autoDispose(gridView),
            gridView.viewPane,
            testId('importer-preview'),
          );
        }),
      ),
      cssModalButtons(
        bigPrimaryButton('Import',
          dom.on('click', () => this._maybeFinishImport(upload)),
          testId('modal-confirm'),
        ),
        bigBasicButton('Cancel',
          dom.on('click', () => this._cancelImport()),
          testId('modal-cancel'),
        ),
      ),
    ]);
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
  return sourceInfo.origTableName ? origName + ' - ' + sourceInfo.origTableName : origName;
}

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
  width: 600px;
  padding: 8px 12px 8px 0;
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
  display: flex;
  flex-flow: row wrap;
  justify-content: space-between;
  margin-bottom: 16px;
  align-items: flex-start;
`);

const cssTableInfo = styled('div', `
  padding: 4px 8px;
  margin: 4px 0px;
  width: calc(50% - 16px);
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
  overflow-wrap: anywhere;
`);

const cssPreviewGrid = styled('div', `
  display: flex;
  height: 300px;
  border: 1px solid ${colors.darkGrey};
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
