import { checkMinIOExternalStorage } from "app/server/lib/configureMinIOExternalStorage";
import { makeId } from "app/server/lib/idUtils";
import { MinIOExternalStorage } from "app/server/lib/MinIOExternalStorage";
import { waitForIt } from "test/server/wait";

import * as stream from "node:stream";

import { assert } from "chai";
import fse from "fs-extra";
import * as minio from "minio";
import sinon from "sinon";

describe("MinIOExternalStorage", function() {
  const sandbox = sinon.createSandbox();
  const dummyBucket = "some-bucket";
  const dummyOptions = {
    endPoint: "some-endpoint",
    accessKey: "some-accessKey",
    secretKey: "some-secretKey",
    region: "some-region",
  };
  afterEach(function() {
    sandbox.restore();
  });

  describe("upload()", function() {
    const filename = "some-filename";
    let filestream: fse.ReadStream;
    let s3: sinon.SinonStubbedInstance<minio.Client>;
    let extStorage: MinIOExternalStorage;

    beforeEach(function() {
      filestream = new stream.Readable() as any;
      sandbox.stub(fse, "lstat").resolves({} as any);
      sandbox.stub(fse, "createReadStream").withArgs(filename).returns(filestream as any);
      s3 = sandbox.createStubInstance(minio.Client);
      extStorage = new MinIOExternalStorage(
        dummyBucket,
        dummyOptions,
        undefined,
        s3 as any,
      );
    });

    it("should call putObject with the right arguments", async function() {
      const putObjectPromise = sinon.promise<Awaited<ReturnType<typeof s3.putObject>>>();
      s3.putObject
        .withArgs(dummyBucket, "some-key", filestream, undefined, undefined)
        .returns(putObjectPromise as any);

      const uploadPromise = extStorage.upload("some-key", filename);

      await waitForIt(() => sinon.assert.called(s3.putObject));
      assert.isFalse(filestream.destroyed,
        "filestream should not be destroyed before putObject resolves");

      await putObjectPromise.resolve({ versionId: "some-versionId", etag: "some-etag" });
      assert.equal(await uploadPromise, "some-versionId");

      assert.isTrue(filestream.destroyed,
        "filestream should be destroyed after putObject resolves");
    });

    it("should close the file even if putObject fails", async function() {
      s3.putObject.rejects(new Error("some-error"));

      await assert.isRejected(extStorage.upload("some-key", filename), "some-error");

      assert.isTrue(filestream.destroyed);
    });
  });

  describe("versions()", function() {
    function makeClient(pages: object[]) {
      const s3 = sandbox.createStubInstance(minio.Client);
      for (const [index, page] of pages.entries()) {
        s3.listObjectsQuery.onCall(index).resolves(page as any);
      }
      return s3;
    }

    it("should call listObjectsQuery with the right arguments", async function() {
      const s3 = makeClient([{ objects: [], isTruncated: false }]);
      const key = "some-key";

      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);
      const result = await extStorage.versions(key);

      assert.deepEqual(result, []);
      sinon.assert.calledOnceWithExactly(s3.listObjectsQuery, dummyBucket, key, "", {
        Delimiter: "/",
        MaxKeys: 42,
        IncludeVersion: true,
        keyMarker: "",
        versionIdMarker: "",
      });
    });

    // This test can be removed once this PR is merged: https://github.com/minio/minio-js/pull/1193
    // and when the minio-js version used as a dependency includes that patch.
    //
    // For more context: https://github.com/gristlabs/grist-core/pull/577
    it("should return versionId's as string when return snapshotId is an integer", async function() {
      // given
      const key = "some-key";
      const versionId = 123;
      const lastModified = new Date();
      const s3 = makeClient([{
        objects: [{ name: key, lastModified, versionId }],
        isTruncated: false,
      }]);
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);
      // when
      const result = await extStorage.versions(key);
      // then
      assert.deepEqual(result, [{
        lastModified: lastModified.toISOString(),
        snapshotId: String(versionId),
      }]);
    });

    it("should include markers only when asked through options", async function() {
      // given
      const key = "some-key";
      const lastModified = new Date();
      const objectsFromS3 = [
        {
          name: key,
          lastModified,
          versionId: "regular-version-uuid",
          isDeleteMarker: false,
        },
        {
          name: key,
          lastModified,
          versionId: "delete-marker-version-uuid",
          isDeleteMarker: true,
        },
      ];
      const s3 = sandbox.createStubInstance(minio.Client);
      s3.listObjectsQuery.resolves({ objects: objectsFromS3, isTruncated: false } as any);
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);

      // when
      const result = await extStorage.versions(key);

      // then
      assert.deepEqual(result, [{
        lastModified: lastModified.toISOString(),
        snapshotId: objectsFromS3[0].versionId,
      }]);

      // when
      const resultWithDeleteMarkers = await extStorage.versions(key, { includeDeleteMarkers: true });

      // then
      assert.deepEqual(resultWithDeleteMarkers, [{
        lastModified: lastModified.toISOString(),
        snapshotId: objectsFromS3[0].versionId,
      }, {
        lastModified: lastModified.toISOString(),
        snapshotId: objectsFromS3[1].versionId,
      }]);
    });

    it("should follow truncated listings, escaping the markers", async function() {
      // given
      const key = "docs/some doc+id.grist";
      const lastModified = new Date();
      const version = (versionId: string) => ({ name: key, lastModified, versionId });
      // With encoding-type=url, the store returns the key marker url-encoded.
      const encodedKey = "docs/some+doc%2Bid.grist";
      const s3 = makeClient([
        { objects: [version("v1"), version("v2")], isTruncated: true,
          keyMarker: encodedKey, versionIdMarker: "v2/x=" },
        { objects: [version("v3")], isTruncated: true,
          keyMarker: encodedKey, versionIdMarker: "v3" },
        { objects: [version("v4")], isTruncated: false },
      ]);
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);

      // when
      const result = await extStorage.versions(key);

      // then
      assert.deepEqual(result.map(v => v.snapshotId), ["v1", "v2", "v3", "v4"]);
      assert.deepEqual(s3.listObjectsQuery.args.map(args => args[3]), [
        { Delimiter: "/", MaxKeys: 42, IncludeVersion: true, keyMarker: "", versionIdMarker: "" },
        { Delimiter: "/", MaxKeys: 42, IncludeVersion: true,
          keyMarker: "docs%2Fsome%20doc%2Bid.grist", versionIdMarker: "v2%2Fx%3D" },
        { Delimiter: "/", MaxKeys: 42, IncludeVersion: true,
          keyMarker: "docs%2Fsome%20doc%2Bid.grist", versionIdMarker: "v3" },
      ]);
    });

    it("should reject a truncated listing that does not advance", async function() {
      // given
      const key = "docs/some-id.grist";
      const page = {
        objects: [{ name: key, lastModified: new Date(), versionId: "v1" }],
        isTruncated: true,
        keyMarker: key,
        versionIdMarker: "v1",
      };
      const s3 = sandbox.createStubInstance(minio.Client);
      s3.listObjectsQuery.resolves(page as any);
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);

      // when
      const result = extStorage.versions(key);

      // then
      await assert.isRejected(result, /not advancing/);
      sinon.assert.calledTwice(s3.listObjectsQuery);
    });

    it("should reject when an error occurs while listing objects", function() {
      // given
      const s3 = sandbox.createStubInstance(minio.Client);
      const key = "some-key";
      const error = new Error("dummy-error");
      s3.listObjectsQuery.rejects(error);
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);

      // when
      const result = extStorage.versions(key);

      // then
      return assert.isRejected(result, error);
    });
  });

  describe("with a real server", function() {
    let extStorage: MinIOExternalStorage;
    let prefix: string;

    before(function() {
      const options = checkMinIOExternalStorage();
      if (!options) { this.skip(); }
      // Request tiny pages, so that listings span several of them.
      extStorage = new MinIOExternalStorage(options.bucket, options, 2);
      prefix = `${options.prefix}test-${makeId()}/`;
    });

    after(async function() {
      if (!extStorage) { return; }
      await extStorage.removeAllWithPrefix(prefix);
      assert.deepEqual(await extStorage.versions(`${prefix}some doc+id.grist`), []);
    });

    it("should list versions spanning several pages", async function() {
      const key = `${prefix}some doc+id.grist`;
      const uploaded: string[] = [];
      for (let i = 0; i < 5; i++) {
        const content = Buffer.from(`version ${i}`);
        uploaded.push((await extStorage.uploadStream(key, stream.Readable.from([content]), content.length))!);
      }
      const versions = await extStorage.versions(key);
      assert.sameMembers(versions.map(v => v.snapshotId), uploaded);
    });
  });
});
