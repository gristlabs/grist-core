/**
 * Core metadata about a single document version.
 */
export interface ObjSnapshot {
  lastModified: string;
  snapshotId: string;
}

/**
 * Extended Grist metadata about a single document version.  Names of fields are kept
 * short since there is a tight limit on total metadata size in S3.
 */
export interface ObjMetadata {
  t?: string;     // timestamp
  tz?: string;    // timezone
  h?: string;     // actionHash
  n?: number;     // actionNum
  label?: string;
}

export interface ObjSnapshotWithMetadata extends ObjSnapshot {
  metadata?: ObjMetadata;
}

/**
 * Information about a single document snapshot in S3, including a Grist docId.
 */
export interface DocSnapshot extends ObjSnapshotWithMetadata {
  docId: string;
}

/**
 * A collection of document snapshots.  Most recent snapshots first.
 */
export interface DocSnapshots {
  snapshots: DocSnapshot[];
}

/**
 * Metadata format for external storage like S3 and Azure.
 * The only difference is that external metadata values must be strings.
 *
 * For S3, there are restrictions on total length of metadata (2 KB).
 * See: https://docs.aws.amazon.com/AmazonS3/latest/dev/UsingMetadata.html#UserMetadata
 */
type ExternalMetadata = Record<string, string>;

/**
 * Convert metadata from internal Grist format to external storage format (string values).
 */
export function toExternalMetadata(metadata: ObjMetadata): ExternalMetadata {
  const result: ExternalMetadata = {};
  for (const [key, val] of Object.entries(metadata)) {
    if (val !== undefined) { result[key] = String(val); }
  }
  return result;
}

/**
 * Select metadata controlled by Grist, and convert to expected formats.
 */
export function toGristMetadata(metadata: ExternalMetadata): ObjMetadata {
  const result: ObjMetadata = {};
  for (const key of ['t', 'tz', 'h', 'label'] as const) {
    if (metadata[key]) { result[key] = metadata[key]; }
  }
  if (metadata.n) { result.n = parseInt(metadata.n, 10); }
  return result;
}
