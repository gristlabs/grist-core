/**
 * A doc worker's id, and the internal url its peers reach it on.
 *
 * The id must be distinct. Two servers sharing one can open the same document, since the check
 * against that compares ids. With nothing allocating ids, one is taken from something already
 * distinct: a url that reaches this server and no other, whether the operator gave it as an
 * internal address or a public one. Where no url names this server, such as when only loopback is
 * available, the machine does instead. GRIST_DOC_WORKER_ID overrides it, except where
 * GRIST_ROUTER_URL has already handed this server a name.
 */

import { parseSubdomain } from "app/common/gristUrls";
import { tryParseUrl } from "app/common/gutil";
import { DocWorkerInfo } from "app/server/lib/DocWorkerMap";

import { format as formatUrl } from "url";

import ipaddr from "ipaddr.js";
import { RedisClient } from "redis";

// What GRIST_HOST defaults to. A server left with it is reachable only from its own machine.
export const DEFAULT_HOST = "localhost";

// Joins the parts of an id. Not "-", which DocWorkerMap's key suffixes use: an id of
// "h_8484_docs" must not collide with the assignment set at "worker-h_8484-docs".
const ID_SEPARATOR = "_";

// Stands in where a part of an id sanitizes away to nothing, so that an id always has a name in
// it and nothing has to handle an empty one.
const FALLBACK_ID_PART = "worker";

// Where the host in the internal url came from, in the order they are tried. "none" is the
// giving-up case: nothing supplied an address a peer could use, so the local one is published and
// the server says so at startup.
export type AddressSource =
  "GRIST_ROUTER_URL" | "APP_DOC_INTERNAL_URL" | "APP_DOC_URL" | "GRIST_HOST" | "redis" | "none";

export interface DocWorkerIdentity {
  info: DocWorkerInfo;
  addressSource: AddressSource;

  // Whether info.publicUrl is only this server's own guess at how the outside world reaches
  // it. APP_DOC_URL and GRIST_ROUTER_URL both supply a real address; with neither, the url
  // is just what this server calls itself, and a client does better keeping the one it has.
  publicUrlIsGuessed: boolean;
}

// Everything an identity is derived from. The settings arrive as arguments rather than being read
// from the environment here, so that what an identity depends on is stated in one place.
export interface DocWorkerIdentityContext {
  // GRIST_DOC_WORKER_ID: this worker's name, given outright.
  docWorkerId?: string;

  // APP_DOC_INTERNAL_URL: the address the operator wants peers to reach this server on.
  appDocInternalUrl?: string;

  // APP_DOC_URL: this server's public address. Distinct for each worker, since it is how a client
  // is routed to the one holding a document, so it can name a worker as well as reach it.
  appDocUrl?: string;

  // APP_HOME_URL: the address clients arrive on. Read here only to tell whether they arrive by
  // subdomain, which decides whether APP_DOC_URL needs one.
  appHomeUrl?: string;

  // GRIST_FLEET: whether this server is part of a fleet, which proxies clients on from whichever
  // server they reach. Refused alongside APP_DOC_URL, which a fleet has no use for.
  fleet?: boolean;

  // GRIST_HOST as the operator set it, if they did. Peers are told this rather than the address
  // it resolved to, since a name outlives whichever address answered at startup.
  gristHost?: string;

  // The address this server reaches Redis from, as getRedisLocalAddress reads it. Every member
  // connects to the same Redis, so this is an address on a network the whole fleet has in common.
  // Undefined without Redis, and so without any peers to be reached by.
  redisLocalAddress?: string;

  // This machine's name, for a worker its url cannot name.
  hostname: string;

  // The port the socket ended up on. Read late by the caller, since with port 0 the real port is
  // only known once we are listening.
  port: number;

  // The address the listening socket is bound to, read as late as the port. Preferred over
  // GRIST_HOST because the bind has resolved it, so a name and every spelling of an address arrive
  // as one form. Undefined where no socket of ours is listening.
  boundAddress?: string;

  // This server's url as it would reach itself. The historical fallback, still used for the
  // public url.
  ownUrl: string;

  // Version tag included in doc worker urls.
  tag: string;

  // Registers this server with the api at GRIST_ROUTER_URL, where one is configured. That puts it
  // behind a load balancer and returns the hostname allocated for it, which is both how clients
  // reach it and what it is known as.
  createWorkerUrl?: () => Promise<{ url: string, host: string }>;
}

