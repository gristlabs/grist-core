import * as Bowser from "bowser"; // TypeScript

let parser: Bowser.Parser.Parser|undefined;

function getParser() {
  return parser || (parser = Bowser.getParser(window.navigator.userAgent));
}

// Returns whether the browser we are in is a desktop browser.
export function isDesktop() {
  const platformType = getParser().getPlatformType();
  return (!platformType || platformType === 'desktop');
}

// Returns whether the browser is on mobile iOS.
// This is used in particular in viewport.ts to set maximum-scale=1 (to prevent iOS auto-zoom when
// an input is focused, without preventing manual pinch-to-zoom).
export function isIOS() {
  return navigator.platform && /iPad|iPhone|iPod/.test(navigator.platform);
}
