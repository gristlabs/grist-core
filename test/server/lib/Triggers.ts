import { DocAPI, UserAPI } from "app/common/UserAPI";
import { DocTriggers } from "app/server/lib/Triggers";
import { TestServer } from "test/gen-server/apiUtils";
import { configForUser } from "test/gen-server/testUtils";
import { Defer, serveSomething, Serving } from "test/server/customUtil";
import { createTmpDir } from "test/server/docTools";
import * as testUtils from "test/server/testUtils";

import axios from "axios";
import { assert } from "chai";
import pick from "lodash/pick";
import * as sinon from "sinon";

describe("Triggers", function() {
  let server: TestServer;
  let serverUrl: string;
  let ownerApi: UserAPI;
  let wsId: number;
  testUtils.setTmpLogLevel("error");
  let oldEnv: testUtils.EnvironmentSnapshot;
  let serving: Serving;  // manages the test webhook server
  const chimpy = configForUser("Chimpy");
  this.timeout("10s");
  let sandbox: sinon.SinonSandbox;
  // Helper to wait for events to be enqueued.
  class EventAwaiter {
    private _defer: Defer<number> | null = new Defer<number>();
    public start() {
      this._defer = new Defer<number>();
    }

    public wait() {
      assert.isOk(this._defer, "Waiter not started");
      return this._defer;
    }

    public enqueueCalled(numEvents: number) {
      if (!this._defer) {
        return;  // not waiting
      }
      this._defer.resolve(numEvents);
    }
  }
  const waiter = new EventAwaiter();

  before(async function() {
    if (!process.env.REDIS_URL && !process.env.TEST_REDIS_URL) {
      this.skip();  // skip if no redis available
    }

    oldEnv = new testUtils.EnvironmentSnapshot();
    // Store data in a temporary directory
    process.env.GRIST_DATA_DIR = await createTmpDir();
    // Allow any webhook domain
    process.env.ALLOWED_WEBHOOK_DOMAINS = "*";
    // Use the TEST_REDIS_URL as the global redis url, if supplied.
    if (process.env.TEST_REDIS_URL && !process.env.REDIS_URL) {
      process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    }

    // Lets hijack the DocTriggers.enqueue to detect when the events are pushed to the queue (or no
    // events to be pushed).
    server = new TestServer(this);
    sandbox = sinon.createSandbox();
    const oldEnqueue = DocTriggers.prototype.enqueue;
    sandbox.replace(DocTriggers.prototype, "enqueue", async function(this: DocTriggers, events: any[]) {
      // This function is called even if there are no events to enqueue.
      try {
        return await oldEnqueue.call(this as any, events as any);
      } finally {
        waiter.enqueueCalled(events.length);
      }
    });

    // Start doc and home server
    serverUrl = await server.start(["home", "docs"]);

    // Create a team site for testing (don't check access as org is not there yet)
    ownerApi = await server.createHomeApi("chimpy", "testy", true, false);
    await ownerApi.newOrg({ name: "testy", domain: "testy" });

    // Create new workspace (finding Home workspace is harder :) )
    wsId = await ownerApi.newWorkspace({ name: "ws" }, "current");

    // Serve something so that webhooks are not failing due to connection errors.
    serving = await serveSomething((app) => {
      app.use((_, res) => res.sendStatus(200));
    });
  });

  after(async function() {
    await server.stop();
    oldEnv.restore();
    await serving.shutdown();
    sandbox.restore();
  });

  async function autoSubscribe(
    docId: string, options?: {
      tableId?: string,
      isReadyColumn?: string | null,
      eventTypes?: string[]
      watchedColIds?: string[],
      condition?: string,
    }) {
    // Subscribe helper that returns a method to unsubscribe.
    const webhook = await subscribe(docId, options);
    return () => unsubscribe(docId, webhook.id);
  }

  function unsubscribe(docId: string, webhookId: string) {
    return axios.delete(
      `${serverUrl}/api/docs/${docId}/webhooks/${webhookId}`,
      chimpy,
    );
  }

  async function subscribe(docId: string, options?: {
    tableId?: string,
    isReadyColumn?: string | null,
    eventTypes?: string[],
    watchedColIds?: string[],
    condition?: string,
    name?: string,
    memo?: string,
    enabled?: boolean,
  }) {
    // Subscribe helper that returns a method to unsubscribe.
    const { data, status } = await axios.post(`${serverUrl}/api/docs/${docId}/webhooks`, {
      webhooks: [{
        fields: {
          tableId: options?.tableId ?? "Table1",
          eventTypes: options?.eventTypes ?? ["add", "update"],
          url: `${serving.url}/data`,
          isReadyColumn: options?.isReadyColumn,
          ...pick(options, "name", "memo", "enabled", "watchedColIds", "condition"),
        },
      }],
    }, chimpy);
    assert.equal(status, 200, `Error during subscription: ` + JSON.stringify(data));
    const [webhook] = data.webhooks;
    assert.isOk(webhook?.id, `Missing webhook id in response: ` + JSON.stringify(data));
    return webhook;
  }

  async function clearQueue(docId: string) {
    const deleteResult = await axios.delete(
      `${serverUrl}/api/docs/${docId}/webhooks/queue`, chimpy,
    );
    assert.equal(deleteResult.status, 200);
  }

  describe("conditions", function() {
    let docId: string;
    let doc: DocAPI;
    this.timeout("10s");

    before(async function() {
      docId = await ownerApi.newDoc({ name: "testdoc" }, wsId);
      doc = ownerApi.getDocAPI(docId);
    });

    afterEach(async function() {
      await doc.flushWebhooks();
      await clearQueue(docId);
      await doc.applyUserActions([
        ["RemoveRecord", "_grist_Triggers", 1],
      ]);
      await doc.applyUserActions([
        ["RemoveRecord", "Table1", 1],
      ]);
    });

    // Plain smoke test that conditions somehow works.
    it("should support custom expression", async function() {
      const clear = await autoSubscribe(docId, {
        tableId: "Table1",
        condition: "$A > 10",
      });

      // Add a record to the table
      await notCalled(async () => {
        await doc.addRows("Table1", {
          A: [1],
        });
      });

      // Update this record to meet the condition
      await called(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [11],
        });
      });
      await clear();
    });

    const called = async (fn: () => Promise<any>) => {
      waiter.start();
      await fn();
      assert.equal(await waiter.wait(), 1, "Should have processed one event");
    };

    const notCalled = async (fn: () => Promise<any>) => {
      waiter.start();
      await fn();
      assert.equal(await waiter.wait(), 0, "Should have processed one event");
    };

    it("should see previous record values in condition", async function() {
      const clear = await autoSubscribe(docId, {
        tableId: "Table1",
        condition: "oldRec.A == 1 and oldRec.B == 2",
      });

      // Not called, this is new row.
      await notCalled(async () => {
        await doc.addRows("Table1", {
          A: [1],
          B: [2],
        });
      });

      // Called, oldRec matches.
      await called(() => doc.updateRows("Table1", {
        id: [1],
        A: [3],
      }));

      // Not called still, old rec does not match.
      await notCalled(() => doc.updateRows("Table1", {
        id: [1],
        A: [1],
      }));

      // Now called, old rec matches again.
      await called(() => doc.updateRows("Table1", {
        id: [1],
        B: [5],
      }));

      await clear();
    });

    it("should detect that this was a new row", async function() {
      const clear = await autoSubscribe(docId, {
        tableId: "Table1",
        condition: "not oldRec.id",
      });

      // Called, this is new row.
      await called(async () => {
        await doc.addRows("Table1", {
          A: [1],
          B: [2],
        });
      });

      // Not called, this is an update.
      await notCalled(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [3],
        });
      });

      await clear();
    });

    it("should detect that column was empty", async function() {
      const clear = await autoSubscribe(docId, {
        tableId: "Table1",
        condition: "not oldRec.A",
      });

      // Called, this is new row.
      await called(async () => {
        await doc.addRows("Table1", {
          A: [10],
          B: [20],
        });
      });

      // Not called, this is an update.
      await notCalled(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [30],
        });
      });

      // But it will be called after the record is removed and re-added.
      await notCalled(async () => {
        await doc.applyUserActions([
          ["RemoveRecord", "Table1", 1],
        ]);
      });

      await called(async () => {
        await doc.addRows("Table1", {
          A: [10],
          B: [20],
        });
      });

      // And will be called again if we clear record and fill again.
      await notCalled(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [null],
        });
      });

      await called(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [10],
        });
      });

      await clear();
    });

    it("should have access columns not modified in action", async function() {
      const clear = await autoSubscribe(docId, {
        tableId: "Table1",
        condition: "oldRec.B == 2",
      });

      // Not called this is a new row.
      await notCalled(async () => {
        await doc.addRows("Table1", {
          A: [1],
          B: [2],
        });
      });

      // Now update A should be called.
      await called(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [10],
        });
      });

      // Sanity check that engine does ignore same update.
      await notCalled(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [10],
        });
      });

      await clear();
    });

    it("should have access to new rec columns not modified in action", async function() {
      const clear = await autoSubscribe(docId, {
        tableId: "Table1",
        condition: "rec.B == 3",
      });

      // Called for a new row that matches.
      await called(async () => {
        await doc.addRows("Table1", {
          A: [1],
          B: [3],
        });
      });

      // Not called when that row is removed.
      await notCalled(async () => {
        await doc.applyUserActions([
          ["RemoveRecord", "Table1", 1],
        ]);
      });

      // Not called for the new row that does not match.
      await notCalled(async () => {
        await doc.addRows("Table1", {
          A: [10],
          B: [2],
        });
      });

      // Called after updating column in test to match.
      await called(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          B: [3],
        });
      });

      // Called when updating other column but this column still matches.
      await called(async () => {
        await doc.updateRows("Table1", {
          id: [1],
          A: [20],
        });
      });

      await clear();
    });
  });
});
