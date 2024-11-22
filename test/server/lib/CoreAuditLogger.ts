import { AuditLogger, Deps, IAuditLogger } from "app/server/lib/AuditLogger";
import { configureCoreAuditLogger } from "app/server/lib/configureCoreAuditLogger";
import axios from "axios";
import { assert } from "chai";
import nock from "nock";
import * as sinon from "sinon";
import { TestServer } from "test/gen-server/apiUtils";
import { configForUser } from "test/gen-server/testUtils";
import {
  ignoreConfigEvents,
  isCreateDocumentEvent,
  isCreateSiteEvent,
} from "test/server/lib/helpers/AuditLoggerUtils";
import { EnvironmentSnapshot, setTmpLogLevel } from "test/server/testUtils";
import { waitForIt } from "test/server/wait";

const MAX_CONCURRENT_REQUESTS = 10;

describe("CoreAuditLogger", function () {
  this.timeout("10s");
  setTmpLogLevel("error");

  let oldEnv: EnvironmentSnapshot;
  let server: TestServer;
  let homeUrl: string;
  let auditLogger: IAuditLogger;
  let oid: number;

  const sandbox: sinon.SinonSandbox = sinon.createSandbox();
  const chimpy = configForUser("Chimpy");
  const chimpyEmail = "chimpy@getgrist.com";

  before(async function () {
    oldEnv = new EnvironmentSnapshot();
    process.env.TYPEORM_DATABASE = ":memory:";
    process.env.GRIST_DEFAULT_EMAIL = chimpyEmail;
    sandbox.stub(Deps, "CACHE_TTL_MS").value(0);
    sandbox
      .stub(Deps, "MAX_CONCURRENT_REQUESTS")
      .value(MAX_CONCURRENT_REQUESTS);
    server = new TestServer(this);
    homeUrl = await server.start();
    oid = (await server.dbManager.testGetId("NASA")) as number;
  });

  beforeEach(async function () {
    auditLogger = configureCoreAuditLogger(server.dbManager);

    ignoreConfigEvents();
  });

  after(async function () {
    sandbox.restore();
    oldEnv.restore();
    await server.stop();
  });

  afterEach(async function () {
    nock.abortPendingRequests();
    nock.cleanAll();
    await auditLogger.close();
  });

  it("streams installation events to a single destination", async function () {
    await axios.put(
      `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
      [
        {
          id: "62c9ed25-1195-48e7-a9f6-0ba164128c20",
          name: "other",
          url: "https://audit.example.com/events/install",
          token: "Bearer a6c8c7fd-b1d7-431e-8d64-3302f7ea0d74",
        },
      ],
      chimpy
    );
    const scope = nock("https://audit.example.com")
      .post("/events/install", (body) => isCreateSiteEvent(body))
      .matchHeader(
        "Authorization",
        "Bearer a6c8c7fd-b1d7-431e-8d64-3302f7ea0d74"
      )
      .reply(200);

    await assert.isFulfilled(
      auditLogger.logEventOrThrow(null, {
        action: "site.create",
        details: {
          site: {
            id: 42,
            name: "Grist Labs",
            domain: "gristlabs",
          },
        },
      })
    );
    assert.isTrue(scope.isDone());
  });

  it("streams installation events to multiple destinations", async function () {
    await axios.put(
      `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
      [
        {
          id: "62c9ed25-1195-48e7-a9f6-0ba164128c20",
          name: "other",
          url: "https://audit.example.com/events/install",
          token: "Bearer a6c8c7fd-b1d7-431e-8d64-3302f7ea0d74",
        },
        {
          id: "4f174ff7-4f56-45c7-b557-712168f7cbec",
          name: "other",
          url: "https://audit.example.com/events/install2",
        },
      ],
      chimpy
    );
    const scope = nock("https://audit.example.com")
      .post("/events/install", (body) => isCreateDocumentEvent(body, oid))
      .matchHeader(
        "Authorization",
        "Bearer a6c8c7fd-b1d7-431e-8d64-3302f7ea0d74"
      )
      .reply(200)
      .post("/events/install2", (body) => isCreateDocumentEvent(body, oid))
      .reply(200);

    await assert.isFulfilled(
      auditLogger.logEventOrThrow(null, {
        action: "document.create",
        context: {
          site: {
            id: oid,
          },
        },
        details: {
          document: {
            id: "mRM8ydxxLkc6Ewo56jsDGx",
            name: "Project Lollipop",
          },
        },
      })
    );
    assert.isTrue(scope.isDone());
  });

  // TODO: Unskip when team audit logs are enabled.
  it.skip("streams installation and site events to a single destination", async function () {
    await axios.put(
      `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
      [
        {
          id: "62c9ed25-1195-48e7-a9f6-0ba164128c20",
          name: "other",
          url: "https://audit.example.com/events/install",
          token: "Bearer a6c8c7fd-b1d7-431e-8d64-3302f7ea0d74",
        },
      ],
      chimpy
    );
    await axios.put(
      `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
      [
        {
          id: "68e44fae-6684-4487-9bef-e42870ffcfc1",
          name: "other",
          url: "https://audit.example.com/events/site",
          token: "Bearer 6f1003e8-3d33-4d45-8a0c-54bcb2a155f1",
        },
      ],
      chimpy
    );
    const scope = nock("https://audit.example.com")
      .post("/events/install", (body) => isCreateDocumentEvent(body, oid))
      .matchHeader(
        "Authorization",
        "Bearer a6c8c7fd-b1d7-431e-8d64-3302f7ea0d74"
      )
      .reply(200)
      .post("/events/site", (body) => isCreateDocumentEvent(body, oid))
      .matchHeader(
        "Authorization",
        "Bearer 6f1003e8-3d33-4d45-8a0c-54bcb2a155f1"
      )
      .reply(200);

    await assert.isFulfilled(
      auditLogger.logEventOrThrow(null, {
        action: "document.create",
        context: {
          site: {
            id: oid,
          },
        },
        details: {
          document: {
            id: "mRM8ydxxLkc6Ewo56jsDGx",
            name: "Project Lollipop",
          },
        },
      })
    );
    assert.isTrue(scope.isDone());
  });

  it("throws when a streaming destination returns a non-2XX response", async function () {
    const scope = nock("https://audit.example.com")
      .post("/events/install")
      .reply(200)
      .post("/events/install2")
      .reply(400, "Bad request");

    await assert.isRejected(
      auditLogger.logEventOrThrow(null, {
        action: "document.create",
        context: {
          site: {
            id: oid,
          },
        },
        details: {
          document: {
            id: "mRM8ydxxLkc6Ewo56jsDGx",
            name: "Project Lollipop",
          },
        },
      }),
      /encountered errors while streaming audit event/
    );
    assert.isTrue(scope.isDone());
  });

  it("throws when max concurrent requests is exceeded", async function () {
    nock("https://audit.example.com")
      .persist()
      .post(/\/events\/.*/)
      .delay(1000)
      .reply(200);

    // Queue up enough requests so that the next `logEvent` call exceeds the
    // concurrent requests limit; each call creates 2 requests, one for each
    // destination.
    for (let i = 0; i <= 4; i++) {
      void auditLogger.logEventOrThrow(null, {
        action: "document.create",
        context: {
          site: {
            id: oid,
          },
        },
        details: {
          document: {
            id: "mRM8ydxxLkc6Ewo56jsDGx",
            name: "Project Lollipop",
          },
        },
      });
    }

    await assert.isRejected(
      auditLogger.logEventOrThrow(null, {
        action: "document.create",
        context: {
          site: {
            id: oid,
          },
        },
        details: {
          document: {
            id: "mRM8ydxxLkc6Ewo56jsDGx",
            name: "Project Lollipop",
          },
        },
      }),
      /encountered errors while streaming audit event/
    );
  });

  describe("closes resources properly", function () {
    before(async function () {
      // Create the AuditLogger instance that we will close eventually.
      logger = configureCoreAuditLogger(server.dbManager);

      ignoreConfigEvents();

      // Wire up the destinations.
      await axios.put(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        [
          {
            id: "62c9e725-1195-48e7-a9f6-0ba164128c20",
            name: "other",
            url: "https://audit.example.com/events/install",
          },
        ],
        chimpy
      );
    });

    afterEach(function () {
      nock.cleanAll();
    });

    after(async function () {
      await logger.close();
    });

    // Start the first test. We test here that audit logger properly clears its queue, without
    // closing.
    it("on its own", async function () {
      // Start a scope to track the requests.
      const firstScope = installScope();

      // Fire up MAX_CONCURRENT_REQUESTS events to test the logger.
      repeat(sendEvent);

      // Ensure the scope is done.
      await waitForIt(
        () => assert.isTrue(firstScope.isDone(), "Scope should be done"),
        1000,
        10
      );

      // When the scope is done, the logger should clear all the pending requests, as they
      // are done (event the destination fetchers)
      await waitForIt(() => assert.equal(logger.length(), 0), 1000, 10);
    });

    // Now test the same but by closing the logger.
    it("when closed", async function () {
      // Start a scope to track the requests.
      const secondScope = installScope();

      // Send all events (without waiting for the result)
      repeat(sendEvent);

      // Now close the logger and wait for all created promises to resolve.
      await logger.close();

      // Scope should be done.
      assert.isTrue(secondScope.isDone());

      // And the logger should have cleared all the pending requests.
      assert.equal(logger.length(), 0);
    });

    // Dummy destination creator.
    const installScope = () =>
      nock("https://audit.example.com")
        .post("/events/install")
        .times(MAX_CONCURRENT_REQUESTS)
        .reply(200);

    // The AuditLogger instance that we will close eventually.
    let logger: AuditLogger;

    // Helper to send events.
    const sendEvent = () =>
      logger.logEvent(null, {
        action: "site.create",
        details: {
          site: {
            id: oid,
            name: "Grist Labs",
            domain: "gristlabs",
          },
        },
      });
  });
});

function repeat(fn: (i: number) => void) {
  for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
    fn(i);
  }
}
