import DOMPurify from "dompurify";

// Export dependencies for stubbing in tests.
export const Deps = { DOMPurify };

/**
 * Returns the provided URL if it is valid and safe to use in
 * HTTP-only contexts, such as form redirects and custom widget
 * URLs.
 *
 * Returns `null` if the URL is invalid or unsafe.
 *
 * For sanitizing hyperlink URLs, such as those used by `a`
 * elements, see `sanitizeLinkUrl`.
 */
export function sanitizeHttpUrl(url: string): string | null {
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return null;
    }

    return parsedUrl.href;
  } catch (e) {
    return null;
  }
}

/**
 * Returns the provided URL if it is valid and safe to use for hyperlinks,
 * such as those used by `a` elements. This includes URLs prefixed with
 * `http[s]:`, `mailto:`, and `tel:`, and excludes URLs prefixed with
 * `javascript:`.
 *
 * Returns `null` if the URL is invalid or unsafe.
 *
 * For sanitizing HTTP-only URLs, such as those used for redirects, see
 * `sanitizeHttpUrl`.
 */
export function sanitizeLinkUrl(url: string): string | null {
  return Deps.DOMPurify.isValidAttribute("a", "href", url) ? url : null;
}
