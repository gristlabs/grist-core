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

// Returns 'metaKey' on Mac / iOS, and 'ctrlKey' elsewhere. This is useful for various keyboard
// interactions that use Control on Windows and Linux, and Command key on Mac for the same
// purpose. Suitable to use with KeyboardEvent and MouseEvent.
// (Note: Mousetrap.js uses the same logic to interpret its "mod" key alias.)
export function modKeyProp(): 'metaKey'|'ctrlKey' {
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform) ? 'metaKey' : 'ctrlKey';
}

export function isWin() {
  const os = getParser().getOSName();
  return os === 'Windows';
}
