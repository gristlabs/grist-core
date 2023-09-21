// External dependencies
import {computed, Computed, computedArray} from 'grainjs';
import {MutableObsArray, obsArray, ObsArray, observable, Observable} from 'grainjs';
import {dom, LiveIndex, makeLiveIndex, styled} from 'grainjs';

// Grist client libs
import {DocComm} from 'app/client/components/DocComm';
import {selectFiles, uploadFiles} from 'app/client/lib/uploads';
import {DocData} from 'app/client/models/DocData';
import {MetaTableData} from 'app/client/models/TableData';
import {basicButton, basicButtonLink, cssButtonGroup} from 'app/client/ui2018/buttons';
import {testId, theme, vars} from 'app/client/ui2018/cssVars';
import {editableLabel} from 'app/client/ui2018/editableLabel';
import {icon} from 'app/client/ui2018/icons';
import {IModalControl, modal} from 'app/client/ui2018/modals';
import {renderFileType} from 'app/client/widgets/AttachmentsWidget';
import {FieldOptions, NewBaseEditor} from 'app/client/widgets/NewBaseEditor';
import {CellValue} from 'app/common/DocActions';
import {SingleCell} from 'app/common/TableData';
import {clamp, encodeQueryParams} from 'app/common/gutil';
import {UploadResult} from 'app/common/uploads';
import * as mimeTypes from 'mime-types';

interface Attachment {
  rowId: number;

  // Checksum of the file content, with extension, which identifies the file data in the _gristsys_Files table.
  fileIdent: string;

  // MIME type of the data (looked up from fileIdent's extension).
  fileType: string;

  // User-defined filename of the attachment. An observable to support renaming.
  filename: Observable<string>;

  // Whether the attachment is an image, indicated by the presence of imageHeight in the record.
  hasPreview: boolean;

  // The download URL of the attachment; served with Content-Disposition of "attachment".
  url: Observable<string>;

  // The inline URL of the attachment; served with Content-Disposition of "inline".
  inlineUrl: Observable<string>;
}

/**
 * An AttachmentsEditor shows a full-screen modal with attachment previews, and options to rename,
 * download, add or remove attachments in the edited cell.
 */
export class AttachmentsEditor extends NewBaseEditor {
  public static skipEditor(typedVal: CellValue|undefined, origVal: CellValue): CellValue|undefined {
    if (Array.isArray(typedVal)) {
      return typedVal;
    }
  }

  private _attachmentsTable: MetaTableData<'_grist_Attachments'>;
  private _docComm: DocComm;

  private _rowIds: MutableObsArray<number>;
  private _attachments: ObsArray<Attachment>;
  private _index: LiveIndex;
  private _selected: Computed<Attachment|null>;

  constructor(options: FieldOptions) {
    super(options);

    const docData: DocData = options.gristDoc.docData;
    const cellValue: CellValue = options.cellValue;
    const cell: SingleCell = {
      rowId: options.rowId,
      colId: options.field.colId(),
      tableId: options.field.column().table().tableId(),
    };

    // editValue is abused slightly to indicate a 1-based index of the attachment.
    const initRowIndex: number|undefined = (options.editValue && parseInt(options.editValue, 0) - 1) || 0;

    this._attachmentsTable = docData.getMetaTable('_grist_Attachments');
    this._docComm = docData.docComm;

    this._rowIds = obsArray(Array.isArray(cellValue) ? cellValue.slice(1) as number[] : []);
    this._attachments = computedArray(this._rowIds, (val: number): Attachment => {
      const fileIdent: string = this._attachmentsTable.getValue(val, 'fileIdent')!;
      const fileType = mimeTypes.lookup(fileIdent) || 'application/octet-stream';
      const filename: Observable<string> =
        observable(this._attachmentsTable.getValue(val, 'fileName')!);
      return {
        rowId: val,
        fileIdent,
        fileType,
        filename,
        hasPreview: Boolean(this._attachmentsTable.getValue(val, 'imageHeight')),
        url: computed((use) => this._getUrl(cell, val, use(filename))),
        inlineUrl: computed((use) => this._getUrl(cell, val, use(filename), true))
      };
    });
    this._index = makeLiveIndex(this, this._attachments, initRowIndex);
    this._selected = this.autoDispose(computed((use) => {
      const index = use(this._index);
      return index === null ? null : use(this._attachments)[index];
    }));
  }

  // This "attach" is not about "attachments", but about attaching this widget to the page DOM.
  public attach(cellElem: Element) {
    modal((ctl, owner) => {
      // If FieldEditor is disposed externally (e.g. on navigation), be sure to close the modal.
      this.onDispose(ctl.close);
      return [
        cssFullScreenModal.cls(''),
        dom.onKeyDown({
          Enter: (ev) => { ctl.close(); this.options.commands.fieldEditSaveHere(); },
          Escape: (ev) => { ctl.close(); this.options.commands.fieldEditCancel(); },
          ArrowLeft$: (ev) => !isInEditor(ev) && this._moveIndex(-1),
          ArrowRight$: (ev) => !isInEditor(ev) && this._moveIndex(1),
        }),
        // Close if clicking into the background. (The default modal's behavior for this isn't
        // triggered because our content covers the whole screen.)
        dom.on('click', (ev, elem) => { if (ev.target === elem) { ctl.close(); } }),
        ...this._buildDom(ctl)
      ];
    }, {noEscapeKey: true});
  }

