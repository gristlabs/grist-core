import createDOMPurifier from 'dompurify';

export function sanitizeHTML(source: string | Node): string {
  return defaultPurifier.sanitize(source);
}

export function sanitizeTutorialHTML(source: string | Node): string {
  return tutorialPurifier.sanitize(source, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowFullscreen'],
  });
}

const defaultPurifier = createDOMPurifier();
const tutorialPurifier = createDOMPurifier();

// If we are executed in a browser, we can add hooks to the purifiers to customize their behavior.
// But sometimes this code is included in tests, where `window` is not defined.
if (typeof window !== 'undefined') {
  defaultPurifier.addHook('uponSanitizeAttribute', handleSanitizeAttribute);
  tutorialPurifier.addHook('uponSanitizeAttribute', handleSanitizeAttribute);
  tutorialPurifier.addHook('uponSanitizeElement', handleSanitizeTutorialElement);
}

function handleSanitizeAttribute(node: Element) {
  if (!('target' in node)) { return; }

  node.setAttribute('target', '_blank');
}

function handleSanitizeTutorialElement(node: Node, data: createDOMPurifier.UponSanitizeElementHookEvent) {
  if (data.tagName !== 'iframe') { return; }

  const src = (node as Element).getAttribute('src');
  if (src?.startsWith('https://www.youtube.com/embed/')) {
    return;
  }

  node.parentNode?.removeChild(node);
}
