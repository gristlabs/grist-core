import * as minio from "minio";
import sinon from "sinon";
import * as stream from "node:stream";

import {MinIOExternalStorage} from "app/server/lib/MinIOExternalStorage";
import {assert} from "chai";

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

      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3);
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
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3);
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
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3);

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
        .returns(fakeStream)
        .callsFake(() => fakeStream.emit('error', error));
      s3.listObjects.returns(fakeStream);
      const extStorage = new MinIOExternalStorage(dummyBucket, dummyOptions, 42, s3);

      // when
      const result = extStorage.versions(key);

      // then
      return assert.isRejected(result, error);
    });
  });
});