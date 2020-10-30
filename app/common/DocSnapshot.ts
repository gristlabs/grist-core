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
