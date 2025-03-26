import packageJson from 'package.json';

export const version = packageJson.version;
export const channel = "core";
export const gitcommit = "unknown";

export interface LatestVersionAvailable {
  version: string;
  isNewer: boolean;
}
