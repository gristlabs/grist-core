import {
  countServerHealth,
  describeServerHealth,
  diagnoseMultiServer,
  isMultiServerInstallation,
  judgeSituation,
  knownServerCount,
  MultiServerBootProbeDetails,
  MultiServerDescription,
  MultiServerEntry,
} from "app/common/BootProbe";

import { assert } from "chai";

describe("BootProbe", function() {
  describe("describeServerHealth", function() {
    function entry(overrides: Partial<MultiServerEntry> = {}): MultiServerEntry {
      return {
        id: "10.1.2.3-8484",
        internalUrl: "http://10.1.2.3:8484/v/tag1/",
        available: true,
        documentCount: 0,
        self: false,
        alive: true,
        ...overrides,
      };
    }

    it("faults a server sharing an address, ahead of everything else", function() {
      // Whichever server answers there answers for all of them, so nothing recorded against them
      // can be trusted -- including the rest of what this function looks at.
      assert.equal(describeServerHealth(entry({
        workerIdsSharingAddress: ["other"], alive: false, available: false,
      })), "shared-address");
    });

    it("ignores an empty shared-address list", function() {
      assert.equal(describeServerHealth(entry({ workerIdsSharingAddress: [] })), "ok");
    });

    it("faults a server that has stopped saying it is running", function() {
      assert.equal(describeServerHealth(entry({ alive: false })), "stale");
    });

    it("prefers a server having stopped over anything else about it", function() {
      // A server that has gone is gone whether or not it was draining when it went.
      assert.equal(describeServerHealth(entry({ alive: false, available: false })), "stale");
    });

    it("warns about a server that is running but not taking documents", function() {
      assert.equal(describeServerHealth(entry({ available: false })), "unavailable");
    });

    it("counts each server once, under the reason that applies to it", function() {
      const count = countServerHealth([
        entry({ id: "a" }),
        entry({ id: "b", alive: false }),
        entry({ id: "c", available: false }),
        entry({ id: "d", alive: false, available: false }),
      ]);
      assert.equal(count("ok"), 1);
      assert.equal(count("stale"), 2);
      assert.equal(count("unavailable"), 1);
      assert.equal(count("shared-address"), 0);
    });
  });

  describe("diagnoseMultiServer", function() {
    function entry(overrides: Partial<MultiServerEntry> = {}): MultiServerEntry {
      return {
        id: "worker", internalUrl: "http://10.1.2.3:8484/", available: true,
        documentCount: 0, self: false, alive: true, ...overrides,
      };
    }

    function description(overrides: Partial<MultiServerDescription> = {}): MultiServerDescription {
      const servers = overrides.servers ?? [entry()];
      return {
        kind: "worker-pool",
        registeredServerCount: servers.length,
        selfRegistered: true,
        servers,
        fleet: { included: true, active: false },
        ...overrides,
      };
    }

    it("reports one server with no pool as such", function() {
      assert.equal(diagnoseMultiServer(description({ kind: "single-server" })), "single-server");
    });

    it("reports an empty pool as a fault, whatever the activation key says", function() {
      // Ahead of licensing: no document can be opened anywhere, which is not a fault to answer
      // with a note about activation keys.
      assert.equal(diagnoseMultiServer(description({
        servers: undefined, registeredServerCount: 0, fleet: { included: false, active: false },
      })), "no-workers");
    });

    it("says a key is missing rather than reporting a pool it never looked at", function() {
      assert.equal(diagnoseMultiServer(description({
        servers: undefined, registeredServerCount: 2, fleet: { included: false, active: false },
      })), "unlicensed");
    });

    it("puts a shared address ahead of everything else", function() {
      assert.equal(diagnoseMultiServer(description({
        servers: [
          entry({ id: "a", workerIdsSharingAddress: ["b"] }),
          entry({ id: "b", workerIdsSharingAddress: ["a"], alive: false }),
        ],
      })), "shared-addresses");
    });

    it("reports servers that have stopped saying they are running", function() {
      assert.equal(diagnoseMultiServer(description({
        servers: [entry({ id: "a" }), entry({ id: "b", alive: false })],
      })), "stale-registrations");
    });

    it("does not raise a draining server to a fault about the installation", function() {
      // What every rolling restart looks like. The row still says which servers are draining.
      assert.equal(diagnoseMultiServer(description({
        servers: [entry({ id: "a" }), entry({ id: "b", available: false })],
      })), "healthy");
    });

    it("reports a fleet with no proxy behind it", function() {
      assert.equal(diagnoseMultiServer(description({
        kind: "fleet", fleet: { included: true, active: false },
      })), "no-proxy");
    });

    it("calls a pool of registered, available servers healthy", function() {
      assert.equal(diagnoseMultiServer(description({
        servers: [entry({ id: "a" }), entry({ id: "b" })],
      })), "healthy");
    });

    it("judges every situation without naming a server", function() {
      // The verdict is one sentence for a script and for the Self Checks row; which servers are
      // affected is the panel's job, beside the list it is about.
      const servers = [
        entry({ id: "grist-docs-1", alive: false }),
        entry({ id: "grist-docs-2" }),
      ];
      for (const details of [
        description({ kind: "single-server" }),
        description({ servers: [], registeredServerCount: 0 }),
        description({ servers: undefined, registeredServerCount: 2, fleet: { included: false, active: false } }),
        description({ servers }),
        description({ kind: "fleet", servers: [entry()] }),
      ]) {
        const { verdict } = judgeSituation(diagnoseMultiServer(details), details);
        assert.notInclude(verdict ?? "", "grist-docs-1");
        assert.notInclude(verdict ?? "", "http://");
      }
    });

    it("counts the registered servers, not the listed ones, when unlicensed", function() {
      // The list is absent without the feature; the count is what the installation actually has.
      const details = description({
        servers: undefined, registeredServerCount: 3, fleet: { included: false, active: false },
      });
      assert.include(judgeSituation("unlicensed", details).verdict ?? "", "3 servers");
    });
  });

  /**
   * What decides whether the admin panel says anything about the servers at all. Kept beside the
   * diagnosis rather than in the panel, so the warning above the settings and the Servers row
   * cannot come to different conclusions about the same installation.
   */
  describe("isMultiServerInstallation", function() {
    function entry(id: string): MultiServerEntry {
      return {
        id, internalUrl: `http://${id}:8484/`, available: true,
        documentCount: 0, self: false, alive: true,
      };
    }

    function details(overrides: Partial<MultiServerBootProbeDetails>): MultiServerBootProbeDetails {
      const servers = overrides.servers ?? [];
      const rest = {
        kind: "worker-pool" as const,
        registeredServerCount: servers.length,
        selfRegistered: true,
        servers,
        fleet: { included: true, active: false },
        ...overrides,
      };
      return { ...rest, situation: overrides.situation ?? diagnoseMultiServer(rest) };
    }

    it("says nothing about an installation with no pool at all", function() {
      assert.isFalse(isMultiServerInstallation(details({ kind: "single-server" })));
    });

    it("says nothing about a lone server that holds its own documents", function() {
      // A merged server with REDIS_URL set, which plenty of single-server installs have just for
      // caching. It has no peers to report on, and telling it to configure its servers through
      // the environment would be advice about an installation it is not running.
      assert.isFalse(isMultiServerInstallation(details({ servers: [entry("a")] })));
    });

    it("counts the server answering, where it holds no documents itself", function() {
      // A home server and one doc worker is two servers, not one, even though only one of them
      // is registered anywhere.
      assert.isTrue(isMultiServerInstallation(details({
        servers: [entry("a")], selfRegistered: false,
      })));
    });

    it("counts servers it was not allowed to list", function() {
      // Without the fleet feature the servers are never fetched, so the count is all there is.
      assert.isTrue(isMultiServerInstallation(details({
        registeredServerCount: 2, fleet: { included: false, active: false },
      })));
    });

    it("reports a pool with nothing in it, though that is one server", function() {
      // No document can be opened anywhere, which is exactly what an admin needs telling.
      const empty = details({ servers: [], registeredServerCount: 0, selfRegistered: false });
      assert.equal(empty.situation, "no-workers");
      assert.isTrue(isMultiServerInstallation(empty));
    });

    it("agrees with the warning shown above the settings", function() {
      // Both read knownServerCount, so the only case where they part company is the empty pool.
      for (const shown of [
        details({ kind: "single-server" }),
        details({ servers: [entry("a")] }),
        details({ servers: [entry("a"), entry("b")] }),
        details({ servers: [entry("a")], selfRegistered: false }),
      ]) {
        assert.equal(isMultiServerInstallation(shown), knownServerCount(shown) > 1,
          `disagreed about ${shown.situation}`);
      }
    });
  });
});
