import ConfigsTI from "app/common/Config-ti";
import { CheckerT, createCheckers } from "ts-interface-checker";

export interface Config {
  id: string;
  key: ConfigKey;
  value: ConfigValue;
  createdAt: string;
  updatedAt: string;
  org?: ConfigOrg;
}

export interface ConfigOrg {
  id: number;
  name: string;
  domain: string | null;
}

export type ConfigKey = "audit_log_streaming_destinations" | "latest_version_available";

export type ConfigValue = AuditLogStreamingDestinations | LatestVersionAvailable;

export type AuditLogStreamingDestinations = AuditLogStreamingDestination[];

export interface AuditLogStreamingDestination {
  id: string;
  name: AuditLogStreamingDestinationName;
  url: string;
  token?: string;
}

export type AuditLogStreamingDestinationName = "splunk" | "other";

export interface LatestVersionAvailable {
  version: string;
  isNewer: boolean;
}

const {
  AuditLogStreamingDestinations,
  AuditLogStreamingDestinationName,
  ConfigKey,
  LatestVersionAvailable,
} = createCheckers(ConfigsTI);

export const AuditLogStreamingDestinationNameChecker =
  AuditLogStreamingDestinationName as CheckerT<AuditLogStreamingDestinationName>;

export const ConfigKeyChecker = ConfigKey as CheckerT<ConfigKey>;

export const ConfigValueCheckers = {
  audit_log_streaming_destinations:
    AuditLogStreamingDestinations as CheckerT<AuditLogStreamingDestinations>,
  latest_version_available:
    LatestVersionAvailable as CheckerT<LatestVersionAvailable>,
};
