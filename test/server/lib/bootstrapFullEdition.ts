import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { HomeDBManager } from "app/gen-server/lib/homedb/HomeDBManager";
import {
  Deps, maybeManageFullEdition, resolveFullEditionWorker,
} from "app/server/lib/bootstrapFullEdition";
import { checksumFile } from "app/server/lib/checksumFile";
import { Edition } from "app/server/lib/configCore";
import * as globalConfig from "app/server/lib/globalConfig";
import { createInitialDb, removeConnection, setUpDB } from "test/gen-server/seed";
import * as testUtils from "test/server/testUtils";
import { EnvironmentSnapshot } from "test/server/testUtils";

import * as http from "http";
import { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";

import { assert } from "chai";
import * as fse from "fs-extra";
import sinon from "sinon";
import * as tar from "tar";

const STAMP_FILE = ".grist-full-edition-stamp";

const FULL_URL = "https://example.test/grist-full-edition-amd64.tar.gz";

function fullEditionDir(instRoot: string): string {
  return path.join(instRoot, "ext", "grist-full-edition");
}

describe("bootstrapFullEdition", function() {
  this.timeout(30000);
  testUtils.setTmpLogLevel("error");

  let oldEnv: EnvironmentSnapshot;
  const sandbox = sinon.createSandbox();

  before(function() {
    oldEnv = new EnvironmentSnapshot();
  });

  after(function() {
    oldEnv.restore();
  });

  describe("resolveFullEditionWorker", function() {
    let instRoot: string;
    let dir: string;

    beforeEach(async function() {
      instRoot = await fse.mkdtemp(path.join(os.tmpdir(), "grist-fe-inst-"));
      process.env.GRIST_INST_DIR = instRoot;
      process.env.GRIST_EXT_FULL_EDITION_URL = FULL_URL;
      dir = fullEditionDir(instRoot);
      await fse.mkdirp(dir);
    });

    afterEach(async function() {
      await fse.remove(instRoot).catch(() => undefined);
      sandbox.restore();
    });

    it("returns the relocated fork spec when a current copy is on disk", async function() {
      await fse.writeFile(path.join(dir, STAMP_FILE), `${FULL_URL}\n`);

      const spec = resolveFullEditionWorker();
      assert.isNotNull(spec);
      const root = path.join(dir, "grist");
      assert.equal(spec!.entryPoint, path.join(root, "_build", "stubs", "app", "server", "server.js"));
      assert.equal(spec!.cwd, root);
      assert.equal(spec!.env!.NODE_PATH, [
        path.join(root, "_build"),
        path.join(root, "_build", "ext"),
        path.join(root, "_build", "stubs"),
      ].join(path.delimiter));
    });

    it("returns null when there is no stamp", function() {
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null when the stamp is stale", async function() {
      await fse.writeFile(path.join(dir, STAMP_FILE), "https://example.test/some-other-build.tar.gz");
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null when the url is unset", function() {
      delete process.env.GRIST_EXT_FULL_EDITION_URL;
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null and never throws on an unreadable stamp", async function() {
      await fse.mkdirp(path.join(dir, STAMP_FILE));
      assert.isNull(resolveFullEditionWorker());
    });

    it("drops the stamp when the relocated worker fails to spawn", async function() {
      await fse.writeFile(path.join(dir, STAMP_FILE), FULL_URL);
      const spec = resolveFullEditionWorker();
      assert.isNotNull(spec);
      spec!.onSpawnFailure!();
      assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)));
      assert.isNull(resolveFullEditionWorker());
    });
  });

  describe("maybeManageFullEdition", function() {
    let instRoot: string;
    let dir: string;
    let fileServer: http.Server | undefined;
    let editionValue: Edition;

    before(async function() {
      await removeConnection();
      process.env.TYPEORM_DATABASE = ":memory:";
      setUpDB(this);
      await createInitialDb();
    });

    after(async function() {
      await removeConnection();
    });

    beforeEach(async function() {
      instRoot = await fse.mkdtemp(path.join(os.tmpdir(), "grist-fe-inst-"));
      process.env.GRIST_INST_DIR = instRoot;
      process.env.GRIST_EXT_FULL_EDITION_URL = FULL_URL;
      dir = fullEditionDir(instRoot);
      await fse.mkdirp(dir);
      editionValue = "core";
      sandbox.stub(globalConfig, "getGlobalConfig").returns({
        edition: {
          get: () => editionValue,
          set: async (value: Edition) => { editionValue = value; },
        },
      } as any);
    });

    afterEach(async function() {
      sandbox.restore();
      if (fileServer) { fileServer.close(); fileServer = undefined; }
      await fse.remove(instRoot).catch(() => undefined);
    });

    async function setUseExtFullEdition(value: boolean): Promise<void> {
      const db = new HomeDBManager();
      await db.connect();
      await new ActivationsManager(db).updatePrefs({ useExtFullEdition: value });
    }

    function edition(): Edition {
      return editionValue;
    }

    async function writeStamp(url: string): Promise<void> {
      await fse.writeFile(path.join(dir, STAMP_FILE), url);
    }

    async function makePayloadDirs(): Promise<void> {
      await fse.mkdirp(path.join(dir, "grist"));
      await fse.mkdirp(path.join(dir, "node_modules"));
    }

    it("is a no-op when the feature is not configured", async function() {
      delete process.env.GRIST_EXT_FULL_EDITION_URL;
      await setUseExtFullEdition(true);
      await makePayloadDirs();
      await writeStamp("stale");

      const { restartRequested } = await maybeManageFullEdition();
      assert.isFalse(restartRequested);
      assert.isTrue(await fse.pathExists(path.join(dir, STAMP_FILE)));
      assert.isTrue(await fse.pathExists(path.join(dir, "grist")));
    });

    it("reverts: drops the stamp and requests restart without deleting the payload", async function() {
      editionValue = "enterprise";
      await setUseExtFullEdition(false);
      await makePayloadDirs();
      await writeStamp(FULL_URL);

      const { restartRequested } = await maybeManageFullEdition();
      assert.isTrue(restartRequested);
      assert.equal(edition(), "core");
      assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)), "stamp should be dropped");
      assert.isTrue(await fse.pathExists(path.join(dir, "grist")));
      assert.isTrue(await fse.pathExists(path.join(dir, "node_modules")));
    });

    it("already current: keeps edition in sync and requests no restart", async function() {
      await setUseExtFullEdition(true);
      await makePayloadDirs();
      await writeStamp(FULL_URL);

      const { restartRequested } = await maybeManageFullEdition();
      assert.isFalse(restartRequested);
      assert.equal(edition(), "enterprise");
      assert.isTrue(await fse.pathExists(path.join(dir, STAMP_FILE)));
      assert.isTrue(await fse.pathExists(path.join(dir, "grist")));
    });

    it("disabled cleanup: reclaims a leftover payload", async function() {
      await setUseExtFullEdition(false);
      await makePayloadDirs();

      const { restartRequested } = await maybeManageFullEdition();
      assert.isFalse(restartRequested);
      assert.equal(edition(), "core");
      assert.isFalse(await fse.pathExists(path.join(dir, "grist")), "payload should be reclaimed");
      assert.isFalse(await fse.pathExists(path.join(dir, "node_modules")));
    });

    describe("install + checksum", function() {
      let src: string;
      let tarball: string;
      let tarballSha: string;
      let url: string;

      beforeEach(async function() {
        src = await fse.mkdtemp(path.join(os.tmpdir(), "grist-fe-fixture-"));
        await fse.mkdirp(path.join(src, "grist"));
        await fse.mkdirp(path.join(src, "node_modules"));
        await fse.writeFile(path.join(src, "grist", "marker"), "x");
        await fse.writeFile(path.join(src, "node_modules", "marker"), "x");
        tarball = path.join(src, "payload.tar.gz");
        await tar.c({ file: tarball, cwd: src, gzip: true }, ["grist", "node_modules"]);
        tarballSha = await checksumFile(tarball, "sha256");

        fileServer = http.createServer((_req, res) => {
          res.writeHead(200);
          fse.createReadStream(tarball).pipe(res);
        });
        await new Promise<void>(resolve => fileServer!.listen(0, resolve));
        url = `http://localhost:${(fileServer.address() as AddressInfo).port}/payload.tar.gz`;
        process.env.GRIST_EXT_FULL_EDITION_URL = url;
        await setUseExtFullEdition(true);
      });

      afterEach(async function() {
        await fse.remove(src).catch(() => undefined);
      });

      it("installs a verified copy, then sets edition and requests restart", async function() {
        process.env.GRIST_EXT_FULL_EDITION_SHA256 = tarballSha;

        const { restartRequested } = await maybeManageFullEdition();
        assert.isTrue(restartRequested);
        assert.equal(edition(), "enterprise");
        assert.equal((await fse.readFile(path.join(dir, STAMP_FILE), "utf8")).trim(), url);
        assert.isTrue(await fse.pathExists(path.join(dir, "grist", "marker")));
        assert.isTrue(await fse.pathExists(path.join(dir, "node_modules", "marker")));
      });

      it("upgrades over an existing copy, replacing its payload and stamp", async function() {
        process.env.GRIST_EXT_FULL_EDITION_SHA256 = tarballSha;
        // A stale copy is already installed: a different stamp and old payload content that
        // the upgrade must replace (exercising the move-old-out-of-the-way swap).
        await makePayloadDirs();
        await fse.writeFile(path.join(dir, "grist", "old-marker"), "old");
        await writeStamp("https://example.test/old-build.tar.gz");

        const { restartRequested } = await maybeManageFullEdition();
        assert.isTrue(restartRequested);
        assert.equal(edition(), "enterprise");
        // Stamp advanced to the new URL, and the new payload replaced the old one.
        assert.equal((await fse.readFile(path.join(dir, STAMP_FILE), "utf8")).trim(), url);
        assert.isTrue(await fse.pathExists(path.join(dir, "grist", "marker")));
        assert.isFalse(await fse.pathExists(path.join(dir, "grist", "old-marker")),
          "stale payload should be gone");
        assert.isTrue(await fse.pathExists(path.join(dir, "node_modules", "marker")));
      });

      it("rejects a checksum mismatch: no install, stays on built-in edition", async function() {
        sandbox.stub(Deps, "installAttempts").value(1);
        sandbox.stub(Deps, "installRetryDelayMs").value(0);
        process.env.GRIST_EXT_FULL_EDITION_SHA256 = "deadbeef";

        const { restartRequested } = await maybeManageFullEdition();
        assert.isFalse(restartRequested);
        assert.equal(edition(), "core", "edition must not flip to enterprise on a failed install");
        assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)));
      });

      it("refuses to install without a built-in checksum", async function() {
        sandbox.stub(Deps, "installAttempts").value(1);
        sandbox.stub(Deps, "installRetryDelayMs").value(0);
        delete process.env.GRIST_EXT_FULL_EDITION_SHA256;

        const { restartRequested } = await maybeManageFullEdition();
        assert.isFalse(restartRequested);
        assert.equal(edition(), "core");
        assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)));
      });
    });
  });
});
