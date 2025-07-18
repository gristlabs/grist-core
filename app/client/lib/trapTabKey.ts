/**
 * Code is authored by Kitty Giraudel for a11y-dialog https://github.com/KittyGiraudel/a11y-dialog, thanks to her!
 *
 * As keyboard-handling is very specific in Grist, we'd rather copy/paste some base code that can be easily modified,
 * rather than relying on a library.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2025 Kitty Giraudel
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
 * TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
 * CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/**
 * Trap the tab key within the given element.
 *
 * This only wraps focus when we detect the user tabs out of bounds (tab on the last focusable element,
 * or shift+tab on the first focusable element). It doesn't force focus any other way, so it doesn't
 * interfere with potential popups appearing or anything else.
 */
export function trapTabKey(container: HTMLElement, tabEvent: KeyboardEvent) {
  const [firstFocusableEl, lastFocusableEl] = getFocusableEdges(container);

  const activeEl = getActiveEl();

  // If the SHIFT key is pressed while tabbing (moving backwards) and the
  // currently focused item is the first one, move the focus to the last
  // focusable item from the element
  if (tabEvent.shiftKey && activeEl === firstFocusableEl) {
    lastFocusableEl?.focus();
    tabEvent.preventDefault();
  }

  // If the SHIFT key is not pressed (moving forwards) and the currently focused
  // item is the last one, move the focus to the first focusable item from the element
  else if (!tabEvent.shiftKey && activeEl === lastFocusableEl) {
    firstFocusableEl?.focus();
    tabEvent.preventDefault();
  }
}

function getFocusableEdges(el: HTMLElement) {
  // Check for a focusable element within the subtree of the given element.
  const firstEl = findFocusableEl(el, true);

  // Only if we find the first element do we need to look for the last one. If
  // there’s no last element, we set `lastEl` as a reference to `firstEl` so
  // that the returned array is still always of length 2.
  const lastEl = firstEl ? findFocusableEl(el, false) || firstEl : null;

  return [firstEl, lastEl] as const;
}

function findFocusableEl(
  el: HTMLElement,
  forward: boolean
): HTMLElement | null {
  // If we’re walking forward, check if this element is focusable, and return it
  // immediately if it is.
  if (forward && isFocusable(el)) { return el; }

  // We should only search the subtree of this element if it can have focusable
  // children.
  if (canHaveFocusableChildren(el)) {
    // Start walking the DOM tree, looking for focusable elements.
    // Case 1: If this element has a shadow root, search it recursively.
    if (el.shadowRoot) {
      // Descend into this subtree.
      let next = getNextChildEl(el.shadowRoot, forward);

      // Traverse the siblings, searching the subtree of each one for focusable
      // elements.
      while (next) {
        const focusableEl = findFocusableEl(next as HTMLElement, forward);
        if (focusableEl) { return focusableEl; }
        next = getNextSiblingEl(next as HTMLElement, forward);
      }
    }

    // Case 2: If this element is a slot for a Custom Element, search its
    // assigned elements recursively.
    else if (el.localName === 'slot') {
      const assignedElements = (el as HTMLSlotElement).assignedElements({
        flatten: true,
      }) as HTMLElement[];
      if (!forward) { assignedElements.reverse(); }

      for (const assignedElement of assignedElements) {
        const focusableEl = findFocusableEl(assignedElement, forward);
        if (focusableEl) { return focusableEl; }
      }
    }
    // Case 3: this is a regular Light DOM element. Search its subtree.
    else {
      // Descend into this subtree.
      let next = getNextChildEl(el, forward);

      // Traverse siblings, searching the subtree of each one
      // for focusable elements.
      while (next) {
        const focusableEl = findFocusableEl(next as HTMLElement, forward);
        if (focusableEl) { return focusableEl; }
        next = getNextSiblingEl(next as HTMLElement, forward);
      }
    }
  }

  // If we’re walking backward, we want to check the element’s entire subtree
  // before checking the element itself. If this element is focusable, return
  // it.
  if (!forward && isFocusable(el)) { return el; }

  return null;
}

/**
 * Get the active element, accounting for Shadow DOM subtrees.
 * @author Cory LaViska
 * @see: https://www.abeautifulsite.net/posts/finding-the-active-element-in-a-shadow-root/
 */
