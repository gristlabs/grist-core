/**
 * Some client-side code sets global properties (on the global Window object). This isn't a
 * great practice, and should normally be avoided. But on occasion it's used to simplify testing,
 * make debugging easier, and initialization (e.g. gristConfig).
 *
 * This file collects most of the properties we use, for typings and visibility.
 */
import type {TopAppModel} from 'app/client/models/AppModel';
import type {DocPageModel} from 'app/client/models/DocPageModel';
import type {GristLoadConfig} from 'app/common/gristUrls';
import type {TestState} from 'app/common/TestState';

export interface GristWindow {
  $?: JQueryStatic;    // Some old code still uses JQuery events.
  gristConfig?: GristLoadConfig;
  gristNotify?: (message: string) => void;
  getAppErrors?: () => string[];
  gristDocPageModel?: DocPageModel;
  gristApp?: {
    topAppModel?: TopAppModel;
    testNumPendingApiRequests?: () => number;
  };
  cmd?: {[name: string]: () => void};
  isRunningUnderElectron?: boolean;
  resetDismissedPopups?: (seen?: boolean) => void;
  resetOnboarding?: () => void;
  testGrist?: Partial<TestState>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Window extends GristWindow {}
}
