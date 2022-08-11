import {colors} from 'app/client/ui2018/cssVars';
import {DomArg, keyframes, styled} from 'grainjs';

const rotate360 = keyframes(`
  from { transform: rotate(45deg); }
  75% { transform: rotate(405deg); }
  to { transform: rotate(405deg); }
`);

const flash = keyframes(`
  0% {
    background-color: ${colors.lightGreen};
  }
  50%, 100% {
    background-color: ${colors.darkGrey};
  }
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

/**
 * Creates a three-dots loading animation. Use by calling `loadingDots()`.
 */
export function loadingDots(...args: DomArg<HTMLDivElement>[]) {
  return cssLoadingDotsContainer(
    cssLoadingDot(cssLoadingDot.cls('-left')),
    cssLoadingDot(cssLoadingDot.cls('-middle')),
    cssLoadingDot(cssLoadingDot.cls('-right')),
    ...args,
  );
}

const cssLoadingDotsContainer = styled('div', `
  --dot-size: 10px;
  display: inline-flex;
  column-gap: calc(var(--dot-size) / 2);
`);

const cssLoadingDot = styled('div', `
  border-radius: 50%;
  width: var(--dot-size);
  height: var(--dot-size);
  background-color: ${colors.lightGreen};
  color: ${colors.lightGreen};
  animation: ${flash} 1s alternate infinite;

  &-left {
    animation-delay: 0s;
  }
  &-middle {
    animation-delay: 0.25s;
  }
  &-right {
    animation-delay: 0.5s;
  }
`);
