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

export type ConfigKey = "audit_log_streaming_destinations" | "setup_requests";

export type ConfigValue = AuditLogStreamingDestinations | SetupRequests;

// The value shape for each config key, letting the API type getConfig/updateConfig by the key
// passed (the `ConfigValue` union above is the same set of values, minus the key association).
export interface ConfigValueByKey {
  audit_log_streaming_destinations: AuditLogStreamingDestinations;
  setup_requests: SetupRequests;
}

export type AuditLogStreamingDestinations = AuditLogStreamingDestination[];

export interface AuditLogStreamingDestination {
  id: string;
  name: AuditLogStreamingDestinationName;
  url: string;
  token?: string;
}

export type AuditLogStreamingDestinationName = "splunk" | "other";

/**
 * Requests from users asking whoever manages the install to complete setup steps (e.g. enable
 * email). Stored install-wide under "setup_requests"; helpers and summary shape live in the
 * SetupRequests module.
 */
export interface SetupRequests {
  steps: { [stepId: string]: SetupStepRequests | undefined };
}

export interface SetupStepRequests {
  // Keyed by the requesting user's id.
  requesters: { [userId: string]: SetupRequester | undefined };
}

export interface SetupRequester {
  email: string;
  name?: string;
  at: string;  // ISO timestamp of this user's latest request.
  features: SetupFeatureId[];  // What they said they wanted the step for.
  reason?: string;
}

// The setup steps a user can ask for, matching the nudge's checklist.
export type SetupStepId = "full-grist" | "automations-plan" | "email" | "redis" | "ai";

// The features a setup step unlocks, also matching the nudge.
export type SetupFeatureId = "automations" | "invites" | "notifications" | "assistant";

const {
  AuditLogStreamingDestinations,
  AuditLogStreamingDestinationName,
  ConfigKey,
  SetupRequests,
} = createCheckers(ConfigsTI);

export const AuditLogStreamingDestinationNameChecker =
  AuditLogStreamingDestinationName as CheckerT<AuditLogStreamingDestinationName>;

export const ConfigKeyChecker = ConfigKey as CheckerT<ConfigKey>;

export const ConfigValueCheckers = {
  audit_log_streaming_destinations:
    AuditLogStreamingDestinations as CheckerT<AuditLogStreamingDestinations>,
  setup_requests: SetupRequests as CheckerT<SetupRequests>,
};
