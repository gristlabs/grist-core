import { Config } from "app/gen-server/entity/Config";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import axios from "axios";
import * as chai from "chai";
import omit from "lodash/omit";
import { TestServer } from "test/gen-server/apiUtils";
import { configForUser } from "test/gen-server/testUtils";
import * as testUtils from "test/server/testUtils";

describe("OrgConfig", function () {
  const assert = chai.assert;

  let server: TestServer;
  let dbManager: HomeDBManager;
  let homeUrl: string;

  const chimpy = configForUser("Chimpy");
  const kiwi = configForUser("Kiwi");
  const support = configForUser("Support");
  const anonymous = configForUser("Anonymous");

  const chimpyEmail = "chimpy@getgrist.com";

  let oid: number | string;

  let oldEnv: testUtils.EnvironmentSnapshot;

  testUtils.setTmpLogLevel("error");

  async function insertSampleConfig() {
    await dbManager.connection.transaction(async (manager) =>
      manager
        .createQueryBuilder()
        .insert()
        .into(Config)
        .values([
          {
            key: "audit_log_streaming_destinations",
            value: [
              {
                id: "4e9f3c26-d069-43f2-8388-1f0f906c0ca3",
                name: "splunk",
                url: "https://hec.example.com:8088/services/collector/event",
                token: "Splunk B5A79AAD-D822-46CC-80D1-819F80D7BFB0",
              },
            ],
            org: () => String(oid),
          },
        ])
        .execute()
    );
  }

  async function deleteConfigs() {
    await dbManager.connection.transaction((manager) =>
      manager.createQueryBuilder().delete().from(Config).execute()
    );
  }

  before(async function () {
    oldEnv = new testUtils.EnvironmentSnapshot();
    process.env.GRIST_DEFAULT_EMAIL = chimpyEmail;
    server = new TestServer(this);
    homeUrl = await server.start(["home"]);
    dbManager = server.dbManager;
    oid = (await dbManager.testGetId("NASA")) as number;
  });

  after(async function () {
    oldEnv.restore();
    await server.stop();
  });

  describe("GET /api/orgs/:oid/configs/:key", async function () {
    after(async function () {
      await deleteConfigs();
    });

    it("returns 200 on success", async function () {
      await insertSampleConfig();
      const resp = await axios.get(
        `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 200);
      assert.deepEqual(omit(resp.data, "createdAt", "updatedAt"), {
        org: { name: "NASA", id: 1, domain: "nasa" },
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
      });
      assert.hasAllKeys(resp.data, [
        "org",
        "id",
        "key",
        "value",
        "createdAt",
        "updatedAt",
      ]);
    });

    it("returns 400 if key is invalid", async function () {
      const resp = await axios.get(
        `${homeUrl}/api/orgs/${oid}/configs/invalid`,
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

    it("returns 403 if user isn't an owner", async function () {
      for (const user of [kiwi, anonymous, support]) {
        const resp = await axios.get(
          `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
          user
        );
        assert.equal(resp.status, 403);
        assert.deepEqual(resp.data, { error: "access denied" });
      }
    });

    it("returns 404 if key doesn't exist", async function () {
      await dbManager.connection.transaction((manager) =>
        manager.createQueryBuilder().delete().from(Config).execute()
      );

      const resp = await axios.get(
        `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 404);
      assert.deepEqual(resp.data, {
        error: "config not found",
      });
    });
  });

  describe("PUT /api/orgs/:oid/configs/:key", async function () {
    after(async function () {
      await deleteConfigs();
    });

    function testCreateOrUpdate({ status }: { status: 200 | 201 }) {
      return async function () {
        const resp1 = await axios.put(
          `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
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
          org: { name: "NASA", id: 1, domain: "nasa" },
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
          "org",
          "id",
          "key",
          "value",
          "createdAt",
          "updatedAt",
        ]);

        const resp2 = await axios.get(
          `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
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
        `${homeUrl}/api/orgs/${oid}/configs/invalid`,
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
        `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
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
        `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
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

    it("returns 403 if user isn't an owner", async function () {
      for (const user of [kiwi, anonymous, support]) {
        const resp = await axios.put(
          `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
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
        assert.deepEqual(resp.data, { error: "access denied" });
      }
    });
  });

  describe("DELETE /api/orgs/:oid/configs/:key", async function () {
    after(async function () {
      await deleteConfigs();
    });

    it("returns 200 on success", async function () {
      await insertSampleConfig();
      let resp = await axios.delete(
        `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 200);
      assert.equal(resp.data, null);

      resp = await axios.get(
        `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
        chimpy
      );
      assert.equal(resp.status, 404);
      assert.deepEqual(resp.data, {
        error: "config not found",
      });
    });

    it("returns 400 if key is invalid", async function () {
      const resp = await axios.delete(
        `${homeUrl}/api/orgs/${oid}/configs/invalid`,
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

    it("returns 403 if user isn't an owner", async function () {
      await insertSampleConfig();
      for (const user of [kiwi, anonymous, support]) {
        const resp = await axios.delete(
          `${homeUrl}/api/orgs/${oid}/configs/audit_log_streaming_destinations`,
          user
        );
        assert.equal(resp.status, 403);
        assert.deepEqual(resp.data, { error: "access denied" });
      }
    });
  });
});
