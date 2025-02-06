import { sanitizeHTML } from 'app/client/ui/sanitizeHTML';
import { BindableValue, DomElementMethod, subscribeElem } from 'grainjs';
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
 *
 * Enable `inline` option to avoid wrapping results in `<p>` tags.
 */
export function markdown(markdownObs: BindableValue<string>, options: {inline?: boolean} = {}): DomElementMethod {
  return elem => subscribeElem(elem, markdownObs, value => setMarkdownValue(elem, value, options));
}

export function inlineMarkdown(markdownObs: BindableValue<string>): DomElementMethod {
  return markdown(markdownObs, {inline: true});
}
function setMarkdownValue(elem: Element, markdownValue: string, options: {inline?: boolean} = {}): void {
  const html = options.inline
    ? marked.parseInline(markdownValue, {async: false})
    : marked(markdownValue, {async: false});
  elem.innerHTML = sanitizeHTML(html);
}
