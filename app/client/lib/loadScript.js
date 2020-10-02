const Promise = require('bluebird');
const G = require('./browserGlobals').get('document');

/**
 * Load dynamically an external JS script from the given URL. Returns a promise that is
 * resolved when the script is loaded.
 */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    let script = G.document.createElement("script");
    script.type = "text/javascript";
    script.onload = resolve;
    script.onerror = reject;
    script.src = url;
    G.document.getElementsByTagName("head")[0].appendChild(script);
  });
}

module.exports = loadScript;
