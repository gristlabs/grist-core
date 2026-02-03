/**
 * Tests for webhook operations:
 * - GET /docs/{did}/webhooks
 * - POST /docs/{did}/webhooks
 * - PATCH /docs/{did}/webhooks/{wid}
 * - DELETE /docs/{did}/webhooks/{wid}
 * - DELETE /docs/{did}/webhooks/queue
 * - POST /docs/{did}/tables/{tid}/_subscribe (legacy)
 * - POST /docs/{did}/tables/{tid}/_unsubscribe (legacy)
 *
 * Tests run in multiple server configurations:
 * - Merged server (home + docs in one process)
 * - Separated servers (home + docworker, requires Redis)
 * - Direct to docworker (requires Redis)
 */

import { delay } from "app/common/delay";
import { arrayRepeat } from "app/common/gutil";
import { WebhookSummary } from "app/common/Triggers";
import { UserAPI, UserAPIImpl } from "app/common/UserAPI";
import { DocAPI } from "app/common/UserAPI";
import {
  docApiUsagePeriods,
  docPeriodicApiUsageKey,
  getDocApiUsageKeysToIncr,
} from "app/server/lib/DocApi";
import { delayAbort } from "app/server/lib/serverUtils";
import { testDailyApiLimitFeatures } from "test/gen-server/seed";
import { configForUser } from "test/gen-server/testUtils";
import { serveSomething, Serving } from "test/server/customUtil";
import { addAllScenarios, TestContext } from "test/server/lib/docapi/scenarios";
import { signal } from "test/server/lib/helpers/Signal";
import * as testUtils from "test/server/testUtils";
import { waitForIt } from "test/server/wait";

import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { assert } from "chai";
import * as express from "express";
import FormData from "form-data";
import * as _ from "lodash";
import pick from "lodash/pick";
import LRUCache from "lru-cache";
import * as moment from "moment-timezone";
import { AbortController } from "node-abort-controller";
import fetch from "node-fetch";
import { createClient, RedisClient } from "redis";

// Use a fixed port offset based on test suite to avoid collisions
const webhooksTestPort = 34365;

async function getWorkspaceId(api: UserAPIImpl, name: string) {
  const workspaces = await api.getOrgWorkspaces("current");
  return workspaces.find(w => w.name === name)!.id;
}

interface WebhookRequests {
  "add": object[][];
  "update": object[][];
  "add,update": object[][];
}

interface WebhookSubscription {
  unsubscribeKey: string;
  webhookId: string;
}

describe("DocApiWebhooks", function() {
  this.timeout(60000);
  testUtils.setTmpLogLevel("error");

  addAllScenarios(addWebhooksTests, "docapi-webhooks", {
    extraEnv: {
      ALLOWED_WEBHOOK_DOMAINS: `example.com,localhost:${webhooksTestPort}`,
    },
  });
});

