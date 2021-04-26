/**
 * Importer manages an import files to Grist tables
 * TODO: hidden tables should be also deleted on page refresh, error...
 */
// tslint:disable:no-console

import {GristDoc} from "app/client/components/GristDoc";
import {buildParseOptionsForm, ParseOptionValues} from 'app/client/components/ParseOptions';
import {ImportSourceElement} from 'app/client/lib/ImportSourceElement';
import {fetchURL, selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {reportError} from 'app/client/models/AppModel';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {openFilePicker} from "app/client/ui/FileDialog";
import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {colors, testId, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {IOptionFull, linkSelect} from 'app/client/ui2018/menus';
import {cssModalButtons, cssModalTitle, IModalControl, modal} from 'app/client/ui2018/modals';
import {DataSourceTransformed, ImportResult, ImportTableResult} from "app/common/ActiveDocAPI";
import {TransformColumn, TransformRule, TransformRuleMap} from "app/common/ActiveDocAPI";
import {byteString} from "app/common/gutil";
import {UploadResult} from 'app/common/uploads';
import {ParseOptions, ParseOptionSchema} from 'app/plugin/FileParserAPI';
import {RenderTarget} from 'app/plugin/RenderOptions';
import {Computed, Disposable, dom, DomContents, IDisposable, Observable, styled} from 'grainjs';

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

/**
 * Importer manages an import files to Grist tables and shows Preview
 */
export class Importer extends Disposable {
  /**
   * Imports using the given plugin importer, or the built-in file-picker when null is passed in.
   */
  public static async selectAndImport(
    gristDoc: GristDoc, importSourceElem: ImportSourceElement|null, createPreview: CreatePreviewFunc
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
    // Importer disposes itself when its dialog is closed, so we do not take ownership of it.
    Importer.create(null, gristDoc, importSourceElem, createPreview).pickAndUploadSource(uploadResult)
    .catch((err) => reportError(err));
  }

  private _docComm = this._gristDoc.docComm;
  private _uploadResult?: UploadResult;
  private _openModalCtl: IModalControl|null = null;
  private _importerContent = Observable.create<DomContents>(this, null);

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

        // registers a render target for plugin to render inline.
        const handle: RenderTarget = plugin.addRenderTarget((el, opt = {}) => {
          el.style.width = "100%";
          el.style.height = opt.height || "200px";
          this._showImportDialog();
          this._renderPlugin(el);
        });

        const importSource = await this._importSourceElem.importSourceStub.getImportSource(handle);
        plugin.removeRenderTarget(handle);

        if (importSource) {
          // If data has been picked, upload it.
          const item = importSource.item;
          if (item.kind === "fileList") {
            const files = item.files.map(({content, name}) => new File([content], name));
            uploadResult = await uploadFiles(files, {docWorkerUrl: this._docComm.docWorkerUrl,
                                                     sizeLimit: 'import'});
           } else if (item.kind ===  "url") {
            uploadResult = await fetchURL(this._docComm, item.url);
           } else {
            throw new Error(`Import source of kind ${(item as any).kind} are not yet supported!`);
          }
        }
      }
    } catch (err) {
      this._renderError(err.message);
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

  private _createTransformRuleMap(uploadFileIndex: number): TransformRuleMap {
    const result: TransformRuleMap = {};
    for (const sourceInfo of this._sourceInfoArray.get()) {
      if (sourceInfo.uploadFileIndex === uploadFileIndex) {
        result[sourceInfo.origTableName] = this._createTransformRule(sourceInfo);
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

  private _getHiddenTableIds(): string[] {
    return this._sourceInfoArray.get().map((t: SourceInfo) => t.hiddenTableId);
  }

  private async _reImport(upload: UploadResult) {
    this._renderSpinner();
    this._showImportDialog();
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

      // Select the first sourceInfo to show in preview.
      this._sourceInfoSelected.set(this._sourceInfoArray.get()[0] || null);

      this._renderMain(upload);

    } catch (e) {
      console.warn("Import failed", e);
      this._renderError(e.message);
    }
  }

  private async _finishImport(upload: UploadResult) {
    this._renderSpinner();
    const parseOptions = {...this._parseOptions.get(), NUM_ROWS: 0};
    const importResult: ImportResult = await this._docComm.finishImportFiles(
      this._getTransformedDataSource(upload), parseOptions, this._getHiddenTableIds());

    if (importResult.tables[0].hiddenTableId) {
      const tableRowModel = this._gristDoc.docModel.dataTables[importResult.tables[0].hiddenTableId].tableMetaRow;
      await this._gristDoc.openDocPage(tableRowModel.primaryViewId());
    }
    this._openModalCtl!.close();
    this.dispose();
  }

  private async _cancelImport() {
    if (this._uploadResult) {
      await this._docComm.cancelImportFiles(
        this._getTransformedDataSource(this._uploadResult), this._getHiddenTableIds());
    }
    this._openModalCtl!.close();
    this.dispose();
  }

  private _showImportDialog() {
    if (this._openModalCtl) { return; }
    modal((ctl, owner) => {
      this._openModalCtl = ctl;
      return [
        cssModalOverrides.cls(''),
        dom.domComputed(this._importerContent),
        testId('importer-dialog'),
      ];
    }, {
      noClickAway: true,
      noEscapeKey: true,
    });
  }

  private _buildModalTitle(rightElement?: DomContents) {
    const title =  this._importSourceElem ? this._importSourceElem.importSource.label : 'Import from file';
    return cssModalHeader(cssModalTitle(title), rightElement);
  }

  // The importer state showing just a spinner, when the user has to wait. We don't even let the
  // user cancel it, because the cleanup can only happen properly once the wait completes.
  private _renderSpinner() {
    this._importerContent.set([this._buildModalTitle(), cssSpinner(loadingSpinner())]);
  }

  // The importer state showing the inline element from the plugin (e.g. to enter URL in case of
  // import-from-url).
  private _renderPlugin(inlineElement: HTMLElement) {
    this._importerContent.set([this._buildModalTitle(), inlineElement]);
  }

  // The importer state showing just an error.
  private _renderError(message: string) {
    this._importerContent.set([
      this._buildModalTitle(),
      cssModalBody('Import failed: ', message, testId('importer-error')),
      cssModalButtons(
        bigBasicButton('Close',
          dom.on('click', () => this._cancelImport()),
          testId('modal-cancel'),
        ),
      ),
    ]);
  }

  // The importer state showing import in progress, with a list of tables, and a preview.
  private _renderMain(upload: UploadResult) {
    const schema = this._parseOptions.get().SCHEMA;
    this._importerContent.set([
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
              .onWrite((destId) => this._updateTransformSection(info, destId));
            return cssTableInfo(
              dom.autoDispose(destTableId),
              cssTableLine(cssToFrom('From'),
                cssTableSource(getSourceDescription(info, upload), testId('importer-from'))),
              cssTableLine(cssToFrom('To'), linkSelect<DestId>(destTableId, this._destTables)),
              cssTableInfo.cls('-selected', (use) => use(this._sourceInfoSelected) === info),
              dom.on('click', () => this._sourceInfoSelected.set(info)),
              testId('importer-source'),
            );
          }),
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
          dom.on('click', () => this._finishImport(upload)),
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
    this._importerContent.set([
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

const cssModalOverrides = styled('div', `
  max-height: calc(100% - 32px);
  display: flex;
  flex-direction: column;
  & > .${cssModalButtons.className} {
    margin-top: 16px;
  }
`);

const cssModalBody = styled('div', `
  padding: 16px 0;
  overflow-y: auto;
  max-width: 470px;
`);

const cssSpinner = styled('div', `
  display: flex;
  align-items: center;
  height: 80px;
  margin: auto;
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
