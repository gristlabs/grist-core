/**
 * This module implements context menu to be shown on contextmenu event (most commonly associated
 * with right+click, but could varies slightly depending on platform, ie: mac support ctrl+click as
 * well).
 *
 * To prevent the default context menu to show everywhere else (including on the top of your custom
 * context menu) dont forget to prevent it by including below line at the root of the dom:
 *   `dom.on('contextmenu', ev => ev.preventDefault())`
 */
import { Disposable, dom, DomArg, DomContents, Holder } from "grainjs";
import { cssMenuElem, registerMenuOpen } from 'app/client/ui2018/menus';
import { IMenuOptions, IOpenController, Menu } from 'popweasel';

export type IContextMenuContentFunc = (ctx: ContextMenuController) => DomContents;

interface ContextMenuControllerOptions {
  triggerElem: Element;
  menuOptions?: IMenuOptions;
}

class ContextMenuController extends Disposable implements IOpenController {
  private _content: HTMLElement;
  private _triggerElem = this._options.triggerElem;

  constructor(
    private _event: MouseEvent,
    contentFunc: IContextMenuContentFunc,
    private _options: ContextMenuControllerOptions
  ) {
    super();

    setTimeout(() => this._updatePosition(), 0);

    // Create content and add to the dom but keep hidden until menu gets positioned
    const menu = Menu.create(null, this, [contentFunc(this)], {
      menuCssClass: cssMenuElem.className + ' grist-floating-menu',
      ...this._options.menuOptions,
    });
    const content = this._content = menu.content;
    content.style.visibility = 'hidden';
    document.body.appendChild(content);

    // Prevents arrow to move the cursor while menu is open.
    dom.onKeyElem(content, 'keydown', {
      ArrowLeft: (ev) => ev.stopPropagation(),
      ArrowRight: (ev) => ev.stopPropagation()
      // UP and DOWN are already handle by the menu to navigate the menu)
    });

    // On click anywhere on the page (outside popup content), close it.
    const onClick = (evt: MouseEvent) => {
      const target: Node|null = evt.target as Node;
      if (target && !content.contains(target)) {
        this.close();
      }
    };
    this.autoDispose(dom.onElem(document, 'contextmenu', onClick, {useCapture: true}));
    this.autoDispose(dom.onElem(document, 'click', onClick, {useCapture: true}));

    // Cleanup involves removing the element.
    this.onDispose(() => {
      dom.domDispose(content);
      content.remove();
    });

    registerMenuOpen(this);
  }

  public close() {
    this.dispose();
  }

  public setOpenClass(elem: Element, cls: string = 'weasel-popup-open') {
    elem.classList.add(cls);
    this.onDispose(() => elem.classList.remove(cls));
  }

  public getTriggerElem() {
    return this._triggerElem;
  }

  public update() {}

  private _updatePosition() {
    const content = this._content;
    const ev = this._event;
    const rect = content.getBoundingClientRect();
    // position menu on the right of the cursor if it can fit, on the left otherwise
    content.style.left = ((ev.pageX + rect.width < window.innerWidth)
      ? ev.pageX
      : Math.max(ev.pageX - rect.width, 0)) + 'px';
    // position menu below the cursor if it can fit, otherwise fit at the bottom of the screen
    content.style.bottom = Math.max(window.innerHeight - (ev.pageY + rect.height), 0) + 'px';
    // show content
    content.style.visibility = '';
  }
}

/**
 * Show a context menu on contextmenu.
 */
export function contextMenu(
  contentFunc: IContextMenuContentFunc,
  options: IMenuOptions = {}
): DomArg {
  return (elem) => {
    const holder = Holder.create(null);
    dom.autoDisposeElem(elem, holder);
    dom.onElem(elem, 'contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ContextMenuController.create(holder, ev, contentFunc, {
        triggerElem: elem as Element,
        menuOptions: options,
      });
    });
  };
}
