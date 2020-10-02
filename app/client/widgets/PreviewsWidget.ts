import {Computed, dom, fromKo, input, makeTestId, onElem, styled, TestId} from 'grainjs';

import {dragOverClass} from 'app/client/lib/dom';
import {selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {cssRow} from 'app/client/ui/RightPanel';
import {colors} from 'app/client/ui2018/cssVars';
import {NewAbstractWidget} from 'app/client/widgets/NewAbstractWidget';
import {NewBaseEditor} from 'app/client/widgets/NewBaseEditor';
import {PreviewModal} from 'app/client/widgets/PreviewModal';
import {encodeQueryParams} from 'app/common/gutil';
import {TableData} from 'app/common/TableData';
import {UploadResult} from 'app/common/uploads';

const testId: TestId = makeTestId('test-pw-');

const attachmentWidget = styled('div.attachment_widget.field_clip', `
  display: flex;
  flex-wrap: wrap;
  white-space: pre-wrap;
`);

const attachmentIcon = styled('div.attachment_icon.glyphicon.glyphicon-paperclip', `
  position: absolute;
  top: 2px;
  left: 2px;
  padding: 2px;
  background-color: #D0D0D0;
  color: white;
  border-radius: 2px;
  border: none;
  cursor: pointer;
  box-shadow: 0 0 0 1px white;
  z-index: 1;

  &:hover {
    background-color: #3290BF;
  }
`);

const attachmentPreview = styled('div', `
  color: black;
  background-color: white;
  border: 1px solid #bbb;
  margin: 0 2px 2px 0;
  position: relative;
  vertical-align: top;
  z-index: 0;

  &:hover > .show_preview {
    display: block;
  }
`);

const showPreview = styled('div.glyphicon.glyphicon-eye-open.show_preview', `
  position: absolute;
  display: none;
  right: -2px;
  top: -2px;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background-color: #888;
  color: white;
  font-size: 6pt;
  padding: 2px;
  cursor: pointer;

  &:hover {
    display: block;
  }
`);

const noPreviewIcon = styled('div.glyphicon.glyphicon-file', `
  min-width: 100%;
  color: #bbb;
  text-align: center;
  margin: calc(50% * 1.33 - 6px) 0;
  font-size: 6pt;
  vertical-align: top;
`);

const sizeLabel = styled('div', `
  color: ${colors.slate};
  margin-right: 9px;
`);

export interface SavingObservable<T> extends ko.Observable<T> {
  setAndSave(value: T): void;
}

/**
 * PreviewsWidget - A widget for displaying attachments as image previews.
 */
export class PreviewsWidget extends NewAbstractWidget {

  private _attachmentsTable: TableData;
  private _height: SavingObservable<string>;

  constructor(field: any) {
    super(field);

    // TODO: the Attachments table currently treated as metadata, and loaded on open,
    // but should probably be loaded on demand as it contains user data, which may be large.
    this._attachmentsTable = this._getDocData().getTable('_grist_Attachments')!;

    this._height = this.options.prop('height') as SavingObservable<string>;

    this.autoDispose(this._height.subscribe(() => {
      this.field.viewSection().events.trigger('rowHeightChange');
    }));
  }

  public buildDom(_row: any): Element {
    // NOTE: A cellValue of the correct type includes the list encoding designator 'L' as the
    // first element.
    const cellValue: SavingObservable<number[]> = _row[this.field.colId()];
    const values = Computed.create(null, fromKo(cellValue), (use, _cellValue) =>
      Array.isArray(_cellValue) ? _cellValue.slice(1) : []);

    return attachmentWidget(
      dom.autoDispose(values),

      dragOverClass('attachment_drag_over'),
      attachmentIcon(
        dom.cls('attachment_hover_icon', (use) => use(values).length > 0),
        dom.on('click', () => this._selectAndSave(cellValue))
      ),
      dom.forEach(values, (value: number) =>
        isNaN(value) ? null : this._buildAttachment(value, cellValue)
      ),
      dom.on('drop', ev => this._uploadAndSave(cellValue, ev.dataTransfer!.files))
    );
  }

  public buildConfigDom(): Element {
    const inputRange = input(fromKo(this._height), {onInput: true}, {
      style: 'margin: 0 5px;',
      type: 'range',
      min: '16',
      max: '96',
      value: '36'
    }, testId('thumbnail-size'));
    // Save the height on change event (when the user releases the drag button)
    onElem(inputRange, 'change', (ev: any) => { this._height.setAndSave(ev.target.value); });
    return cssRow(
      sizeLabel('Size'),
      inputRange
    );
  }

  protected _buildAttachment(value: number, cellValue: SavingObservable<number[]>): Element {
    const filename: string = this._attachmentsTable.getValue(value, 'fileName') as string;
    const height: number = this._attachmentsTable.getValue(value, 'imageHeight') as number;
    const width: number = this._attachmentsTable.getValue(value, 'imageWidth') as number;
    const hasPreview: boolean = Boolean(height);
    const ratio: number = hasPreview ? (width / height) : .75;

    return attachmentPreview({title: filename}, // Add a filename tooltip to the previews.
      dom.style('height', (use) => `${use(this._height)}px`),
      dom.style('width', (use) => `${parseInt(use(this._height), 10) * ratio}px`),
      // TODO: Update to legitimately determine whether a file preview exists.
      hasPreview ? dom('img', {style: 'height: 100%; min-width: 100%; vertical-align: top;'},
        dom.attr('src', this._getUrl(value))
      ) : noPreviewIcon(),
      dom.cls('no_preview', () => !hasPreview),
      showPreview(
        dom.on('click', () => this._showPreview(value, cellValue)),
        testId(`preview-${value}`)
      ),
      testId(String(value))
    );
  }

  // Returns the attachment download url.
  private _getUrl(rowId: number): string {
    const ident = this._attachmentsTable.getValue(rowId, 'fileIdent') as string;
    if (!ident) {
      return '';
    } else {
      const docComm = this._getDocComm();
      return docComm.docUrl('attachment') + '?' + encodeQueryParams({
        ...docComm.getUrlParams(),
        ident,
        name: this._attachmentsTable.getValue(rowId, 'fileName') as string
      });
    }
  }

  private async _selectAndSave(value: SavingObservable<number[]>): Promise<void> {
    const uploadResult = await selectFiles({docWorkerUrl: this._getDocComm().docWorkerUrl,
                                            multiple: true, sizeLimit: 'attachment'});
    return this._save(value, uploadResult);
  }

  private async _uploadAndSave(value: SavingObservable<number[]>, files: FileList): Promise<void> {
    const uploadResult = await uploadFiles(Array.from(files),
                                           {docWorkerUrl: this._getDocComm().docWorkerUrl,
                                            sizeLimit: 'attachment'});
    return this._save(value, uploadResult);
  }

  private async _save(value: SavingObservable<number[]>, uploadResult: UploadResult|null): Promise<void> {
    if (!uploadResult) { return; }
    const rowIds = await this._getDocComm().addAttachments(uploadResult.uploadId);
    // Values should be saved with a leading "L" to fit Grist's list value encoding.
    const formatted: any[] = value() ? value() : ["L"];
    value.setAndSave(formatted.concat(rowIds));
    // Trigger a row height change in case the added attachment wraps to the next line.
    this.field.viewSection().events.trigger('rowHeightChange');
  }

  // Show a preview for the attachment with the given rowId value in the attachments table.
  private _showPreview(value: number, cellValue: SavingObservable<number[]>): void {
    // Modal should be disposed on close.
    const onClose = (_cellValue: number[]) => {
      cellValue.setAndSave(_cellValue);
      modal.dispose();
    };
    const modal = PreviewModal.create(this, this._getDocData(), cellValue.peek(), testId, value,
      onClose);
  }
}

/**
 * A PreviewsEditor is just the PreviewModal, which allows adding and removing attachments.
 */
export class PreviewsEditor extends NewBaseEditor {
  private _modal: any;

  public attach(cellRect: ClientRect|DOMRect) {
    const docData = this.options.gristDoc.docData;
    // Disposal on close is handled by the FieldBuilder editor logic.
    this._modal = PreviewModal.create(this, docData, this.options.cellValue as number[], testId);
  }

  public getCellValue(): any {
    return this._modal.getCellValue();
  }

  public getCursorPos(): number {
    return 0;
  }

  public getTextValue(): string {
    return '';
  }
}
