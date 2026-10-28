import { setupLocale } from "app/client/lib/localization";

// Fixtures that use withLocale() render after the page loads. Set on import, so that it covers
// fixtures that call withLocale() later; openFixture() in test/projects/testUtils waits for it
// to clear.
(window as any).isFixtureRenderPending = true;

/**
 * Sets up locales needed for translating text in a fixture.
 *
 * Calls `cb` as soon as setup is completed.
 */
export async function withLocale(cb: () => void) {
  await setupLocale();
  cb();
  (window as any).isFixtureRenderPending = false;
}