  public getCellValue() {
    return ["L", ...this._rowIds.get()] as CellValue;
  }

  public getCursorPos(): number {
    return 0;
  }

  public getTextValue(): string {
    return '';
  }

  // Builds the attachment preview modal.
  private _buildDom(ctl: IModalControl) {
    return [
      cssHeader(
        cssFlexExpand(dom.text(use => {
            const len = use(this._attachments).length;
            return len ? `${(use(this._index) || 0) + 1} of ${len}` : '';
          }),
          testId('pw-counter')
        ),
        dom.maybe(this._selected, selected =>
          cssTitle(
            cssEditableLabel(selected.filename, {
              save: (val) => this._renameAttachment(selected, val),
              inputArgs: [testId('pw-name')],
            }),
          )
        ),
        cssFlexExpand(
          cssFileButtons(
            dom.maybe(this._selected, selected =>
              basicButtonLink(cssButton.cls(''), cssButtonIcon('Download'), 'Download',
                dom.attr('href', selected.url),
                dom.attr('target', '_blank'),
                dom.attr('download', selected.filename),
                testId('pw-download')
              ),
            ),
            this.options.readonly ? null : [
              cssButton(cssButtonIcon('FieldAttachment'), 'Add',
                dom.on('click', () => this._select()),
                testId('pw-add')
              ),
              dom.maybe(this._selected, () =>
                cssButton(cssButtonIcon('Remove'), 'Delete',
                  dom.on('click', () => this._remove()),
                  testId('pw-remove')
                ),
              )
            ]
          ),
          cssCloseButton(cssBigIcon('CrossBig'), dom.on('click', () => ctl.close()),
            testId('pw-close')),
        )
      ),
      cssNextArrow(cssNextArrow.cls('-left'), cssBigIcon('Expand'), testId('pw-left'),
        dom.hide(use => !use(this._attachments).length || use(this._index) === 0),
        dom.on('click', () => this._moveIndex(-1))
      ),
      cssNextArrow(cssNextArrow.cls('-right'), cssBigIcon('Expand'), testId('pw-right'),
        dom.hide(use => !use(this._attachments).length || use(this._index) === use(this._attachments).length - 1),
        dom.on('click', () => this._moveIndex(1))
      ),
      dom.domComputed(this._selected, selected => renderContent(selected, this.options.readonly)),

      // Drag-over logic
      (elem: HTMLElement) => dragOverClass(elem, cssDropping.className),
      cssDragArea(this.options.readonly ? null : cssWarning('Drop files here to attach')),
      this.options.readonly ? null : dom.on('drop', ev => this._upload(ev.dataTransfer!.files)),
      testId('pw-modal')
    ];
  }

  private async _renameAttachment(att: Attachment, fileName: string): Promise<void> {
    await this._attachmentsTable.sendTableAction(['UpdateRecord', att.rowId, {fileName}]);
    // Update the observable, since it's not on its own observing changes.
    att.filename.set(this._attachmentsTable.getValue(att.rowId, 'fileName')!);
  }

  private _getUrl(cell: SingleCell, attId: number, filename: string, inline?: boolean): string {
    return this._docComm.docUrl('attachment') + '?' + encodeQueryParams({
      ...this._docComm.getUrlParams(),
      name: filename,
      ...cell,
      maybeNew: 1,  // The attachment may be uploaded by the user but not stored in the cell yet.
      attId,
      ...(inline ? {inline: 1} : {})
    });
  }

