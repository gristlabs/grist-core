import {
  deriveDocWorkerIdentity,
  DocWorkerIdentityContext,
  getRedisLocalAddress,
  makeWorkerId,
} from "app/server/lib/DocWorkerIdentity";

import { promisifyAll } from "bluebird";
import { assert } from "chai";
import { createClient, RedisClient } from "redis";

promisifyAll(RedisClient.prototype);

// Everything an identity is derived from arrives in the context, so these tests state their
// inputs: nothing is stubbed, and nothing is inherited from the environment or the machine.
describe("DocWorkerIdentity", function() {
  // Held apart from the context so a test comparing two servers can change what the machine is
  // between them.
  let hostname: string;

  function setHostname(name: string) {
    hostname = name;
  }

  function makeContext(options: Partial<DocWorkerIdentityContext> = {}): DocWorkerIdentityContext {
    return {
      hostname,
      port: 8484,
      ownUrl: "http://localhost:8484",
      // Bound to the unspecified address, as the docker image asks for with GRIST_HOST=0.0.0.0.
      // That is a request to listen everywhere rather than an address, so it leaves open which
      // address to publish, which is what makes working one out legitimate.
      gristHost: "0.0.0.0",
      boundAddress: "0.0.0.0",
      // No Redis, and so no peers, unless a test says otherwise.
      redisLocalAddress: undefined,
      tag: "tag1",
      ...options,
    };
  }

  // A server whose socket is bound to one address, as GRIST_HOST asked for.
  function boundTo(host: string): Partial<DocWorkerIdentityContext> {
    return { gristHost: host, boundAddress: host };
  }

  // GRIST_HOST unset, which binds localhost, so the server answers only its own machine.
  function gristHostUnset(): Partial<DocWorkerIdentityContext> {
    return { gristHost: undefined, boundAddress: "127.0.0.1" };
  }

  describe("makeWorkerId", function() {
    // Naming, and therefore stability: a server that comes back at the same address takes the same
    // id, and with it the documents still assigned to it.
    it("names a worker after the address peers reach it on", function() {
      assert.equal(makeWorkerId("http://10.1.2.3:8484"), "10.1.2.3_8484");
    });

    it("distinguishes servers sharing a host by port", function() {
      assert.notEqual(
        makeWorkerId("http://docs-1:8484"),
        makeWorkerId("http://docs-1:8485"),
      );
    });

    it("distinguishes servers sharing a port by host", function() {
      // The bug this design removes: a port-derived id made these two the same worker.
      assert.notEqual(
        makeWorkerId("http://10.1.2.3:8484"),
        makeWorkerId("http://10.1.2.4:8484"),
      );
    });

    it("survives an IPv6 address, which cannot appear literally in a key or path", function() {
      const id = makeWorkerId("http://[fd00::1]:8484");
      assert.notMatch(id, /[[\]:]/);
      assert.notEqual(id, makeWorkerId("http://[fd00::2]:8484"));
    });

    it("tells IPv6 addresses apart that differ only in where the zeros are", function() {
      // Collapsing runs of removed characters would give these two the same name.
      assert.notEqual(
        makeWorkerId("http://[2001:db8::1]:8484"),
        makeWorkerId("http://[2001:db8:1::]:8484"),
      );
    });

    it("falls back to a name when the address sanitizes away to nothing", function() {
      assert.equal(makeWorkerId("http://[::]"), "worker");
    });

    it("tells apart workers behind one address that route by path", function() {
      // One proxy in front of the pool, each worker reached at its own prefix. Naming them after
      // host and port alone would give them all one id.
      assert.notEqual(
        makeWorkerId("http://proxy/pool/worker-a"),
        makeWorkerId("http://proxy/pool/worker-b"),
      );
      assert.equal(
        makeWorkerId("http://proxy/pool/worker-a"),
        "proxy_pool_worker-a",
      );
    });

    it("names the worker anyway when the address will not parse", function() {
      // A broken APP_DOC_INTERNAL_URL should name a worker and fail where the url is used,
      // rather than throwing out of startup.
      assert.equal(makeWorkerId("not a url"), "not-a-url");
    });
  });

  describe("LocalIdentity", function() {
    it("uses APP_DOC_INTERNAL_URL as given, without appending a tag", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocInternalUrl: "http://docs-1.internal:9999",
      }));
      assert.equal(identity.info.internalUrl, "http://docs-1.internal:9999");
      assert.equal(identity.addressSource, "APP_DOC_INTERNAL_URL");
    });

    it("falls back to APP_DOC_URL before working out an address of its own", async function() {
      // Kept so that upgrading does not silently move server-to-server traffic off a balancer.
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocUrl: "https://docs.example.com",
        redisLocalAddress: "10.9.9.9",
      }));
      assert.equal(identity.info.internalUrl, "https://docs.example.com/v/tag1/");
      assert.equal(identity.info.publicUrl, identity.info.internalUrl);
      assert.equal(identity.addressSource, "APP_DOC_URL");
    });

    it("names a worker after APP_DOC_URL, which reaches it and no other", async function() {
      // A client is routed to the worker holding a document through this url, so no two workers
      // share one. Several servers on one machine, told apart only by the path, is the shape that
      // naming them after the machine would have collapsed into a single worker.
      setHostname("ubuntu");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocUrl: "https://grist.example.com/dw/worker-1",
      }));
      assert.equal(identity.info.id, "grist.example.com_dw_worker-1");
    });

    it("keeps the version tag out of the name", async function() {
      // The public url has /v/<tag>/ appended and the tag changes with every build, so a name
      // taken from it would change on every deploy, orphaning the documents assigned to it.
      setHostname("docs-1");
      const appDocUrl = "https://docs.example.com/dw/worker-a";
      const before = await deriveDocWorkerIdentity(makeContext({ appDocUrl, tag: "tag1" }));
      const after = await deriveDocWorkerIdentity(makeContext({ appDocUrl, tag: "tag2" }));
      assert.equal(before.info.id, after.info.id);
      assert.notEqual(before.info.publicUrl, after.info.publicUrl);
    });

    it("refuses APP_DOC_URL in a fleet", async function() {
      setHostname("docs-1");
      await assert.isRejected(deriveDocWorkerIdentity(makeContext({
        appDocUrl: "https://docs.example.com",
        fleet: true,
      })), /APP_DOC_URL cannot be set with GRIST_FLEET/);
    });

    it("refuses APP_DOC_URL in a fleet even where it is unused", async function() {
      // APP_DOC_INTERNAL_URL takes precedence, so only the public url would have been wasted.
      // Refused anyway, so the rule does not depend on what else is set.
      setHostname("docs-1");
      await assert.isRejected(deriveDocWorkerIdentity(makeContext({
        appDocUrl: "https://docs.example.com",
        appDocInternalUrl: "http://docs-1.internal:9999",
        fleet: true,
      })), /APP_DOC_URL cannot be set with GRIST_FLEET/);
    });

    it("refuses an APP_DOC_URL that is not a url", async function() {
      setHostname("docs-1");
      await assert.isRejected(deriveDocWorkerIdentity(makeContext({
        appDocUrl: "localhost",
      })), /APP_DOC_URL is not a url/);
    });

    it("refuses an address with no subdomain where the home has one", async function() {
      // A client's request carries the base domain of the home address, and a worker address with
      // no subdomain to keep is rebuilt under it, naming a server that is not this one.
      setHostname("docs-1");
      await assert.isRejected(deriveDocWorkerIdentity(makeContext({
        appHomeUrl: "https://grist.example.com",
        appDocUrl: "https://grist.app",
      })), /APP_DOC_URL .* has no subdomain/);
    });

    it("allows an address with no subdomain where the home has none", async function() {
      // The ordinary self-hosted setup: one domain, orgs in the path, nothing to rebuild.
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appHomeUrl: "https://grist.app",
        appDocUrl: "https://grist.app",
      }));
      assert.equal(identity.info.publicUrl, "https://grist.app/v/tag1/");
    });

    it("allows a worker given a subdomain of its own", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appHomeUrl: "https://grist.example.com",
        appDocUrl: "https://docs-1.example.com",
      }));
      assert.equal(identity.info.publicUrl, "https://docs-1.example.com/v/tag1/");
    });

    it("allows a fleet that leaves APP_DOC_URL unset", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocInternalUrl: "http://docs-1.internal:9999",
        fleet: true,
      }));
      assert.equal(identity.info.id, "docs-1.internal_9999");
    });

    it("prefers APP_DOC_INTERNAL_URL over APP_DOC_URL", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocUrl: "https://docs.example.com",
        appDocInternalUrl: "http://docs-1.internal:9999",
      }));
      assert.equal(identity.info.internalUrl, "http://docs-1.internal:9999");
      assert.equal(identity.info.publicUrl, "https://docs.example.com/v/tag1/");
      assert.equal(identity.addressSource, "APP_DOC_INTERNAL_URL");
    });

    it("advertises the address the operator named, over one it could work out", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        // The bind resolved the name; peers are still told the name.
        gristHost: "docs-1.internal",
        boundAddress: "10.1.2.3",
        redisLocalAddress: "10.9.9.9",
      }));
      assert.equal(identity.info.internalUrl, "http://docs-1.internal:8484/");
      assert.equal(identity.addressSource, "GRIST_HOST");
    });

    it("does not name a server after a loopback address, however GRIST_HOST spelled it", async function() {
      // localhost, 127.1, 0x7f000001 and ip6-localhost all bind the same socket. Since the bind
      // resolves and canonicalizes, only the forms it hands back have to be recognized, and the
      // mapped one is not recognized at all: it falls through to the same answer.
      //
      // A usable Redis address is offered and has to be turned down: nothing is listening on it,
      // so a peer told to use it would be refused.
      setHostname("docs-1");
      for (const bound of ["127.0.0.1", "::1", "127.0.0.6", "::ffff:127.0.0.1"]) {
        const identity = await deriveDocWorkerIdentity(makeContext({
          gristHost: "localhost",
          boundAddress: bound,
          redisLocalAddress: "10.9.9.9",
        }));
        assert.equal(identity.addressSource, "none", `bound to ${bound}`);
        assert.equal(identity.info.id, "docs-1_8484", `bound to ${bound}`);
      }
    });

    it("takes every spelling of the unspecified address as listening everywhere", async function() {
      // What GRIST_HOST=0.0.0.0, ::0 and [::] all come back as. It asks to listen on every
      // interface rather than naming one, so which address to publish is still open.
      setHostname("docs-1");
      for (const bound of ["0.0.0.0", "::", "::ffff:0.0.0.0"]) {
        const identity = await deriveDocWorkerIdentity(makeContext({
          boundAddress: bound,
          redisLocalAddress: "10.9.9.9",
        }));
        assert.equal(identity.addressSource, "redis", `bound to ${bound}`);
        assert.equal(identity.info.internalUrl, "http://10.9.9.9:8484/", `bound to ${bound}`);
      }
    });

    it("falls back to GRIST_HOST where this process does not hold the socket", async function() {
      // Under the restart shell the socket belongs to the parent, which passes down what it bound.
      // Without that, GRIST_HOST is the same value the socket was bound with, only unresolved,
      // and an address still classifies.
      setHostname("docs-1");
      const listening = await deriveDocWorkerIdentity(makeContext({
        boundAddress: undefined,
        redisLocalAddress: "10.9.9.9",
      }));
      assert.equal(listening.addressSource, "redis");

      const loopback = await deriveDocWorkerIdentity(makeContext({
        gristHost: "127.1",
        boundAddress: undefined,
      }));
      assert.equal(loopback.addressSource, "none");
      assert.equal(loopback.info.id, "docs-1_8484");
    });

    it("prefers the Redis-facing address when listening everywhere", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        redisLocalAddress: "10.9.9.9",
      }));
      assert.equal(identity.info.internalUrl, "http://10.9.9.9:8484/");
      assert.equal(identity.addressSource, "redis");
    });

    it("ignores the address when Redis is reached through a neighbor", async function() {
      // A proxy in the same pod adding TLS to a managed Redis, or a service mesh intercepting the
      // connection: the address reaches that neighbor, and every pod has the same one.
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        redisLocalAddress: "127.0.0.1",
      }));
      assert.equal(identity.addressSource, "none");
      assert.equal(identity.info.internalUrl, "http://localhost:8484/");
      assert.equal(identity.info.id, "docs-1_8484");
    });

    it("gives two servers behind such a neighbor distinct ids", async function() {
      // The point of ignoring it: taken at face value it would name every pod 127.0.0.1_8484.
      const context = { redisLocalAddress: "127.0.0.1" };
      setHostname("machine-a");
      const first = await deriveDocWorkerIdentity(makeContext(context));
      setHostname("machine-b");
      const second = await deriveDocWorkerIdentity(makeContext(context));
      assert.notEqual(first.info.id, second.info.id);
    });

    it("ignores an address that is nobody's in particular", async function() {
      // Link-local means nothing off its own link; multicast and broadcast are no server's
      // address at all. None could be published for a peer to dial.
      setHostname("docs-1");
      for (const address of ["fe80::1%eth0", "224.0.0.1", "ff02::1", "255.255.255.255"]) {
        const identity = await deriveDocWorkerIdentity(makeContext({
          redisLocalAddress: address,
        }));
        assert.equal(identity.addressSource, "none", `reaching Redis from ${address}`);
      }
    });

    it("reports loopback when Redis offers no hint, rather than picking an interface", async function() {
      // Whichever interface reaches a peer is not a local fact, so there is nothing left to say.
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext());
      assert.equal(identity.info.internalUrl, "http://localhost:8484/");
      assert.equal(identity.addressSource, "none");
    });

    it("names the worker after its machine when it has no address to be named after", async function() {
      // The whole name, since machines that differ only in their domain are still different
      // machines.
      setHostname("docs-1.dc1.example.com");
      const identity = await deriveDocWorkerIdentity(makeContext());
      assert.equal(identity.info.id, "docs-1.dc1.example.com_8484");
    });

    it("brackets IPv6 addresses so the url parses", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        redisLocalAddress: "fd00::1",
      }));
      assert.equal(identity.info.internalUrl, "http://[fd00::1]:8484/");
      // Node keeps the brackets in hostname; what matters is that the url parses and keeps the port.
      assert.equal(new URL(identity.info.internalUrl).hostname, "[fd00::1]");
      assert.equal(new URL(identity.info.internalUrl).port, "8484");
    });

    it("respects a configured worker id", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({ docWorkerId: "worker1" }));
      assert.equal(identity.info.id, "worker1");
    });

    it("names itself after the machine when it has only a loopback address", async function() {
      // Loopback is the same string on every machine, so using it as identity would give a whole
      // deployment one id, disarming the checks against opening a document twice.
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext(gristHostUnset()));
      assert.equal(identity.addressSource, "none");
      assert.equal(identity.info.internalUrl, "http://localhost:8484/");
      assert.equal(identity.info.id, "docs-1_8484");
      assert.notInclude(identity.info.id, "localhost");
    });

    it("gives two loopback-only servers distinct ids", async function() {
      // The default bare-metal shape: GRIST_HOST unset, so both publish the same useless address.
      setHostname("machine-a");
      const first = await deriveDocWorkerIdentity(makeContext(gristHostUnset()));
      setHostname("machine-b");
      const second = await deriveDocWorkerIdentity(makeContext(gristHostUnset()));
      assert.equal(first.info.internalUrl, second.info.internalUrl);
      assert.notEqual(first.info.id, second.info.id);
    });

    it("derives an id from the internal address when none is configured", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        redisLocalAddress: "10.1.2.3",
      }));
      assert.equal(identity.info.internalUrl, "http://10.1.2.3:8484/");
      assert.equal(identity.info.id, "10.1.2.3_8484");
    });

    it("gives two servers on one port distinct ids", async function() {
      // The original defect: a port-derived id made two servers on different machines one worker.
      setHostname("docs-1");
      const first = await deriveDocWorkerIdentity(makeContext(boundTo("10.1.2.3")));
      const second = await deriveDocWorkerIdentity(makeContext(boundTo("10.1.2.4")));
      assert.equal(first.info.id, "10.1.2.3_8484");
      assert.equal(second.info.id, "10.1.2.4_8484");
    });

    it("takes the id from a configured internal url, so it names where peers go", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocInternalUrl: "http://docs-1.internal:9999",
      }));
      assert.equal(identity.info.id, "docs-1.internal_9999");
    });

    it("keeps the public url separate from the internal one", async function() {
      // Neither configured: the public url stays as the server sees itself, the internal one
      // becomes an address a peer could use.
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        redisLocalAddress: "10.1.2.3",
      }));
      assert.equal(identity.info.publicUrl, "http://localhost:8484/v/tag1/");
      assert.equal(identity.info.internalUrl, "http://10.1.2.3:8484/");
    });
  });

  describe("an identity allocated by GRIST_ROUTER_URL", function() {
    it("takes its name and both urls from the url allocated to it", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        createWorkerUrl: async () => ({
          url: "https://docworker-17.example.com", host: "docworker-17",
        }),
      }));
      assert.equal(identity.info.id, "docworker-17");
      assert.equal(identity.info.publicUrl, "https://docworker-17.example.com/v/tag1/");
      assert.equal(identity.info.internalUrl, identity.info.publicUrl);
      assert.equal(identity.addressSource, "GRIST_ROUTER_URL");
    });

    it("ignores a configured worker id, since it has already been named", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        docWorkerId: "ignored",
        createWorkerUrl: async () => ({
          url: "https://docworker-17.example.com", host: "docworker-17",
        }),
      }));
      assert.equal(identity.info.id, "docworker-17");
    });
  });

  describe("whether the public url is a guess", function() {
    // A client is sent to that url to reach a document, so whether anything outside can be
    // expected to reach it there decides whether the client is sent at all.
    it("is a guess where nobody named this server", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext());
      assert.equal(identity.info.publicUrl, "http://localhost:8484/v/tag1/");
      assert.isTrue(identity.publicUrlIsGuessed);
    });

    it("is not a guess where APP_DOC_URL named it", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocUrl: "https://docs-1.example.com",
      }));
      assert.isFalse(identity.publicUrlIsGuessed);
    });

    it("is not a guess where a router allocated it", async function() {
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        createWorkerUrl: async () => ({
          url: "https://docworker-17.example.com", host: "docworker-17",
        }),
      }));
      assert.isFalse(identity.publicUrlIsGuessed);
    });

    it("is a guess where only the address peers use was named", async function() {
      // APP_DOC_INTERNAL_URL is for reaching this server from inside, and says nothing about how
      // the outside world does.
      setHostname("docs-1");
      const identity = await deriveDocWorkerIdentity(makeContext({
        appDocInternalUrl: "http://docs-1.internal:8484",
      }));
      assert.isTrue(identity.publicUrlIsGuessed);
    });
  });

  describe("the hint the derived address rests on", function() {
    // getRedisLocalAddress reads client.stream.localAddress, an internal of node_redis that Grist
    // declares by hand. Were an upgrade to move it, every unconfigured fleet would fall back to
    // loopback, and no other test would notice, since they all reach Redis over loopback anyway.
    it("is still where we read it from", async function() {
      if (!process.env.TEST_REDIS_URL) { return this.skip(); }
      const client = createClient(process.env.TEST_REDIS_URL);
      try {
        // Unspoken to, so this also covers the ping the helper does to bring the socket up.
        assert.isNotEmpty(await getRedisLocalAddress(client));
      } finally {
        await client.quitAsync();
      }
    });

    it("has no address to offer without a client", async function() {
      assert.isUndefined(await getRedisLocalAddress(null));
    });
  });
});
