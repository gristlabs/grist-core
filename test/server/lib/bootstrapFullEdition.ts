import { version } from "app/common/version";
import { appSettings } from "app/server/lib/AppSettings";
import {
  Deps, isExtFullEditionSupported, maybeManageFullEdition, resolveFullEditionWorker,
} from "app/server/lib/bootstrapFullEdition";
import { checksumFile } from "app/server/lib/checksumFile";
import { Edition } from "app/server/lib/configCore";
import * as globalConfig from "app/server/lib/globalConfig";
import { getEdition } from "app/server/lib/gristSettings";
import { codeRoot, getAppRoot } from "app/server/lib/places";
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

const IDENTITY = `version:${version}`;

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
      delete process.env.GRIST_EXT_FULL_EDITION_BASE_URL;
      delete process.env.NODE_PATH;
      delete process.env.GRIST_EXT_FULL_EDITION_ACTIVE;
      sandbox.stub(Deps, "hasBuiltInExt").returns(false);
      sandbox.stub(Deps, "isReleaseBuild").returns(true);
      dir = fullEditionDir(instRoot);
      await fse.mkdirp(dir);
    });

    afterEach(async function() {
      await fse.remove(instRoot).catch(() => undefined);
      sandbox.restore();
    });

    it("returns a fork spec layering the extensions onto the local build", async function() {
      await fse.writeFile(path.join(dir, STAMP_FILE), `${IDENTITY}\n`);

      const spec = resolveFullEditionWorker();
      assert.isNotNull(spec);
      const extDir = path.join(dir, "ext");
      const staticDir = path.join(dir, "static");
      assert.equal(spec!.entryPoint, path.join(codeRoot, "stubs", "app", "server", "server.js"));
      assert.equal(spec!.key, `full:${IDENTITY}`);
      assert.equal(spec!.env!.NODE_PATH, [
        codeRoot,
        dir,
        extDir,
        path.join(codeRoot, "stubs"),
        path.join(extDir, "node_modules"),
        path.join(getAppRoot(), "node_modules"),
      ].join(path.delimiter));
      assert.equal(spec!.env!.GRIST_EXT_DIR, extDir);
      assert.equal(spec!.env!.GRIST_STATIC_EXT_DIR, staticDir);
      assert.equal(spec!.env!.GRIST_EXT_FULL_EDITION_ACTIVE, "1");
    });

    it("returns null when there is no stamp", function() {
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null when the stamp is for a different version", async function() {
      await fse.writeFile(path.join(dir, STAMP_FILE), "version:9.9.9");
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null on a non-release build", async function() {
      (Deps.isReleaseBuild as sinon.SinonStub).returns(false);
      await fse.writeFile(path.join(dir, STAMP_FILE), IDENTITY);
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null when derivation is disabled", async function() {
      process.env.GRIST_EXT_FULL_EDITION_BASE_URL = "";
      await fse.writeFile(path.join(dir, STAMP_FILE), IDENTITY);
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null when the build already bundles extensions", async function() {
      (Deps.hasBuiltInExt as sinon.SinonStub).returns(true);
      await fse.writeFile(path.join(dir, STAMP_FILE), IDENTITY);
      assert.isNull(resolveFullEditionWorker());
    });

    it("returns null and never throws on an unreadable stamp", async function() {
      await fse.mkdirp(path.join(dir, STAMP_FILE));
      assert.isNull(resolveFullEditionWorker());
    });
  });

  describe("isExtFullEditionSupported", function() {
    beforeEach(function() {
      delete process.env.GRIST_EXT_FULL_EDITION_BASE_URL;
      delete process.env.GRIST_EXT_FULL_EDITION_ACTIVE;
      sandbox.stub(Deps, "hasBuiltInExt").returns(false);
      sandbox.stub(Deps, "isReleaseBuild").returns(true);
    });

    afterEach(function() {
      sandbox.restore();
    });

    it("is supported on a release build via version derivation", function() {
      assert.isTrue(isExtFullEditionSupported());
    });

    it("is unsupported on a non-release build (main/nightly)", function() {
      (Deps.isReleaseBuild as sinon.SinonStub).returns(false);
      assert.isFalse(isExtFullEditionSupported());
    });

    it("is unsupported when derivation is disabled", function() {
      process.env.GRIST_EXT_FULL_EDITION_BASE_URL = "";
      assert.isFalse(isExtFullEditionSupported());
    });

    it("is unsupported when the build already bundles extensions", function() {
      (Deps.hasBuiltInExt as sinon.SinonStub).returns(true);
      assert.isFalse(isExtFullEditionSupported());
    });

    it("is supported for an extensions worker even with built-in extensions", function() {
      (Deps.hasBuiltInExt as sinon.SinonStub).returns(true);
      (Deps.isReleaseBuild as sinon.SinonStub).returns(false);
      process.env.GRIST_EXT_FULL_EDITION_ACTIVE = "1";
      assert.isTrue(isExtFullEditionSupported());
    });
  });

  describe("maybeManageFullEdition", function() {
    let instRoot: string;
    let dir: string;
    let fileServer: http.Server | undefined;
    let editionValue: Edition;

    beforeEach(async function() {
      instRoot = await fse.mkdtemp(path.join(os.tmpdir(), "grist-fe-inst-"));
      process.env.GRIST_INST_DIR = instRoot;
      delete process.env.GRIST_EXT_FULL_EDITION_BASE_URL;
      delete process.env.GRIST_EXT_FULL_EDITION_ACTIVE;
      delete process.env.GRIST_EDITION;
      setEdition(undefined);
      sandbox.stub(Deps, "hasBuiltInExt").returns(false);
      sandbox.stub(Deps, "isReleaseBuild").returns(true);
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
      setEdition(undefined);
      await fse.remove(instRoot).catch(() => undefined);
    });

    function setEdition(value: string | undefined): void {
      appSettings.setEnvVars(value === undefined ? {} : { GRIST_EDITION: value });
      getEdition.cache.clear();
    }

    function edition(): Edition {
      return editionValue;
    }

    async function writeStamp(identity: string): Promise<void> {
      await fse.writeFile(path.join(dir, STAMP_FILE), identity);
    }

    async function makePayloadDirs(): Promise<void> {
      await fse.mkdirp(path.join(dir, "ext"));
      await fse.mkdirp(path.join(dir, "static"));
    }

    it("is a no-op on a non-release build", async function() {
      (Deps.isReleaseBuild as sinon.SinonStub).returns(false);
      setEdition("full");
      await makePayloadDirs();
      await writeStamp("stale");

      const { restartRequested } = await maybeManageFullEdition();
      assert.isFalse(restartRequested);
      assert.isTrue(await fse.pathExists(path.join(dir, STAMP_FILE)));
      assert.isTrue(await fse.pathExists(path.join(dir, "ext")));
    });

    it("is a no-op when the build already bundles extensions", async function() {
      (Deps.hasBuiltInExt as sinon.SinonStub).returns(true);
      setEdition("full");
      await makePayloadDirs();
      await writeStamp("stale");

      const { restartRequested } = await maybeManageFullEdition();
      assert.isFalse(restartRequested);
      assert.isTrue(await fse.pathExists(path.join(dir, "ext")));
      assert.equal(edition(), "core", "global config must not be touched by an ext build");
    });

    it("reverts: drops the stamp and requests restart without deleting the payload", async function() {
      editionValue = "enterprise";
      setEdition("community");
      await makePayloadDirs();
      await writeStamp(IDENTITY);

      const { restartRequested } = await maybeManageFullEdition();
      assert.isTrue(restartRequested);
      assert.equal(edition(), "core");
      assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)), "stamp should be dropped");
      assert.isTrue(await fse.pathExists(path.join(dir, "ext")));
      assert.isTrue(await fse.pathExists(path.join(dir, "static")));
    });

    it("already current: keeps edition in sync and requests no restart", async function() {
      setEdition("full");
      await makePayloadDirs();
      await writeStamp(IDENTITY);

      const { restartRequested } = await maybeManageFullEdition();
      assert.isFalse(restartRequested);
      assert.equal(edition(), "enterprise");
      assert.isTrue(await fse.pathExists(path.join(dir, STAMP_FILE)));
      assert.isTrue(await fse.pathExists(path.join(dir, "ext")));
    });

    it("disabled cleanup: reclaims a leftover payload", async function() {
      setEdition("community");
      await makePayloadDirs();

      const { restartRequested } = await maybeManageFullEdition();
      assert.isFalse(restartRequested);
      assert.equal(edition(), "core");
      assert.isFalse(await fse.pathExists(path.join(dir, "ext")), "payload should be reclaimed");
      assert.isFalse(await fse.pathExists(path.join(dir, "static")));
    });

    it("does not download when the storage directory is not writable", async function() {
      // Root ignores directory permissions, so this check can't be exercised as root.
      if (process.getuid?.() === 0) { this.skip(); }

      sandbox.stub(Deps, "installAttempts").value(1);
      sandbox.stub(Deps, "installRetryDelayMs").value(0);
      await fse.chmod(dir, 0o500);
      setEdition("full");

      try {
        const { restartRequested } = await maybeManageFullEdition();
        assert.isFalse(restartRequested);
        assert.equal(edition(), "core");
      } finally {
        await fse.chmod(dir, 0o700).catch(() => undefined);
      }
    });

    describe("download + install", function() {
      let src: string;
      let tarball: string;
      let tarballSha: string;
      let base: string;
      // The manifest body served for this test; null serves a 404.
      let manifestBody: string | null;

      beforeEach(async function() {
        src = await fse.mkdtemp(path.join(os.tmpdir(), "grist-fe-fixture-"));
        await fse.mkdirp(path.join(src, "ext"));
        await fse.mkdirp(path.join(src, "static"));
        await fse.writeFile(path.join(src, "ext", "marker"), "x");
        await fse.writeFile(path.join(src, "static", "marker"), "x");
        tarball = path.join(src, "payload.tar.gz");
        await tar.c({ file: tarball, cwd: src, gzip: true }, ["ext", "static"]);
        tarballSha = await checksumFile(tarball, "sha256");

        fileServer = http.createServer((req, res) => {
          if (req.url === `/by-version/${version}.json`) {
            if (manifestBody === null) { res.writeHead(404); res.end(); return; }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(manifestBody);
          } else if (req.url === "/payload.tar.gz") {
            res.writeHead(200);
            fse.createReadStream(tarball).pipe(res);
          } else {
            res.writeHead(404);
            res.end();
          }
        });
        await new Promise<void>(resolve => fileServer!.listen(0, resolve));
        base = `http://localhost:${(fileServer.address() as AddressInfo).port}`;
        process.env.GRIST_EXT_FULL_EDITION_BASE_URL = base;
        manifestBody = JSON.stringify({ url: `${base}/payload.tar.gz`, sha256: tarballSha });
        setEdition("full");
      });

      afterEach(async function() {
        await fse.remove(src).catch(() => undefined);
      });

      it("derives, installs verified extensions, sets edition and requests restart", async function() {
        const { restartRequested } = await maybeManageFullEdition();
        assert.isTrue(restartRequested);
        assert.equal(edition(), "enterprise");
        assert.equal((await fse.readFile(path.join(dir, STAMP_FILE), "utf8")).trim(), IDENTITY);
        assert.isTrue(await fse.pathExists(path.join(dir, "ext", "marker")));
        assert.isTrue(await fse.pathExists(path.join(dir, "static", "marker")));
      });

      it("upgrades over an existing copy, replacing its payload and stamp", async function() {
        // A stale copy is already installed: a different stamp and old payload content that
        // the upgrade must replace (exercising the move-old-out-of-the-way swap).
        await makePayloadDirs();
        await fse.writeFile(path.join(dir, "ext", "old-marker"), "old");
        await writeStamp("version:9.9.9");

        const { restartRequested } = await maybeManageFullEdition();
        assert.isTrue(restartRequested);
        assert.equal(edition(), "enterprise");
        assert.equal((await fse.readFile(path.join(dir, STAMP_FILE), "utf8")).trim(), IDENTITY);
        assert.isTrue(await fse.pathExists(path.join(dir, "ext", "marker")));
        assert.isFalse(await fse.pathExists(path.join(dir, "ext", "old-marker")),
          "stale payload should be gone");
        assert.isTrue(await fse.pathExists(path.join(dir, "static", "marker")));
      });

      it("rejects a checksum mismatch: no install, stays on built-in edition", async function() {
        sandbox.stub(Deps, "installAttempts").value(1);
        sandbox.stub(Deps, "installRetryDelayMs").value(0);
        manifestBody = JSON.stringify({ url: `${base}/payload.tar.gz`, sha256: "deadbeef" });

        const { restartRequested } = await maybeManageFullEdition();
        assert.isFalse(restartRequested);
        assert.equal(edition(), "core", "edition must not flip to enterprise on a failed install");
        assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)));
      });

      it("stays on core when the manifest is missing", async function() {
        sandbox.stub(Deps, "installAttempts").value(1);
        sandbox.stub(Deps, "installRetryDelayMs").value(0);
        manifestBody = null;

        const { restartRequested } = await maybeManageFullEdition();
        assert.isFalse(restartRequested);
        assert.equal(edition(), "core");
        assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)));
      });

      it("stays on core when the manifest is malformed", async function() {
        sandbox.stub(Deps, "installAttempts").value(1);
        sandbox.stub(Deps, "installRetryDelayMs").value(0);
        manifestBody = "{ not json";

        const { restartRequested } = await maybeManageFullEdition();
        assert.isFalse(restartRequested);
        assert.equal(edition(), "core");
        assert.isFalse(await fse.pathExists(path.join(dir, STAMP_FILE)));
      });
    });
  });
});
