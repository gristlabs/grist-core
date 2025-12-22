import { Style } from 'app/client/models/Styles';
import { theme, vars } from 'app/client/ui2018/cssVars';
import { dom, DomContents, DomElementArg, styled } from 'grainjs';
import { colord, extend } from 'colord';
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
  return cssChoiceToken(choiceTokenDomArgs(label, options), ...args);
}

/**
 * Exposes the choiceToken dom args outside of cssChoiceToken to allow
 * easy usage of them with TokenField#renderToken, that has its own wrapper dom el.
 */
export function choiceTokenDomArgs(
  label: DomElementArg,
  options: IChoiceTokenOptions,
): DomElementArg {
  const { fillColor, textColor, fontBold, fontItalic, fontUnderline,
    fontStrikethrough, invalid, blank } = options;
  const { bg, fg } = getReadableColorsCombo({ fillColor, textColor });
  return [
    label,
    dom.style('background-color', bg),
    dom.style('color', fg),
    dom.cls('font-bold', fontBold ?? false),
    dom.cls('font-underline', fontUnderline ?? false),
    dom.cls('font-italic', fontItalic ?? false),
    dom.cls('font-strikethrough', fontStrikethrough ?? false),
    invalid ? cssChoiceToken.cls('-invalid') : null,
    blank ? cssChoiceToken.cls('-blank') : null,
  ];
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

// shades to pick from for automatic text color, ordered from lightest to darkest
const grayShades = [
  '#e8e8e8',
  '#bfbfbf',
  '#959595',
  '#70707d',
  '#44444c',
  '#242428',
  '#000000',
];

function findBestShade(color: string, shades: string[]) {
  const cache = contrastCalculationsCache;
  if (cache[color] !== undefined) {
    return cache[color];
  }
  const c = colord(color);
  // Find the best text gray shade for the given bg color.
  // Logic is: we take the highest contrast ratio we can get, but stop searching
  // when we find a contrast ratio > 7 (WCAG AAA level).
  const matchingShade = shades.reduce((prev, current) => {
    if (prev.foundBest) {
      return prev;
    }
    const currentContrast = c.contrast(current);
    if (currentContrast > 7 || currentContrast > prev.contrast) {
      return { shade: current, contrast: currentContrast, foundBest: currentContrast > 7 };
    }
    return prev;
  }, {
    shade: shades[0],
    contrast: c.contrast(shades[0]),
    foundBest: false,
  });
  cache[color] = matchingShade.shade;
  return cache[color];
}

export function getReadableColorsCombo(
  token: IChoiceTokenOptions,
  defaultColors: { bg: string, fg: string } = { bg: DEFAULT_BACKGROUND_COLOR, fg: DEFAULT_COLOR },
) {
  const { fillColor, textColor } = token;
  const hasCustomBg = fillColor !== undefined;
  const hasCustomText = textColor !== undefined;
  const bg = fillColor || defaultColors.bg;
  let fg = textColor || defaultColors.fg;
  if (hasCustomBg && !hasCustomText) {
    fg = findBestShade(fillColor, grayShades);
  }
  return { bg, fg };
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