  private _moveIndex(dir: -1|1): void {
    const next = this._index.get()! + dir;
    this._index.set(clamp(next, 0, this._attachments.get().length));
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

function isInEditor(ev: KeyboardEvent): boolean {
  return (ev.target as HTMLElement).tagName === 'INPUT';
}

function renderContent(att: Attachment|null, readonly: boolean): HTMLElement {
  const commonArgs = [cssContent.cls(''), testId('pw-attachment-content')];
  if (!att) {
    return cssWarning('No attachments', readonly ? null : cssDetails('Drop files here to attach.'), ...commonArgs);
  } else if (att.hasPreview) {
    return dom('img', dom.attr('src', att.url), ...commonArgs);
  } else if (att.fileType.startsWith('video/')) {
    return dom('video', dom.attr('src', att.inlineUrl), {autoplay: false, controls: true}, ...commonArgs);
  } else if (att.fileType.startsWith('audio/')) {
    return dom('audio', dom.attr('src', att.inlineUrl), {autoplay: false, controls: true}, ...commonArgs);
  } else if (att.fileType.startsWith('text/') || att.fileType === 'application/json') {
    // Rendering text/html is risky. Things like text/plain and text/csv we could render though,
    // but probably not using object tag (which needs work to look acceptable).
    return dom('div', ...commonArgs,
      cssWarning(cssContent.cls(''), renderFileType(att.filename.get(), att.fileIdent),
        cssDetails('Preview not available.')));
  } else {
    // Setting 'type' attribute is important to avoid a download prompt from Chrome.
    return dom('object', {type: att.fileType}, dom.attr('data', att.inlineUrl), ...commonArgs,
      cssWarning(cssContent.cls(''), renderFileType(att.filename.get(), att.fileIdent),
        cssDetails('Preview not available.'))
    );
  }
}

function dragOverClass(target: HTMLElement, className: string): void {
  let enterTarget: EventTarget|null = null;
  function toggle(ev: DragEvent, onOff: boolean) {
    enterTarget = onOff ? ev.target : null;
    ev.stopPropagation();
    ev.preventDefault();
    target.classList.toggle(className, onOff);
  }
  dom.onElem(target, 'dragenter', (ev) => toggle(ev, true));
  dom.onElem(target, 'dragleave', (ev) => (ev.target === enterTarget) && toggle(ev, false));
  dom.onElem(target, 'drop', (ev) => toggle(ev, false));
}

const cssFullScreenModal = styled('div', `
  background-color: initial;
  width: 100%;
  height: 100%;
  border: none;
  border-radius: 0px;
  box-shadow: none;
  padding: 0px;
`);

const cssHeader = styled('div', `
  padding: 16px 24px;
  position: fixed;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
`);

const cssCloseButton = styled('div', `
  padding: 6px;
  border-radius: 32px;
  cursor: pointer;
  background-color: ${theme.attachmentsEditorButtonBg};
  --icon-color: ${theme.attachmentsEditorButtonFg};

  &:hover {
    background-color: ${theme.attachmentsEditorButtonHoverBg};
    --icon-color: ${theme.attachmentsEditorButtonHoverFg};
  }
`);

const cssBigIcon = styled(icon, `
  padding: 10px;
`);

const cssTitle = styled('div', `
  display: inline-block;
  padding: 8px 16px;
  margin-right: 8px;
  min-width: 0px;
  overflow: hidden;

  &:hover {
    outline: 1px solid ${theme.lightText};
  }
  &:focus-within {
    outline: 1px solid ${theme.controlFg};
  }
`);

const cssEditableLabel = styled(editableLabel, `
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
  color: white;
`);

const cssFlexExpand = styled('div', `
  flex: 1;
  display: flex;
`);

const cssFileButtons = styled(cssButtonGroup, `
  margin-left: auto;
  margin-right: 16px;
  height: 32px;
  flex: none;
`);

const cssButton = styled(basicButton, `
  color: ${theme.attachmentsEditorButtonFg};
  background-color: ${theme.attachmentsEditorButtonBg};
  font-weight: normal;
  padding: 0 16px;
  border-top: none;
  border-right: none;
  border-bottom: none;
  border-left: 1px solid ${theme.attachmentsEditorButtonBorder};
  display: flex;
  align-items: center;

  &:first-child {
    border: none;
  }
  &:hover {
    color: ${theme.attachmentsEditorButtonHoverFg};
    background-color: ${theme.attachmentsEditorButtonHoverBg};
    border-color: ${theme.attachmentsEditorButtonBorder};
  }
`);

const cssButtonIcon = styled(icon, `
  --icon-color: ${theme.attachmentsEditorButtonIcon};
  margin-right: 4px;
`);

const cssNextArrow = styled('div', `
  position: fixed;
  height: 32px;
  margin: auto 24px;
  top: 0px;
  bottom: 0px;
  z-index: 1;

  padding: 6px;
  border-radius: 32px;
  cursor: pointer;
  background-color: ${theme.controlPrimaryBg};
  --icon-color: ${theme.controlPrimaryFg};

  &:hover {
    background-color: ${theme.controlPrimaryHoverBg};
  }
  &-left {
    transform: rotateY(180deg);
    left: 0px;
  }
  &-right {
    right: 0px;
  }
`);

const cssDropping = styled('div', '');

const cssContent = styled('div', `
  display: block;
  height: calc(100% - 72px);
  width: calc(100% - 64px);
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  margin-top: 64px;
  margin-bottom: 8px;
  outline: none;
  img& {
    width: max-content;
    height: unset;
  }
  audio& {
    padding-bottom: 64px;
  }
  .${cssDropping.className} > & {
    display: none;
  }
`);

const cssWarning = styled('div', `
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  font-size: ${vars.mediumFontSize};
  font-weight: bold;
  color: white;
  padding: 0px;
`);

const cssDetails = styled('div', `
  font-weight: normal;
  margin-top: 24px;
`);

const cssDragArea = styled(cssContent, `
  border: 2px dashed ${theme.attachmentsEditorBorder};
  height: calc(100% - 96px);
  margin-top: 64px;
  padding: 0px;
  justify-content: center;
  display: none;
  .${cssDropping.className} > & {
    display: flex;
  }
`);
