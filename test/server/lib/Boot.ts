import { BOOT_KEY_PROVIDER_KEY } from "app/common/loginProviders";
import { getBootKeySessionId } from "app/server/lib/Boot";
import { GristServer } from "app/server/lib/GristServer";
import { SessionStore } from "app/server/lib/gristSessions";
import { Sessions } from "app/server/lib/Sessions";

import * as path from "path";

import * as session from "@gristlabs/express-session";
import { promisifyAll } from "bluebird";
import { assert } from "chai";
import { Request } from "express";
import * as tmp from "tmp";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const SQLiteStore = require("@gristlabs/connect-sqlite3")(session);
promisifyAll(SQLiteStore.prototype);

describe("Boot", function() {
  describe("getBootKeySessionId", function() {
    const sessionId = "sid-boot";

    let store: SessionStore;
    let sessions: Sessions;
    let server: GristServer;

    beforeEach(async function() {
      const sessionDB = tmp.fileSync();
      store = new SQLiteStore({
        dir: path.dirname(sessionDB.name),
        db: path.basename(sessionDB.name),
        table: "sessions",
      });
      sessions = new Sessions("not-a-real-secret", store);
      server = { getSessions: () => sessions } as unknown as GristServer;
    });

    function makeRequest(org: string): Request {
      return { org, headers: {}, sessionID: sessionId } as unknown as Request;
    }

    function makeSession(authProvider?: string) {
      return {
        cookie: { maxAge: 60 * 60 * 1000 },
        users: [{
          profile: { email: "admin@example.com", name: "admin" },
          ...(authProvider ? { authProvider } : {}),
        }],
        orgToUser: { docs: 0 },
      };
    }

    it("returns the session id for a boot key session", async function() {
      await store.setAsync(sessionId, makeSession(BOOT_KEY_PROVIDER_KEY));
      assert.equal(await getBootKeySessionId(makeRequest("docs"), server), sessionId);
    });

    it("returns the session id when the request org differs from the boot key login org", async function() {
      await store.setAsync(sessionId, makeSession(BOOT_KEY_PROVIDER_KEY));
      assert.equal(await getBootKeySessionId(makeRequest("someteam"), server), sessionId);
    });

    it("returns undefined when the session has other logins besides the boot key one", async function() {
      const bootSession = makeSession(BOOT_KEY_PROVIDER_KEY);
      bootSession.users.push({ profile: { email: "other@example.com", name: "other" } });
      await store.setAsync(sessionId, bootSession);
      assert.isUndefined(await getBootKeySessionId(makeRequest("docs"), server));
      assert.isUndefined(await getBootKeySessionId(makeRequest("someteam"), server));
    });

    it("returns undefined for a session not established with a boot key", async function() {
      await store.setAsync(sessionId, makeSession());
      assert.isUndefined(await getBootKeySessionId(makeRequest("docs"), server));
      assert.isUndefined(await getBootKeySessionId(makeRequest("someteam"), server));
    });

    it("returns undefined when the request has no session", async function() {
      const req = { org: "docs", headers: {} } as unknown as Request;
      assert.isUndefined(await getBootKeySessionId(req, server));
    });
  });
});
