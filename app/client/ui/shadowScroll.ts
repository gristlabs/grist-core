import {dom, IDomArgs, Observable, styled} from 'grainjs';

// Shadow css settings for member scroll top and bottom.
const SHADOW_TOP = 'inset 0 4px 6px 0 var(--grist-theme-scroll-shadow, rgba(217,217,217,0.4))';
const SHADOW_BTM = 'inset 0 -4px 6px 0 var(--grist-theme-scroll-shadow, rgba(217,217,217,0.4))';

/**
 * Creates a scroll div used in the UserManager and moveDoc menus to display
 * shadows at the top and bottom of a list of scrollable items.
 */
export function shadowScroll(...args: IDomArgs<HTMLDivElement>) {
  // Observables to indicate the scroll position.
  const scrollTop = Observable.create(null, true);
  const scrollBtm = Observable.create(null, true);
  return cssScrollMenu(
    dom.autoDispose(scrollTop),
    dom.autoDispose(scrollBtm),
    // Update scroll positions on init and on scroll.
    (elem) => { setTimeout(() => scrollBtm.set(isAtScrollBtm(elem)), 0); },
    dom.on('scroll', (_, elem) => {
      scrollTop.set(isAtScrollTop(elem));
      scrollBtm.set(isAtScrollBtm(elem));
    }),
    // Add shadows on the top/bottom if the list is scrolled away from either.
    dom.style('box-shadow', (use) => {
      const shadows = [use(scrollTop) ? null : SHADOW_TOP, use(scrollBtm) ? null : SHADOW_BTM];
      return shadows.filter(css => css).join(', ');
    }),
    ...args
  );
}

// Indicates that an element is currently scrolled such that the top of the element is visible.
function isAtScrollTop(elem: Element): boolean {
  return elem.scrollTop === 0;
}

// Indicates that an element is currently scrolled such that the bottom of the element is visible.
// It is expected that the elem arg has the offsetHeight property set.
function isAtScrollBtm(elem: HTMLElement): boolean {
  return elem.scrollTop >= (elem.scrollHeight - elem.offsetHeight);
}

const cssScrollMenu = styled('div', `
  flex: 1 1 0;
  width: 100%;
  overflow-y: auto;
`);
