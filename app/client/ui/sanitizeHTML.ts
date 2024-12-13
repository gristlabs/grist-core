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
defaultPurifier.addHook('uponSanitizeAttribute', handleSanitizeAttribute);

const tutorialPurifier = createDOMPurifier();
tutorialPurifier.addHook('uponSanitizeAttribute', handleSanitizeAttribute);
tutorialPurifier.addHook('uponSanitizeElement', handleSanitizeTutorialElement);

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
