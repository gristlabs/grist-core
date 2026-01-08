import createDOMPurifier from "dompurify";

export function sanitizeHTML(source: string | Node): string {
  return defaultPurifier.sanitize(source);
}

export function sanitizeHTMLIntoDOM(source: string | Node): DocumentFragment {
  try {
    return defaultPurifier.sanitize(source, { RETURN_DOM_FRAGMENT: true });
  } catch (err) {
    // There seems to be a regression in Chrome during printing related to TrustedTypes (see
    // https://issues.chromium.org/issues/40138301). We attempt a workaround by forcing
    // DOMPurify to avoid using TrustedTypes. Keep workaround narrowly limited to printing.
    if ((window as any).isCurrentlyPrinting) {
      console.warn("Working around error from dompurify during printing", err);
      return defaultPurifier.sanitize(source, {
        RETURN_DOM_FRAGMENT: true,
        TRUSTED_TYPES_POLICY: {
          createHTML: (html: string) => html,
          createScriptURL: (scriptUrl: string) => scriptUrl,
        } as any,    // We need a cast because it's an incomplete stub of TrustedTypePolicy,
        // just the bits that dompurify actually calls.
      });
    }
    throw err;
  }
}

export function sanitizeTutorialHTML(source: string | Node): string {
  return tutorialPurifier.sanitize(source, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allowFullscreen"],
  });
}

const defaultPurifier = createDOMPurifier();
const tutorialPurifier = createDOMPurifier();

// If we are executed in a browser, we can add hooks to the purifiers to customize their behavior.
// But sometimes this code is included in tests, where `window` is not defined.
if (typeof window !== "undefined") {
  defaultPurifier.addHook("afterSanitizeAttributes", handleAfterSanitizeAttributes);

  tutorialPurifier.addHook("afterSanitizeAttributes", handleAfterSanitizeAttributes);
  tutorialPurifier.addHook("uponSanitizeElement", handleSanitizeTutorialElement);
}

function handleAfterSanitizeAttributes(node: Element) {
  // Code copied from:
  // https://github.com/cure53/DOMPurify/blob/main/demos/hooks-target-blank-demo.html
  if ("target" in node) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
}

function handleSanitizeTutorialElement(node: Node, data: createDOMPurifier.UponSanitizeElementHookEvent) {
  if (data.tagName !== "iframe") { return; }

  const src = (node as Element).getAttribute("src");
  if (src?.startsWith("https://www.youtube.com/embed/")) {
    return;
  }

  node.parentNode?.removeChild(node);
}
