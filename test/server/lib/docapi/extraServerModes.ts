import type { TestServerInitializer } from "test/server/lib/docapi/helpers";

export type ExtraServerModes = never;

/**
 * Hook to allow adding extra server modes in other versions of Grist (SaaS, full edition)
 */
export function getExtraServerModeInitializer(mode: string): TestServerInitializer | undefined {
  return undefined;
}