function addWebhooksTests(getCtx: () => TestContext) {
  function makeUserApi(org: string, username: string): UserAPI {
    const { homeUrl } = getCtx();
    const config = configForUser(username);
    return new UserAPIImpl(`${homeUrl}/o/${org}`, {
      headers: config.headers as Record<string, string>,
      fetch: fetch as unknown as typeof globalThis.fetch,
      newFormData: () => new FormData() as any,
    });
  }

  /**
   * Tests for basic webhook CRUD operations.
   */
  describe("webhooksRelatedEndpoints", function() {
    let serving: Serving;

    before(async function() {
      serving = await serveSomething((app: express.Application) => {
        app.use(express.json());
        app.post("/200", ({ body }: express.Request, res: express.Response) => {
          res.sendStatus(200);
          res.end();
        });
      }, webhooksTestPort);
    });

    after(async function() {
      await serving.shutdown();
    });

    async function oldSubscribeCheck(requestBody: any, status: number, ...errors: RegExp[]) {
      const { serverUrl, docIds, chimpy } = getCtx();
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_subscribe`,
        requestBody, chimpy,
      );
      assert.equal(resp.status, status);
      for (const error of errors) {
        assert.match(resp.data.details?.userError || resp.data.error, error);
      }
    }

    async function postWebhookCheck(requestBody: any, status: number, ...errors: RegExp[]) {
      const { serverUrl, docIds, chimpy } = getCtx();
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks`,
        requestBody, chimpy,
      );
      assert.equal(resp.status, status);
      for (const error of errors) {
        assert.match(resp.data.details?.userError || resp.data.error, error);
      }
      return resp.data;
    }

    async function userCheck(user: AxiosRequestConfig, requestBody: any, status: number, responseBody: any) {
      const { serverUrl, docIds } = getCtx();
      const resp = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_unsubscribe`,
        requestBody, user,
      );
      assert.equal(resp.status, status);
      if (status !== 200) {
        responseBody = { error: responseBody };
      }
      assert.deepEqual(resp.data, responseBody);
    }

    async function userDeleteCheck(user: AxiosRequestConfig, webhookId: string, status: number, ...errors: RegExp[]) {
      const { serverUrl, docIds } = getCtx();
      const resp = await axios.delete(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks/${webhookId}`,
        user,
      );
      assert.equal(resp.status, status);
      for (const error of errors) {
        assert.match(resp.data.details?.userError || resp.data.error, error);
      }
    }

    interface SubscriptionInfo {
      unsubscribeKey: string;
      webhookId: string;
    }

    async function subscribeWebhook(): Promise<SubscriptionInfo> {
      const { serverUrl, docIds, chimpy } = getCtx();
      const subscribeResponse = await axios.post(
        `${serverUrl}/api/docs/${docIds.Timesheets}/tables/Table1/_subscribe`,
        { eventTypes: ["add"], url: "https://example.com" }, chimpy,
      );
      assert.equal(subscribeResponse.status, 200);
      const { unsubscribeKey, webhookId } = subscribeResponse.data;
      return { unsubscribeKey, webhookId };
    }

    async function getRegisteredWebhooks() {
      const { serverUrl, docIds, chimpy } = getCtx();
      const response = await axios.get(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks`, chimpy);
      return response.data.webhooks;
    }

    async function deleteWebhookCheck(webhookId: any) {
      const { serverUrl, docIds, chimpy } = getCtx();
      const response = await axios.delete(
        `${serverUrl}/api/docs/${docIds.Timesheets}/webhooks/${webhookId}`, chimpy);
      return response.data;
    }

    it("GET /docs/{did}/webhooks retrieves a list of webhooks", async function() {
      const { serverUrl, docIds, chimpy } = getCtx();
      const registerResponse = await postWebhookCheck({
        webhooks: [{ fields: { tableId: "Table1", eventTypes: ["add"], url: "https://example.com" } }],
      }, 200);
      const resp = await axios.get(`${serverUrl}/api/docs/${docIds.Timesheets}/webhooks`, chimpy);
      try {
        assert.equal(resp.status, 200);
        assert.isAtLeast(resp.data.webhooks.length, 1);
        assert.containsAllKeys(resp.data.webhooks[0], ["id", "fields"]);
        assert.containsAllKeys(resp.data.webhooks[0].fields,
          ["enabled", "isReadyColumn", "memo", "name", "tableId", "eventTypes", "url"]);
      } finally {
        await deleteWebhookCheck(registerResponse.webhooks[0].id);
      }
    });

    it("POST /docs/{did}/tables/{tid}/_subscribe validates inputs", async function() {
      await oldSubscribeCheck({}, 400, /eventTypes is missing/);
      await oldSubscribeCheck({ eventTypes: 0 }, 400, /url is missing/, /eventTypes is not an array/);
      await oldSubscribeCheck({ eventTypes: [] }, 400, /url is missing/);
      await oldSubscribeCheck({ eventTypes: [], url: "https://example.com" }, 400, /eventTypes must be a non-empty array/);
      await oldSubscribeCheck({ eventTypes: ["foo"], url: "https://example.com" }, 400, /eventTypes\[0] is none of "add", "update"/);
      await oldSubscribeCheck({ eventTypes: ["add"] }, 400, /url is missing/);
      await oldSubscribeCheck({ eventTypes: ["add"], url: "https://evil.com" }, 403, /Provided url is forbidden/);
      await oldSubscribeCheck({ eventTypes: ["add"], url: "http://example.com" }, 403, /Provided url is forbidden/);
      await oldSubscribeCheck({ eventTypes: ["add"], url: "https://example.com", isReadyColumn: "bar" }, 404, /Column not found "bar"/);
    });

    it("POST /docs/{did}/webhooks validates inputs", async function() {
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1" } }] }, 400,
        /eventTypes is missing/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: 0 } }] }, 400,
        /url is missing/, /eventTypes is not an array/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: [] } }] },
        400, /url is missing/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: [],
        url: "https://example.com" } }] },
      400, /eventTypes must be a non-empty array/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: ["foo"],
        url: "https://example.com" } }] },
      400, /eventTypes\[0] is none of "add", "update"/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: ["add"] } }] },
        400, /url is missing/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: ["add"],
        url: "https://evil.com" } }] },
      403, /Provided url is forbidden/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: ["add"],
        url: "http://example.com" } }] },
      403, /Provided url is forbidden/);
      await postWebhookCheck({ webhooks: [{ fields: { tableId: "Table1", eventTypes: ["add"],
        url: "https://example.com", isReadyColumn: "bar" } }] },
      404, /Column not found "bar"/);
      await postWebhookCheck({ webhooks: [{ fields: { eventTypes: ["add"], url: "https://example.com" } }] },
        400, /tableId is missing/);
      await postWebhookCheck({}, 400, /webhooks is missing/);
      await postWebhookCheck({
        webhooks: [{
          fields: {
            tableId: "Table1", eventTypes: ["update"], watchedColIds: ["notExisting"],
            url: `${serving.url}/200`,
          },
        }],
      },
      404, /Column not found "notExisting"/);
    });

    it("POST /docs/{did}/tables/{tid}/_unsubscribe validates inputs for owners", async function() {
      const { chimpy } = getCtx();
      const { webhookId } = await subscribeWebhook();
      const check = userCheck.bind(null, chimpy);

      await check({ webhookId: "foo" }, 404, `Webhook not found "foo"`);
      await check({}, 404, `Webhook not found ""`);
      await check({ webhookId }, 200, { success: true });
      await check({ webhookId }, 404, `Webhook not found "${webhookId}"`);
    });

    it("DELETE /docs/{did}/tables/webhooks validates inputs for owners", async function() {
      const { docIds, chimpy } = getCtx();
      const { webhookId } = await subscribeWebhook();
      const check = userDeleteCheck.bind(null, chimpy);

      await check("foo", 404, /Webhook not found "foo"/);
      await check("", 404, /not found/, new RegExp(`/api/docs/${docIds.Timesheets}/webhooks/`));
      await check(webhookId, 200);
      await check(webhookId, 404, new RegExp(`Webhook not found "${webhookId}"`));
    });

    it("POST /docs/{did}/webhooks is adding new webhook to table " +
      "and DELETE /docs/{did}/webhooks/{wid} is removing new webhook from table", async function() {
      const registeredWebhook = await postWebhookCheck({
        webhooks: [{ fields: { tableId: "Table1", eventTypes: ["add"], url: "https://example.com" } }],
      }, 200);
      let webhookList = await getRegisteredWebhooks();
      assert.equal(webhookList.length, 1);
      assert.equal(webhookList[0].id, registeredWebhook.webhooks[0].id);
      await deleteWebhookCheck(registeredWebhook.webhooks[0].id);
      webhookList = await getRegisteredWebhooks();
      assert.equal(webhookList.length, 0);
    });

    it("POST /docs/{did}/webhooks is adding new webhook should be able to add many webhooks at once", async function() {
      const response = await postWebhookCheck(
        {
          webhooks: [
            { fields: { tableId: "Table1", eventTypes: ["add"], url: "https://example.com" } },
            { fields: { tableId: "Table1", eventTypes: ["add"], url: "https://example.com/2" } },
            { fields: { tableId: "Table1", eventTypes: ["add"], url: "https://example.com/3" } },
          ] }, 200);
      assert.equal(response.webhooks.length, 3);
      const webhookList = await getRegisteredWebhooks();
      assert.equal(webhookList.length, 3);
    });

    it("POST /docs/{did}/tables/{tid}/_unsubscribe validates inputs for editors", async function() {
      const { homeUrl, docIds, flushAuth, chimpy, kiwi } = getCtx();
      const subscribeResponse = await subscribeWebhook();

      const delta = {
        users: { "kiwi@getgrist.com": "editors" as string | null },
      };
      let accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, { delta }, chimpy);
      await flushAuth();
      assert.equal(accessResp.status, 200);

      const check = userCheck.bind(null, kiwi);

      await check({ webhookId: "foo" }, 404, `Webhook not found "foo"`);
      await check({ webhookId: subscribeResponse.webhookId }, 400, "Bad request: unsubscribeKey required");
      await check({ webhookId: subscribeResponse.webhookId, unsubscribeKey: "foo" },
        401, "Wrong unsubscribeKey");
      await check({ webhookId: subscribeResponse.webhookId, unsubscribeKey: subscribeResponse.unsubscribeKey },
        200, { success: true });
      await check({ webhookId: subscribeResponse.webhookId, unsubscribeKey: subscribeResponse.unsubscribeKey },
        404, `Webhook not found "${subscribeResponse.webhookId}"`);

      delta.users["kiwi@getgrist.com"] = null;
      accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, { delta }, chimpy);
      assert.equal(accessResp.status, 200);
      await flushAuth();
    });

    it("DELETE /docs/{did}/tables/webhooks should not be allowed for not-owner", async function() {
      const { homeUrl, docIds, flushAuth, chimpy, kiwi } = getCtx();
      const subscribeResponse = await subscribeWebhook();
      const check = userDeleteCheck.bind(null, kiwi);

      const delta = {
        users: { "kiwi@getgrist.com": "editors" as string | null },
      };
      let accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, { delta }, chimpy);
      assert.equal(accessResp.status, 200);
      await flushAuth();

      await check(subscribeResponse.webhookId, 403, /No owner access/);

      delta.users["kiwi@getgrist.com"] = null;
      accessResp = await axios.patch(`${homeUrl}/api/docs/${docIds.Timesheets}/access`, { delta }, chimpy);
      assert.equal(accessResp.status, 200);
      await flushAuth();
    });
  });

  /**
   * Tests for daily API usage limits.
   */
  describe("dailyApiLimits", function() {
    let redisClient: RedisClient;

    before(async function() {
      if (!process.env.TEST_REDIS_URL) {
        this.skip();
      }
      redisClient = createClient(process.env.TEST_REDIS_URL);
    });

    after(async function() {
      if (process.env.TEST_REDIS_URL) {
        await redisClient.quitAsync();
      }
    });

    it("limits daily API usage", async function() {
      const api = makeUserApi("testdailyapilimit", "chimpy") as UserAPIImpl;
      const workspaceId = await getWorkspaceId(api, "TestDailyApiLimitWs");
      const docId = await api.newDoc({ name: "TestDoc1" }, workspaceId);
      const max = testDailyApiLimitFeatures.baseMaxApiUnitsPerDocumentPerDay;

      for (let i = 1; i <= max + 2; i++) {
        let success = true;
        try {
          await api.getTable(docId, "Table1");
        } catch (e) {
          success = false;
        }

        if (success) {
          assert.isAtMost(i, max + 1);
        } else {
          assert.isAtLeast(i, max + 1);
        }
      }
    });

    it("limits daily API usage and sets the correct keys in redis", async function() {
      const { serverUrl, chimpy } = getCtx();
      this.retries(3);
      const freeTeamApi = makeUserApi("freeteam", "chimpy") as UserAPIImpl;
      const workspaceId = await getWorkspaceId(freeTeamApi, "FreeTeamWs");
      const docId = await freeTeamApi.newDoc({ name: "TestDoc2" }, workspaceId);
      const used = 999999;
      let m = moment.utc();
      const currentDay = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[0], m);
      const currentHour = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[1], m);
      const nextDay = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[0], m);
      const nextHour = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[1], m);
      await redisClient.multi()
        .set(currentDay, String(used))
        .set(currentHour, String(used))
        .set(nextDay, String(used))
        .set(nextHour, String(used))
        .execAsync();

      for (let i = 1; i <= 9; i++) {
        const last = i === 9;
        m = moment.utc();
        const response = await axios.get(`${serverUrl}/api/docs/${docId}/tables/Table1/records`,
          chimpy);
        await delay(100);
        if (i <= 4) {
          assert.equal(response.status, 200);
          const first = i === 1;
          const day = docPeriodicApiUsageKey(docId, first, docApiUsagePeriods[0], m);
          const hour = docPeriodicApiUsageKey(docId, first, docApiUsagePeriods[1], m);
          const minute = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[2], m);

          if (!first) {
            assert.deepEqual(
              await redisClient.multi()
                .ttl(minute)
                .ttl(hour)
                .ttl(day)
                .execAsync(),
              [
                2 * 60,
                2 * 60 * 60,
                2 * 60 * 60 * 24,
              ],
            );
          }

          assert.deepEqual(
            await redisClient.multi()
              .get(minute)
              .get(hour)
              .get(day)
              .execAsync(),
            [
              String(i),
              String(used + (first ? 1 : i - 1)),
              String(used + (first ? 1 : i - 1)),
            ],
          );
        }

        if (last) {
          assert.equal(response.status, 429);
          assert.deepEqual(response.data, { error: `Exceeded daily limit for document ${docId}` });
        }
      }
    });

    it("correctly allocates API requests based on the day, hour, and minute", async function() {
      const m = moment.utc("1999-12-31T23:59:59Z");
      const docId = "myDocId";
      const currentDay = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[0], m);
      const currentHour = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[1], m);
      const currentMinute = docPeriodicApiUsageKey(docId, true, docApiUsagePeriods[2], m);
      const nextDay = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[0], m);
      const nextHour = docPeriodicApiUsageKey(docId, false, docApiUsagePeriods[1], m);
      assert.equal(currentDay, `doc-myDocId-periodicApiUsage-1999-12-31`);
      assert.equal(currentHour, `doc-myDocId-periodicApiUsage-1999-12-31T23`);
      assert.equal(currentMinute, `doc-myDocId-periodicApiUsage-1999-12-31T23:59`);
      assert.equal(nextDay, `doc-myDocId-periodicApiUsage-2000-01-01`);
      assert.equal(nextHour, `doc-myDocId-periodicApiUsage-2000-01-01T00`);

      const usage = new LRUCache<string, number>({ max: 1024 });

      function check(expected: string[] | undefined) {
        assert.deepEqual(getDocApiUsageKeysToIncr(docId, usage, dailyMax, m), expected);
      }

      const dailyMax = 5000;
      const hourlyMax = 209;
      const minuteMax = 4;
      check([currentDay, currentHour, currentMinute]);
      usage.set(currentDay, dailyMax - 1);
      check([currentDay, currentHour, currentMinute]);
      usage.set(currentDay, dailyMax);
      check([nextDay, currentHour, currentMinute]);
      usage.set(currentHour, hourlyMax - 1);
      check([nextDay, currentHour, currentMinute]);
      usage.set(currentHour, hourlyMax);
      check([nextDay, nextHour, currentMinute]);
      usage.set(currentMinute, minuteMax - 1);
      check([nextDay, nextHour, currentMinute]);
      usage.set(currentMinute, minuteMax);
      check(undefined);
      usage.set(currentDay, 0);
      check([currentDay, currentHour, currentMinute]);
      usage.set(currentDay, dailyMax);
      usage.set(currentHour, 0);
      check([nextDay, currentHour, currentMinute]);
    });
  });

  /**
   * Main webhook behavior tests.
   */
  describe("mainWebhooks", function() {
    let serving: Serving;
    let requests: WebhookRequests;
    let receivedLastEvent: Promise<void>;

    const expected200AddEvents = [
      _.range(100).map(i => ({
        id: 9 + i, manualSort: 9 + i, A3: 200 + i, B3: true,
      })),
      _.range(100).map(i => ({
        id: 109 + i, manualSort: 109 + i, A3: 300 + i, B3: true,
      })),
    ];

    const expectedRequests: WebhookRequests = {
      "add": [
        [{ id: 1, A: 1, B: true, C: null, manualSort: 1 }],
        [{ id: 2, A: 4, B: true, C: null, manualSort: 2 }],
        [{ id: 2, A: 7, B: true, C: null, manualSort: 2 }],
        [{ id: 3, A3: 13, B3: true, manualSort: 3 },
          { id: 5, A3: 15, B3: true, manualSort: 5 }],
        [{ id: 7, A3: 18, B3: true, manualSort: 7 }],
        ...expected200AddEvents,
      ],
      "update": [
        [{ id: 2, A: 8, B: true, C: null, manualSort: 2 }],
        [{ id: 1, A3: 101, B3: true, manualSort: 1 }],
      ],
      "add,update": [
        [{ id: 1, A: 1, B: true, C: null, manualSort: 1 }],
        [{ id: 2, A: 4, B: true, C: null, manualSort: 2 }],
        [{ id: 2, A: 7, B: true, C: null, manualSort: 2 }],
        [{ id: 2, A: 8, B: true, C: null, manualSort: 2 }],
        [{ id: 1, A3: 101, B3: true, manualSort: 1 },
          { id: 3, A3: 13, B3: true, manualSort: 3 },
          { id: 5, A3: 15, B3: true, manualSort: 5 }],
        [{ id: 7, A3: 18, B3: true, manualSort: 7 }],
        ...expected200AddEvents,
      ],
    };

    let redisMonitor: any;
    let redisCalls: any[] = [];

    const successCalled = signal();
    const notFoundCalled = signal();
    const longStarted = signal();
    const longFinished = signal();
    let probeStatus = 200;
    let probeMessage: string | null = "OK";
    let controller = new AbortController();

    async function autoSubscribe(
      endpoint: string, docId: string, options?: {
        tableId?: string,
        isReadyColumn?: string | null,
        eventTypes?: string[]
        watchedColIds?: string[],
      }) {
      const data = await subscribe(endpoint, docId, options);
      return () => unsubscribe(docId, data, options?.tableId ?? "Table1");
    }

    function unsubscribe(docId: string, data: any, tableId = "Table1") {
      const { serverUrl, chimpy } = getCtx();
      return axios.post(
        `${serverUrl}/api/docs/${docId}/tables/${tableId}/_unsubscribe`,
        data, chimpy,
      );
    }

    async function subscribe(endpoint: string, docId: string, options?: {
      tableId?: string,
      isReadyColumn?: string | null,
      eventTypes?: string[],
      watchedColIds?: string[],
      name?: string,
      memo?: string,
      enabled?: boolean,
    }) {
      const { serverUrl, chimpy } = getCtx();
      const { data, status } = await axios.post(
        `${serverUrl}/api/docs/${docId}/tables/${options?.tableId ?? "Table1"}/_subscribe`,
        {
          eventTypes: options?.eventTypes ?? ["add", "update"],
          url: `${serving.url}/${endpoint}`,
          isReadyColumn: options?.isReadyColumn === undefined ? "B" : options?.isReadyColumn,
          ...pick(options, "name", "memo", "enabled", "watchedColIds"),
        }, chimpy,
      );
      assert.equal(status, 200, `Error during subscription: ` + JSON.stringify(data));
      return data as WebhookSubscription;
    }

    async function clearQueue(docId: string) {
      const { serverUrl, chimpy } = getCtx();
      const deleteResult = await axios.delete(
        `${serverUrl}/api/docs/${docId}/webhooks/queue`, chimpy,
      );
      assert.equal(deleteResult.status, 200);
    }

    async function readStats(docId: string): Promise<WebhookSummary[]> {
      const { serverUrl, chimpy } = getCtx();
      const result = await axios.get(
        `${serverUrl}/api/docs/${docId}/webhooks`, chimpy,
      );
      assert.equal(result.status, 200);
      return result.data.webhooks;
    }

    before(async function() {
      this.timeout(30000);

      requests = {
        "add,update": [],
        "add": [],
        "update": [],
      };

      let resolveReceivedLastEvent: () => void;
      receivedLastEvent = new Promise<void>((r) => {
        resolveReceivedLastEvent = r;
      });

      // TODO test retries on failure and slowness in a new test
      serving = await serveSomething((app: express.Application) => {
        app.use(express.json());
        app.post("/200", ({ body }: express.Request, res: express.Response) => {
          successCalled.emit(body[0].A);
          res.sendStatus(200);
          res.end();
        });
        app.post("/404", ({ body }: express.Request, res: express.Response) => {
          notFoundCalled.emit(body[0].A);
          res.sendStatus(404);
          res.end();
        });
        app.post("/probe", async ({ body }: express.Request, res: express.Response) => {
          longStarted.emit(body.map((r: any) => r.A));
          const scoped = new AbortController();
          controller = scoped;
          try {
            await delayAbort(20000, scoped.signal);
            assert.fail("Should have been aborted");
          } catch (exc) {
            res.status(probeStatus);
            res.send(probeMessage);
            res.end();
            longFinished.emit(body.map((r: any) => r.A));
          }
        });
        app.post("/long", async ({ body }: express.Request, res: express.Response) => {
          longStarted.emit(body[0].A);
          const scoped = new AbortController();
          controller = scoped;
          try {
            await delayAbort(20000, scoped.signal);
            res.sendStatus(200);
            res.end();
            longFinished.emit(body[0].A);
          } catch (exc) {
            res.sendStatus(200);
            res.end();
            longFinished.emit([408, body[0].A]);
          }
        });
        app.post("/:eventTypes", async ({ body, params: { eventTypes } }: express.Request, res: express.Response) => {
          requests[eventTypes as keyof WebhookRequests].push(body);
          res.sendStatus(200);
          if (
            _.flattenDeep(_.values(requests)).length >=
            _.flattenDeep(_.values(expectedRequests)).length
          ) {
            resolveReceivedLastEvent();
          }
        });
      }, webhooksTestPort);
    });

    after(async function() {
      await serving.shutdown();
    });

    describe("table endpoints", function() {
      before(async function() {
        this.timeout(30000);
        if (!process.env.TEST_REDIS_URL) {
          this.skip();
        }

        redisMonitor = createClient(process.env.TEST_REDIS_URL);
        redisMonitor.monitor();
        redisMonitor.on("monitor", (_time: any, args: any, _rawReply: any) => {
          redisCalls.push(args);
        });
      });

      beforeEach(function() {
        requests = {
          "add,update": [],
          "add": [],
          "update": [],
        };
        redisCalls = [];
      });

      after(async function() {
        if (process.env.TEST_REDIS_URL) {
          await redisMonitor.quitAsync();
        }
      });

      async function createWebhooks(
        {
          docId,
          tableId,
          eventTypesSet,
          isReadyColumn,
          watchedColIds,
          enabled,
        }: {
          docId: string,
          tableId: string,
          eventTypesSet: string[][],
          isReadyColumn: string,
          watchedColIds?: string[],
          enabled?: boolean
        },
      ) {
        const { serverUrl, chimpy } = getCtx();
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ["ModifyColumn", tableId, isReadyColumn, { type: "Bool" }],
        ], chimpy);

        const subscribeResponses = [];
        const webhookIds: Record<string, string> = {};

        for (const eventTypes of eventTypesSet) {
          const data = await subscribe(String(eventTypes), docId, {
            tableId,
            eventTypes,
            isReadyColumn,
            watchedColIds,
            enabled,
          });
          subscribeResponses.push(data);
          webhookIds[data.webhookId] = String(eventTypes);
        }
        return { subscribeResponses, webhookIds };
      }

      [{
        itMsg: "delivers expected payloads from combinations of changes, with retrying and batching",
        watchedColIds: undefined,
      }, {
        itMsg: "delivers expected payloads when watched col ids are set",
        watchedColIds: ["A", "B"],
      }].forEach((ctx) => {
        it(ctx.itMsg,
          async function() {
            const { serverUrl, userApi, chimpy } = getCtx();
            const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
            const docId = await userApi.newDoc({ name: "testdoc" }, ws1);
            const doc = userApi.getDocAPI(docId);

            const { subscribeResponses, webhookIds } = await createWebhooks({
              docId, tableId: "Table1", isReadyColumn: "B", watchedColIds: ctx.watchedColIds,
              eventTypesSet: [
                ["add"],
                ["update"],
                ["add", "update"],
              ],
            });

            await doc.addRows("Table1", {
              A: [1, 2],
              B: [true, false],
            });
            await doc.updateRows("Table1", { id: [2], A: [3] });
            await doc.updateRows("Table1", { id: [2], A: [4], B: [true] });
            await doc.updateRows("Table1", { id: [2], A: [5], B: [false] });
            await doc.updateRows("Table1", { id: [2], A: [6] });
            await doc.updateRows("Table1", { id: [2], A: [7], B: [true] });
            await doc.updateRows("Table1", { id: [2], A: [8] });

            await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
              ["BulkAddRecord", "Table1", [3, 4, 5, 6], { A: [9, 10, 11, 12], B: [true, true, false, false] }],
              ["BulkUpdateRecord", "Table1", [1, 2, 3, 4, 5, 6], {
                A: [101, 102, 13, 14, 15, 16],
                B: [true, false, true, false, true, false],
              }],
              ["RenameColumn", "Table1", "A", "A3"],
              ["RenameColumn", "Table1", "B", "B3"],
              ["RenameTable", "Table1", "Table12"],
              ["RemoveColumn", "Table12", "C"],
            ], chimpy);

            await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
              ["AddRecord", "Table12", 7, { A3: 17, B3: false }],
              ["UpdateRecord", "Table12", 7, { A3: 18, B3: true }],
              ["AddRecord", "Table12", 8, { A3: 19, B3: true }],
              ["UpdateRecord", "Table12", 8, { A3: 20, B3: false }],
              ["AddRecord", "Table12", 9, { A3: 20, B3: true }],
              ["RemoveRecord", "Table12", 9],
            ], chimpy);

            await doc.addRows("Table12", {
              A3: _.range(200, 400),
              B3: arrayRepeat(200, true),
            });

            await receivedLastEvent;

            await Promise.all(subscribeResponses.map(async (subscribeResponse) => {
              const unsubscribeResponse = await axios.post(
                `${serverUrl}/api/docs/${docId}/tables/Table12/_unsubscribe`,
                subscribeResponse, chimpy,
              );
              assert.equal(unsubscribeResponse.status, 200);
              assert.deepEqual(unsubscribeResponse.data, { success: true });
            }));

            await doc.addRows("Table12", {
              A3: [88, 99],
              B3: [true, false],
            });

            assert.deepEqual(requests, expectedRequests);

            const queueRedisCalls = redisCalls.filter(args => args[1] === "webhook-queue-" + docId);
            const redisPushes = _.chain(queueRedisCalls)
              .filter(args => args[0] === "rpush")
              .flatMap(args => args.slice(2))
              .map(JSON.parse)
              .groupBy("id")
              .mapKeys((_value, key) => webhookIds[key])
              .mapValues(group => _.map(group, "payload"))
              .value();
            const expectedPushes = _.mapValues(expectedRequests, value => _.flatten(value));
            assert.deepEqual(redisPushes, expectedPushes);

            const redisTrims = queueRedisCalls.filter(args => args[0] === "ltrim")
              .map(([, , start, end]) => {
                assert.equal(end, "-1");
                return Number(start);
              });
            const expectedTrims = Object.values(redisPushes).map(value => value.length);
            assert.equal(
              _.sum(redisTrims),
              _.sum(expectedTrims),
            );
          });
      });

      [{
        itMsg: "doesn't trigger webhook that has been disabled",
        enabled: false,
      }, {
        itMsg: "does trigger webhook that has been enable",
        enabled: true,
      }].forEach((ctx) => {
        it(ctx.itMsg, async function() {
          const { userApi } = getCtx();
          const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
          const docId = await userApi.newDoc({ name: "testdoc" }, ws1);
          const doc = userApi.getDocAPI(docId);

          await createWebhooks({
            docId, tableId: "Table1", isReadyColumn: "B", eventTypesSet: [["add"]], enabled: ctx.enabled,
          });

          await doc.addRows("Table1", {
            A: [42],
            B: [true],
          });

          const queueRedisCalls = redisCalls.filter(args => args[1] === "webhook-queue-" + docId);
          const redisPushIndex = queueRedisCalls.findIndex(args => args[0] === "rpush");

          if (ctx.enabled) {
            assert.isAbove(redisPushIndex, 0, "Should have pushed events to the redis queue");
          } else {
            assert.equal(redisPushIndex, -1, "Should not have pushed any events to the redis queue");
          }
        });
      });
    });

    describe("/webhooks endpoint", function() {
      let docId: string;
      let doc: DocAPI;
      let stats: WebhookSummary[];

      before(async function() {
        const { serverUrl, userApi, chimpy } = getCtx();
        const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
        docId = await userApi.newDoc({ name: "testdoc2" }, ws1);
        doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ["ModifyColumn", "Table1", "B", { type: "Bool" }],
        ], chimpy);
        await userApi.applyUserActions(docId, [["AddTable", "Table2", [{ id: "Foo" }, { id: "Bar" }]]]);
      });

      const waitForQueue = async (length: number) => {
        await waitForIt(async () => {
          stats = await readStats(docId);
          assert.equal(length, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
        }, 1000, 200);
      };

      it("should clear the outgoing queue", async () => {
        const { serverUrl, userApi, chimpy } = getCtx();
        const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
        const docId = await userApi.newDoc({ name: "testdoc2" }, ws1);
        const doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ["ModifyColumn", "Table1", "B", { type: "Bool" }],
        ], chimpy);

        await clearQueue(docId);

        const cleanup: (() => Promise<any>)[] = [];

        cleanup.push(await autoSubscribe("200", docId));
        cleanup.push(await autoSubscribe("404", docId));

        successCalled.reset();
        notFoundCalled.reset();
        await doc.addRows("Table1", {
          A: [1],
          B: [true],
        });

        await successCalled.waitAndReset();
        await notFoundCalled.waitAndReset();

        await notFoundCalled.waitAndReset();

        successCalled.assertNotCalled();

        await doc.addRows("Table1", {
          A: [2],
          B: [true],
        });
        const firstRow = await notFoundCalled.waitAndReset();
        assert.deepEqual(firstRow, 1);

        successCalled.assertNotCalled();

        await clearQueue(docId);

        successCalled.assertNotCalled();
        notFoundCalled.assertNotCalled();

        successCalled.reset();
        notFoundCalled.reset();
        await doc.addRows("Table1", {
          A: [3],
          B: [true],
        });
        let thirdRow = await successCalled.waitAndReset();
        assert.deepEqual(thirdRow, 3);
        thirdRow = await notFoundCalled.waitAndReset();
        assert.deepEqual(thirdRow, 3);
        await notFoundCalled.waitAndReset();
        successCalled.assertNotCalled();

        await Promise.all(cleanup.map(fn => fn())).finally(() => cleanup.length = 0);
        await clearQueue(docId);

        cleanup.push(await autoSubscribe("200", docId));
        cleanup.push(await autoSubscribe("long", docId));
        successCalled.reset();
        longFinished.reset();
        longStarted.reset();
        await doc.addRows("Table1", {
          A: [4],
          B: [true],
        });
        await successCalled.waitAndReset();
        await longStarted.waitAndReset();
        longFinished.assertNotCalled();
        controller.abort();
        assert.deepEqual(await longFinished.waitAndReset(), [408, 4]);

        await doc.addRows("Table1", {
          A: [5],
          B: [true],
        });
        assert.deepEqual(await successCalled.waitAndReset(), 5);
        assert.deepEqual(await longStarted.waitAndReset(), 5);
        longFinished.assertNotCalled();

        const controller5 = controller;
        await doc.addRows("Table1", {
          A: [6],
          B: [true],
        });
        successCalled.assertNotCalled();
        longFinished.assertNotCalled();
        assert.isTrue((await axios.delete(
          `${serverUrl}/api/docs/${docId}/webhooks/queue`, chimpy,
        )).status === 200);
        controller5.abort();
        assert.deepEqual(await longFinished.waitAndReset(), [408, 5]);

        successCalled.assertNotCalled();
        longStarted.assertNotCalled();

        await doc.addRows("Table1", {
          A: [7],
          B: [true],
        });
        assert.deepEqual(await successCalled.waitAndReset(), 7);
        assert.deepEqual(await longStarted.waitAndReset(), 7);
        longFinished.assertNotCalled();
        controller.abort();
        assert.deepEqual(await longFinished.waitAndReset(), [408, 7]);

        await Promise.all(cleanup.map(fn => fn())).finally(() => cleanup.length = 0);
        await clearQueue(docId);
      });

      it("should not call to a deleted webhook", async () => {
        const { serverUrl, userApi, chimpy } = getCtx();
        const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
        const docId = await userApi.newDoc({ name: "testdoc4" }, ws1);
        const doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ["ModifyColumn", "Table1", "B", { type: "Bool" }],
        ], chimpy);

        const webhook1 = await autoSubscribe("probe", docId);
        const webhook2 = await autoSubscribe("200", docId);

        probeStatus = 200;
        successCalled.reset();
        longFinished.reset();
        await doc.addRows("Table1", {
          A: [1],
          B: [true],
        });

        await longStarted.waitAndReset();
        const stats = await readStats(docId);
        assert.equal(2, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
        await webhook2();
        controller.abort();
        await longFinished.waitAndReset();
        successCalled.assertNotCalled();
        await doc.addRows("Table1", {
          A: [2],
          B: [true],
        });
        await longStarted.waitAndReset();
        controller.abort();
        await longFinished.waitAndReset();

        await webhook1();
      });

      it("should call to a webhook only when columns updated are in watchedColIds if not empty", async () => {
        const { serverUrl, userApi, chimpy } = getCtx();
        const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
        const docId = await userApi.newDoc({ name: "testdoc5" }, ws1);
        const doc = userApi.getDocAPI(docId);
        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ["ModifyColumn", "Table1", "B", { type: "Bool" }],
        ], chimpy);

        const modifyColumn = async (newValues: { [key: string]: any; }) => {
          await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
            ["UpdateRecord", "Table1", newRowIds[0], newValues],
          ], chimpy);
        };
        const assertSuccessNotCalled = async () => {
          successCalled.assertNotCalled();
          successCalled.reset();
        };
        const assertSuccessCalled = async () => {
          await successCalled.waitAndReset();
        };

        const webhook1 = await autoSubscribe("200", docId, {
          watchedColIds: ["A"], eventTypes: ["add", "update"],
        });
        successCalled.reset();
        const newRowIds = await doc.addRows("Table1", {
          A: [2],
          B: [true],
          C: ["c1"],
        });
        await successCalled.waitAndReset();
        await modifyColumn({ C: "c2" });
        await assertSuccessNotCalled();
        await modifyColumn({ A: 19 });
        await assertSuccessCalled();
        await webhook1();

        const webhook2 = await autoSubscribe("200", docId, {
          watchedColIds: ["A", "B"], eventTypes: ["update"],
        });
        successCalled.reset();
        await modifyColumn({ C: "c3" });
        await assertSuccessNotCalled();
        await modifyColumn({ A: 20 });
        await assertSuccessCalled();
        await webhook2();

        const webhook3 = await autoSubscribe("200", docId, {
          watchedColIds: ["A", ""], eventTypes: ["update"],
        });
        await modifyColumn({ C: "c4" });
        await assertSuccessNotCalled();
        await modifyColumn({ A: 21 });
        await assertSuccessCalled();
        await webhook3();
      });

      it("should return statistics", async () => {
        await clearQueue(docId);
        assert.deepEqual(await readStats(docId), []);
        const first = await subscribe("200", docId);
        const second = await subscribe("404", docId);
        assert.deepEqual(await readStats(docId), [
          {
            id: first.webhookId,
            fields: {
              url: `${serving.url}/200`,
              authorization: "",
              unsubscribeKey: first.unsubscribeKey,
              eventTypes: ["add", "update"],
              enabled: true,
              isReadyColumn: "B",
              tableId: "Table1",
              name: "",
              memo: "",
              watchedColIds: [],
            }, usage: {
              status: "idle",
              numWaiting: 0,
              lastEventBatch: null,
            },
          },
          {
            id: second.webhookId,
            fields: {
              url: `${serving.url}/404`,
              authorization: "",
              unsubscribeKey: second.unsubscribeKey,
              eventTypes: ["add", "update"],
              enabled: true,
              isReadyColumn: "B",
              tableId: "Table1",
              name: "",
              memo: "",
              watchedColIds: [],
            }, usage: {
              status: "idle",
              numWaiting: 0,
              lastEventBatch: null,
            },
          },
        ]);

        await unsubscribe(docId, first);
        await unsubscribe(docId, second);
        assert.deepEqual(await readStats(docId), []);

        let unsubscribe1 = await autoSubscribe("200", docId, { isReadyColumn: null });
        assert.isNull((await readStats(docId))[0].fields.isReadyColumn);
        await unsubscribe1();

        unsubscribe1 = await autoSubscribe("probe", docId);
        let now = Date.now();
        longStarted.reset();
        longFinished.reset();
        await doc.addRows("Table1", {
          A: [1],
          B: [true],
        });
        await longStarted.waitAndReset();
        stats = await readStats(docId);
        assert.isNotNull(stats[0].usage);
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.status, "sending");
        assert.isNotNull(stats[0].usage?.updatedTime);
        assert.isAbove(stats[0].usage?.updatedTime ?? 0, now);
        assert.isNull(stats[0].usage?.lastErrorMessage);
        assert.isNull(stats[0].usage?.lastSuccessTime);
        assert.isNull(stats[0].usage?.lastFailureTime);
        assert.isNull(stats[0].usage?.lastHttpStatus);
        assert.isNull(stats[0].usage?.lastEventBatch);
        probeStatus = 200;
        controller.abort();
        await longFinished.waitAndReset();
        await waitForIt(async () => {
          stats = await readStats(docId);
          assert.equal(stats[0].usage?.numWaiting, 0);
        }, 1000, 200);
        assert.equal(stats[0].usage?.numWaiting, 0);
        assert.equal(stats[0].usage?.status, "idle");
        assert.isAtLeast(stats[0].usage?.updatedTime ?? 0, now);
        assert.isNull(stats[0].usage?.lastErrorMessage);
        assert.isNull(stats[0].usage?.lastFailureTime);
        assert.equal(stats[0].usage?.lastHttpStatus, 200);
        assert.isAtLeast(stats[0].usage?.lastSuccessTime ?? 0, now);
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: "success",
          attempts: 1,
          size: 1,
          errorMessage: null,
          httpStatus: 200,
        });

        now = Date.now();
        await doc.addRows("Table1", {
          A: [2],
          B: [true],
        });
        await longStarted.waitAndReset();
        probeStatus = 404;
        probeMessage = null;
        controller.abort();
        await longFinished.waitAndReset();
        await longStarted.waitAndReset();
        stats = await readStats(docId);
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.status, "retrying");
        assert.isAtLeast(stats[0].usage?.updatedTime ?? 0, now);
        assert.isNull(stats[0].usage?.lastErrorMessage);
        assert.isAtLeast(stats[0].usage?.lastFailureTime ?? 0, now);
        assert.isBelow(stats[0].usage?.lastSuccessTime ?? 0, now);
        assert.equal(stats[0].usage?.lastHttpStatus, 404);
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: "failure",
          attempts: 1,
          size: 1,
          errorMessage: null,
          httpStatus: 404,
        });
        probeStatus = 500;
        probeMessage = "Some error";
        controller.abort();
        await longFinished.waitAndReset();
        await longStarted.waitAndReset();
        stats = await readStats(docId);
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.status, "retrying");
        assert.equal(stats[0].usage?.lastHttpStatus, 500);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: "failure",
          attempts: 2,
          size: 1,
          errorMessage: probeMessage,
          httpStatus: 500,
        });
        probeStatus = 200;
        controller.abort();
        await longFinished.waitAndReset();
        await waitForIt(async () => {
          stats = await readStats(docId);
          assert.equal(stats[0].usage?.numWaiting, 0);
        }, 1000, 200);
        stats = await readStats(docId);
        assert.equal(stats[0].usage?.numWaiting, 0);
        assert.equal(stats[0].usage?.status, "idle");
        assert.equal(stats[0].usage?.lastHttpStatus, 200);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.isAtLeast(stats[0].usage?.lastFailureTime ?? 0, now);
        assert.isAtLeast(stats[0].usage?.lastSuccessTime ?? 0, now);
        assert.deepEqual(stats[0].usage?.lastEventBatch, {
          status: "success",
          attempts: 3,
          size: 1,
          errorMessage: null,
          httpStatus: 200,
        });
        await clearQueue(docId);
        stats = await readStats(docId);
        assert.isNotNull(stats[0].usage);
        assert.equal(stats[0].usage?.numWaiting, 0);
        assert.equal(stats[0].usage?.status, "idle");
        const unsubscribe2 = await autoSubscribe("probe", docId);
        await doc.addRows("Table1", {
          A: [3],
          B: [true],
        });
        await doc.addRows("Table1", {
          A: [4],
          B: [true],
        });
        await doc.addRows("Table1", {
          A: [5],
          B: [true],
        });
        assert.deepEqual(await longStarted.waitAndReset(), [3]);
        stats = await readStats(docId);
        assert.lengthOf(stats, 2);
        assert.equal(stats[0].usage?.status, "sending");
        assert.equal(stats[1].usage?.status, "idle");
        assert.isNull(stats[0].usage?.lastEventBatch);
        assert.isNull(stats[1].usage?.lastEventBatch);
        assert.equal(6, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
        controller.abort();
        assert.deepEqual(await longFinished.waitAndReset(), [3]);
        const nextPass = async (length: number, A: number) => {
          assert.deepEqual(await longStarted.waitAndReset(), [A]);
          stats = await readStats(docId);
          assert.equal(length, _.sum(stats.map(x => x.usage?.numWaiting ?? 0)));
          controller.abort();
          assert.deepEqual(await longFinished.waitAndReset(), [A]);
        };
        await nextPass(5, 3);
        await nextPass(4, 4);
        await nextPass(3, 4);
        await nextPass(2, 5);
        await nextPass(1, 5);

        await waitForQueue(0);
        await unsubscribe2();
        await unsubscribe1();
      });

      it("should not block document load (gh issue #799)", async function() {
        const { serverUrl, userApi, chimpy } = getCtx();
        const ws1 = (await userApi.getOrgWorkspaces("current"))[0].id;
        const docId = await userApi.newDoc({ name: "testdoc5" }, ws1);
        const doc = userApi.getDocAPI(docId);
        const formulaEvaluatedAtDocLoad = "NOW()";

        await axios.post(`${serverUrl}/api/docs/${docId}/apply`, [
          ["ModifyColumn", "Table1", "C", { isFormula: true, formula: formulaEvaluatedAtDocLoad }],
        ], chimpy);

        const unsubscribeWebhook1 = await autoSubscribe("probe", docId);

        await doc.addRows("Table1", {
          A: [1],
        });

        await doc.forceReload();

        await doc.addRows("Table1", {
          A: [2],
        });

        await unsubscribeWebhook1();
      });

      it("should monitor failures", async () => {
        const webhook3 = await subscribe("probe", docId);
        const webhook4 = await subscribe("probe", docId);
        probeStatus = 509;
        probeMessage = "fail";
        await doc.addRows("Table1", {
          A: [5],
          B: [true],
        });

        const pass = async () => {
          await longStarted.waitAndReset();
          controller.abort();
          await longFinished.waitAndReset();
        };
        await pass();
        await pass();
        await pass();
        await pass();
        await longStarted.waitAndReset();

        stats = await readStats(docId);
        assert.equal(stats.length, 2);
        assert.equal(stats[0].id, webhook3.webhookId);
        assert.equal(stats[1].id, webhook4.webhookId);
        assert.equal(stats[0].usage?.status, "postponed");
        assert.equal(stats[1].usage?.status, "sending");
        assert.equal(stats[0].usage?.numWaiting, 1);
        assert.equal(stats[1].usage?.numWaiting, 1);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.equal(stats[0].usage?.lastHttpStatus, 509);
        assert.equal(stats[0].usage?.lastEventBatch?.status, "failure");
        assert.isNull(stats[1].usage?.lastErrorMessage);

        await waitForQueue(2);
        const addRowProm = doc.addRows("Table1", {
          A: arrayRepeat(5, 100),
          B: arrayRepeat(5, true),
        }).catch(() => {
        });

        probeStatus = 429;
        controller.abort();
        await longFinished.waitAndReset();
        await pass();
        await pass();

        await waitForQueue(12);
        await pass();

        await longStarted.waitAndReset();

        stats = await readStats(docId);
        assert.equal(stats.length, 2);
        assert.equal(stats[0].id, webhook3.webhookId);
        assert.equal(stats[0].usage?.status, "sending");
        assert.equal(stats[0].usage?.numWaiting, 6);
        assert.equal(stats[0].usage?.lastErrorMessage, probeMessage);
        assert.equal(stats[0].usage?.lastHttpStatus, 509);

        assert.equal(stats[1].id, webhook4.webhookId);
        assert.equal(stats[1].usage?.status, "error");
        assert.equal(stats[1].usage?.lastEventBatch?.status, "rejected");
        assert.equal(stats[1].usage?.numWaiting, 5);

        probeStatus = 200;
        controller.abort();
        await longFinished.waitAndReset();
        await pass();
        await waitForQueue(0);

        await addRowProm;
        await unsubscribe(docId, webhook3);
        await unsubscribe(docId, webhook4);
      });

      describe("webhook update", function() {
        it("should work correctly", async function() {
          const { serverUrl, userApi, chimpy } = getCtx();
          async function check(fields: any, status: number, error?: RegExp | string,
            expectedFieldsCallback?: (fields: any) => any) {
            const origFields = {
              tableId: "Table1",
              eventTypes: ["add"],
              isReadyColumn: "B",
              name: "My Webhook",
              memo: "Sync store",
              watchedColIds: ["A"],
            };

            const doc = userApi.getDocAPI(docId);
            const fork = await doc.fork();
            const { data: errorData } = await axios.post(
              `${serverUrl}/api/docs/${fork.docId}/webhooks`,
              {
                webhooks: [{
                  fields: {
                    ...origFields,
                    url: `${serving.url}/foo`,
                  },
                }],
              }, chimpy,
            );
            assert.equal(errorData.error, "Unsaved document copies cannot have webhooks");

            const { data } = await axios.post(
              `${serverUrl}/api/docs/${docId}/webhooks`,
              {
                webhooks: [{
                  fields: {
                    ...origFields,
                    url: `${serving.url}/foo`,
                  },
                }],
              }, chimpy,
            );
            const webhooks = data;

            const expectedFields = {
              url: `${serving.url}/foo`,
              authorization: "",
              eventTypes: ["add"],
              isReadyColumn: "B",
              tableId: "Table1",
              enabled: true,
              name: "My Webhook",
              memo: "Sync store",
              watchedColIds: ["A"],
            };

            let stats = await readStats(docId);
            assert.equal(stats.length, 1, "stats=" + JSON.stringify(stats));
            assert.equal(stats[0].id, webhooks.webhooks[0].id);
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { unsubscribeKey, ...fieldsWithoutUnsubscribeKey } = stats[0].fields;
            assert.deepEqual(fieldsWithoutUnsubscribeKey, expectedFields);

            const resp = await axios.patch(
              `${serverUrl}/api/docs/${docId}/webhooks/${webhooks.webhooks[0].id}`, fields, chimpy,
            );

            assert.equal(resp.status, status, JSON.stringify(pick(resp, ["data", "status"])));
            if (resp.status === 200) {
              stats = await readStats(docId);
              assert.equal(stats.length, 1);
              assert.equal(stats[0].id, webhooks.webhooks[0].id);
              if (expectedFieldsCallback) {
                expectedFieldsCallback(expectedFields);
              }
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { unsubscribeKey, ...fieldsWithoutUnsubscribeKey } = stats[0].fields;
              assert.deepEqual(fieldsWithoutUnsubscribeKey, { ...expectedFields, ...fields });
            } else {
              if (error instanceof RegExp) {
                assert.match(resp.data.details?.userError || resp.data.error, error);
              } else {
                assert.deepEqual(resp.data, { error });
              }
            }

            const unsubscribeResp = await axios.delete(
              `${serverUrl}/api/docs/${docId}/webhooks/${webhooks.webhooks[0].id}`, chimpy,
            );
            assert.equal(unsubscribeResp.status, 200, JSON.stringify(pick(unsubscribeResp, ["data", "status"])));
            stats = await readStats(docId);
            assert.equal(stats.length, 0, "stats=" + JSON.stringify(stats));
          }

          await check({ url: `${serving.url}/bar` }, 200);
          await check({ url: "https://evil.com" }, 403, "Provided url is forbidden");
          await check({ url: "http://example.com" }, 403, "Provided url is forbidden");

          await check({ tableId: "Table2" }, 200, "", (expectedFields) => {
            expectedFields.isReadyColumn = null;
            expectedFields.watchedColIds = [];
          });

          await check({ tableId: "Santa" }, 404, `Table not found "Santa"`);
          await check({ tableId: "Table2", isReadyColumn: "Foo", watchedColIds: [] }, 200);

          await check({ eventTypes: ["add", "update"] }, 200);
          await check({ eventTypes: [] }, 400, "eventTypes must be a non-empty array");
          await check({ eventTypes: ["foo"] }, 400, /eventTypes\[0] is none of "add", "update"/);

          await check({ isReadyColumn: null }, 200);
          await check({ isReadyColumn: "bar" }, 404, `Column not found "bar"`);

          await check({ authorization: "Bearer fake-token" }, 200);
        });
      });
    });
  });

  /**
   * Tests for CORS allowed origin.
   */
  describe("allowedOrigin", function() {
    it("should respond with correct CORS headers", async function() {
      const { serverUrl, home, userApi, chimpy, nobody } = getCtx();
      const wid = await getWorkspaceId(userApi as UserAPIImpl, "Private");
      const docId = await userApi.newDoc({ name: "CorsTestDoc" }, wid);
      await userApi.updateDocPermissions(docId, {
        users: {
          "everyone@getgrist.com": "owners",
        },
      });

      const chimpyConfig = { ...chimpy };
      const anonConfig = { ...nobody };
      delete chimpyConfig.headers!["X-Requested-With"];
      delete anonConfig.headers!["X-Requested-With"];

      let allowedOrigin;

      // Target a more realistic Host than "localhost:port"
      // (if behind a proxy, we already benefit from a custom and realistic host).
      if (!home.proxiedServer) {
        anonConfig.headers!.Host = chimpyConfig.headers!.Host =
          "api.example.com";
        allowedOrigin = "http://front.example.com";
      } else {
        allowedOrigin = serverUrl;
      }

      const url = `${serverUrl}/api/docs/${docId}/tables/Table1/records`;
      const data = { records: [{ fields: {} }] };

      const forbiddenOrigin = "http://evil.com";

      // Normal same origin requests
      anonConfig.headers!.Origin = allowedOrigin;
      let response: AxiosResponse;
      for (response of [
        await axios.post(url, data, anonConfig),
        await axios.get(url, anonConfig),
        await axios.options(url, anonConfig),
      ]) {
        assert.equal(response.status, 200);
        assert.equal(response.headers["access-control-allow-methods"], "GET, PATCH, PUT, POST, DELETE, OPTIONS");
        assert.equal(response.headers["access-control-allow-headers"], "Authorization, Content-Type, X-Requested-With");
        assert.equal(response.headers["access-control-allow-origin"], allowedOrigin);
        assert.equal(response.headers["access-control-allow-credentials"], "true");
      }

      // Cross origin requests from untrusted origin.
      for (const config of [anonConfig, chimpyConfig]) {
        config.headers!.Origin = forbiddenOrigin;
        for (response of [
          await axios.post(url, data, config),
          await axios.get(url, config),
          await axios.options(url, config),
        ]) {
          if (config === anonConfig) {
            // Requests without credentials are still OK.
            assert.equal(response.status, 200);
          } else {
            assert.equal(response.status, 403);
            assert.deepEqual(response.data, { error: "Credentials not supported for cross-origin requests" });
          }
          assert.equal(response.headers["access-control-allow-methods"], "GET, PATCH, PUT, POST, DELETE, OPTIONS");
          // Authorization header is not allowed
          assert.equal(response.headers["access-control-allow-headers"], "Content-Type, X-Requested-With");
          // Origin is not echoed back. Arbitrary origin is allowed, but credentials are not.
          assert.equal(response.headers["access-control-allow-origin"], "*");
          assert.equal(response.headers["access-control-allow-credentials"], undefined);
        }
      }

      // POST requests without credentials require a custom header so that a CORS preflight request is triggered.
      // One possible header is X-Requested-With, which we removed at the start of the test.
      // The other is Content-Type: application/json, which we have been using implicitly above because axios
      // automatically treats the given data object as data. Passing a string instead prevents this.
      response = await axios.post(url, JSON.stringify(data), anonConfig);
      assert.equal(response.status, 401);
      assert.deepEqual(response.data, {
        error: "Unauthenticated requests require one of the headers" +
          "'Content-Type: application/json' or 'X-Requested-With: XMLHttpRequest'",
      });

      // ^ that's for requests without credentials, otherwise we get the same 403 as earlier.
      response = await axios.post(url, JSON.stringify(data), chimpyConfig);
      assert.equal(response.status, 403);
      assert.deepEqual(response.data, { error: "Credentials not supported for cross-origin requests" });
    });
  });
}
