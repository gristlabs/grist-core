const BLACKLISTED_SUBDOMAINS = new Set([
  // from wiki page as of 2018-12-14
  'aws',
  'gristlogin',
  'issues',
  'metrics',
  'phab',
  'releases',
  'test',
  'vpn',
  'www',

  // A few more reserved just in case.  The minimum length requirement would eliminate
  // some in any case, but specified here also in case that minimum changes.
  'w', 'ww', 'wwww', 'wwwww',
  'docs', 'api', 'static',
  'ftp', 'imap', 'pop', 'smtp', 'mail', 'git', 'blog', 'wiki', 'support', 'kb', 'help',
  'admin', 'store', 'dev', 'beta',
  'community', 'try', 'wpx', 'telemetry',

  // a few random tech brands
  'google', 'apple', 'microsoft', 'ms', 'facebook', 'fb', 'twitter', 'youtube', 'yt',

  // updates for new special domains
  'current', 'staging', 'prod', 'login', 'login-dev',

  // some domains that look suspicious
  '1ogin', '1ogin-dev'
]);

/**
 *
 * Checks whether the subdomain is on the list of forbidden subdomains.
 * See /documentation/urls.md#organization-subdomains
 *
 * Also enforces various sanity checks.
 *
 * Throws if the subdomain is invalid.
 *
 */
export function checkSubdomainValidity(subdomain: string): void {
  // stick with limited alphanumeric subdomains.
  if (!(/^[a-z0-9][-a-z0-9]*$/.test(subdomain))) {
    throw new Error('Domain must include lower-case letters, numbers, and dashes only.');
  }
  // 'docs-*' is reserved for personal orgs.
  if (subdomain.startsWith('docs-')) { throw new Error('Domain cannot use reserved prefix "docs-".'); }
  // 'o-*' is reserved for automatic org domains.
  if (subdomain.startsWith('o-')) { throw new Error('Domain cannot use reserved prefix "o-".'); }
  // 'doc-worker-*' is reserved for doc workers.
  if (subdomain.startsWith('doc-worker-')) { throw new Error('Domain cannot use reserved prefix "doc-worker-".'); }
  // special subdomains like _domainkey.
  if (subdomain.startsWith('_')) { throw new Error('Domain cannot use reserved prefix "_".'); }
  // some domains are currently in use for testing v1.
  if (subdomain.startsWith('v1-')) { throw new Error('Domain cannot use reserved prefix "v1-".'); }
  // check limit of 63 characters on dns label.
  if (subdomain.length > 63) { throw new Error('Domain must contain less than 64 characters.'); }
  // check the subdomain isn't too short.
  if (subdomain.length <= 2) { throw new Error('Domain must contain more than 2 characters.'); }
  // a small blacklist prepared by hand.
  if (BLACKLISTED_SUBDOMAINS.has(subdomain)) { throw new Error('Invalid domain value.'); }
}
