const TYPE_CHAR_MS = 35;
const ERASE_CHAR_MS = 18;
const HOLD_PHRASE_MS = 1800;
const PHRASE_GAP_MS = 400;
const START_DELAY_MS = 400;

interface TypewriterText {
  start(): void;
  stop(): void;
  dispose(): void;
}

interface TypewriterTextOptions {
  phrases: readonly string[];
  onText: (text: string | null) => void;
}

/**
 * Returns a {@link TypewriterText} that cycles through a list of phrases, typing them
 * out one character at a time and erasing them.
 *
 * The returned TypewriterText is stopped by default. Call `start()` to start it and `stop()`
 * to stop it.
 *
 * You must call `dispose()` once you're finished using the returned TypewriterText to clear
 * any active timers.
 */
export function createTypewriterText(options: TypewriterTextOptions): TypewriterText {
  const { phrases, onText } = options;
  const inert = phrases.length === 0 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let phraseIndex = 0;
  let charCount = 0;
  let erasing = false;

  function clear() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
  }

  function next(delayMs: number) {
    clear();
    if (!running) { return; }
    timer = setTimeout(step, delayMs);
  }

  function step() {
    timer = null;
    if (!running) { return; }
    const phrase = phrases[phraseIndex % phrases.length];
    if (!erasing) {
      charCount++;
      onText(phrase.slice(0, charCount));
      if (charCount >= phrase.length) {
        erasing = true;
        next(HOLD_PHRASE_MS);
      } else {
        next(TYPE_CHAR_MS);
      }
      return;
    }
    charCount--;
    onText(phrase.slice(0, Math.max(charCount, 0)));
    if (charCount <= 0) {
      erasing = false;
      phraseIndex++;
      next(PHRASE_GAP_MS);
    } else {
      next(ERASE_CHAR_MS);
    }
  }

  return {
    start() {
      if (inert || running) { return; }
      running = true;
      onText("");
      next(START_DELAY_MS);
    },
    stop() {
      if (inert || !running) { return; }
      running = false;
      clear();
      charCount = 0;
      erasing = false;
      onText(null);
    },
    dispose() {
      running = false;
      clear();
    },
  };
}
