const G = require('../lib/browserGlobals').get('document');
const dom = require('../lib/dom');

/**
 * Note about testing
 * It is difficult to test file downloads as Selenuim and javascript do not provide
 * an easy way to control native dialogs.
 * One approach would be to configure the test browser to automatically start the download and
 * save the file in a specific place. Then check that the file exists at that location.
 * Firefox documentation: http://kb.mozillazine.org/File_types_and_download_actions
 * Approach detailed here in java: https://www.seleniumeasy.com/selenium-tutorials/verify-file-after-downloading-using-webdriver-java
 */

let _download = null;
/**
 * Trigger a download on the file at the given url.
 * @param {String} href: The url of the download.
 */
function download(href) {
  if (!_download) {
    _download = dom('a', {
      style: 'position: absolute; top: 0; display: none',
      download: ''
    });
    G.document.body.appendChild(_download);
  }
  _download.setAttribute('href', href);
  _download.click();
}

module.exports = download;
