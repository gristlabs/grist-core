import { StringUnion } from "app/common/StringUnion";

export const StorageBackendName = StringUnion(
  "minio",
  "s3",
  "azure",
);
export type StorageBackendName = typeof StorageBackendName.type;
