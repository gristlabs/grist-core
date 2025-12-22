/**
 * A link that has a clickable area that spans the entire containing block.
 *
 * Don't forget to apply the `position: relative` CSS property to the parent block you want the link to cover.
 *
 * @see https://getbootstrap.com/docs/5.3/helpers/stretched-link
 */
import { styled } from 'grainjs';

export const stretchedLink = styled('a', `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &::after {
    position: absolute;
    inset: 0;
    content: '';
    z-index: 1;
  }
`);
