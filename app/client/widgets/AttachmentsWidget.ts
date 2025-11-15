import {CellValue} from "app/common/DocActions";
import * as commands from 'app/client/components/commands';
import {dragOverClass} from 'app/client/lib/dom';
import {stopEvent} from 'app/client/lib/domUtils';
import {selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {makeT} from "app/client/lib/localization";
import {cssRow} from 'app/client/ui/RightPanelStyles';
import {colors, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from "app/client/ui2018/loaders";
import {NewAbstractWidget} from 'app/client/widgets/NewAbstractWidget';
import {encodeQueryParams} from 'app/common/gutil';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {MetaTableData} from 'app/client/models/TableData';
import { SingleCell } from 'app/common/TableData';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {UploadResult} from 'app/common/uploads';
import {UIRowId} from 'app/plugin/GristAPI';
import { GristObjCode } from 'app/plugin/GristData';
import {Computed, dom, DomContents, fromKo, input, Observable, onElem, styled} from 'grainjs';
import {extname} from 'path';
import {FormFieldRulesConfig} from "app/client/components/Forms/FormConfig";

const t = makeT('AttachmentsWidget');

/**
 * AttachmentsWidget - A widget for displaying attachments as image previews.
 */
export class AttachmentsWidget extends NewAbstractWidget {

  private _attachmentsTable: MetaTableData<'_grist_Attachments'>;
  private _height: KoSaveableObservable<string>;
  private _uploadingTimeouts: Partial<Record<UIRowId, number>> = {};
  private _uploadingStatesObs: Observable<Partial<Record<UIRowId, boolean>>>;

  constructor(field: ViewFieldRec) {
    super(field);

    // TODO: the Attachments table currently treated as metadata, and loaded on open,
    // but should probably be loaded on demand as it contains user data, which may be large.
    this._attachmentsTable = this._getDocData().getMetaTable('_grist_Attachments');

    this._height = this.options.prop('height');
    this._uploadingStatesObs = Observable.create(this, {});

    this.autoDispose(this._height.subscribe(() => {
      this.field.viewSection().events.trigger('rowHeightChange');
    }));

    this.onDispose(() => {
      Object.values(this._uploadingTimeouts).forEach(timeout => clearTimeout(timeout));
    });
  }

  public buildDom(row: DataRowModel) {
    // NOTE: A cellValue of the correct type includes the list encoding designator 'L' as the
    // first element.
    const cellValue = row.cells[this.field.colId()];
    const values = Computed.create(null, fromKo(cellValue), (use, _cellValue) =>
      Array.isArray(_cellValue) ? _cellValue.slice(1) as number[] : []);

    const colId = this.field.colId();
    const tableId = this.field.column().table().tableId();

    const isUploadingObs = Computed.create(null, this._uploadingStatesObs, (use, states) =>
      states[row.getRowId()] || false
    );

    return cssAttachmentWidget(
      dom.autoDispose(values),
      dom.autoDispose(isUploadingObs),

      dom.cls('field_clip'),
      dragOverClass('attachment_drag_over'),
      dom.maybe(use => !use(use(this.field.column).isRealFormula), () => [
        cssAttachmentIcon(
          cssAttachmentIcon.cls('-hover', (use) => use(values).length > 0),
          dom.on('click', async (ev) => {
            stopEvent(ev);
            await this._selectAndSave(row, cellValue);
          }),
          testId('attachment-icon'),
        ),
      ]),
      dom.maybe<number>(row.id, rowId => {
        return dom.forEach(values, (value: number) =>
          isNaN(value) ? null : this._buildAttachment(value, values, {
            rowId, colId, tableId,
          }));
      }),
      dom.maybe(isUploadingObs, () =>
        cssSpinner(
          cssSpinner.cls('-has-attachments', (use) => use(values).length > 0),
          testId('attachment-spinner'),
          {title: t('Uploading, please wait…')}
        )
      ),
      dom.on('drop', ev => this._uploadAndSave(row, cellValue, ev.dataTransfer!.files)),
      testId('attachment-widget'),
    );
  }

  public buildConfigDom(): DomContents {
    const options = this.field.config.options;
    const height = options.prop('height');
    const inputRange = input(
      fromKo(height),
      {onInput: true}, {
        style: 'margin: 0 5px;',
        type: 'range',
        min: '16',
        max: '96',
        value: '36'
      },
      testId('pw-thumbnail-size'),
      // When multiple columns are selected, we can only edit height when all
      // columns support it.
      dom.prop('disabled', use => use(options.disabled('height'))),
    );
    // Save the height on change event (when the user releases the drag button)
    onElem(inputRange, 'change', (ev: Event) => {
      height.setAndSave(inputRange.value).catch(reportError);
    });
    return cssRow(
      cssSizeLabel('Size'),
      inputRange
    );
  }

  public buildFormConfigDom(): DomContents {
    return [
      dom.create(FormFieldRulesConfig, this.field),
    ];
  }

  protected _buildAttachment(value: number, allValues: Computed<number[]>, cell: SingleCell): Element {
    const filename = this._attachmentsTable.getValue(value, 'fileName')!;
    const fileIdent = this._attachmentsTable.getValue(value, 'fileIdent')!;
    const height = this._attachmentsTable.getValue(value, 'imageHeight')!;
    const width = this._attachmentsTable.getValue(value, 'imageWidth')!;
    const hasPreview = Boolean(height);
    const ratio = hasPreview ? (width / height) : 1;

    return cssAttachmentPreview({title: filename}, // Add a filename tooltip to the previews.
      dom.style('height', (use) => `${use(this._height)}px`),
      dom.style('width', (use) => `${parseInt(use(this._height), 10) * ratio}px`),
      // TODO: Update to legitimately determine whether a file preview exists.
      hasPreview ? dom('img', {style: 'height: 100%; min-width: 100%; vertical-align: top;'},
        dom.attr('src', this._getUrl(value, cell))
      ) : renderFileType(filename, fileIdent, this._height),
      // Open editor as if with input, using it to tell it which of the attachments to show. We
      // pass in a 1-based index. Hitting a key opens the cell, and this approach allows an
      // accidental feature of opening e.g. second attachment by hitting "2".
      dom.on('dblclick', (ev) => commands.allCommands.input.run(String(allValues.get().indexOf(value) + 1), ev)),
      testId('pw-thumbnail'),
    );
  }

  // Returns the attachment download url.
  private _getUrl(attId: number, cell: SingleCell): string {
    const docComm = this._getDocComm();
    return docComm.docUrl('attachment') + '?' + encodeQueryParams({
      ...docComm.getUrlParams(),
      ...cell,
      attId,
      name: this._attachmentsTable.getValue(attId, 'fileName')
    });
  }

  private _setUploadingState(rowId: UIRowId, uploading: boolean): void {
    const timeouts = this._uploadingTimeouts;
    const states = this._uploadingStatesObs.get();
    if (timeouts[rowId]) {
      clearTimeout(timeouts[rowId]);
    }
    if (uploading) {
      timeouts[rowId] = window.setTimeout(() => {
        if (this.isDisposed()) {
          return;
        }
        states[rowId] = true;
        this._uploadingStatesObs.set({...states});
        // let the view know about the spinner so that it can expands the row height for it if needed
        const viewInstance = this.field.viewSection().viewInstance();
        const rowModel = viewInstance?.viewData.getRowModel(rowId);
        if (rowModel) {
          viewInstance?.onRowResize([rowModel]);
        }
      }, 750);
    } else {
      states[rowId] = false;
      this._uploadingStatesObs.set({...states});
    }
  }

  private async _selectAndSave(row: DataRowModel, value: KoSaveableObservable<CellValue>): Promise<void> {
    // keep a copy of the row id at the beginning ; because the given row may change while uploading
    // (example: user starts uploading in card 2/10, then switches to card 3/10, the upload must save to card 2/10)
    const rowId = row.getRowId();
    try {
      const uploadResult = await selectFiles({
        docWorkerUrl: this._getDocComm().docWorkerUrl,
        multiple: true,
        sizeLimit: 'attachment',
      }, (progress) => {
        if (progress === 0) {
          this._setUploadingState(rowId, true);
        }
      });
      this._setUploadingState(rowId, false);
      return this._save(rowId, value, uploadResult);
    } catch (error) {
      this._setUploadingState(rowId, false);
      throw error;
    }
  }

  private async _uploadAndSave(row: DataRowModel, value: KoSaveableObservable<CellValue>,
        files: FileList): Promise<void> {
    // keep a copy of the row id at the beginning ; because the given row may change while uploading
    // (example: user starts uploading in card 2/10, then switches to card 3/10, the upload must save to card 2/10)
    const rowId = row.getRowId();
    // Move the cursor here (note that this may involve switching active section when dragging
    // into a cell of an inactive section).
    commands.allCommands.setCursor.run(row, this.field);
    try {
      const uploadResult = await uploadFiles(
        Array.from(files),
        {docWorkerUrl: this._getDocComm().docWorkerUrl, sizeLimit: 'attachment'},
        (progress) => {
          if (progress === 0) {
            this._setUploadingState(rowId, true);
          }
        }
      );
      this._setUploadingState(rowId, false);
      return this._save(rowId, value, uploadResult);
    } catch (error) {
      this._setUploadingState(rowId, false);
      throw error;
    }
  }

  private async _save(rowId: UIRowId, value: KoSaveableObservable<CellValue>,
        uploadResult: UploadResult|null
  ): Promise<void> {
    if (!uploadResult) { return; }

    // Add a row if one doesn't already exist.
    if (rowId === "new") {
      const viewSection = this.field.viewSection();
      const view = viewSection.viewInstance();
      if (!view) {
        throw new Error(`Widget ${viewSection.getRowId()} not found`);
      }

      rowId = await view.insertRow()!;
    }

    // Upload the attachments.
    const rowIds = await this._getDocComm().addAttachments(uploadResult.uploadId);

    const tableId = this.field.tableId();
    const tableData = this._getDocData().getTable(tableId);
    if (!tableData) {
      throw new Error(`Table ${tableId} not found`);
    }

    // Save the attachment IDs to the cell.
    // Values should be saved with a leading "L" to fit Grist's list value encoding.
    const formatted: CellValue = value() ? value() : [GristObjCode.List];
    const newValue = (formatted as number[]).concat(rowIds) as CellValue;
    await tableData.sendTableAction(["UpdateRecord", rowId, {
        [this.field.colId()]: newValue,
    }]);
  }
}

export function renderFileType(fileName: string, fileIdent: string, height?: ko.Observable<string>): HTMLElement {
  // Prepend 'x' to ensure we return the extension even if the basename is empty (e.g. ".xls").
  // Take slice(1) to strip off the leading period.
  const extension = extname('x' + fileName).slice(1) || extname('x' + fileIdent).slice(1) || '?';
  return cssFileType(extension.toUpperCase(),
    height && cssFileType.cls((use) => {
      const size = parseFloat(use(height));
      return size < 28 ? '-small' : size < 60 ? '-medium' : '-large';
    }),
  );
}

const cssAttachmentWidget = styled('div', `
  display: flex;
  flex-wrap: wrap;
  white-space: pre-wrap;

  &.attachment_drag_over {
    outline: 2px dashed #ff9a00;
    outline-offset: -2px;
  }
`);

const cssAttachmentIcon = styled('div', `
  position: absolute;
  top: 2px;
  left: 5px;
  padding: 2px;
  background-color: ${theme.attachmentsCellIconBg};
  color: ${theme.attachmentsCellIconFg};
  border-radius: 2px;
  border: none;
  cursor: pointer;
  box-shadow: 0 0 0 1px ${theme.cellEditorBg};
  z-index: 1;

  &:hover {
    background-color: ${theme.attachmentsCellIconHoverBg};
  }

  &-hover {
    display: none;
  }
  .${cssAttachmentWidget.className}:hover &-hover {
    display: inline;
  }

  &::before {
    display: block;
    background-color: var(--grist-control-bg, --grist-theme-text, black);
    content: ' ';
    mask-image: var(--icon-FieldAttachment);
    width: 14px;
    height: 14px;
    mask-size: contain;
    mask-repeat: no-repeat;
  }
`);

const cssAttachmentPreview = styled('div', `
  color: black;
  background-color: white;
  border: 1px solid #bbb;
  margin: 0 2px 2px 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 0;
  &:hover {
    border-color: ${theme.cursor};
  }
`);

const cssSizeLabel = styled('div', `
  color: ${theme.lightText};
  margin-right: 9px;
`);


const cssFileType = styled('div', `
  height: 100%;
  width: 100%;
  max-height: 80px;
  max-width: 80px;
  background-color: ${colors.slate};
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
  color: white;
  overflow: hidden;

  &-small { font-size: ${vars.xxsmallFontSize}; }
  &-medium { font-size: ${vars.smallFontSize}; }
  &-large { font-size: ${vars.mediumFontSize}; }
`);

const cssSpinner = styled(loadingSpinner, `
  width: 16px;
  height: 16px;
  border-width: 2px;
  margin-left: 23px;

  &-has-attachments {
    margin-left: 2px;
    margin-top: 2px;
    margin-bottom: 6px;
  }
`);