// Work out who this server is, at startup.
export async function deriveDocWorkerIdentity(
  ctx: DocWorkerIdentityContext,
): Promise<DocWorkerIdentity> {
  // Refused rather than ignored: where APP_DOC_URL also stands in for the internal url, peers
  // reach each other by leaving the cluster and coming back through the public front end, which
  // routes to any server rather than the one meant.
  if (ctx.fleet && ctx.appDocUrl) {
    throw new Error("APP_DOC_URL cannot be set with GRIST_FLEET. A fleet routes clients through " +
      "whichever server they reach, so a worker's public url is never used. Unset APP_DOC_URL, " +
      "and use APP_DOC_INTERNAL_URL if peers need an address given to them.");
  }

  if (ctx.createWorkerUrl) {
    // The hostname allocated is one that reaches this server, so the id and both urls are it.
    const allocated = await ctx.createWorkerUrl();
    const workerUrl = `${allocated.url}/v/${ctx.tag}/`;
    return {
      info: { id: allocated.host, publicUrl: workerUrl, internalUrl: workerUrl },
      addressSource: "GRIST_ROUTER_URL",
      publicUrlIsGuessed: false,
    };
  }

  // APP_DOC_URL is where clients are sent. Where APP_HOME_URL routes orgs by subdomain, an address
  // with no subdomain of its own is rebuilt under the base domain a client arrives on, naming
  // another server. Checked at startup, where the operator can act on it.
  if (ctx.appDocUrl) {
    const publicHostname = tryParseUrl(ctx.appDocUrl)?.hostname;
    if (!publicHostname) {
      throw new Error(`APP_DOC_URL is not a url: ${ctx.appDocUrl}`);
    }
    if (parseSubdomain(tryParseUrl(ctx.appHomeUrl)?.hostname).base &&
      !parseSubdomain(publicHostname).org) {
      throw new Error(`APP_DOC_URL (${ctx.appDocUrl}) has no subdomain, but APP_HOME_URL routes by one`);
    }
  }

  const publicUrl = (ctx.appDocUrl || ctx.ownUrl) + `/v/${ctx.tag}/`;
  const internal = chooseInternalUrl(ctx, publicUrl);
  return {
    info: {
      id: ctx.docWorkerId || (internal.nameUrl ?
        makeWorkerId(internal.nameUrl) : makeHostWorkerId(ctx.hostname, ctx.port)),
      publicUrl,
      internalUrl: internal.url,
    },
    addressSource: internal.source,
    publicUrlIsGuessed: !ctx.appDocUrl,
  };
}

/**
 * The address this server reaches Redis from, for the context's redisLocalAddress.
 *
 * Read from the client's socket, an internal of node_redis that Grist declares by hand (see
 * stubs/app/server/declarations.d.ts). It is empty until that socket is up, so a client that has
 * not yet spoken to Redis is made to: asking too early would report no address at all, and the
 * fleet would fall back to publishing loopback.
 */
export async function getRedisLocalAddress(client: RedisClient | null): Promise<string | undefined> {
  if (!client) { return undefined; }
  if (!client.stream?.localAddress) { await client.pingAsync(); }
  return client.stream?.localAddress;
}

interface InternalUrl {
  url: string;
  source: AddressSource;

  // The url that names this server in particular, rather than any server answering there, where
  // there is one. Only such a url can name a worker; without one it is named after its machine
  // instead. Held apart from the url published above: the public url has a version tag on the end,
  // which changes with every build, and an id has to outlive that.
  nameUrl?: string;
}

