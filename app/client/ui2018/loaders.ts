import {colors} from 'app/client/ui2018/cssVars';
import {keyframes, styled} from 'grainjs';

const rotate360 = keyframes(`
  from { transform: rotate(45deg); }
  75% { transform: rotate(405deg); }
  to { transform: rotate(405deg); }
`);

/**
 * Creates a 32x32 pixel loading spinner. Use by calling `loadingSpinner()`.
 */
export const loadingSpinner = styled('div', `
  display: inline-block;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  border-radius: 32px;
  border: 4px solid ${colors.darkGrey};
  border-top-color: ${colors.lightGreen};
  animation: ${rotate360} 1s ease-out infinite;
`);
