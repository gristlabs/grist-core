/**
 * How often a doc worker reports on itself. Read by the timer that does the reporting, and by the
 * worker map, which keeps what a worker says for a few turns of it.
 */

import { appSettings } from "app/server/lib/AppSettings";

export function readLoadIntervalMs(): number {
  return appSettings.section("docWorker").flag("updateLoadIntervalMs").requireInt({
    envVar: "GRIST_DOC_WORKER_UPDATE_LOAD_INTERVAL_MS",
    minValue: 1,
    defaultValue: 5 * 1000,
  });
}
