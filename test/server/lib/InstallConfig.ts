import { Config } from "app/gen-server/entity/Config";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import axios from "axios";
import * as chai from "chai";
import omit from "lodash/omit";
import { TestServer } from "test/gen-server/apiUtils";
import { configForUser } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";

describe("InstallConfig", function () {
  const assert = chai.assert;

  let server: TestServer;
  let dbManager: HomeDBManager;
  let homeUrl: string;

  const chimpy = configForUser("Chimpy");
  const kiwi = configForUser("Kiwi");
  const support = configForUser("Support");
  const anonymous = configForUser("Anonymous");

  const chimpyEmail = "chimpy@getgrist.com";

  let oldEnv: testUtils.EnvironmentSnapshot;

  testUtils.setTmpLogLevel("error");

  before(async function () {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = chimpyEmail;
    server = new TestServer(this);
    homeUrl = await server.start(["home"]);
    dbManager = server.dbManager;
  });

  after(async function () {
    oldEnv.restore();
    await server.stop();
  });

  describe("GET /api/install/configs/:key", async function () {
    let config: Config;

    before(async function () {
      await dbManager.connection.transaction(async (manager) => {
        config = new Config();
        config.key = "audit_log_streaming_destinations";
        config.value = [
          {
            id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
            name: "splunk",
            url: "https://hec.example.com:8088/services/collector/event",
            token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
          },
        ];
        await manager.save(config);
      });
    });

    after(async function () {
      await dbManager.connection.transaction((manager) =>
        manager.createQueryBuilder().delete().from(Config).execute()
      );
    });

    it("returns 200 on success", async function () {
      const resp = await axios.get(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 200);
      assert.deepEqual(resp.data, {
        id: 1,
        key: "audit_log_streaming_destinations",
        value: [
          {
            id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
            name: "splunk",
            url: "https://hec.example.com:8088/services/collector/event",
            token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
          },
        ],
        createdAt: config.createdAt.toISOString(),
        updatedAt: config.updatedAt.toISOString(),
      });
    });

    it("returns 400 if key is invalid", async function () {
      const resp = await axios.get(
        `${homeUrl}/api/install/configs/invalid`,
        chimpy
      );
      assert.equal(resp.status, 400);
      assert.deepEqual(resp.data, {
        error: "Invalid config key",
        details: {
          userError: 'Error: value is not "audit_log_streaming_destinations"',
        },
      });
    });

    it("returns 403 if user isn't an install admin", async function () {
      for (const user of [kiwi, anonymous]) {
        const resp = await axios.get(
          `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
          user
        );
        assert.equal(resp.status, 403);
        assert.deepEqual(resp.data, { error: "Access denied" });
      }

      const resp = await axios.get(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        support
      );
      assert.equal(resp.status, 200);
    });

    it("returns 404 if key doesn't exist", async function () {
      await dbManager.connection.transaction((manager) =>
        manager.remove(config)
      );

      const resp = await axios.get(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 404);
      assert.deepEqual(resp.data, {
        error: "config not found",
      });
    });
  });

  describe("PUT /api/install/configs/:key", async function () {
    after(async function () {
      await dbManager.connection.transaction((manager) =>
        manager.createQueryBuilder().delete().from(Config).execute()
      );
    });

    function testCreateOrUpdate({ status }: { status: 200 | 201 }) {
      return async function () {
        const resp1 = await axios.put(
          `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
          [
            {
              id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
              name: "splunk",
              url: "https://hec.example.com:8088/services/collector/event",
              token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
            },
          ],
          chimpy
        );
        assert.equal(resp1.status, status);
        assert.deepEqual(omit(resp1.data, "createdAt", "updatedAt"), {
          id: 2,
          key: "audit_log_streaming_destinations",
          value: [
            {
              id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
              name: "splunk",
              url: "https://hec.example.com:8088/services/collector/event",
              token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
            },
          ],
        });
        assert.hasAllKeys(resp1.data, [
          "id",
          "key",
          "value",
          "createdAt",
          "updatedAt",
        ]);

        const resp2 = await axios.get(
          `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
          chimpy
        );
        assert.equal(resp2.status, 200);
        assert.deepEqual(resp2.data, resp1.data);
      };
    }

    it(
      "returns 201 if resource was created",
      testCreateOrUpdate({ status: 201 })
    );

    it(
      "returns 200 if resource was updated",
      testCreateOrUpdate({ status: 200 })
    );

    it("returns 400 if key invalid", async function () {
      const resp = await axios.put(
        `${homeUrl}/api/install/configs/invalid`,
        "invalid",
        chimpy
      );
      assert.equal(resp.status, 400);
      assert.deepEqual(resp.data, {
        error: "Invalid config key",
        details: {
          userError: 'Error: value is not "audit_log_streaming_destinations"',
        },
      });
    });

    it("returns 400 if body is invalid", async function () {
      let resp = await axios.put(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        "invalid",
        chimpy
      );
      assert.equal(resp.status, 400);
      assert.deepEqual(resp.data, {
        error: "Invalid config value",
        details: {
          userError: "Error: value is not an array",
        },
      });

      resp = await axios.put(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        ["invalid"],
        chimpy
      );
      assert.equal(resp.status, 400);
      assert.deepEqual(resp.data, {
        error: "Invalid config value",
        details: {
          userError:
            "Error: value[0] is not a AuditLogStreamingDestination; value[0] is not an object",
        },
      });
    });

    it("returns 403 if user isn't an install admin", async function () {
      for (const user of [kiwi, anonymous]) {
        const resp = await axios.put(
          `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
          [
            {
              id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
              name: "splunk",
              url: "https://hec.example.com:8088/services/collector/event",
              token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
            },
          ],
          user
        );
        assert.equal(resp.status, 403);
        assert.deepEqual(resp.data, { error: "Access denied" });
      }

      const resp = await axios.put(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        [
          {
            id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
            name: "splunk",
            url: "https://hec.example.com:8088/services/collector/event",
            token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
          },
        ],
        support
      );
      assert.equal(resp.status, 200);
    });
  });

  describe("DELETE /api/install/configs/:key", async function () {
    before(async function () {
      await dbManager.connection.transaction(async (manager) => {
        const config = new Config();
        config.key = "audit_log_streaming_destinations";
        config.value = [
          {
            id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
            name: "splunk",
            url: "https://hec.example.com:8088/services/collector/event",
            token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
          },
        ];
        await manager.save(config);
      });
    });

    after(async function () {
      await dbManager.connection.transaction((manager) =>
        manager.createQueryBuilder().delete().from(Config).execute()
      );
    });

    it("returns 200 on success", async function () {
      let resp = await axios.delete(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 200);
      assert.equal(resp.data, null);

      resp = await axios.get(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 404);
      assert.deepEqual(resp.data, {
        error: "config not found",
      });
    });

    it("returns 400 if key is invalid", async function () {
      const resp = await axios.delete(
        `${homeUrl}/api/install/configs/invalid`,
        chimpy
      );
      assert.equal(resp.status, 400);
      assert.deepEqual(resp.data, {
        error: "Invalid config key",
        details: {
          userError: 'Error: value is not "audit_log_streaming_destinations"',
        },
      });
    });

    it("returns 403 if user isn't an install admin", async function () {
      for (const user of [kiwi, anonymous]) {
        const resp = await axios.delete(
          `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
          user
        );
        assert.equal(resp.status, 403);
        assert.deepEqual(resp.data, { error: "Access denied" });
      }
    });

    it("returns 404 if key doesn't exist", async function () {
      const resp = await axios.delete(
        `${homeUrl}/api/install/configs/audit_log_streaming_destinations`,
        support
      );
      assert.equal(resp.status, 404);
      assert.deepEqual(resp.data, {
        error: "config not found",
      });
    });
  });
});
