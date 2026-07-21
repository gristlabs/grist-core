import type { ScenarioDefinition, ScenarioOptions } from "test/server/lib/docapi/helpers";

/**
 * Hook to allow adding extra DocApi scenarios in other versions of Grist (SaaS, full edition)
 */
export function getExtraScenarios(options: ScenarioOptions = {}): ScenarioDefinition[] {
  // Does nothing in core
  return [];
}