export function getActiveEl(
  root: Document | ShadowRoot = document
): Element | null {
  const activeEl = root.activeElement;

  if (!activeEl) { return null; }

  // If there’s a shadow root, recursively find the active element within it.
  // If the recursive call returns null, return the active element
  // of the top-level Document.
  if (activeEl.shadowRoot)
    { return getActiveEl(activeEl.shadowRoot) || document.activeElement; }

  // If not, we can just return the active element
  return activeEl;
}

/**
 * Determine if an element can have focusable children. Useful for bailing out
 * early when walking the DOM tree.
 * @example
 * This div is inert, so none of its children can be focused, even though they
 * meet our criteria for what is focusable. Once we check the div, we can skip
 * the rest of the subtree.
 * ```html
 * <div inert>
 *   <button>Button</button>
 *   <a href="#">Link</a>
 * </div>
 * ```
 */
function canHaveFocusableChildren(el: HTMLElement) {
  // The browser will never send focus into a Shadow DOM if the host element
  // has a negative tabindex. This applies to both slotted Light DOM Shadow DOM
  // children
  if (el.shadowRoot && el.getAttribute('tabindex') === '-1') { return false; }

  // Elemments matching this selector are either hidden entirely from the user,
  // or are visible but unavailable for interaction. Their descentants can never
  // receive focus.
  return !el.matches(':disabled,[hidden],[inert]');
}


function getNextChildEl(el: ParentNode, forward: boolean) {
  return forward ? el.firstElementChild : el.lastElementChild;
}

function getNextSiblingEl(el: HTMLElement, forward: boolean) {
  return forward ? el.nextElementSibling : el.previousElementSibling;
}

/**
 * Determine if an element is hidden from the user.
 */
const isHidden = (el: HTMLElement) => {
  // Browsers hide all non-<summary> descendants of closed <details> elements
  // from user interaction, but those non-<summary> elements may still match our
  // focusable-selectors and may still have dimensions, so we need a special
  // case to ignore them.
  if (
    el.matches('details:not([open]) *') &&
    !el.matches('details>summary:first-of-type')
  )
    { return true; }

  // If this element has no painted dimensions, it's hidden.
  return !(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
};

/**
 * Determine if an element is focusable and has user-visible painted dimensions.
 */
const isFocusable = (el: HTMLElement) => {
  // A shadow host that delegates focus will never directly receive focus,
  // even with `tabindex=0`. Consider our <fancy-button> custom element, which
  // delegates focus to its shadow button:
  //
  // <fancy-button tabindex="0">
  //  #shadow-root
  //  <button><slot></slot></button>
  // </fancy-button>
  //
  // The browser acts as as if there is only one focusable element – the shadow
  // button. Our library should behave the same way.
  if (el.shadowRoot?.delegatesFocus) { return false; }

  return el.matches(focusableSelectorsString) && !isHidden(el);
};

const notInert = ':not([inert]):not([inert] *)';
const notNegTabIndex = ':not([tabindex^="-"])';
const notDisabled = ':not(:disabled)';

const focusableSelectors = [
  `a[href]${notInert}${notNegTabIndex}`,
  `area[href]${notInert}${notNegTabIndex}`,
  `input:not([type="hidden"]):not([type="radio"])${notInert}${notNegTabIndex}${notDisabled}`,
  `input[type="radio"]${notInert}${notNegTabIndex}${notDisabled}`,
  `select${notInert}${notNegTabIndex}${notDisabled}`,
  `textarea${notInert}${notNegTabIndex}${notDisabled}`,
  `button${notInert}${notNegTabIndex}${notDisabled}`,
  `details${notInert} > summary:first-of-type${notNegTabIndex}`,
  // Discard until Firefox supports `:has()`
  // See: https://github.com/KittyGiraudel/focusable-selectors/issues/12
  // `details:not(:has(> summary))${notInert}${notNegTabIndex}`,
  `iframe${notInert}${notNegTabIndex}`,
  `audio[controls]${notInert}${notNegTabIndex}`,
  `video[controls]${notInert}${notNegTabIndex}`,
  `[contenteditable]${notInert}${notNegTabIndex}`,
  `[tabindex]${notInert}${notNegTabIndex}`,
];

const focusableSelectorsString = focusableSelectors.join(',');
