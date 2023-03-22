import DOMPurify from 'dompurify';

const config = {
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allowFullscreen'],
};

DOMPurify.addHook('uponSanitizeAttribute', (node) => {
  if (!('target' in node)) { return; }

  node.setAttribute('target', '_blank');
});
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'iframe') { return; }

  const src = node.getAttribute('src');
  if (src?.startsWith('https://www.youtube.com/embed/')) {
    return;
  }

  return node.parentNode?.removeChild(node);
});

export function sanitizeHTML(source: string | Node): string {
  return DOMPurify.sanitize(source, config);
}
