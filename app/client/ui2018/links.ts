/**
 * Styling for a simple green <A HREF> link.
 */

import { colors } from 'app/client/ui2018/cssVars';
import { styled } from 'grainjs';

// Match the font-weight of buttons.
export const cssLink = styled('a', `
  color: ${colors.lightGreen};
  --icon-color: ${colors.lightGreen};
  text-decoration: none;
  &:hover, &:focus {
    color: ${colors.lightGreen};
    --icon-color: ${colors.lightGreen};
    text-decoration: underline;
  }
`);
