import moment from "moment-timezone";

/**
 * Returns the current local time. Allows overriding via a "currentTime" URL parameter, for the sake
 * of tests.
 */
export default function getCurrentTime(): moment.Moment {
  const getDefault = () => moment();
  if (typeof window === 'undefined' || !window) { return getDefault(); }
  const searchParams = new URLSearchParams(window.location.search);

  return searchParams.has('currentTime') ? moment(searchParams.get('currentTime') || undefined) : getDefault();
}
