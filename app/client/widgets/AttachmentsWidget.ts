import {CellValue} from "app/common/DocActions";
import * as commands from 'app/client/components/commands';
import {dragOverClass} from 'app/client/lib/dom';
import {selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {cssRow} from 'app/client/ui/RightPanelStyles';
import {colors, testId, theme, vars} from 'app/client/ui2018/cssVars';
import {NewAbstractWidget} from 'app/client/widgets/NewAbstractWidget';
import {encodeQueryParams} from 'app/common/gutil';
import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {DataRowModel} from 'app/client/models/DataRowModel';
import {MetaTableData} from 'app/client/models/TableData';
import { SingleCell } from 'app/common/TableData';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {UploadResult} from 'app/common/uploads';
import { GristObjCode } from 'app/plugin/GristData';
import {Computed, dom, DomContents, fromKo, input, onElem, styled} from 'grainjs';
import {extname} from 'path';


/**
 * AttachmentsWidget - A widget for displaying attachments as image previews.
 */
export class AttachmentsWidget extends NewAbstractWidget {

  private _attachmentsTable: MetaTableData<'_grist_Attachments'>;
  private _height: KoSaveableObservable<string>;

  constructor(field: ViewFieldRec) {
    super(field);

    // TODO: the Attachments table currently treated as metadata, and loaded on open,
    // but should probably be loaded on demand as it contains user data, which may be large.
    this._attachmentsTable = this._getDocData().getMetaTable('_grist_Attachments');

    this._height = this.options.prop('height');

    this.autoDispose(this._height.subscribe(() => {
      this.field.viewSection().events.trigger('rowHeightChange');
    }));
  }

  public buildDom(row: DataRowModel) {
    // NOTE: A cellValue of the correct type includes the list encoding designator 'L' as the
    // first element.
    const cellValue = row.cells[this.field.colId()];
    const values = Computed.create(null, fromKo(cellValue), (use, _cellValue) =>
      Array.isArray(_cellValue) ? _cellValue.slice(1) as number[] : []);

    const colId = this.field.colId();
    const tableId = this.field.column().table().tableId();
    return cssAttachmentWidget(
      dom.autoDispose(values),

      dom.cls('field_clip'),
      dragOverClass('attachment_drag_over'),
      cssAttachmentIcon(
        cssAttachmentIcon.cls('-hover', (use) => use(values).length > 0),
        dom.on('click', () => this._selectAndSave(row, cellValue)),
        testId('attachment-icon'),
      ),
      dom.maybe<number>(row.id, rowId => {
        return dom.forEach(values, (value: number) =>
          isNaN(value) ? null : this._buildAttachment(value, values, {
            rowId, colId, tableId,
          }));
      }),
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
      dom.on('dblclick', () => commands.allCommands.input.run(String(allValues.get().indexOf(value) + 1))),
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

  private async _selectAndSave(row: DataRowModel, value: KoSaveableObservable<CellValue>): Promise<void> {
    const uploadResult = await selectFiles({docWorkerUrl: this._getDocComm().docWorkerUrl,
                                            multiple: true, sizeLimit: 'attachment'});
    return this._save(row, value, uploadResult);
  }

  private async _uploadAndSave(row: DataRowModel, value: KoSaveableObservable<CellValue>,
        files: FileList): Promise<void> {
    const uploadResult = await uploadFiles(Array.from(files),
                                           {docWorkerUrl: this._getDocComm().docWorkerUrl,
                                            sizeLimit: 'attachment'});
    return this._save(row, value, uploadResult);
  }

  private async _save(row: DataRowModel, value: KoSaveableObservable<CellValue>,
        uploadResult: UploadResult|null
  ): Promise<void> {
    if (!uploadResult) { return; }
    const rowIds = await this._getDocComm().addAttachments(uploadResult.uploadId);
    // Values should be saved with a leading "L" to fit Grist's list value encoding.
    const formatted: CellValue = value() ? value() : [GristObjCode.List];
    const newValue = (formatted as number[]).concat(rowIds) as CellValue;

    // Move the cursor here (note that this may involve switching active section when dragging
    // into a cell of an inactive section). Then send the 'input' command; it is normally used for
    // key presses to open an editor; here the "typed text" is the new value. It is handled by
    // AttachmentsEditor.skipEditor(), and makes the edit apply to editRow, which handles setting
    // default values based on widget linking.
    commands.allCommands.setCursor.run(row, this.field);
    commands.allCommands.input.run(newValue);
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

const cssAttachmentIcon = styled('div.glyphicon.glyphicon-paperclip', `
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
