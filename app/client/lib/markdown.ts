import { sanitizeHTML } from 'app/client/ui/sanitizeHTML';
import { BindableValue, DomElementMethod, subscribeElem } from 'grainjs';
import { marked } from 'marked';

export function markdown(markdownObs: BindableValue<string>): DomElementMethod {
  return elem => subscribeElem(elem, markdownObs, value => setMarkdownValue(elem, value));
}

function setMarkdownValue(elem: Element, markdownValue: string): void {
  elem.innerHTML = sanitizeHTML(marked(markdownValue));
}
