import {StringUnion} from 'app/common/StringUnion';

export const SortPref = StringUnion("name", "date");
export type SortPref = typeof SortPref.type;

export const ViewPref = StringUnion("list", "icons");
export type ViewPref = typeof ViewPref.type;

// A collection of preferences related to a user or org (or combination).
export interface Prefs {
  // A dummy field used only in tests.
  placeholder?: string;
}

// A collection of preferences related to a user or org (or combination).
export interface UserPrefs extends Prefs {
  // Whether to ask the user to fill out a form about their use-case, on opening the DocMenu page.
  // Set to true on first login, then reset when the form is closed, so that it only shows once.
  showNewUserQuestions?: boolean;
  // Whether to record a new sign-up event via Google Tag Manager. Set to true on first login, then
  // reset on first page load (after the event is sent), so that it's only recorded once.
  recordSignUpEvent?: boolean;
}

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
