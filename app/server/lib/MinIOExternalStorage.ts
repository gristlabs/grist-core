import {ApiError} from 'app/common/ApiError';
import {ObjMetadata, ObjSnapshotWithMetadata, toExternalMetadata, toGristMetadata} from 'app/common/DocSnapshot';
import {ExternalStorage} from 'app/server/lib/ExternalStorage';
import {IncomingMessage} from 'http';
import * as fse from 'fs-extra';
import * as minio from 'minio';
import * as stream from 'node:stream';

// The minio-js v8.0.0 typings are sometimes incorrect. Here are some workarounds.
interface MinIOClient extends
  // Some of them are not directly extendable, must be omitted first and then redefined.
  Omit<minio.Client, "listObjects" | "getBucketVersioning" | "removeObjects">
  {
    // The official typing returns `Promise<Readable>`, dropping some useful metadata.
    getObject(bucket: string, key: string, options: {versionId?: string}): Promise<IncomingMessage>;
    // The official typing dropped "options" in their .d.ts file, but it is present in the underlying impl.
    listObjects(bucket: string, key: string, recursive: boolean,
      options: {IncludeVersion?: boolean}): minio.BucketStream<minio.BucketItem>;
    // The released v8.0.0 wrongly returns `Promise<void>`; borrowed from PR #1297
    getBucketVersioning(bucketName: string): Promise<MinIOVersioningStatus>;
    // The released v8.0.0 typing is outdated; copied over from commit 8633968.
    removeObjects(bucketName: string, objectsList: RemoveObjectsParam): Promise<RemoveObjectsResponse[]>
  }

type MinIOVersioningStatus = "" | {
  Status: "Enabled" | "Suspended",
  MFADelete?: string,
  ExcludeFolders?: boolean,
  ExcludedPrefixes?: {Prefix: string}[]
}

type RemoveObjectsParam = string[] | { name: string, versionId?: string }[]

type RemoveObjectsResponse = null | undefined | {
  Error?: {
    Code?: string
    Message?: string
    Key?: string
    VersionId?: string
  }
}

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
    private _s3 = new minio.Client(options) as unknown as MinIOClient
  ) {
  }

  public async exists(key: string, snapshotId?: string) {
    return Boolean(await this.head(key, snapshotId));
  }

  public async head(key: string, snapshotId?: string): Promise<ObjSnapshotWithMetadata|null> {
    try {
      const head = await this._s3.statObject(
        this.bucket, key,
        snapshotId ? {versionId: snapshotId} : {},
      );
      if (!head.lastModified || !head.versionId) {
        // AWS documentation says these fields will be present.
        throw new Error('MinIOExternalStorage.head did not get expected fields');
      }
      return {
        lastModified: head.lastModified.toISOString(),
        snapshotId: head.versionId,
        ...head.metaData && { metadata: toGristMetadata(head.metaData) },
      };
    } catch (err) {
      if (!this.isFatalError(err)) { return null; }
      throw err;
    }
  }

  public async uploadStream(key: string, inStream: stream.Readable, metadata?: ObjMetadata) {
    const result = await this._s3.putObject(
      this.bucket, key, inStream, undefined,
      metadata ? {Metadata: toExternalMetadata(metadata)} : undefined
    );
    // Empirically VersionId is available in result for buckets with versioning enabled.
    return result.versionId || null;
  }

  public async upload(key: string, fname: string, metadata?: ObjMetadata) {
    const filestream = fse.createReadStream(fname);
    return this.uploadStream(key, filestream, metadata);
  }

  public async downloadStream(key: string, outStream: stream.Writable, snapshotId?: string ) {
    const request = await this._s3.getObject(
      this.bucket, key,
      snapshotId ? {versionId: snapshotId} : {}
    );
    const statusCode = request.statusCode || 500;
    if (statusCode >= 300) {
      throw new ApiError('download error', statusCode);
    }
    // See https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/requests-using-stream-objects.html
    // for an example of streaming data.
    const headers = request.headers;
    // For a versioned bucket, the header 'x-amz-version-id' contains a version id.
    const downloadedSnapshotId = String(headers['x-amz-version-id'] || '');
    return new Promise<string>((resolve, reject) => {
      request
        .on('error', reject)    // handle errors on the read stream
        .pipe(outStream)
        .on('error', reject)    // handle errors on the write stream
        .on('finish', () => resolve(downloadedSnapshotId));
    });
  }

  public async download(key: string, fname: string, snapshotId?: string) {
    const fileStream = fse.createWriteStream(fname);
    return this.downloadStream(key, fileStream, snapshotId);
  }

  public async remove(key: string, snapshotIds?: string[]) {
    if (snapshotIds) {
      await this._deleteVersions(key, snapshotIds);
    } else {
      await this._deleteAllVersions(key);
    }
  }

  public async removeAllWithPrefix(prefix: string) {
    const objects = await this._listObjects(this.bucket, prefix, true, { IncludeVersion: true });
    const objectsToDelete = objects.filter(o => o.name !== undefined).map(o => ({
      name: o.name!,
      versionId: (o as any).versionId as (string | undefined),
    }));
    await this._deleteObjects(objectsToDelete);
  }

  public async hasVersioning(): Promise<Boolean> {
    const versioning = await this._s3.getBucketVersioning(this.bucket);
    // getBucketVersioning() may return an empty string when versioning has never been enabled.
    // This situation is not addressed in minio-js v8.0.0, but included in our workaround.
    return versioning !== '' && versioning?.Status === 'Enabled';
  }

  public async versions(key: string, options?: { includeDeleteMarkers?: boolean }) {
    const results = await this._listObjects(this.bucket, key, false, {IncludeVersion: true});
    return results
      .filter(v => v.name === key &&
        v.lastModified && (v as any).versionId &&
        (options?.includeDeleteMarkers || !(v as any).isDeleteMarker))
      .map(v => ({
        lastModified: v.lastModified!.toISOString(),
        // Circumvent inconsistency of MinIO API with versionId by casting it to string
        // PR to MinIO so we don't have to do that anymore:
        // https://github.com/minio/minio-js/pull/1193
        snapshotId: String((v as any).versionId!),
      }));
  }

  public url(key: string) {
    return `minio://${this.bucket}/${key}`;
  }

  public isFatalError(err: any) {
    // ECONNRESET should not count as fatal:
    //   https://github.com/aws/aws-sdk-js/pull/3739
    // Likewise for "We encountered an internal error. Please try again."
    // These are errors associated with the AWS S3 backend, and which
    // the AWS S3 SDK would typically handle.
    return err.code !== 'NotFound' && err.code !== 'NoSuchKey' &&
      err.code !== 'ECONNRESET' && err.code !== 'InternalError';
  }

  public async close() {
    // nothing to do
  }

  // Delete all versions of an object.
  public async _deleteAllVersions(key: string) {
    const vs = await this.versions(key, {includeDeleteMarkers: true});
    await this._deleteVersions(key, vs.map(v => v.snapshotId));
  }

  // Delete a batch of versions for an object.
  private async _deleteVersions(key: string, versions: Array<string | undefined>) {
    return this._deleteObjects(
      versions.filter(v => v).map(versionId => ({
        name: key,
        versionId,
      }))
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

  private async _listObjects(...args: Parameters<MinIOClient["listObjects"]>): Promise<minio.BucketItem[]> {
    const bucketItemStream = this._s3.listObjects(...args);
    const results: minio.BucketItem[] = [];
    for await (const data of bucketItemStream) {
      results.push(data);
    }
    return results;
  }
}
