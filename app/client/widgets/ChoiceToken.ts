import {dom, DomContents, DomElementArg, styled} from "grainjs";
import {colors, vars} from "app/client/ui2018/cssVars";
import {Style} from 'app/client/models/Styles';

export const DEFAULT_FILL_COLOR = colors.mediumGreyOpaque.value;
export const DEFAULT_TEXT_COLOR = '#000000';

export type IChoiceTokenOptions = Style;

/**
 * Creates a colored token representing a choice (e.g. Choice and Choice List values).
 *
 * Tokens are pill-shaped boxes that contain text, with custom fill and text
 * colors. If colors are not specified, a gray fill with black text will be used.
 *
 * Additional styles and other DOM arguments can be passed in to customize the
 * appearance and behavior of the token.
 *
 * @param {DomElementArg} label The text that will appear inside the token.
 * @param {IChoiceTokenOptions} options Options for customizing the token appearance.
 * @param {DOMElementArg[]} args Additional arguments to pass to the token.
 * @returns {DomContents} A colored choice token.
 */
export function choiceToken(
  label: DomElementArg,
  {fillColor, textColor, fontBold, fontItalic, fontUnderline, fontStrikethrough}: IChoiceTokenOptions,
  ...args: DomElementArg[]
): DomContents {
  return cssChoiceToken(
    label,
    dom.style('background-color', fillColor ?? DEFAULT_FILL_COLOR),
    dom.style('color', textColor ?? DEFAULT_TEXT_COLOR),
    dom.cls('font-bold', fontBold ?? false),
    dom.cls('font-underline', fontUnderline ?? false),
    dom.cls('font-italic', fontItalic ?? false),
    dom.cls('font-strikethrough', fontStrikethrough ?? false),
    ...args
  );
}

const cssChoiceToken = styled('div', `
  display: inline-block;
  padding: 1px 4px;
  border-radius: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
`);

const ADD_NEW_HEIGHT = '37px';

export const cssChoiceACItem = styled('li', `
  display: block;
  font-family: ${vars.fontFamily};
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  cursor: pointer;

  &.selected {
    background-color: ${colors.mediumGreyOpaque};
    color: ${colors.dark};
  }
  &-with-new {
    scroll-margin-bottom: ${ADD_NEW_HEIGHT};
  }
  &-new {
    display: flex;
    align-items: center;
    color: ${colors.slate};
    position: sticky;
    bottom: 0px;
    height: ${ADD_NEW_HEIGHT};
    background-color: white;
    border-top: 1px solid ${colors.mediumGreyOpaque};
    scroll-margin-bottom: initial;
  }
  &-new.selected {
    color: ${colors.lightGrey};
  }
`);
