import {StringUnion} from 'app/common/StringUnion';
import {ThemePrefs} from 'app/common/ThemePrefs';

export const SortPref = StringUnion("name", "date");
export type SortPref = typeof SortPref.type;

export const ViewPref = StringUnion("list", "icons");
export type ViewPref = typeof ViewPref.type;

// A collection of preferences related to a user or org (or combination).
export interface Prefs {
  // A dummy field used only in tests.
  placeholder?: string;
}

// A collection of preferences related to a user.
export interface UserPrefs extends Prefs {
  // Whether to ask the user to fill out a form about their use-case, on opening the DocMenu page.
  // Set to true on first login, then reset when the form is closed, so that it only shows once.
  showNewUserQuestions?: boolean;
  // Whether to record a new sign-up event via Google Tag Manager. Set to true on first login, then
  // reset on first page load (after the event is sent), so that it's only recorded once.
  recordSignUpEvent?: boolean;
  // Theme-related preferences.
  theme?: ThemePrefs;
  // List of deprecated warnings user have seen. Kept for historical reasons as some users have them in their prefs.
  seenDeprecatedWarnings?: DeprecationWarning[];
  // List of dismissedPopups user have seen.
  dismissedPopups?: DismissedPopup[];
  // Behavioral prompt preferences.
  behavioralPrompts?: BehavioralPromptPrefs;
  // Welcome popups a user has dismissed.
  dismissedWelcomePopups?: DismissedReminder[];
  // Localization support.
  locale?: string;
}

// A collection of preferences related to a combination of user and org.
export interface UserOrgPrefs extends Prefs {
  docMenuSort?: SortPref;
  docMenuView?: ViewPref;

  // List of example docs that the user has seen and dismissed the welcome card for.
  // The numbers are the `id` from IExampleInfo in app/client/ui/ExampleInfo.
  // By living in UserOrgPrefs, this applies only to the examples-containing org.
  seenExamples?: number[];

  // Whether the user should see the onboarding tour of Grist. False by default, since existing
  // users should not see it. New users get this set to true when the user is created. This
  // applies to the personal org only; the tour is currently only shown there.
  showGristTour?: boolean;

  // List of document IDs where the user has seen and dismissed the document tour.
  seenDocTours?: string[];
}

export type OrgPrefs = Prefs;

/**
 * List of all deprecated warnings that user can see and dismiss.
 * All of them are marked as seen for new users in FlexServer.ts (welcomeNewUser handler).
 * For now we use then to mark which keyboard shortcuts are deprecated, so those keys
 * are also used in commandList.js.
 *
 * Source code for this feature was deprecated itself :). Here is a link to the latest revision:
 * https://github.com/gristlabs/grist-core/blob/ec20e7fb68786e10979f238c16c432c50a9a7464/app/client/components/DeprecatedCommands.ts
 */
export const DeprecationWarning = StringUnion(
  // Those are not checked anymore. They are kept here for historical reasons (as some users have them marked as seen
  // so they should not be reused).
  // 'deprecatedInsertRowBefore',
  // 'deprecatedInsertRecordAfter',
  // 'deprecatedDeleteRecords',
);
export type DeprecationWarning = typeof DeprecationWarning.type;

export const BehavioralPrompt = StringUnion(
  'referenceColumns',
  'referenceColumnsConfig',
  'rawDataPage',
  'accessRules',
  'filterButtons',
  'nestedFiltering',
  'pageWidgetPicker',
  'pageWidgetPickerSelectBy',
  'editCardLayout',
  'addNew',
  'rickRow',
  'customURL',
  'calendarConfig',
  'formsAreHere',
);
export type BehavioralPrompt = typeof BehavioralPrompt.type;

export interface BehavioralPromptPrefs {
  /** Defaults to false. */
  dontShowTips: boolean;
  /** List of tips that have been dismissed. */
  dismissedTips: BehavioralPrompt[];
}

/**
 * List of all popups that user can see and dismiss
 */
export const DismissedPopup = StringUnion(
  'deleteRecords',        // confirmation for deleting records keyboard shortcut
  'deleteFields',         // confirmation for deleting columns keyboard shortcut
  'tutorialFirstCard',    // first card of the tutorial
  'formulaHelpInfo',      // formula help info shown in the popup editor
  'formulaAssistantInfo', // formula assistant info shown in the popup editor
  'supportGrist',         // nudge to opt in to telemetry
  'publishForm',          // confirmation for publishing a form
  'unpublishForm',        // confirmation for unpublishing a form
);
export type DismissedPopup = typeof DismissedPopup.type;

export const WelcomePopup = StringUnion(
  'coachingCall',
);
export type WelcomePopup = typeof WelcomePopup.type;

export interface DismissedReminder {
  /** The name of the popup. */
  id: WelcomePopup;
  /** Unix timestamp in ms when the popup was last dismissed. */
  lastDismissedAt: number;
  /** If non-null, Unix timestamp in ms when the popup will reappear. */
  nextAppearanceAt: number | null;
  /**  The number of times this popup has been dismissed. */
  timesDismissed: number;
}
