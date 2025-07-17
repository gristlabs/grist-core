/**
 * "Visually hidden" helpers.
 *
 * Allows to add things in the DOM that are not shown on screen but are still announced by screen readers.
 *
 * The code is taken from Bootstrap which has a pretty battle-tested implementation (thanks to them!)
 * @see https://github.com/twbs/bootstrap/blob/c5bec4ea7bd74b679fc2ecc53c141bff3750915b/scss/mixins/_visually-hidden.scss
 * @see https://getbootstrap.com/docs/5.3/helpers/visually-hidden/
 * @see https://www.ffoodd.fr/masquage-accessible-de-pointe/index.html
 */
import {styled} from "grainjs";

const commonStyles = `
  border: 0 !important;
  clip-path: inset(50%) !important;
  height: 1px !important;
  margin: -1px !important;
  overflow: hidden !important;
  padding: 0 !important;
  width: 1px !important;
  white-space: nowrap !important;
`;

/**
 * Visually hides an element.
 *
 * You should use this with div, span, p, headings. Certainly not much else.
 */
export const visuallyHidden = styled('div', `
  ${commonStyles}

  &:not(caption) {
    position: absolute !important;
  }

  & * {
    overflow: hidden !important;
  }
`);


/**
 * Visually hides an element but show it when it gets keyboard focus.
 * Useful for things like skip links.
 *
 * You should use this on interactive html elements like <a> or <button>.
 *
 * Note: you can also use this on a div containing interactive elements, that you want
 * to show as a whole only when one of its interactive elements is focused.
 *
 * See bootstrap docs linked above for more details.
 */
export const visuallyHiddenFocusable = styled(visuallyHidden, `
  &:not(:focus, :focus-within) {
    ${commonStyles}
  }

  &:not(caption):not(:focus, :focus-within){
    position: absolute !important;
  }

  &:not(:focus, :focus-within) * {
    overflow: hidden !important;
  }
`);
