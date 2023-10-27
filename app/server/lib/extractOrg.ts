import { ApiError } from 'app/common/ApiError';
import { mapGetOrSet, MapWithTTL } from 'app/common/AsyncCreate';
import { extractOrgParts, getHostType, getKnownOrg } from 'app/common/gristUrls';
import { isAffirmative } from 'app/common/gutil';
import { Organization } from 'app/gen-server/entity/Organization';
import { HomeDBManager } from 'app/gen-server/lib/HomeDBManager';
import { GristServer } from 'app/server/lib/GristServer';
import { getOriginUrl } from 'app/server/lib/requestUtils';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { IncomingMessage } from 'http';

// How long we cache information about the relationship between
// orgs and custom hosts.  The higher this is, the fewer requests
// to the DB needed, but the longer it will take for changes
// to custom host setting to take effect.  Also, since the caching
// is done on individual servers/workers, it could be inconsistent
// between servers/workers for some time.  During this period,
// redirect cycles are possible.
// Units are milliseconds.
const ORG_HOST_CACHE_TTL = 60 * 1000;

export interface RequestOrgInfo {
  org: string;
  isCustomHost: boolean;   // when set, the request's domain is a recognized custom host linked
                           // with the specified org.

  // path remainder after stripping /o/{org} if any.
  url: string;
}

export type RequestWithOrg = Request & Partial<RequestOrgInfo>;

/**
 * Manage the relationship between orgs and custom hosts in the url.
 */
export class Hosts {

  // Cache of orgs (e.g. "fancy" of "fancy.getgrist.com") associated with custom hosts
  // (e.g. "www.fancypants.com")
  private _host2org = new MapWithTTL<string, Promise<string|undefined>>(ORG_HOST_CACHE_TTL);
  // Cache of custom hosts associated with orgs.
  private _org2host = new MapWithTTL<string, Promise<string|undefined>>(ORG_HOST_CACHE_TTL);

  // baseDomain should start with ".". It may be undefined for localhost or single-org mode.
  constructor(private _baseDomain: string|undefined, private _dbManager: HomeDBManager,
              private _gristServer: GristServer|undefined) {
  }

  /**
   * Use app.use(hosts.extractOrg) to set req.org, req.isCustomHost, and to strip
   *  /o/ORG/ from urls (when present).
   *
   * If Host header has a getgrist.com subdomain, then it must match the value in /o/ORG (when
   * present), and req.org will be set to the subdomain. On mismatch, a 400 response is returned.
   *
   * If Host header is a localhost domain, then req.org is set to the value in /o/ORG when
   * present, and to "" otherwise.
   *
   * If Host header is something else, we query the db for an org whose host value matches.
   * If found, req.org is set appropriately, and req.isCustomHost is set to true.
   * If not found, a 'Domain not recognized' error is thrown, showing an error page.
   */
  public get extractOrg(): RequestHandler {
    return this._extractOrg.bind(this);
  }

  // Extract org info in a request. This applies to the low-level IncomingMessage type (rather
  // than express.Request that derives from it) to be usable with websocket requests too.
  public async getOrgInfo(req: IncomingMessage): Promise<RequestOrgInfo> {
    const host = req.headers.host!;
    const info = await this.getOrgInfoFromParts(host, req.url!);
    // "Organization" header is used in proxying to doc worker, so respect it if
    // no org info found in url.
    if (!info.org && req.headers.organization) {
      info.org = req.headers.organization as string;
    }
    return info;
  }

  // Extract org, isCustomHost, and the URL with /o/ORG stripped away. Throws ApiError for
  // mismatching org or invalid custom domain. Hostname should not include port.
  public async getOrgInfoFromParts(host: string, urlPath: string): Promise<RequestOrgInfo> {
    const hostname = host.split(':')[0];    // Strip out port (ignores IPv6 but is OK for us).

    // Extract the org from the host and URL path.
    const parts = extractOrgParts(hostname, urlPath);

    // If the server is configured to serve a single hard-wired org, respect that.
    const singleOrg = getKnownOrg();
    if (singleOrg) {
      return {org: singleOrg, url: parts.pathRemainder, isCustomHost: false};
    }

    const hostType = this._getHostType(host);
    if (hostType === 'native') {
      if (parts.mismatch) {
        throw new ApiError(`Wrong org for this domain: ` +
          `'${parts.orgFromPath}' does not match '${parts.orgFromHost}'`, 400);
      }
      return {org: parts.subdomain || '', url: parts.pathRemainder, isCustomHost: false};
    } else if (hostType === 'plugin') {
      return {org: '', url: parts.pathRemainder, isCustomHost: false};
    } else {
      // Otherwise check for a custom host.
      const org = await mapGetOrSet(this._host2org, hostname, async () => {
        const o = await this._dbManager.connection.manager.findOne(Organization, {where: {host: hostname}});
        return o && o.domain || undefined;
      });
      if (!org) { throw new ApiError(`Domain not recognized: ${hostname}`, 404); }

      // Strip any stray /o/.... that has been added to a url with a custom host.
      // TODO: it would eventually be cleaner to make sure we don't make those
      // additions in the first place.

      // To check for mismatch, compare to org, since orgFromHost is not expected to match.
      if (parts.orgFromPath && parts.orgFromPath !== org) {
        throw new ApiError(`Wrong org for this domain: ` +
          `'${parts.orgFromPath}' does not match '${org}'`, 400);
      }
      return {org, isCustomHost: true, url: parts.pathRemainder};
    }
  }

  public async addOrgInfo<T extends IncomingMessage>(req: T): Promise<T & RequestOrgInfo> {
    return Object.assign(req, await this.getOrgInfo(req));
  }

  /**
   * Use app.use(hosts.redirectHost) to ensure (by redirecting if necessary)
   * that the domain in the url matches the preferred domain for the current org.
   * Expects that the extractOrg has been used first.
   */
  public get redirectHost(): RequestHandler {
    return this._redirectHost.bind(this);
  }

  public close() {
    this._host2org.clear();
    this._org2host.clear();
  }

  private async _extractOrg(req: Request, resp: Response, next: NextFunction) {
    try {
      await this.addOrgInfo(req);
      return next();
    } catch (err) {
      return resp.status(err.status || 500).send({error: err.message});
    }
  }

  private async _redirectHost(req: Request, resp: Response, next: NextFunction) {
    const {org} = req as RequestWithOrg;

    if (org && this._getHostType(req.headers.host!) === 'native' && !this._dbManager.isMergedOrg(org)) {
      // Check if the org has a preferred host.
      const orgHost = await mapGetOrSet(this._org2host, org, async () => {
        const o = await this._dbManager.connection.manager.findOne(Organization, {where: {domain: org}});
        return o && o.host || undefined;
      });
      if (orgHost && orgHost !== req.hostname) {
        const url = new URL(getOriginUrl(req) + req.path);
        url.hostname = orgHost;  // assigning hostname rather than host preserves port.
        return resp.redirect(url.href);
      }
    }
    return next();
  }

  private _getHostType(host: string) {
    const pluginUrl = isAffirmative(process.env.GRIST_TRUST_PLUGINS) ?
        undefined : this._gristServer?.getPluginUrl();
    return getHostType(host, {baseDomain: this._baseDomain, pluginUrl});
  }
}
