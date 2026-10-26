import { ApiError } from "app/common/ApiError";
import { ObjMetadata, ObjSnapshotWithMetadata, toExternalMetadata, toGristMetadata } from "app/common/DocSnapshot";
import { ExternalStorage, StreamDownloadResult } from "app/server/lib/ExternalStorage";

import { IncomingMessage } from "http";
import * as stream from "node:stream";

import * as fse from "fs-extra";
import * as minio from "minio";

// The minio-js v8.0.0 typings are sometimes incorrect. Here are some workarounds.
interface MinIOClient extends
  // Some of them are not directly extendable, must be omitted first and then redefined.
  Omit<minio.Client, "listObjectsQuery" | "getBucketVersioning" | "removeObjects">
{
  // The official typing returns `Promise<Readable>`, dropping some useful metadata.
  getObject(bucket: string, key: string, options: { versionId?: string }): Promise<IncomingMessage>;
  // The official typing drops the version-specific fields of listed objects.
  listObjectsQuery(bucket: string, prefix: string, marker: string, options: {
    Delimiter: string,
    MaxKeys: number,
    IncludeVersion: boolean,
    keyMarker?: string,
    versionIdMarker?: string,
  }): Promise<MinIOVersionListing>;
  // The released v8.0.0 wrongly returns `Promise<void>`; borrowed from PR #1297
  getBucketVersioning(bucketName: string): Promise<MinIOVersioningStatus>;
  // The released v8.0.0 typing is outdated; copied over from commit 8633968.
  removeObjects(bucketName: string, objectsList: RemoveObjectsParam): Promise<RemoveObjectsResponse[]>
}

type MinIOVersioningStatus = "" | {
  Status: "Enabled" | "Suspended",
  MFADelete?: string,
  ExcludeFolders?: boolean,
  ExcludedPrefixes?: { Prefix: string }[]
};

interface MinIOVersionListing {
  objects: MinIOObjectVersion[];
  isTruncated?: boolean;
  keyMarker?: string;
  versionIdMarker?: string;
}

interface MinIOObjectVersion {
  name?: string;
  lastModified?: Date;
  versionId?: string;
  isDeleteMarker?: boolean;
}

type RemoveObjectsParam = string[] | { name: string, versionId?: string }[];

type RemoveObjectsResponse = null | undefined | {
  Error?: {
    Code?: string
    Message?: string
    Key?: string
    VersionId?: string
  }
};

/**
 * An external store implemented using the MinIO client, which
 * will work with MinIO and other S3-compatible storage.
 */
export class MinIOExternalStorage implements ExternalStorage {
  // Specify bucket to use, and optionally the max number of keys to request
  // in any call to listObjectVersions (used for testing)
  constructor(
    public bucket: string,
    public options: {
      endPoint: string,
      port?: number,
      useSSL?: boolean,
      accessKey: string,
      secretKey: string,
      region: string
    },
    private _batchSize?: number,
    private _s3 = new minio.Client(options) as unknown as MinIOClient,
  ) {
  }

  public async exists(key: string, snapshotId?: string) {
    return Boolean(await this.head(key, snapshotId));
  }

  public async head(key: string, snapshotId?: string): Promise<ObjSnapshotWithMetadata | null> {
    try {
      const head = await this._s3.statObject(
        this.bucket, key,
        snapshotId ? { versionId: snapshotId } : {},
      );
      if (!head.lastModified || !head.versionId) {
        // AWS documentation says these fields will be present.
        throw new Error("MinIOExternalStorage.head did not get expected fields");
      }
      return {
        lastModified: head.lastModified.toISOString(),
        snapshotId: head.versionId,
        ...head.metaData && { metadata: toGristMetadata(head.metaData) },
      };
    } catch (err) {
      // NotFound and NoSuchKey are "expected" errors when checking for existence of a document
      // and should return a falsy null.
      // Other errors like 'ECONNRESET' and 'InternalError' are fatal errors and should be thrown
      // in order to avoid weird behavior when MinIO is experiencing hiccups
      if (this.isExpectedNotFoundError(err)) { return null; }
      throw err;
    }
  }

