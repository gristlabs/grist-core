import { checkMinIOExternalStorage } from "app/server/lib/configureMinIOExternalStorage";
import { EnvironmentSnapshot } from "test/server/testUtils";

import { assert } from "chai";

describe("configureMinIOExternalStorage", function() {
  let oldEnv: EnvironmentSnapshot;

  beforeEach(function() {
    oldEnv = new EnvironmentSnapshot();
    for (const key of Object.keys(process.env)) {
      if (/^(GRIST_DOCS_(MINIO|S3)_|TEST_MINIO_)/.test(key)) { delete process.env[key]; }
    }
  });

  afterEach(function() {
    oldEnv.restore();
  });

  it("is off without a bucket", function() {
    assert.isUndefined(checkMinIOExternalStorage());
  });

  it("reads GRIST_DOCS_S3_* settings", function() {
    process.env.GRIST_DOCS_S3_BUCKET = "b";
    process.env.GRIST_DOCS_S3_PREFIX = "p/";
    process.env.GRIST_DOCS_S3_ENDPOINT = "store.example.com";
    process.env.GRIST_DOCS_S3_PORT = "9000";
    process.env.GRIST_DOCS_S3_USE_SSL = "0";
    process.env.GRIST_DOCS_S3_BUCKET_REGION = "r";
    process.env.GRIST_DOCS_S3_ACCESS_KEY = "ak";
    process.env.GRIST_DOCS_S3_SECRET_KEY = "sk";
    assert.deepEqual(checkMinIOExternalStorage(), {
      bucket: "b", prefix: "p/", endPoint: "store.example.com", port: 9000, useSSL: false,
      region: "r", accessKey: "ak", secretKey: "sk",
    });
  });

  it("accepts the older GRIST_DOCS_MINIO_* names", function() {
    process.env.GRIST_DOCS_MINIO_BUCKET = "b";
    process.env.GRIST_DOCS_MINIO_PREFIX = "p/";
    process.env.GRIST_DOCS_MINIO_ENDPOINT = "store.example.com";
    process.env.GRIST_DOCS_MINIO_PORT = "9000";
    process.env.GRIST_DOCS_MINIO_USE_SSL = "0";
    process.env.GRIST_DOCS_MINIO_BUCKET_REGION = "r";
    process.env.GRIST_DOCS_MINIO_ACCESS_KEY = "ak";
    process.env.GRIST_DOCS_MINIO_SECRET_KEY = "sk";
    assert.deepEqual(checkMinIOExternalStorage(), {
      bucket: "b", prefix: "p/", endPoint: "store.example.com", port: 9000, useSSL: false,
      region: "r", accessKey: "ak", secretKey: "sk",
    });
  });

  it("prefers GRIST_DOCS_S3_* when both are set", function() {
    process.env.GRIST_DOCS_S3_BUCKET = "new";
    process.env.GRIST_DOCS_MINIO_BUCKET = "old";
    process.env.GRIST_DOCS_S3_ENDPOINT = "store.example.com";
    process.env.GRIST_DOCS_S3_ACCESS_KEY = "ak";
    process.env.GRIST_DOCS_S3_SECRET_KEY = "sk";
    assert.equal(checkMinIOExternalStorage()?.bucket, "new");
  });

  it("requires an endpoint once a bucket is set", function() {
    process.env.GRIST_DOCS_S3_BUCKET = "b";
    assert.throws(() => checkMinIOExternalStorage(), /missing GRIST_DOCS_S3_ENDPOINT/);
  });
});
