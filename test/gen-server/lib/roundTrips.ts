import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import { testStartQueryCounting } from "app/gen-server/lib/TypeORMPatches";
import { TestServer } from "test/gen-server/apiUtils";
import * as testUtils from "test/server/testUtils";

import { assert } from "chai";

describe("roundTrips", function() {
  let server: TestServer;
  let home: HomeDBManager;
  testUtils.setTmpLogLevel("error");

  before(async function() {
    server = new TestServer(this);
    await server.start();
    home = server.dbManager;
  });

  after(async function() {
    await server.stop();
  });

  it("counts statements", async function() {
    const stop = testStartQueryCounting();
    await home.connection.query("SELECT 1");
    assert.equal(stop().count, 1);
  });

  it("does not count while stopped", async function() {
    const stop = testStartQueryCounting();
    stop();
    await home.connection.query("SELECT 1");
    assert.equal(stop().count, 0);
  });

  it("reads a known user in one statement", async function() {
    await home.getUserByLogin("kiwi@getgrist.com");

    const stop = testStartQueryCounting();
    const user = await home.getUserByLogin("kiwi@getgrist.com");
    const { count } = stop();

    assert.equal(user.name, "Kiwi");
    assert.equal(count, 1);
  });
});
