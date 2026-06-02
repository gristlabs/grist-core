import { StringUnion } from "app/common/StringUnion";

export const StorageBackendName = StringUnion(
  "minio",
  "s3",
  "azure",
  "filesystem",
);
export type StorageBackendName = typeof StorageBackendName.type;
