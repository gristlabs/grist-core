import {dom} from 'grainjs';

/**
 * Load dynamically an external JS script from the given URL. Returns a promise that is
 * resolved when the script is loaded.
 */
export function loadScript(url: string) {
  return new Promise((resolve, reject) => {
    const script = dom("script", {type: "text/javascript", src: url, crossorigin: "anonymous"});
    document.head.appendChild(Object.assign(script, {onload: resolve, onerror: reject}));
  });
}

/**
 * Load dynamically an external CSS file from the given URL. Returns a promise that is
 * resolved when the file is loaded.
 */
export function loadCssFile(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = dom("link", {rel: "stylesheet", href: url});
    document.head.appendChild(Object.assign(link, {onload: resolve, onerror: reject}));
  });
}
