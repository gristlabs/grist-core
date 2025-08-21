/**
 * KeyboardFocusHighlighter helps kb users view what interactive elements they have focus on.
 *
 * In an ideal world, this would not exist and our css styling would normally highlight
 * focused elements. But for now, lots of css rules disable focus rings.
 *
 * This is done as a quick way to make sure focus rings are correctly visible when using a kb,
 * without impacting touch/mouse users, and without having to change the whole codebase.
 */
import { components } from "app/common/ThemePrefs";
import { Disposable, dom, styled } from "grainjs";

export class KeyboardFocusHighlighter extends Disposable {
  constructor() {
    super();
    this.autoDispose(dom.onElem(window, 'keydown', this._onKeyDown));
    this.autoDispose(dom.onElem(window, 'touchstart', this._clear));
    this.autoDispose(dom.onElem(window, 'mousedown', this._clear));
  }

  public isKeyboardUser = () => {
    return document.documentElement.classList.contains(cssKeyboardUser.className);
  };

  private _onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Tab') {
      document.documentElement.classList.add(cssKeyboardUser.className);
    }
  };

  private _clear = () => {
    document.documentElement.classList.remove(cssKeyboardUser.className);
  };
}

export const kbFocusHighlighterClass = 'kb-focus-highlighter-group';

const cssKeyboardUser = styled('div', `
  & .${kbFocusHighlighterClass} :is(a, input, textarea, select, button, [tabindex="0"]):focus-visible {
    outline: 3px solid ${components.kbFocusHighlight} !important;
  }
`);
