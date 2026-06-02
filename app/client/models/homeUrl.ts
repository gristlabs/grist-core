import { urlState } from "app/client/models/gristUrlState";
import { GristLoadConfig } from "app/common/gristUrls";

/**
 * If we don't know what the home URL is, the top level of the site
 * we are on may work. This should always work for single-server installs
 * that don't encode organization information in domains. Even for other
 * cases, this should be a good enough home URL for many purposes, it
 * just may still have some organization information encoded in it from
 * the domain that could influence results that might be supposed to be
 * organization-neutral.
 */
export function getFallbackHomeUrl(): string {
  const { host, protocol } = window.location;
  return `${protocol}//${host}`;
}

/**
 * Get the official home URL sent to us from the back end.
 */
export function getConfiguredHomeUrl(): string {
  const gristConfig: GristLoadConfig | undefined = window.gristConfig;
  return gristConfig?.homeUrl || getFallbackHomeUrl();
}

/**
 * Get the home URL, using fallback on the admin case and in the
 * single-domain case case.
 */
export function getPreferredHomeUrl(): string | undefined {
  const gristUrl = urlState().state.get();
  const gristConfig: GristLoadConfig | undefined = window.gristConfig;
  if (gristUrl.adminPanel || gristConfig?.serveSameOrigin) {
    // On the admin panel, we should not trust configuration much,
    // since we want the user to be able to access it to diagnose
    // problems with configuration. So we access the API via the
    // site we happen to be on rather than anything configured on
    // the back end.
    //
    // We can also do this in the common self-hosted case of a single
    // domain, no orgs encoded in subdomains.
    //
    // Couldn't we just always do this? Maybe! It could require
    // adjustments for calls that are meant to be site-neutral if the
    // domain has an org encoded in it. But that's a small price to
    // pay. Grist Labs uses a setup where api calls go to a dedicated
    // domain distinct from all other sites, but there's no particular
    // advantage to it.
    return getFallbackHomeUrl();
  }
  return getConfiguredHomeUrl();
}

export function getHomeUrl(): string {
  return getPreferredHomeUrl() || getConfiguredHomeUrl();
}
