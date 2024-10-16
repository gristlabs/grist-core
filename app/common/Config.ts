import ConfigsTI from "app/common/Config-ti";
import { CheckerT, createCheckers } from "ts-interface-checker";

export type ConfigKey = "audit_log_streaming_destinations";

export type ConfigValue = AuditLogStreamingDestinations;

export type AuditLogStreamingDestinations = AuditLogStreamingDestination[];

export interface AuditLogStreamingDestination {
  id: string;
  name: "splunk";
  url: string;
  token?: string;
}

export const ConfigKeyChecker = createCheckers(ConfigsTI)
  .ConfigKey as CheckerT<ConfigKey>;

const { AuditLogStreamingDestinations } = createCheckers(ConfigsTI);

export const ConfigValueCheckers = {
  audit_log_streaming_destinations:
    AuditLogStreamingDestinations as CheckerT<AuditLogStreamingDestinations>,
};
