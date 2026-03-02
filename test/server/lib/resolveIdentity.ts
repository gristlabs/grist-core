import { ApiError } from "app/common/ApiError";
import { UserProfile } from "app/common/LoginSessionAPI";
import { ServiceAccount } from "app/gen-server/entity/ServiceAccount";
import { User } from "app/gen-server/entity/User";
import { HomeDBAuth } from "app/gen-server/lib/homedb/Interfaces";
import { AccessTokenInfo, IAccessTokens } from "app/server/lib/AccessTokens";
import { resolveIdentity } from "app/server/lib/Authorizer";
import { createDummyGristServer, GristServer } from "app/server/lib/GristServer";
import { InstallAdmin } from "app/server/lib/InstallAdmin";
import { IPermitStore, Permit } from "app/server/lib/Permit";

import { IncomingMessage } from "http";

import { assert } from "chai";

function makeUser(id: number, name: string, extra?: Partial<User>): User {
  return { id, name, disabledAt: null, type: "login", ...extra } as User;
}

const ANON_ID = 1;
const ANON = makeUser(ANON_ID, "Anonymous");
const ALICE = makeUser(10, "Alice");
const ALICE_PROFILE: UserProfile = { email: "alice@x.com", name: "Alice" };
const ADMIN = makeUser(99, "Admin");

function makeRequest(url: string = "/test", headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as IncomingMessage;
}

function makeDbManager(overrides?: Partial<HomeDBAuth>): HomeDBAuth {
  return {
    getAnonymousUserId: () => ANON_ID,
    getSupportUserId: () => 2,
    getAnonymousUser: () => ANON,
    getUser: async () => undefined,
    getUserByKey: async () => undefined,
    getUserByLogin: async () => ALICE,
    getUserByLoginWithRetry: async () => ALICE,
    getBestUserForOrg: async () => null,
    getServiceAccountByLoginWithOwner: async () => null,
    makeFullUser: (user: User) => ({
      id: user.id, name: user.name, email: "", loginEmail: "",
    }),
    ...overrides,
  } as HomeDBAuth;
}

function makePermitStore(overrides?: Partial<IPermitStore>): IPermitStore {
  return {
    getPermit: async () => null,
    setPermit: async () => "",
    removePermit: async () => {},
    close: async () => {},
    getKeyPrefix: () => "test",
    ...overrides,
  };
}

function opts(extra?: Partial<Parameters<typeof resolveIdentity>[2]>): Parameters<typeof resolveIdentity>[2] {
  return {
    gristServer: createDummyGristServer(),
    permitStore: makePermitStore(),
    ...extra,
  };
}

