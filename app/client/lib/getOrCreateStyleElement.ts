/**
 * Gets or creates a style element in the head of the document with the given `id`.
 *
 * Useful for grouping CSS values such as theme custom properties without needing to
 * pollute the document with in-line styles.
 *
 * @param id - The id of the style element to create.
 * @param insertOptions - insertAdjacentElement options to specify where to insert the style element.
 *                        Defaults to before the end of the head.
 */
export function getOrCreateStyleElement(id: string, insertOptions: {
  position: 'beforebegin' | 'afterbegin' | 'beforeend' | 'afterend'
  element: Element | null
} = { position: 'beforeend', element: null }): HTMLElement {
  let style = document.getElementById(id);
  if (style) {
    return style;
  }

  style = document.createElement('style');
  style.setAttribute('id', id);

  (insertOptions.element || document.head).insertAdjacentElement(
    insertOptions.element
      ? insertOptions.position
      : 'beforeend',
    style
  );
  return style;
}
