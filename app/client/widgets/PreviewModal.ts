// External dependencies
import {computed, Computed, computedArray, Disposable} from 'grainjs';
import {MutableObsArray, obsArray, ObsArray, observable, Observable} from 'grainjs';
import {dom, input, LiveIndex, makeLiveIndex, noTestId, styled, TestId} from 'grainjs';
import noop = require('lodash/noop');

// Grist client libs
import {DocComm} from 'app/client/components/DocComm';
import {dragOverClass} from 'app/client/lib/dom';
import {selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {DocData} from 'app/client/models/DocData';
import {TableData} from 'app/client/models/TableData';
import {button1Small, button1SmallBright} from 'app/client/ui/buttons';
import {cssModalBody, cssModalTitle, IModalControl, modal} from 'app/client/ui2018/modals';
import {encodeQueryParams, mod} from 'app/common/gutil';
import {UploadResult} from 'app/common/uploads';


const modalPreview = styled('div', `
  position: relative;
  max-width: 80%;
  margin: 0 auto;
  background-color: white;
  border: 1px solid #bbb;
`);

const modalPreviewImage = styled('img', `
  display: block;
  max-width: 100%;
  max-height: 400px;
`);

const noPreview = styled('div', `
  margin: 40% 0;
  text-align: center;
  vertical-align: top;
  color: #bbb;
`);

const thumbnail = styled('div', `
  position: relative;
  height: 100%;
  margin: 0 5px;
  cursor: pointer;
`);

const thumbnailOuterRow = styled('div', `
  display: flex;
  position: relative;
  height: 60px;
  margin: 0 10px;
  justify-content: center;
`);

const thumbnailInnerRow = styled('div', `
  display: inline-flex;
  height: 100%;
  padding: 10px 0;
  overflow-x: auto;
`);

const addButton = styled('div.glyphicon.glyphicon-paperclip', `
  position: relative;
  flex: 0 0 40px;
  height: 40px;
  width: 40px;
  margin: 9px 10px;
  padding: 12px 6px;
  text-align: center;
  vertical-align: middle;
  border: 1px dashed #bbbbbb;
  cursor: pointer;
  font-size: 12pt;
`);

const addButtonPlus = styled('div.glyphicon.glyphicon-plus', `
  position: absolute;
  left: 9px;
  top: 9px;
  font-size: 5pt;
`);

const selectedOverlay = styled('div', `
  position: absolute;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: #3390bf80;
`);

const noAttachments = styled('div', `
  width: 100%;
  height: 300px;
  padding: 125px 0;
  text-align: center;
  border: 2px dashed #bbbbbb;
  font-size: 12pt;
  cursor: pointer;
`);

const menuBtnStyle = `
  float: right;
  margin: 0 5px;
  cursor: pointer;
  color: black;
  text-decoration: none;
`;

const navArrowStyle = `
  width: 10%;
  height: 60px;
  padding: 20px 0;
  text-align: center;
  cursor: pointer;
  font-size: 14pt;
`;

interface Attachment {
  rowId: number;
  fileIdent: string;
  filename: Observable<string>;
  hasPreview: boolean;
  url: Observable<string>;
}

// Used as a placeholder for the currently selected attachment if all attachments are removed.
const nullAttachment: Attachment = {
  rowId: 0,
  fileIdent: '',
  filename: observable(''),
  hasPreview: false,
  url: observable('')
};


/**
 * PreviewModal - Modal showing an attachment and options to rename, download or remove the
 * attachment from the cell.
 */
export class PreviewModal extends Disposable {
  private _attachmentsTable: TableData;
  private _docComm: DocComm;

  private _isEditingName: Observable<boolean> = observable(false);
  private _newName: Observable<string> = observable('');
  private _isRenameValid: Computed<boolean>;

  private _rowIds: MutableObsArray<number>;
  private _attachments: ObsArray<Attachment>;
  private _index: LiveIndex;
  private _selected: Computed<Attachment>;

  constructor(
    docData: DocData,
    cellValue: number[],
    testId: TestId = noTestId,
    initRowId?: number,
    onClose: (cellValue: any) => void = noop,
  ) {
    super();
    this._attachmentsTable = docData.getTable('_grist_Attachments')!;
    this._docComm = docData.docComm;

    this._rowIds = obsArray(Array.isArray(cellValue) ? cellValue.slice(1) : []);
    this._attachments = computedArray(this._rowIds, (val: number): Attachment => {
      const fileIdent: string = this._attachmentsTable.getValue(val, 'fileIdent') as string;
      const filename: Observable<string> =
        observable(this._attachmentsTable.getValue(val, 'fileName') as string);
      return {
        rowId: val,
        fileIdent,
        filename,
        hasPreview: Boolean(this._attachmentsTable.getValue(val, 'imageHeight')),
        url: computed((use) => this._getUrl(fileIdent, use(filename)))
      };
    });
    this._index = makeLiveIndex(this, this._attachments,
      initRowId ? this._rowIds.get().indexOf(initRowId) : 0);
    this._selected = this.autoDispose(computed((use) => {
      const index = use(this._index);
      return index === null ? nullAttachment : use(this._attachments)[index];
    }));

    this._isRenameValid = this.autoDispose(computed((use) =>
      Boolean(use(this._newName) && (use(this._newName) !== use(use(this._selected).filename)))
    ));

    modal((ctl, owner) => {
      owner.onDispose(() => { onClose(this.getCellValue()); });
      return [
        dom.style('padding', '16px'),   // To match the previous style more closely.
        cssModalTitle(
          dom('span',
            dom.text((use) => use(use(this._selected).filename) || 'No attachments'),
            testId('modal-title'),
          ),
          // This is a bootstrap-styled button, for now only to match previous style more closely.
          dom('button', dom.cls('close'), '×', testId('modal-close-x'),
            dom.on('click', () => ctl.close()),
          )
        ),
        cssModalBody(this._buildDom(testId, ctl)),
      ];
    });

    this.autoDispose(this._selected.addListener(att => { this._scrollToThumbnail(att.rowId); }));

    // Initialize with the selected attachment's thumbnail in view.
    if (initRowId) {
      this._scrollToThumbnail(initRowId);
    }
  }

  public getCellValue() {
    const rowIds = this._rowIds.get() as any[];
    return rowIds.length > 0 ? ["L"].concat(this._rowIds.get() as any[]) : '';
  }

  // Builds the attachment preview modal.
  private _buildDom(testId: TestId, ctl: IModalControl): Element {
    return dom('div',
      // Prevent focus from switching away from the modal on mousedown.
      dom.on('mousedown', (e) => e.preventDefault()),
      dom.domComputed((use) =>
        use(this._rowIds).length > 0 ? this._buildPreviewNav(testId, ctl) : this._buildEmptyMenu(testId)),
      // Drag-over logic
      dragOverClass('attachment_drag_over'),
      dom.on('drop', ev => this._upload(ev.dataTransfer!.files)),
      testId('modal')
    );
  }

  private _buildPreviewNav(testId: TestId, ctl: IModalControl) {
    const modalPrev = (selected: Attachment) => modalPreviewImage(
      dom.attr('src', (use) => use(selected.url)),
      testId('image')
    );
    const noPrev = noPreview({style: 'padding: 60px;'},
      dom('div.glyphicon.glyphicon-file'),
      dom('div', 'Preview not available')
    );
    return [
      // Preview and left/right nav arrows
      dom('div', {style: 'display: flex; align-items: center; height: 400px;'},
        dom('div.glyphicon.glyphicon-chevron-left', {style: navArrowStyle},
          dom.on('click', () => this._moveIndex(-1)),
          testId('left')
        ),
        modalPreview(
          dom.maybe(this._selected, (selected) =>
            dom.domComputed((use) => selected.hasPreview ? modalPrev(selected) : noPrev)
          ),
          dom.attr('title', (use) => use(use(this._selected).filename)),
        ),
        dom('div.glyphicon.glyphicon-chevron-right', {style: navArrowStyle},
          dom.on('click', () => this._moveIndex(1)),
          testId('right')
        )
      ),
      // Nav thumbnails
      thumbnailOuterRow(
        thumbnailInnerRow(
          dom.forEach(this._attachments, (a: Attachment) => this._buildThumbnail(a)),
          testId('thumbnails')
        ),
        addButton(
          addButtonPlus(),
          dom.on('click', () => { this._select(); }), // tslint:disable-line:no-floating-promises TODO
          testId('add')
        )
      ),
      // Menu buttons
      dom('div', {style: 'height: 10px; margin: 10px;'},
        dom('div.glyphicon.glyphicon-trash', {style: menuBtnStyle},
          dom.on('click', () => this._remove()),
          testId('remove')
        ),
        dom('a.glyphicon.glyphicon-download-alt', {style: menuBtnStyle},
          dom.attr('href', (use) => use(use(this._selected).url)),
          dom.attr('target', '_blank'),
          dom.attr('download', (use) => use(use(this._selected).filename)),
          testId('download')
        ),
        dom('div.glyphicon.glyphicon-pencil', {style: menuBtnStyle},
          dom.on('click', () => this._isEditingName.set(!this._isEditingName.get())),
          testId('rename')
        )
      ),
      // Rename menu
      dom.maybe(this._isEditingName, () => {
        this._newName.set(this._selected.get().filename.get());
        return dom('div', {style: 'display: flex; margin: 20px 0 0 0;'},
          input(this._newName, {onInput: true},
            {style: 'flex: 4 1 0; margin: 0 5px;', placeholder: 'Rename file...'},
            // Allow the input element to gain focus.
            dom.on('mousedown', (e) => e.stopPropagation()),
            dom.onKeyPress({Enter: () => this._renameFile()}),
            // Prevent the dialog from losing focus and disposing on input completion.
            dom.on('blur', (ev) => ctl.focus()),
            dom.onDispose(() => ctl.focus()),
            testId('rename-input')
          ),
          button1Small('Cancel', {style: 'flex: 1 1 0; margin: 0 5px;'},
            dom.on('click', () => this._isEditingName.set(false)),
            testId('rename-cancel')
          ),
          button1SmallBright('Save', {style: 'flex: 1 1 0; margin: 0 5px;'},
            dom.on('click', () => this._renameFile()),
            dom.boolAttr('disabled', (use) => !use(this._isRenameValid)),
            testId('rename-save')
          )
        );
      })
    ];
  }

  private _buildEmptyMenu(testId: TestId): Element {
    return noAttachments('Click or drag to add attachments',
      addButton({style: 'border: none; margin: 2px;'},
        addButtonPlus(),
      ),
      dom.on('click', () => { this._select(); }), // tslint:disable-line:no-floating-promises TODO
      testId('empty-add')
    );
  }

  private _buildThumbnail(att: Attachment): Element {
    const isSelected: Computed<boolean> = computed((use) =>
      att.rowId === use(this._selected).rowId);
    return thumbnail({id: `thumbnail-${att.rowId}`, style: att.hasPreview ? '' : 'width: 30px;'},
      dom.autoDispose(isSelected),
      // TODO: Update to legitimately determine whether a file preview exists.
      att.hasPreview ? dom('img', {style: 'height: 100%; vertical-align: top;'},
        dom.attr('src', (use) => this._getUrl(att.fileIdent, use(att.filename)))
      ) : noPreview({style: 'width: 30px;'},
        dom('div.glyphicon.glyphicon-file')
      ),
      dom.maybe(isSelected, () => selectedOverlay()),
      // Add a filename tooltip to the thumbnails.
      dom.attr('title', (use) => use(att.filename)),
      dom.style('border', (use) => use(isSelected) ? '1px solid #317193' : '1px solid #bbb'),
      dom.on('click', () => {
        this._index.set(this._attachments.get().findIndex(a => a.rowId === att.rowId));
      })
    );
  }

  private _getUrl(fileIdent: string, filename: string): string {
    return this._docComm.docUrl('attachment') + '?' + encodeQueryParams({
      ...this._docComm.getUrlParams(),
      ident: fileIdent,
      name: filename
    });
  }

  private _renameFile(): void {
    const val = this._newName.get();
    if (this._isRenameValid.get()) {
      this._selected.get().filename.set(val);
      const rowId = this._selected.get().rowId;
      this._attachmentsTable.sendTableAction(['UpdateRecord', rowId, {fileName: val}]);
      this._isEditingName.set(false);
    }
  }

  private _moveIndex(dir: -1|1): void {
    const len = this._attachments.get().length;
    this._index.set(mod(this._index.get()! + dir, len));
  }

  private _scrollToThumbnail(rowId: number): void {
    const tn = document.getElementById(`thumbnail-${rowId}`);
    if (tn) {
      tn.scrollIntoView();
    }
  }

  // Removes the attachment being previewed from the cell (but not the document).
  private _remove(): void {
    this._rowIds.splice(this._index.get()!, 1);
  }

  private async _select(): Promise<void> {
    const uploadResult = await selectFiles({docWorkerUrl: this._docComm.docWorkerUrl,
                                            multiple: true, sizeLimit: 'attachment'});
    return this._add(uploadResult);
  }

  private async _upload(files: FileList): Promise<void> {
    const uploadResult = await uploadFiles(Array.from(files),
                                           {docWorkerUrl: this._docComm.docWorkerUrl,
                                            sizeLimit: 'attachment'});
    return this._add(uploadResult);
  }

  private async _add(uploadResult: UploadResult|null): Promise<void> {
    if (!uploadResult) { return; }
    const rowIds = await this._docComm.addAttachments(uploadResult.uploadId);
    const len = this._rowIds.get().length;
    if (rowIds.length > 0) {
      this._rowIds.push(...rowIds);
      this._index.set(len);
    }
  }
}