describe("resolveIdentity", function() {
  it("returns anonymous when no credentials are provided", async function() {
    const result = await resolveIdentity(makeRequest(), makeDbManager(), opts());
    assert.equal(result.user.id, ANON_ID);
    assert.isFalse(result.hasApiKey);
    assert.isFalse(result.explicitAuth);
    assert.isUndefined(result.accessToken);
    assert.isUndefined(result.specialPermit);
  });

  describe("access token", function() {
    it("resolves access token from ?auth query param", async function() {
      const tokenInfo: AccessTokenInfo = { userId: 10, docId: "doc1", readOnly: false };
      const result = await resolveIdentity(
        makeRequest("/test?auth=tok"), makeDbManager(),
        opts({
          gristServer: {
            ...createDummyGristServer(),
            getAccessTokens: () => ({
              verify: async (t: string) => {
                if (t === "tok") { return tokenInfo; }
                throw new ApiError("bad token", 401);
              },
            } as IAccessTokens),
          },
        }),
      );
      assert.equal(result.user.id, ANON_ID, "access token uses anonymous user");
      assert.deepEqual(result.accessToken, tokenInfo);
      assert.isFalse(result.explicitAuth, "access token keeps CSRF enforced");
    });

    it("access token takes priority over API key", async function() {
      const tokenInfo: AccessTokenInfo = { userId: 10, docId: "doc1", readOnly: false };
      const db = makeDbManager({ getUserByKey: async () => ALICE });
      const result = await resolveIdentity(
        makeRequest("/test?auth=tok", { authorization: "Bearer good-key" }), db,
        opts({
          gristServer: {
            ...createDummyGristServer(),
            getAccessTokens: () => ({
              verify: async () => tokenInfo,
            } as unknown as IAccessTokens),
          },
        }),
      );
      assert.isDefined(result.accessToken, "access token wins");
      assert.isFalse(result.hasApiKey, "API key not used");
    });
  });

  describe("API key", function() {
    it("resolves user from valid API key", async function() {
      const db = makeDbManager({ getUserByKey: async k => k === "good" ? ALICE : undefined });
      const result = await resolveIdentity(
        makeRequest("/test", { authorization: "Bearer good" }), db, opts(),
      );
      assert.equal(result.user.id, ALICE.id);
      assert.isTrue(result.hasApiKey);
      assert.isTrue(result.explicitAuth);
    });

    it("throws on invalid API key", async function() {
      const db = makeDbManager({ getUserByKey: async () => undefined });
      try {
        await resolveIdentity(
          makeRequest("/test", { authorization: "Bearer bad" }), db, opts(),
        );
        assert.fail("should have thrown");
      } catch (err: any) {
        assert.equal(err.status, 401);
        assert.match(err.message, /invalid API key/);
      }
    });

    it("rejects API key for anonymous user", async function() {
      const db = makeDbManager({ getUserByKey: async () => ANON });
      try {
        await resolveIdentity(
          makeRequest("/test", { authorization: "Bearer anon-key" }), db, opts(),
        );
        assert.fail("should have thrown");
      } catch (err: any) {
        assert.equal(err.status, 401);
        assert.match(err.message, /anonymous/i);
      }
    });

    it("rejects expired service account", async function() {
      const svcUser = makeUser(20, "SvcBot", { type: "service", loginEmail: "bot@svc" } as any);
      const db = makeDbManager({
        getUserByKey: async () => svcUser,
        getServiceAccountByLoginWithOwner: async () => ({
          owner: makeUser(10, "Owner"),
          isActive: () => false,
        } as unknown as ServiceAccount),
      });
      try {
        await resolveIdentity(
          makeRequest("/test", { authorization: "Bearer svc-key" }), db, opts(),
        );
        assert.fail("should have thrown");
      } catch (err: any) {
        assert.equal(err.status, 401);
        assert.match(err.message, /expired/i);
      }
    });

    it("rejects service account whose owner is disabled", async function() {
      const svcUser = makeUser(20, "SvcBot", { type: "service", loginEmail: "bot@svc" } as any);
      const db = makeDbManager({
        getUserByKey: async () => svcUser,
        getServiceAccountByLoginWithOwner: async () => ({
          owner: makeUser(10, "Owner", { disabledAt: new Date() }),
          isActive: () => true,
        } as unknown as ServiceAccount),
      });
      try {
        await resolveIdentity(
          makeRequest("/test", { authorization: "Bearer svc-key" }), db, opts(),
        );
        assert.fail("should have thrown");
      } catch (err: any) {
        assert.equal(err.status, 403);
        assert.match(err.message, /disabled/i);
      }
    });

    it("ignores non-Bearer authorization header", async function() {
      const result = await resolveIdentity(
        makeRequest("/test", { authorization: "Basic dXNlcjpwYXNz" }),
        makeDbManager(), opts(),
      );
      assert.equal(result.user.id, ANON_ID);
      assert.isFalse(result.hasApiKey);
    });
  });

  describe("boot key", function() {
    it("resolves admin user from valid boot key", async function() {
      const result = await resolveIdentity(
        makeRequest("/test", { "x-boot-key": "secret-boot" }), makeDbManager(),
        opts({
          gristServer: {
            ...createDummyGristServer(),
            getBootKey: () => "secret-boot",
            getInstallAdmin: () => ({ getAdminUser: async () => ADMIN } as InstallAdmin),
          },
        }),
      );
      assert.equal(result.user.id, ADMIN.id);
      assert.isTrue(result.explicitAuth);
    });

    it("throws on invalid boot key", async function() {
      try {
        await resolveIdentity(
          makeRequest("/test", { "x-boot-key": "wrong" }), makeDbManager(),
          opts({
            gristServer: { ...createDummyGristServer(), getBootKey: () => "real-key" },
          }),
        );
        assert.fail("should have thrown");
      } catch (err: any) {
        assert.equal(err.status, 401);
        assert.match(err.message, /invalid Boot key/);
      }
    });

    it("boot key takes priority over API key", async function() {
      const db = makeDbManager({ getUserByKey: async () => ALICE });
      const result = await resolveIdentity(
        makeRequest("/test", { "authorization": "Bearer good", "x-boot-key": "bk" }), db,
        opts({
          gristServer: {
            ...createDummyGristServer(),
            getBootKey: () => "bk",
            getInstallAdmin: () => ({ getAdminUser: async () => ADMIN } as InstallAdmin),
          },
        }),
      );
      assert.equal(result.user.id, ADMIN.id, "boot key wins over API key");
      assert.isFalse(result.hasApiKey);
    });
  });

  describe("permit", function() {
    it("resolves permit as anonymous with specialPermit", async function() {
      const permit: Permit = { docId: "doc1" };
      const permitStore = makePermitStore({
        getPermit: async k => k === "pk" ? permit : null,
      });
      const result = await resolveIdentity(
        makeRequest("/test", { permit: "pk" }), makeDbManager(),
        opts({ permitStore }),
      );
      assert.equal(result.user.id, ANON_ID);
      assert.deepEqual(result.specialPermit, permit);
      assert.isTrue(result.explicitAuth);
    });

    it("permit overrides API key", async function() {
      const permit: Permit = { docId: "doc1" };
      const db = makeDbManager({ getUserByKey: async () => ALICE });
      const permitStore = makePermitStore({
        getPermit: async () => permit,
      });
      const result = await resolveIdentity(
        makeRequest("/test", { authorization: "Bearer key", permit: "pk" }), db,
        opts({ permitStore }),
      );
      assert.equal(result.user.id, ANON_ID, "permit sets anonymous");
      assert.isDefined(result.specialPermit);
      assert.isFalse(result.hasApiKey, "API key not reported when permit takes over");
    });

    it("throws on unknown permit", async function() {
      try {
        await resolveIdentity(
          makeRequest("/test", { permit: "bad" }), makeDbManager(), opts(),
        );
        assert.fail("should have thrown");
      } catch (err: any) {
        assert.equal(err.status, 401);
        assert.match(err.message, /unknown permit/);
      }
    });

    it("throws when permit store errors", async function() {
      try {
        await resolveIdentity(
          makeRequest("/test", { permit: "pk" }), makeDbManager(),
          opts({ permitStore: makePermitStore({ getPermit: async () => { throw new Error("redis down"); } }) }),
        );
        assert.fail("should have thrown");
      } catch (err: any) {
        assert.equal(err.status, 401);
        assert.match(err.message, /permit could not be read/);
      }
    });
  });

  describe("override profile", function() {
    it("resolves user from override profile", async function() {
      const result = await resolveIdentity(makeRequest(), makeDbManager(), {
        ...opts(),
        overrideProfile: async () => ALICE_PROFILE,
      });
      assert.equal(result.user.id, ALICE.id);
      assert.isFalse(result.explicitAuth, "forward-auth is ambient, not explicit");
    });

    it("override profile returning null means anonymous (skip session)", async function() {
      const sessionCalled = { value: false };
      const result = await resolveIdentity(makeRequest(), makeDbManager(), {
        ...opts(),
        overrideProfile: async () => null,
        getSessionProfile: async () => { sessionCalled.value = true; return { profile: null }; },
      });
      assert.equal(result.user.id, ANON_ID);
      assert.isFalse(sessionCalled.value, "session should be skipped after null override");
    });

    it("override profile returning undefined falls through to session", async function() {
      const result = await resolveIdentity(makeRequest(), makeDbManager(), {
        ...opts(),
        overrideProfile: async () => undefined,
        getSessionProfile: async () => ({ profile: ALICE_PROFILE }),
      });
      assert.equal(result.user.id, ALICE.id);
    });
  });

  describe("session", function() {
    it("resolves user from session profile", async function() {
      const result = await resolveIdentity(makeRequest(), makeDbManager(), {
        ...opts(),
        getSessionProfile: async () => ({ profile: ALICE_PROFILE }),
      });
      assert.equal(result.user.id, ALICE.id);
      assert.isFalse(result.explicitAuth);
    });

    it("session with null profile falls through to anonymous", async function() {
      const result = await resolveIdentity(makeRequest(), makeDbManager(), {
        ...opts(),
        getSessionProfile: async () => ({ profile: null }),
      });
      assert.equal(result.user.id, ANON_ID);
    });
  });

  describe("priority", function() {
    it("full priority: access token > boot key > permit > API key > override > session", async function() {
      // When everything is present except access token, boot key wins.
      const db = makeDbManager({ getUserByKey: async () => ALICE });
      const permit: Permit = { docId: "d" };
      const gristServer: GristServer = {
        ...createDummyGristServer(),
        getBootKey: () => "bk",
        getInstallAdmin: () => ({ getAdminUser: async () => ADMIN } as InstallAdmin),
      };
      const permitStore = makePermitStore({ getPermit: async () => permit });

      const result = await resolveIdentity(
        makeRequest("/test", { "authorization": "Bearer key", "x-boot-key": "bk", "permit": "pk" }),
        db,
        {
          gristServer, permitStore,
          overrideProfile: async () => ALICE_PROFILE,
          getSessionProfile: async () => ({ profile: ALICE_PROFILE }),
        },
      );
      assert.equal(result.user.id, ADMIN.id, "boot key wins");

      // Without boot key, permit wins over API key.
      const result2 = await resolveIdentity(
        makeRequest("/test", { authorization: "Bearer key", permit: "pk" }),
        db,
        {
          ...opts({ permitStore }),
          overrideProfile: async () => ALICE_PROFILE,
          getSessionProfile: async () => ({ profile: ALICE_PROFILE }),
        },
      );
      assert.isDefined(result2.specialPermit, "permit wins over API key");
      assert.equal(result2.user.id, ANON_ID);
    });
  });
});
