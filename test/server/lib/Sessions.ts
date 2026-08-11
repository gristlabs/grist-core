import { SessionStore } from "app/server/lib/gristSessions";
import { Sessions } from "app/server/lib/Sessions";

import * as path from "path";

import * as session from "@gristlabs/express-session";
import { promisifyAll } from "bluebird";
import { assert } from "chai";
import * as tmp from "tmp";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SQLiteStore = require("@gristlabs/connect-sqlite3")(session);
promisifyAll(SQLiteStore.prototype);

describe("Sessions", function() {
  let store: SessionStore;
  let sessions: Sessions;

  beforeEach(async function() {
    const sessionDB = tmp.fileSync();
    store = new SQLiteStore({
      dir: path.dirname(sessionDB.name),
      db: path.basename(sessionDB.name),
      table: "sessions",
    });
    sessions = new Sessions("not-a-real-secret", store);
  });

  // The SQLite store reads `cookie.maxAge` when writing, so sessions need one.
  function makeSession(email: string) {
    return {
      cookie: { maxAge: 60 * 60 * 1000 },
      users: [{ profile: { email, name: email } }],
      orgToUser: { docs: 0 },
    };
  }

  describe("clearAllSessions", function() {
    it("removes every session when no id is kept", async function() {
      await store.setAsync("sid-a", makeSession("a@example.com"));
      await store.setAsync("sid-b", makeSession("b@example.com"));

      await sessions.clearAllSessions();

      assert.isNotOk(await store.getAsync("sid-a"));
      assert.isNotOk(await store.getAsync("sid-b"));
    });

    it("keeps the named session and removes the rest", async function() {
      await store.setAsync("sid-keep", makeSession("keep@example.com"));
      await store.setAsync("sid-drop", makeSession("drop@example.com"));

      await sessions.clearAllSessions("sid-keep");

      assert.isNotOk(await store.getAsync("sid-drop"));
      const kept = await store.getAsync("sid-keep");
      assert.equal(kept?.users?.[0]?.profile?.email, "keep@example.com");
    });

    it("clears everything when the id to keep is not in the store", async function() {
      await store.setAsync("sid-a", makeSession("a@example.com"));

      await sessions.clearAllSessions("sid-gone");

      assert.isNotOk(await store.getAsync("sid-a"));
      assert.isNotOk(await store.getAsync("sid-gone"));
    });
  });
});
