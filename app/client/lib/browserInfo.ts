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
