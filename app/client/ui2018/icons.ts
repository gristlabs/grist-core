/**
 * Exports a single `icon` function which returns a DOM Element for the given icon name.
 * Names are of type `IconName` imported from `IconList.ts`, which is auto-generated during the
 * build process.
 *
 * In order to use the icons, you must first include the generated CSS file:
 *
 *   <link rel="stylesheet" href="icons.css">
 *
 * The CSS file encodes each icon as a `url()` with base64 DataURI of the icon SVG and saves it
 * as a CSS :root var of the form --icon-${name}. It also includes a class for each icon that
 * uses the variable to set the mask-image (vs background-image, allowing you to change colors
 * using background-color):
 *
 *   .icon.Search_icon { -webkit-mask-image: var(--icon-Search); }
 *
 * This approach is more performant than inlining SVGs or using <symbol> with <use>.
 *
 * Examples:
 *
 *   // Display icon with default color and size
 *   dom('div',
 *     icon('Search')
 *   );
 *
 *   // Display bigger icon in blue
 *   const bigBlueIcon = styled(icon, `
 *     background-color: blue;
 *     width: 32px;
 *     height: 32px;
 *   `);
 *   dom('div',
 *     bigBlueIcon('Search')
 *   )
 *
 *   // Use icon image directly in css to style a checkbox
 *   // Refer to https://developer.mozilla.org/en-US/docs/Learn/HTML/Forms/Advanced_styling_for_HTML_forms
 *   const checkbox = styled('input#checkbox', `
 *     -webkit-appearance: none;
 *     -moz-appearance: none;
 *      width: 1rem;
 *      height: 1rem;
 *      border: 1px solid blue;
 *
 *      &:checked::before {
 *        position: absolute;
 *        content: var(--icon-Select);
 *      }
 *   `);
 */

import { theme } from 'app/client/ui2018/cssVars';
import { dom, DomElementArg, styled } from 'grainjs';
import { IconName } from './IconList';

/**
 * Defaults for all icons.
 */
const iconDiv = styled('div', `
  position: relative;
  display: inline-block;
  vertical-align: middle;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
  width: 16px;
  height: 16px;
  background-color: var(--icon-color, var(--grist-theme-text, black));
`);

export const cssIconBackground = styled(iconDiv, `
  background-color: var(--icon-background, inherit);
  -webkit-mask: none;
  & .${iconDiv.className} {
    transition: inherit;
    display: block;
  }
`);

export function icon(name: IconName, ...domArgs: DomElementArg[]): HTMLElement {
  return iconDiv(
    dom.style('-webkit-mask-image', `var(--icon-${name})`),
    ...domArgs
  );
}

/**
 * Container box for an icon to serve as a button..
 */
export const cssIconButton = styled('div', `
  flex: none;
  height: 24px;
  width: 24px;
  padding: 4px;
  border-radius: 3px;
  line-height: 0px;
  cursor: default;
  --icon-color: ${theme.controlSecondaryFg};
  &:hover, &.weasel-popup-open {
    background-color: ${theme.controlSecondaryHoverBg};
    --icon-color: ${theme.controlSecondaryFg};
  }
`);
