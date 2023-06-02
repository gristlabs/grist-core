import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {detachNode} from 'app/client/lib/dom';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {FloatingPopup} from 'app/client/ui/FloatingPopup';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Disposable, dom, Holder, IDisposableOwner, IDomArgs,
        makeTestId, MultiHolder, Observable, styled} from 'grainjs';

export interface IFloatingOwner extends IDisposableOwner {
  detach(): HTMLElement;
  attach(content: HTMLElement): Promise<void>|void;
}

const testId = makeTestId('test-floating-editor-');

export class FloatingEditor extends Disposable {

  public active = Observable.create<boolean>(this, false);

  constructor(private _fieldEditor: IFloatingOwner, private _gristDoc: GristDoc) {
    super();
    this.autoDispose(commands.createGroup({
      detachEditor: this.createPopup.bind(this),
    }, this, true));
  }

  public createPopup() {
    const editor = this._fieldEditor;

    const popupOwner = Holder.create(editor);
    const tempOwner = new MultiHolder();
    try {
      // Create a layer to grab the focus, when we will move the editor to the popup. Otherwise the focus
      // will be moved to the clipboard which can destroy us (as it will be treated as a clickaway). So here
      // we are kind of simulating always focused editor (even if it is not in the dom for a brief moment).
      FocusLayer.create(tempOwner, { defaultFocusElem: document.activeElement as any});

      // Take some data from gristDoc to create a title.
      const cursor = this._gristDoc.cursorPosition.get()!;
      const vs = this._gristDoc.docModel.viewSections.getRowModel(cursor.sectionId!);
      const table = vs.tableId.peek();
      const field = vs.viewFields.peek().at(cursor.fieldIndex!)!;
      const title = `${table}.${field.label.peek()}`;

      let content: HTMLElement;
      // Now create the popup. It will be owned by the editor itself.
      const popup = FloatingPopup.create(popupOwner, {
        content: () => (content = editor.detach()), // this will be called immediately, and will move some dom between
                                                    // existing editor and the popup. We need to save it, so we can
                                                    // detach it on close.
        title: () => title, // We are not reactive yet
        closeButton: true,  // Show the close button with a hover
        closeButtonHover: () => 'Return to cell',
        onClose: async () => {
          const layer = FocusLayer.create(null, { defaultFocusElem: document.activeElement as any});
          try {
            detachNode(content);
            popupOwner.dispose();
            await editor.attach(content);
          } finally {
            layer.dispose();
          }
        },
        args: [testId('popup')]
      });
      // Set a public flag that we are active.
      this.active.set(true);
      popup.onDispose(() => {
        this.active.set(false);
      });

      // Show the popup with the editor.
      popup.showPopup();
    } finally {
      // Dispose the focus layer, we only needed it for the time when the dom was moved between parents.
      tempOwner.dispose();
    }
  }
}

export function createDetachedIcon(...args: IDomArgs<HTMLDivElement>) {
  return cssResizeIconWrapper(
    cssSmallIcon('Maximize'),
    dom.on('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      commands.allCommands.detachEditor.run();
    }),
    dom.on('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }),
    testId('detach-button'),
    ...args
  );
}

const cssSmallIcon = styled(icon, `
  width: 14px;
  height: 14px;
`);

const cssResizeIconWrapper = styled('div', `
  position: absolute;
  right: -2px;
  top: -20px;
  line-height: 0px;
  cursor: pointer;
  z-index: 10;
  --icon-color: ${theme.cellBg};
  background: var(--grist-theme-control-primary-bg, var(--grist-primary-fg));
  height: 20px;
  width: 21px;
  --icon-color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 0px;
  border-top-left-radius: 4px;
  border-top-right-radius: 4px;
  &:hover {
    background: var(--grist-theme-control-primary-hover-bg, var(--grist-primary-fg-hover))
  }
  & > div {
    transition: background .05s ease-in-out;
  }
`);