  public async uploadStream(key: string, inStream: stream.Readable, size?: number, metadata?: ObjMetadata) {
    const result = await this._s3.putObject(
      this.bucket, key, inStream, size,
      metadata ? { Metadata: toExternalMetadata(metadata) } : undefined,
    );
    // Empirically VersionId is available in result for buckets with versioning enabled.
    return result.versionId || null;
  }

  public async upload(key: string, fname: string, metadata?: ObjMetadata) {
    // calling putObject with a file size will let MinIO be clever about uploading in multiple parts or not.
    const stat = await fse.lstat(fname);
    const filestream = fse.createReadStream(fname);
    try {
      return await this.uploadStream(key, filestream, stat.size, metadata);
    } finally {
      filestream.destroy();
    }
  }

  public async downloadStream(key: string, snapshotId?: string): Promise<StreamDownloadResult> {
    const request = await this._s3.getObject(
      this.bucket, key,
      snapshotId ? { versionId: snapshotId } : {},
    );
    const statusCode = request.statusCode || 500;
    if (statusCode >= 300) {
      throw new ApiError("download error", statusCode);
    }
    // See https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/requests-using-stream-objects.html
    // for an example of streaming data.
    const headers = request.headers;
    // For a versioned bucket, the header 'x-amz-version-id' contains a version id.
    const downloadedSnapshotId = String(headers["x-amz-version-id"] || "");
    const fileSize = Number(headers["content-length"]);
    if (Number.isNaN(fileSize)) {
      throw new ApiError("download error - bad file size", 500);
    }
    return {
      metadata: {
        snapshotId: downloadedSnapshotId,
        size: fileSize,
      },
      contentStream: request,
    };
  }

  public async download(key: string, fname: string, snapshotId?: string) {
    const fileStream = fse.createWriteStream(fname);
    const download = await this.downloadStream(key, snapshotId);
    await stream.promises.pipeline(download.contentStream, fileStream);
    return download.metadata.snapshotId;
  }

  public async remove(key: string, snapshotIds?: string[]) {
    if (snapshotIds) {
      await this._deleteVersions(key, snapshotIds);
    } else {
      await this._deleteAllVersions(key);
    }
  }

  public async removeAllWithPrefix(prefix: string) {
    const objects = await this._listVersions(prefix, true);
    const objectsToDelete = objects.filter(o => o.name !== undefined).map(o => ({
      name: o.name!,
      versionId: o.versionId,
    }));
    await this._deleteObjects(objectsToDelete);
  }

  public async hasVersioning(): Promise<boolean> {
    const versioning = await this._s3.getBucketVersioning(this.bucket);
    // getBucketVersioning() may return an empty string when versioning has never been enabled.
    // This situation is not addressed in minio-js v8.0.0, but included in our workaround.
    return versioning !== "" && versioning?.Status === "Enabled";
  }

  public async versions(key: string, options?: { includeDeleteMarkers?: boolean }) {
    const results = await this._listVersions(key, false);
    return results
      .filter(v => v.name === key &&
        v.lastModified && v.versionId &&
        (options?.includeDeleteMarkers || !v.isDeleteMarker))
      .map(v => ({
        lastModified: v.lastModified!.toISOString(),
        // Circumvent inconsistency of MinIO API with versionId by casting it to string
        // PR to MinIO so we don't have to do that anymore:
        // https://github.com/minio/minio-js/pull/1193
        snapshotId: String(v.versionId),
      }));
  }

  public url(key: string) {
    return `minio://${this.bucket}/${key}`;
  }

  public isFatalError(err: any) {
    // Fatal errors are all errors that are neither expected nor retryable.
    return !this.isExpectedNotFoundError(err) && !this.isRetryableError(err);
  }

