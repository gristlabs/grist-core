/**
 * Helpers for "setup requests": users asking whoever manages the install to complete a setup step
 * (enable email, connect Redis, etc) — asked from the nudge, seen aggregated in the admin panel.
 * Pure logic on the stored `SetupRequests` value (fold in, censor to a summary); the
 * concurrent read-modify-write is handled by `transformInstallConfig`.
 */
import {
  SetupFeatureId,
  SetupRequester,
  SetupRequests,
  SetupStepId,
  SetupStepRequests,
} from "app/common/Config";

// Runtime id lists, derived from Record keys so a new union member without an entry is a compile
// error. Kept out of Config (ts-interface-builder can't parse the derived-type idiom).
const SETUP_STEP_ID_SET: Record<SetupStepId, true> = {
  "full-grist": true, "automations-plan": true, "email": true, "redis": true, "ai": true,
};
export const SETUP_STEP_IDS = Object.keys(SETUP_STEP_ID_SET) as SetupStepId[];

const SETUP_FEATURE_ID_SET: Record<SetupFeatureId, true> = {
  automations: true, invites: true, notifications: true, assistant: true,
};
export const SETUP_FEATURE_IDS = Object.keys(SETUP_FEATURE_ID_SET) as SetupFeatureId[];

// Reasons longer than this are truncated rather than rejected.
export const MAX_SETUP_REASON_LENGTH = 280;

// What a user sends when asking for a step.
export interface SetupRequestSpec {
  step: SetupStepId;
  features: SetupFeatureId[];  // Which features they want the step for.
  reason?: string;
}

// What regular users may see: per-step counts and their own participation, never who else asked.
export interface SetupRequestsSummary {
  steps: { [stepId: string]: SetupStepSummary | undefined };
}

export interface SetupStepSummary {
  count: number;          // Number of distinct users who asked for this step.
  requestedByMe: boolean;
}

/** Number of distinct users who asked for a step. */
export function countStepRequests(step: SetupStepRequests): number {
  return Object.keys(step.requesters).length;
}

/** Clone the stored value for an immutable update, seeding an empty shape when absent. */
function cloneRequests(prev: SetupRequests | null): SetupRequests {
  return structuredClone(prev) ?? { steps: {} };
}

/** Fold one user's request into the stored value; a repeat from the same user upserts. */
export function addSetupRequest(
  prev: SetupRequests | null,
  userId: number,
  spec: SetupRequestSpec,
  requester: Pick<SetupRequester, "email" | "name" | "at">,
): SetupRequests {
  const result = cloneRequests(prev);
  const stepRequests = result.steps[spec.step] ?? { requesters: {} };
  result.steps[spec.step] = stepRequests;
  const key = String(userId);
  const existing = stepRequests.requesters[key];
  if (existing) {
    stepRequests.requesters[key] = {
      ...existing,
      ...requester,
      features: [...new Set([...existing.features, ...spec.features])],
      reason: spec.reason ?? existing.reason,
    };
  } else {
    stepRequests.requesters[key] = { ...requester, features: spec.features,
      ...(spec.reason ? { reason: spec.reason } : {}) };
  }
  return result;
}

/**
 * Remove all requests for one step (admin "Clear"), returning a new value.
 */
export function clearSetupRequestsStep(
  prev: SetupRequests | null,
  step: SetupStepId,
): SetupRequests {
  const result = cloneRequests(prev);
  delete result.steps[step];
  return result;
}

/**
 * Censor the stored value down to what the given user may see.
 */
export function summarizeSetupRequests(
  requests: SetupRequests | null,
  userId: number,
): SetupRequestsSummary {
  const summary: SetupRequestsSummary = { steps: {} };
  for (const [stepId, stepRequests] of Object.entries(requests?.steps || {})) {
    if (!stepRequests) { continue; }
    const count = countStepRequests(stepRequests);
    if (count === 0) { continue; }
    summary.steps[stepId] = {
      count,
      requestedByMe: Boolean(stepRequests.requesters[String(userId)]),
    };
  }
  return summary;
}
