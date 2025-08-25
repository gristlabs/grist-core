import * as minio from "minio";
import sinon from "sinon";
import * as stream from "node:stream";
import fse from "fs-extra";
import {MinIOExternalStorage} from "app/server/lib/MinIOExternalStorage";
import {assert} from "chai";
import {waitForIt} from "test/server/wait";

describe("MinIOExternalStorage", function () {
  const sandbox = sinon.createSandbox();
  const FakeClientClass = class extends minio.Client {
    public listObjects(
      bucket: string,
      key: string,
      recursive: boolean,
      options?: {IncludeVersion?: boolean}
    ): minio.BucketStream<minio.BucketItem> {
      return new stream.Readable();
    }
  };
  const dummyBucket = 'some-bucket';
  const dummyOptions = {
    endPoint: 'some-endpoint',
    accessKey: 'some-accessKey',
    secretKey: 'some-secretKey',
    region: 'some-region',
  };
  afterEach(function () {
    sandbox.restore();
  });

  // Extend MinIOExternalStorage to allow injecting a mock client for testing
  class TestMinIOExternalStorage extends MinIOExternalStorage {
    constructor(
      bucket: string,
      options: any,
      batchSize?: number,
      mockClient?: any
    ) {
      super(bucket, options, batchSize);
      if (mockClient) {
        (this as any)._s3 = mockClient;
      }
    }
  }

  describe('upload()', function () {
    const filename = "some-filename";
    let filestream: fse.ReadStream;
    let s3: sinon.SinonStubbedInstance<minio.Client>;
    let extStorage: TestMinIOExternalStorage;

    beforeEach(function () {
      filestream = new stream.Readable() as any;
      sandbox.stub(fse, "lstat").resolves({} as any);
      sandbox.stub(fse, "createReadStream").withArgs(filename).returns(filestream as any);
      s3 = sandbox.createStubInstance(minio.Client);
      extStorage = new TestMinIOExternalStorage(
        dummyBucket,
        dummyOptions,
        undefined,
        s3 as any
      );
    });

    it("should call putObject with the right arguments", async function () {
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

    it("should close the file even if putObject fails", async function () {
      s3.putObject.rejects(new Error("some-error"));

      await assert.isRejected(extStorage.upload("some-key", filename), "some-error");

      assert.isTrue(filestream.destroyed);
    });
  });

  describe('versions()', function () {
    function makeFakeStream(listedObjects: object[]) {
      const fakeStream = new stream.Readable({objectMode: true});
      const readSpy = sandbox.stub(fakeStream, "_read");
      for (const [index, obj] of listedObjects.entries()) {
        readSpy.onCall(index).callsFake(() => fakeStream.push(obj));
      }
      readSpy.onCall(listedObjects.length).callsFake(() => fakeStream.push(null));
      return {fakeStream, readSpy};
    }

    it("should call listObjects with the right arguments", async function () {
      const s3 = sandbox.createStubInstance(FakeClientClass);
      const key = "some-key";
      const expectedRecursive = false;
      const expectedOptions = {IncludeVersion: true};
      const {fakeStream} = makeFakeStream([]);

      s3.listObjects.returns(fakeStream);

      const extStorage = new TestMinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);
      const result = await extStorage.versions(key);

      assert.deepEqual(result, []);
      assert.isTrue(s3.listObjects.calledWith(dummyBucket, key, expectedRecursive, expectedOptions));
    });

    // This test can be removed once this PR is merged: https://github.com/minio/minio-js/pull/1193
    // and when the minio-js version used as a dependency includes that patch.
    //
    // For more context: https://github.com/gristlabs/grist-core/pull/577
    it("should return versionId's as string when return snapshotId is an integer", async function () {
      // given
      const s3 = sandbox.createStubInstance(FakeClientClass);
      const key = "some-key";
      const versionId = 123;
      const lastModified = new Date();
      const {fakeStream, readSpy} = makeFakeStream([
        {
          name: key,
          lastModified,
          versionId,
        }
      ]);

      s3.listObjects.returns(fakeStream);
      const extStorage = new TestMinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);
      // when
      const result = await extStorage.versions(key);
      // then
      assert.equal(readSpy.callCount, 2);
      assert.deepEqual(result, [{
        lastModified: lastModified.toISOString(),
        snapshotId: String(versionId)
      }]);
    });

    it("should include markers only when asked through options", async function () {
      // given
      const s3 = sandbox.createStubInstance(FakeClientClass);
      const key = "some-key";
      const lastModified = new Date();
      const objectsFromS3 = [
        {
          name: key,
          lastModified,
          versionId: 'regular-version-uuid',
          isDeleteMarker: false
        },
        {
          name: key,
          lastModified,
          versionId: 'delete-marker-version-uuid',
          isDeleteMarker: true
        }
      ];
      let {fakeStream} = makeFakeStream(objectsFromS3);

      s3.listObjects.returns(fakeStream);
      const extStorage = new TestMinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);

      // when
      const result = await extStorage.versions(key);

      // then
      assert.deepEqual(result, [{
        lastModified: lastModified.toISOString(),
        snapshotId: objectsFromS3[0].versionId
      }]);

      // given
      fakeStream = makeFakeStream(objectsFromS3).fakeStream;
      s3.listObjects.returns(fakeStream);

      // when
      const resultWithDeleteMarkers = await extStorage.versions(key, {includeDeleteMarkers: true});

      // then
      assert.deepEqual(resultWithDeleteMarkers, [{
        lastModified: lastModified.toISOString(),
        snapshotId: objectsFromS3[0].versionId
      }, {
        lastModified: lastModified.toISOString(),
        snapshotId: objectsFromS3[1].versionId
      }]);
    });

    it("should reject when an error occurs while listing objects", function () {
      // given
      const s3 = sandbox.createStubInstance(FakeClientClass);
      const key = "some-key";
      const fakeStream = new stream.Readable({objectMode: true});
      const error = new Error("dummy-error");
      sandbox.stub(fakeStream, "_read")
        .returns(fakeStream as any)
        .callsFake(() => fakeStream.emit('error', error));
      s3.listObjects.returns(fakeStream);
      const extStorage = new TestMinIOExternalStorage(dummyBucket, dummyOptions, 42, s3 as any);

      // when
      const result = extStorage.versions(key);

      // then
      return assert.isRejected(result, error);
    });
  });
});
