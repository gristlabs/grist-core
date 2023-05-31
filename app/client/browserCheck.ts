/**
 * Check if browser is a version we are happy with.
 * Introduce any new dependencies very carefully, checking that the code still runs
 * on old browsers afterwards.
 */

// Use version of bowser with polyfill for old browsers.
import * as bowser from 'bowser/bundled';

// This code will run in the browser.
const version = bowser.getParser(window.navigator.userAgent);
(window as any)._parsedBrowserVersion = version;

// Skip if user has already dismissed a warning from us.
if (document && window && document.cookie.indexOf("gristbrowser=accept") === -1) {
  const isHappyBrowser = version.satisfies({
    desktop: {
      chrome: ">=72.0.3626",   // first 2019 version
      firefox: ">=65",         // first 2019 version
      safari: ">=12.0.3",      // first 2019 version
      edge: ">=80",            // one of first Chromium-based Edge versions, early 2020
      opera: ">=66",           // first 2020 version
    },
    mobile: {
      // These were tested using browserstack, for a basic layout and cell editing. Other browsers
      // not attempted, so Grist will show a warning there.
      safari: ">=15",       // 2021 version, first where layouts aren't broken
      chrome: ">=92",       // 2021 version which works fine
      firefox: ">=108",     // end-of-2022 version, couldn't try an earlier one
    },
  });
  const isMobile = version.isPlatform('mobile') || version.isPlatform('tablet');
  if (!isHappyBrowser) {
    const problemElement = document.getElementById('browser-check-problem');
    const dismissElement = document.getElementById('browser-check-problem-dismiss');
    if (problemElement && dismissElement) {
      // Prepare a button for dismissing the warning.
      dismissElement.onclick = function() {
        // Set a cookie so we don't show this warning once it is dismissed.
        let cookie = "gristbrowser=accept; path=/";
        // Keep the cookie for a year (60*60*24*365 seconds) before warning again.
        cookie += "; max-age=31536000";

        // NOTE: Safari seems to limit cookies (and other storage?) set via JS to 1 week, so
        // people on mobile or old Safari may get prompted more often than we'd like. See
        // https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/

        if (document.location.href.indexOf(".getgrist.com") !== -1) {
          // on *.getgrist.com, set cookie domain to getgrist.com
          cookie += "; Domain=.getgrist.com";
        }
        document.cookie = cookie;
        // Hide the warning, showing the loaded page that it was obscuring.
        problemElement.style.display = 'none';
        return false;
      };
      // Show modal describing problem, and some possible solutions.
      if (isMobile) {
        problemElement.className += ' browser-check-is-mobile';
      }
      problemElement.style.display = 'block';
    }
  }
}
