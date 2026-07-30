/**
 * Setup steps shared by the Notifications & Automations nudge and the admin panel's "Setup
 * requests" item: the prerequisites an install can satisfy, their labels, and which are done.
 * Kept out of either widget so both read one definition and can't drift.
 */
import { makeT } from "app/client/lib/localization";
import { AppModel } from "app/client/models/AppModel";
import { getAutomationsStatus } from "app/client/ui/AutomationStatus";
import { SetupFeatureId, SetupStepId } from "app/common/Config";
import { isFullEditionDeployment } from "app/common/gristUrls";
import { getGristConfig } from "app/common/urlUtils";

const t = makeT("SetupSteps");

export interface SetupStep {
  id: SetupStepId;
  label: string;  // Used in the pip tooltip, the checklist and the "Next step" text.
  done: boolean;
  adminItem?: string; // Anchor id of this step's item in the admin panel, if it has one.
}

/** Human name of a setup step, shown to both users and admins. */
export function setupStepLabel(id: SetupStepId): string {
  switch (id) {
    case "full-grist": return t("Choose full Grist edition");
    case "automations-plan": return t("Use a plan with automations");
    case "email": return t("Connect email delivery");
    case "redis": return t("Connect a task queue (Redis)");
    case "ai": return t("Connect an AI provider");
  }
}

/** Human name of a nudge feature, shown to both users and admins. */
export function setupFeatureName(id: SetupFeatureId): string {
  switch (id) {
    case "automations": return t("Automations");
    case "invites": return t("Invite emails");
    case "notifications": return t("Change & comment notifications");
    case "assistant": return t("AI Assistant");
  }
}

/**
 * The setup steps, in the order an admin would tackle them, `done` read from the page config.
 *
 * "full-grist" (edition) and "automations-plan" are separate: any full edition (enterprise or
 * SaaS) satisfies the edition step, while automations is an extra plan feature on top — so only
 * the automations feature needs the plan step.
 */
export function computeSetupSteps(appModel: AppModel): SetupStep[] {
  const { deploymentType, notifierEnabled, redisAvailable, assistant } = getGristConfig();
  return [
    { id: "full-grist", label: setupStepLabel("full-grist"),
      done: isFullEditionDeployment(deploymentType), adminItem: "edition" },
    { id: "automations-plan", label: setupStepLabel("automations-plan"),
      done: getAutomationsStatus(appModel) === "available" },
    { id: "email", label: setupStepLabel("email"),
      done: Boolean(notifierEnabled) },
    { id: "redis", label: setupStepLabel("redis"),
      done: Boolean(redisAvailable) },
    { id: "ai", label: setupStepLabel("ai"),
      done: Boolean(assistant) },
  ];
}

/**
 * Which steps each feature needs — the single source of truth, read by the nudge and the live
 * notifications card's gate so they can't disagree.
 */
export const setupFeatureNeeds: Record<SetupFeatureId, SetupStepId[]> = {
  automations: ["full-grist", "automations-plan", "email"],
  invites: ["full-grist", "email"],
  notifications: ["full-grist", "email", "redis"],
  assistant: ["full-grist", "ai"],
};

/** Whether every step the given feature needs is done. */
export function isSetupFeatureReady(appModel: AppModel, id: SetupFeatureId): boolean {
  const done = new Set(computeSetupSteps(appModel).filter(s => s.done).map(s => s.id));
  return setupFeatureNeeds[id].every(stepId => done.has(stepId));
}
