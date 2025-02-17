import {theme} from 'app/client/ui2018/cssVars';
import {DomArg, keyframes, Observable, observable, styled} from 'grainjs';

const rotate360 = keyframes(`
  from { transform: rotate(45deg); }
  75% { transform: rotate(405deg); }
  to { transform: rotate(405deg); }
`);

const flash = keyframes(`
  0% {
    background-color: ${theme.loaderFg};
  }
  50%, 100% {
    background-color: ${theme.loaderBg};
  }
`);

/**
 * Creates a 32x32 pixel loading spinner. Use by calling `loadingSpinner()`.
 */
export const loadingSpinner = styled('div', `
  --loader-fg: ${theme.loaderFg};
  --loader-bg: ${theme.loaderBg};
  display: inline-block;
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  border-radius: 32px;
  border: 4px solid var(--loader-bg);
  border-top-color: var(--loader-fg);
  animation: ${rotate360} 1s ease-out infinite;
  &-inline {
    width: 1em;
    height: 1em;
    line-height: inherit;
    border-radius: 50%;
    border-width: 1px;
  }
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

export function watchPromise<T extends (...args: any[]) => any>(fun: T): T & {busy: Observable<boolean>} {
  const loading = observable(false);
  const result = async (...args: any) => {
    loading.set(true);
    try {
      return await fun(...args);
    } finally {
      if (!loading.isDisposed()) {
        loading.set(false);
      }
    }
  };
  return Object.assign(result, {busy: loading}) as any;
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
  background-color: ${theme.loaderFg};
  color: ${theme.loaderFg};
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
