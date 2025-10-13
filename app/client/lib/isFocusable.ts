
/**
 * Code authored by Kitty Giraudel for a11y-dialog https://github.com/KittyGiraudel/a11y-dialog, thanks to her!
 *
 * This was split from the trapTabKey file to expose the `isFocusable` function that is useful on its own.
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
 * Determine if an element is focusable and has user-visible painted dimensions.
 */
export const isFocusable = (el: HTMLElement) => {
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
