/**
 * Interface for storing checksums.  Family is a short string, to allow storing
 * checksums for different namespaces.
 */
export interface IChecksumStore {
  updateChecksum(family: string, key: string, checksum: string): Promise<void>;
  getChecksum(family: string, key: string): Promise<string|null>;
}