function chooseInternalUrl(ctx: DocWorkerIdentityContext, publicUrl: string): InternalUrl {
  // Named by the operator to reach this server, so it is taken at its word.
  if (ctx.appDocInternalUrl) {
    return {
      url: ctx.appDocInternalUrl, source: "APP_DOC_INTERNAL_URL", nameUrl: ctx.appDocInternalUrl,
    };
  }
  // The documented fallback for the internal url, kept so that upgrading does not silently move
  // server-to-server traffic. It names this worker too: a client reaches the worker holding a
  // document through it, so no two can share one. The name comes from the address as the operator
  // wrote it, not from the url published above, which has a version tag on the end.
  if (ctx.appDocUrl) {
    return { url: publicUrl, source: "APP_DOC_URL", nameUrl: ctx.appDocUrl };
  }

  // Nothing a peer could use. A url is published anyway, since a worker is expected to have one,
  // and it is the one this server reaches itself at, which is the same string on every machine and
  // so names none of them.
  const localOnly: InternalUrl = {
    url: urlForHost(DEFAULT_HOST, ctx.port), source: "none",
  };

  // What the socket is bound to, which the bind has already resolved. Falling back to GRIST_HOST
  // covers a server whose socket is held elsewhere and not passed down: the same value the socket
  // was bound with, only unresolved.
  const bound = ctx.boundAddress || ctx.gristHost;
  if (!bound) { return localOnly; }

  switch (reachability(bound)) {
    case "nowhere":
      // Reachable only from its own machine, so there is nothing to publish. Not even an address
      // this server does have elsewhere: no peer would find anything listening on it.
      return localOnly;

    case "somewhere": {
      // The bind landed on an address rather than every interface, so the operator named one:
      // GRIST_HOST unset would have bound loopback and said nowhere. Peers are told the name as
      // it was written, since it outlives whichever address answered at startup, while the bound
      // form is what was classified above.
      const named = urlForHost(ctx.gristHost || bound, ctx.port);
      return { url: named, source: "GRIST_HOST", nameUrl: named };
    }

    case "everywhere": {
      // Which address to publish is still open. The kernel chose this one to reach Redis, and
      // every fleet member reaches the same Redis. Unless it reaches it through something
      // alongside us, such as a proxy adding TLS or a service mesh, and the address names that
      // neighbor.
      const fromRedis = ctx.redisLocalAddress;
      if (!fromRedis || reachability(fromRedis) !== "somewhere") { return localOnly; }
      const named = urlForHost(fromRedis, ctx.port);
      return { url: named, source: "redis", nameUrl: named };
    }
  }
}

// What an address says about where this server can be reached.
//
// "everywhere" is the unspecified address, which asks to listen on every interface rather than
// naming one, so it leaves the question open. "nowhere" covers the addresses that mean something
// different on every machine, or nothing to anyone. Everything else is somewhere, which is as much
// as can be known here: an address on a private network or a docker bridge passes, and may still
// reach nobody.
function reachability(address: string): "everywhere" | "somewhere" | "nowhere" {
  let parsed;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    // A name, which only resolving could judge, so it is trusted: the operator wrote it to be
    // reached at. Reached only where the bound address was unavailable.
    return "somewhere";
  }
  // One address has an IPv4 and an IPv6 spelling, and which of them arrives depends on how the
  // socket was opened. Ranges are stated in terms of the IPv4 one.
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) { parsed = parsed.toIPv4Address(); }
  switch (parsed.range()) {
    case "unspecified": return "everywhere";
    // Loopback and link-local are every machine's own idea of the same address; multicast and
    // broadcast are nobody's address at all.
    case "loopback": case "linkLocal": case "multicast": case "broadcast": return "nowhere";
    default: return "somewhere";
  }
}

// Peers reach each other over plain http, as they did before any of this was worked out. Node
// assembles the url, since a host is not simply a string beside a port: an IPv6 address has to be
// bracketed, and hand-rolling that is where this gets sharp.
function urlForHost(host: string, port: number): string {
  return formatUrl({ protocol: "http", slashes: true, hostname: host, port, pathname: "/" });
}

// Name a worker after an address that reaches it and no other server, so the name is unique and
// stable wherever that address is. A server returning at a different address is a different worker.
// The address is the one peers use, or the one clients do where that is all the operator gave.
export function makeWorkerId(url: string): string {
  const parsed = tryParseUrl(url);
  if (!parsed) {
    // A broken address should still name a worker.
    return sanitizeIdPart(url) || FALLBACK_ID_PART;
  }
  // Every part that routes: the port tells workers apart on a shared host, the path on a shared
  // address.
  return [
    // hostname, not host, so that the port stays a part of its own. Bracketed, for IPv6.
    sanitizeIdPart(parsed.hostname) || FALLBACK_ID_PART,
    parsed.port,
    ...parsed.pathname.split("/").map(sanitizeIdPart),
  ].filter(Boolean).join(ID_SEPARATOR);
}

// Name a worker after its machine, for when its url names no server in particular. Not routable,
// but it tells machines apart.
function makeHostWorkerId(hostname: string, port: number): string {
  const host = sanitizeIdPart(hostname) || FALLBACK_ID_PART;
  return `${host}${ID_SEPARATOR}${port}`;
}

// Reduce a part of an address to characters safe in a Redis key and unreserved in a url.
//
// Underscore is excluded so it can serve as the separator: one that could also occur inside a part
// would make /a/b and /a-b one worker. One dash per replaced character, not per run, or
// 2001:db8::1 and 2001:db8:1:: would collide.
function sanitizeIdPart(part: string): string {
  return part
    .replace(/[^A-Za-z0-9.-]/g, "-")     // anything else becomes a dash
    .replace(/^[-.]+|[-.]+$/g, "");      // and dashes or dots at either end are noise
}
