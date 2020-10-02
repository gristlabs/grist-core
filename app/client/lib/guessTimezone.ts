import {loadMomentTimezone} from 'app/client/lib/imports';

/**
 * Returns the browser timezone, using moment.tz.guess(), allowing overriding it via a "timezone"
 * URL parameter, for the sake of tests.
 */
export async function guessTimezone() {
  const moment = await loadMomentTimezone();
  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get('timezone') || moment.tz.guess();
}
