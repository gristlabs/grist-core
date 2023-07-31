import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {detachNode} from 'app/client/lib/dom';
import {FocusLayer} from 'app/client/lib/FocusLayer';
import {makeT} from 'app/client/lib/localization';
import {FLOATING_POPUP_MAX_WIDTH_PX, FloatingPopup} from 'app/client/ui/FloatingPopup';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Disposable, dom, Holder, IDisposableOwner, IDomArgs,
        makeTestId, MultiHolder, Observable, styled} from 'grainjs';

const t = makeT('FloatingEditor');

const testId = makeTestId('test-floating-editor-');

export interface IFloatingOwner extends IDisposableOwner {
  detach(): HTMLElement;
  attach(content: HTMLElement): Promise<void>|void;
}

export interface FloatingEditorOptions {
  gristDoc: GristDoc;
  /**
   * The element that `placement` should be relative to.
   */
  refElem?: Element;
  /**
   * How to position the editor.
   *
   * If "overlapping", the editor will be positioned on top of `refElem`, anchored
   * to its top-left corner.
   *
   * If "adjacent", the editor will be positioned to the left or right of `refElem`,
   * depending on available space.
   *
   * If "fixed", the editor will be positioned in the bottom-right corner of the
   * viewport.
   *
   * Defaults to "fixed".
   */
  placement?: 'overlapping' | 'adjacent' | 'fixed';
}

export class FloatingEditor extends Disposable {

  public active = Observable.create<boolean>(this, false);

  private _gristDoc = this._options.gristDoc;
  private _placement = this._options.placement ?? 'fixed';
  private _refElem = this._options.refElem;

  constructor(
    private _fieldEditor: IFloatingOwner,
    private _options: FloatingEditorOptions
  ) {
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
        closeButtonIcon: 'Minimize',
        closeButtonHover: () => t('Collapse Editor'),
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
        minHeight: 550,
        initialPosition: this._getInitialPosition(),
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

  private _getInitialPosition(): [number, number] | undefined {
    if (!this._refElem || this._placement === 'fixed') {
      return undefined;
    }

    const refElem = this._refElem as HTMLElement;
    const refElemBoundingRect = refElem.getBoundingClientRect();
    if (this._placement === 'overlapping') {
      // Anchor the floating editor to the top-left corner of the refElement.
      return [
        refElemBoundingRect.left,
        refElemBoundingRect.top,
      ];
    } else {
      if (window.innerWidth - refElemBoundingRect.right >= FLOATING_POPUP_MAX_WIDTH_PX) {
        // If there's enough space to the right of refElement, position the
        // floating editor there.
        return [
          refElemBoundingRect.right,
          refElemBoundingRect.top,
        ];
      } else {
        // Otherwise position it to the left of refElement; note that it may still
        // overlap if there isn't enough space on this side either.
        return [
          refElemBoundingRect.left - FLOATING_POPUP_MAX_WIDTH_PX,
          refElemBoundingRect.top,
        ];
      }
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
