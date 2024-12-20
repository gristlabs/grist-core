/**
 * Gets or creates a style element in the head of the document with the given `id`.
 *
 * Useful for grouping CSS values such as theme custom properties without needing to
 * pollute the document with in-line styles.
 */
export function getOrCreateStyleElement(id: string) {
  let style = document.head.querySelector(`#${id}`);
  if (style) { return style; }
  style = document.createElement('style');
  style.setAttribute('id', id);
  document.head.append(style);
  return style;
}