  public isExpectedNotFoundError(err: any) {
    // NotFound and NoSuchKey are "expected" errors when checking for existence of a document
    // Other errors like 'ECONNRESET' and 'InternalError' were added to the list by mistake
    // which caused problems like overriding an existing document when MinIO was experiencing hiccups.
    return err.code === "NotFound" || err.code === "NoSuchKey";
  }

  public isRetryableError(err: any) {
    // Retry MinIO requests on some common transient errors.
    return err.code === "ECONNRESET" || err.code === "InternalError" ||
      err.code === "EAI_AGAIN";
  }

  public async close() {
    // nothing to do
  }

  // Delete all versions of an object.
  public async _deleteAllVersions(key: string) {
    const vs = await this.versions(key, { includeDeleteMarkers: true });
    await this._deleteVersions(key, vs.map(v => v.snapshotId));
  }

  // Delete a batch of versions for an object.
  private async _deleteVersions(key: string, versions: (string | undefined)[]) {
    return this._deleteObjects(
      versions.filter(v => v).map(versionId => ({
        name: key,
        versionId,
      })),
    );
  }

  // Delete an arbitrary number of objects, batched appropriately.
  private async _deleteObjects(objects: { name: string, versionId?: string }[]): Promise<void> {
    // Max number of keys per request for AWS S3 is 1000, see:
    //   https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html
    // Stick to this maximum in case we are using this client to talk to AWS.
    const N = this._batchSize || 1000;
    for (let i = 0; i < objects.length; i += N) {
      const batch = objects.slice(i, i + N);
      if (batch.length === 0) { continue; }
      await this._s3.removeObjects(this.bucket, batch);
    }
  }

  // List all versions of all objects starting with the given prefix.
  //
  // We page through the listing ourselves because the listObjects() stream in minio-js
  // (as of 8.0.7) doesn't escape the markers it sends for later pages, which breaks
  // request signing for keys containing a slash. Some stores, like DigitalOcean Spaces,
  // return short pages, so even a single key's listing can span many pages.
  // See https://github.com/gristlabs/grist-core/issues/2626
  private async _listVersions(prefix: string, recursive: boolean): Promise<MinIOObjectVersion[]> {
    const results: MinIOObjectVersion[] = [];
    let keyMarker = "";
    let versionIdMarker = "";
    for (;;) {
      const page = await this._s3.listObjectsQuery(this.bucket, prefix, "", {
        Delimiter: recursive ? "" : "/",
        MaxKeys: this._batchSize || 1000,
        IncludeVersion: true,
        // minio-js passes these markers through to the query string as they are.
        keyMarker: keyMarker && uriEscape(keyMarker),
        versionIdMarker: versionIdMarker && uriEscape(versionIdMarker),
      });
      results.push(...page.objects);
      if (!page.isTruncated) { return results; }
      // minio-js asks for keys to be url-encoded in the response, and decodes the keys
      // of listed objects, but leaves the key marker encoded.
      const nextKeyMarker = page.keyMarker ? decodeObjectKey(page.keyMarker) : "";
      const nextVersionIdMarker = page.versionIdMarker || "";
      if (!nextKeyMarker ||
        (nextKeyMarker === keyMarker && nextVersionIdMarker === versionIdMarker)) {
        // Fail rather than accumulate the same versions forever.
        throw new Error(`MinIOExternalStorage: version listing for ${prefix} is not advancing`);
      }
      keyMarker = nextKeyMarker;
      versionIdMarker = nextVersionIdMarker;
    }
  }
}

// Decode a url-encoded object key, the way minio-js does for listed objects.
function decodeObjectKey(key: string) {
  return decodeURIComponent(key.replace(/\+/g, " "));
}

// Escape a query parameter value, the way minio-js does for the ones it does escape,
// which matches what S3 expects when checking a request signature.
function uriEscape(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
