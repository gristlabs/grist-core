import {Style} from 'app/client/models/Styles';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {dom, DomContents, DomElementArg, styled} from 'grainjs';
import {colord, extend} from 'colord';
import a11yPlugin from 'colord/plugins/a11y';

extend([a11yPlugin]);

export const DEFAULT_BACKGROUND_COLOR = theme.choiceTokenBg.toString();
export const DEFAULT_COLOR = theme.choiceTokenFg.toString();

export interface IChoiceTokenOptions extends Style {
  invalid?: boolean;
  blank?: boolean;
}


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
  options: IChoiceTokenOptions,
  ...args: DomElementArg[]
): DomContents {
  const {fillColor, textColor, fontBold, fontItalic, fontUnderline,
         fontStrikethrough, invalid, blank} = options;
  const {bg, fg} = getReadableColorsCombo({fillColor, textColor});
  return cssChoiceToken(
    label,
    dom.style('background-color', bg),
    dom.style('color', fg),
    dom.cls('font-bold', fontBold ?? false),
    dom.cls('font-underline', fontUnderline ?? false),
    dom.cls('font-italic', fontItalic ?? false),
    dom.cls('font-strikethrough', fontStrikethrough ?? false),
    invalid ? cssChoiceToken.cls('-invalid') : null,
    blank ? cssChoiceToken.cls('-blank') : null,
    ...args
  );
}

export const cssChoiceToken = styled('div', `
  display: inline-block;
  padding: 1px 4px;
  border-radius: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;

  &-invalid {
    color: ${theme.choiceTokenInvalidFg} !important;
    background-color: ${theme.choiceTokenInvalidBg} !important;
    box-shadow: inset 0 0 0 1px ${theme.choiceTokenInvalidBorder};
  }
  &-blank {
    color: ${theme.lightText} !important;
  }
`);

const contrastCalculationsCache: Record<string, string> = {};

function findMatchingShade(color: string, lightShade: string, darkShade: string) {
  const c = colord(color);
  const cache = contrastCalculationsCache;
  const cacheKey = `${color}-${lightShade}-${darkShade}`;
  if (cache[cacheKey] !== undefined) {
    return cache[cacheKey];
  }
  const withLightShade = c.contrast(lightShade);
  const withDarkShade = c.contrast(darkShade);
  const matchingShade = (withLightShade >= 4.5 || withLightShade > withDarkShade)
    ? lightShade
    : darkShade;
  cache[cacheKey] = matchingShade;
  return matchingShade;
}

export function getReadableColorsCombo(
  token: IChoiceTokenOptions,
  defaultColors: {bg: string, fg: string} = {bg: DEFAULT_BACKGROUND_COLOR, fg: DEFAULT_COLOR}
) {
  const {fillColor, textColor} = token;
  const hasCustomBg = fillColor !== undefined;
  const hasCustomText = textColor !== undefined;
  let bg = defaultColors.bg;
  let fg = defaultColors.fg;
  if (hasCustomBg && hasCustomText) {
    bg = fillColor;
    fg = textColor;
  } else if (hasCustomText) {
    bg = findMatchingShade(textColor, '#E8E8E8', '#70707d');
    fg = textColor;
  } else if (hasCustomBg) {
    bg = fillColor;
    fg = findMatchingShade(fillColor, '#ffffff', '#000000');
  }
  return {bg, fg};
}

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
    background-color: ${theme.autocompleteItemSelectedBg};
  }
  &-with-new {
    scroll-margin-bottom: ${ADD_NEW_HEIGHT};
  }
  &-new {
    display: flex;
    align-items: center;
    position: sticky;
    bottom: 0px;
    height: ${ADD_NEW_HEIGHT};
    background-color: ${theme.menuBg};
    border-top: 1px solid ${theme.menuBorder};
    scroll-margin-bottom: initial;
  }
`);
