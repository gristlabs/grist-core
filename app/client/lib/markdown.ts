import { sanitizeHTML } from 'app/client/ui/sanitizeHTML';
import { theme } from 'app/client/ui2018/cssVars';
import { BindableValue, DomElementMethod, IDomArgs, styled, subscribeElem } from 'grainjs';
import { marked } from 'marked';

/**
 * Helper function for using Markdown in grainjs elements. It accepts
 * both plain Markdown strings, as well as methods that use an observable.
 * Example usage:
 *
 *    cssSection(markdown(t(`# New Markdown Function
 *
 *      We can _write_ [the usual Markdown](https://markdownguide.org) *inside*
 *      a Grainjs element.`)));
 *
 * or
 *
 *   cssSection(markdown(use => use(toggle) ? t('The toggle is **on**') : t('The toggle is **off**'));
 *
 * Markdown strings are easier for our translators to handle, as it's possible
 * to include all of the context around a single markdown string without
 * breaking it up into separate strings for grainjs elements.
 */
export function markdown(markdownObs: BindableValue<string>): DomElementMethod {
  return elem => subscribeElem(elem, markdownObs, value => setMarkdownValue(elem, value));
}

/**
 * HTML span element that creates a span element with the given markdown string, without
 * any surrounding paragraph tags. This is useful when you want to include markdown inside
 * a larger element as a single line.
 */
export function cssMarkdownSpan(
  markdownObs: BindableValue<string>,
  ...args: IDomArgs<HTMLSpanElement>
): HTMLSpanElement {
  return cssMarkdownLine(markdown(markdownObs), ...args);
}

const cssMarkdownLine = styled('span', `
  & p {
    margin: 0;
  }
  & a {
    color: ${theme.link};
    --icon-color: ${theme.link};
    text-decoration: none;
  }
  & a:hover, & a:focus {
    color: ${theme.linkHover};
    --icon-color: ${theme.linkHover};
    text-decoration: underline;
  }
`);

function setMarkdownValue(elem: Element, markdownValue: string): void {
  elem.innerHTML = sanitizeHTML(marked(markdownValue, {async: false}));
}
