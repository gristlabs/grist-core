import {setupLocale} from 'app/client/lib/localization';

/**
 * Sets up locales needed for translating text in a fixture.
 *
 * Calls `cb` as soon as setup is completed.
 */
export async function withLocale(cb: () => void) {
  await setupLocale();
  cb();
}
