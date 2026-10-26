/** An uncaught error, a rejected promise, a script that did not load, or a console.error call. */
export interface WidgetError {
  message: string;
  line?: number;
  stack?: string;
}

/**
 * Sends the errors of the page to Grist, as messages `{ error }` to the parent window:
 * uncaught errors, rejected promises, scripts and styles that did not load, and console.error
 * calls. A repeat of the last error is not sent again. It catches only what happens after it runs,
 * so a widget loads the plugin API first.
 */
export function reportWidgetErrors() {
  let last: string | undefined;
  const send = (error: WidgetError) => {
    const key = JSON.stringify(error);
    if (key === last) { return; }
    last = key;
    try { window.parent.postMessage({ error }, "*"); } catch (e) { /* no parent */ }
  };

  window.addEventListener("error", (ev) => {
    const source = ev.target as (HTMLScriptElement & HTMLLinkElement) | null;
    if (source && (ev.target as unknown) !== window && (source.src || source.href)) {
      send({ message: `Failed to load ${source.src || source.href}` });
    } else {
      send({ message: String(ev.message), line: ev.lineno || undefined, stack: stackOf(ev.error) });
    }
  }, true);   // Errors of scripts and styles that did not load don't bubble; capturing gets them.

  window.addEventListener("unhandledrejection", (ev) => {
    send({ message: `Unhandled rejection: ${toText(ev.reason)}`, stack: stackOf(ev.reason) });
  });

  const consoleError = console.error;
  console.error = (...args: unknown[]) => {
    const error = args.find(arg => arg instanceof Error);
    send({ message: args.map(toText).join(" "), stack: stackOf(error) });
    consoleError.apply(console, args);
  };
}

function stackOf(error: unknown): string | undefined {
  return error instanceof Error && error.stack ? String(error.stack) : undefined;
}

function toText(value: unknown): string {
  if (value instanceof Error) { return String(value); }
  if (value && typeof value === "object") {
    try { return JSON.stringify(value); } catch (e) { /* a cycle; falls back to String() */ }
  }
  return String(value);
}
